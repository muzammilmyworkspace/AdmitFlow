import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import { sendAuthEmail } from "@/lib/notifications/dev-mailer";
import { getEnv } from "@/lib/env";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { checkPasswordPolicy } from "@/lib/auth/password-policy";
import {
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  PASSWORD_RESET_TTL_MS,
  VERIFICATION_LINK_TTL_MS,
  generateOpaqueToken,
  generateOtp,
  hashToken,
  safeEqualHex,
} from "@/lib/auth/tokens";
import { createSession, revokeAllSessions } from "@/lib/auth/session";

// Auth business logic — docs/13-authentication-authorization.md, contracts in
// docs/12-api-contracts.md §2. Route handlers stay thin: parse, call, respond
// (docs/08-backend-architecture.md — "business logic never lives in route handlers").

interface RequestMeta {
  userAgent?: string | null;
  ipAddress?: string | null;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function issueEmailVerification(userId: string, email: string) {
  const rawToken = generateOpaqueToken();
  const otp = generateOtp();
  const now = Date.now();

  await db.verificationToken.create({
    data: {
      userId,
      type: "EMAIL_VERIFICATION",
      tokenHash: hashToken(rawToken),
      otpHash: hashToken(otp),
      otpExpiresAt: new Date(now + OTP_TTL_MS),
      expiresAt: new Date(now + VERIFICATION_LINK_TTL_MS),
    },
  });

  const link = `${getEnv().NEXT_PUBLIC_APP_URL}/verify-email?token=${rawToken}`;
  await sendAuthEmail({
    to: email,
    subject: "Verify your AdmitFlow email",
    body: `Verify your email: ${link}\nOr enter this code: ${otp} (valid 10 minutes)`,
  });
}

export async function signup(
  input: { email: string; password: string; firstName: string; lastName: string },
  meta: RequestMeta = {},
) {
  const email = normalizeEmail(input.email);

  const policy = checkPasswordPolicy(input.password);
  if (!policy.ok) throw new AppError("VALIDATION_ERROR", policy.reason);

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    // Deliberate, documented trade-off: signup does NOT hide "already registered"
    // behind a generic success, unlike login which never reveals whether an email
    // exists (docs/12-api-contracts.md §2).
    throw new AppError("EMAIL_ALREADY_REGISTERED", "An account with this email already exists.");
  }

  const passwordHash = await hashPassword(input.password);
  const studentRole = await db.role.findUnique({ where: { name: "STUDENT" } });
  if (!studentRole) {
    throw new AppError("INTERNAL_ERROR", "STUDENT role is missing — run the reference-data seed.");
  }

  // A1 + A2 from docs/31-state-machines.md §1 happen in one transaction: every new
  // account lands directly in EMAIL_UNVERIFIED, never resting at REGISTERED.
  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        passwordHash,
        status: "EMAIL_UNVERIFIED",
        profile: { create: { firstName: input.firstName.trim(), lastName: input.lastName.trim() } },
        userRoles: { create: { roleId: studentRole.id } },
      },
    });

    await writeAuditLog(
      {
        actorId: created.id,
        actorType: "STUDENT",
        action: "user.registered",
        entityType: "User",
        entityId: created.id,
        ipAddress: meta.ipAddress,
      },
      tx,
    );

    return created;
  });

  await issueEmailVerification(user.id, user.email);

  return {
    userId: user.id,
    email: user.email,
    status: user.status,
    verificationMethod: "LINK_AND_OTP" as const,
  };
}

export async function resendVerification(email: string) {
  const user = await db.user.findUnique({ where: { email: normalizeEmail(email) } });
  // Always succeeds from the caller's perspective — no account enumeration here.
  if (user && user.status === "EMAIL_UNVERIFIED") {
    await issueEmailVerification(user.id, user.email);
  }
}

export async function verifyEmail(
  input: { token?: string; userId?: string; otp?: string },
  meta: RequestMeta = {},
) {
  const record = input.token
    ? await db.verificationToken.findUnique({
        where: { tokenHash: hashToken(input.token) },
        include: { user: true },
      })
    : await db.verificationToken.findFirst({
        where: { userId: input.userId, type: "EMAIL_VERIFICATION", consumedAt: null },
        orderBy: { createdAt: "desc" },
        include: { user: true },
      });

  if (!record || record.type !== "EMAIL_VERIFICATION") {
    throw new AppError("TOKEN_INVALID_OR_EXPIRED", "This verification link is invalid or has expired.");
  }
  if (record.user.status !== "EMAIL_UNVERIFIED") {
    throw new AppError("ALREADY_VERIFIED", "This email address is already verified.");
  }
  if (record.consumedAt) {
    throw new AppError("TOKEN_INVALID_OR_EXPIRED", "This verification link has already been used.");
  }

  if (input.otp) {
    if (record.otpAttempts >= OTP_MAX_ATTEMPTS) {
      throw new AppError("TOKEN_INVALID_OR_EXPIRED", "Too many incorrect codes. Request a new one.");
    }
    const otpValid =
      record.otpHash &&
      record.otpExpiresAt &&
      record.otpExpiresAt > new Date() &&
      safeEqualHex(record.otpHash, hashToken(input.otp));
    if (!otpValid) {
      await db.verificationToken.update({
        where: { id: record.id },
        data: { otpAttempts: { increment: 1 } },
      });
      throw new AppError("OTP_INCORRECT", "That code is incorrect or has expired.");
    }
  } else if (record.expiresAt <= new Date()) {
    throw new AppError("TOKEN_INVALID_OR_EXPIRED", "This verification link has expired.");
  }

  // A3 then A4 (docs/31-state-machines.md §1): VERIFIED is passed through to ONBOARDING
  // immediately — there is no useful resting state between "email confirmed" and "must
  // complete onboarding", and the token is single-use.
  const user = await db.$transaction(async (tx) => {
    await tx.verificationToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    const updated = await tx.user.update({
      where: { id: record.userId },
      data: { status: "ONBOARDING", emailVerifiedAt: new Date() },
    });
    await writeAuditLog(
      {
        actorId: updated.id,
        actorType: "STUDENT",
        action: "user.email_verified",
        entityType: "User",
        entityId: updated.id,
        ipAddress: meta.ipAddress,
      },
      tx,
    );
    return updated;
  });

  await createSession(user.id, meta);
  return { userId: user.id, status: user.status };
}

export async function login(input: { email: string; password: string }, meta: RequestMeta = {}) {
  const email = normalizeEmail(input.email);
  const user = await db.user.findUnique({
    where: { email },
    include: { userRoles: { include: { role: true } } },
  });

  // Identical failure whether the email doesn't exist or the password is wrong — never
  // USER_NOT_FOUND (docs/12-api-contracts.md §2). The password verify still runs against
  // a dummy hash when the user is missing so response timing doesn't leak existence.
  const passwordOk = user?.passwordHash
    ? await verifyPassword(user.passwordHash, input.password)
    : await verifyPassword(
        "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHR2YWx1ZQ$0000000000000000000000000000000000000000000",
        input.password,
      );

  if (!user || !passwordOk) {
    throw new AppError("AUTH_INVALID_CREDENTIALS", "Email or password is incorrect.");
  }
  if (user.status === "EMAIL_UNVERIFIED") {
    throw new AppError("AUTH_EMAIL_NOT_VERIFIED", "Please verify your email address to continue.");
  }
  if (user.status === "SUSPENDED" || user.status === "DEACTIVATED" || user.deletedAt) {
    throw new AppError("ACCOUNT_SUSPENDED", "This account is not currently active.");
  }

  // Session fixation prevention: always a fresh session id (docs/13 §3.2).
  await createSession(user.id, meta);
  await writeAuditLog({
    actorId: user.id,
    actorType: "STUDENT",
    action: "user.login",
    entityType: "User",
    entityId: user.id,
    ipAddress: meta.ipAddress,
  });
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  return {
    userId: user.id,
    status: user.status,
    roles: user.userRoles.map((ur) => ur.role.name),
  };
}

export async function requestPasswordReset(email: string) {
  const user = await db.user.findUnique({ where: { email: normalizeEmail(email) } });
  // Always behaves identically whether or not the account exists (docs/12 §2).
  if (!user) return;

  const rawToken = generateOpaqueToken();
  await db.verificationToken.create({
    data: {
      userId: user.id,
      type: "PASSWORD_RESET",
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
    },
  });

  await sendAuthEmail({
    to: user.email,
    subject: "Reset your AdmitFlow password",
    body: `Reset your password: ${getEnv().NEXT_PUBLIC_APP_URL}/reset-password?token=${rawToken}\nThis link expires in 30 minutes.`,
  });
}

export async function resetPassword(
  input: { token: string; newPassword: string },
  meta: RequestMeta = {},
) {
  const policy = checkPasswordPolicy(input.newPassword);
  if (!policy.ok) throw new AppError("VALIDATION_ERROR", policy.reason);

  const record = await db.verificationToken.findUnique({
    where: { tokenHash: hashToken(input.token) },
  });
  if (
    !record ||
    record.type !== "PASSWORD_RESET" ||
    record.consumedAt ||
    record.expiresAt <= new Date()
  ) {
    throw new AppError("TOKEN_INVALID_OR_EXPIRED", "This reset link is invalid or has expired.");
  }

  const passwordHash = await hashPassword(input.newPassword);
  await db.$transaction(async (tx) => {
    await tx.verificationToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
    await writeAuditLog(
      {
        actorId: record.userId,
        actorType: "STUDENT",
        action: "user.password_changed",
        entityType: "User",
        entityId: record.userId,
        ipAddress: meta.ipAddress,
      },
      tx,
    );
  });

  // A password reset is a strong signal the old sessions may be compromised — treat it
  // like logout-all (docs/12-api-contracts.md §2, docs/13 §3.3).
  await revokeAllSessions(record.userId);

  const user = await db.user.findUniqueOrThrow({ where: { id: record.userId } });
  await sendAuthEmail({
    to: user.email,
    subject: "Your AdmitFlow password was changed",
    body: "Your password was just changed. If this wasn't you, contact support immediately.",
  });
}
