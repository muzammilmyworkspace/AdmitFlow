import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { checkPasswordPolicy } from "@/lib/auth/password-policy";
import { sendAuthEmail } from "@/lib/notifications/dev-mailer";
import type { Prisma } from "../../prisma/generated/client";

// Account self-service — the things a student must be able to do to their own account
// without asking support: change their password, see and cut off their sessions, take
// their data with them, and leave.
//
// docs/13-authentication-authorization.md §3, docs/42-gdpr-and-data-privacy.md §3.

/** Disclosed up front at request time, so it is a stated policy rather than a delay tactic. */
export const DELETION_GRACE_DAYS = 7;

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

export async function changePassword(params: {
  userId: string;
  currentPassword: string;
  newPassword: string;
  currentSessionTokenHash?: string | null;
  ipAddress?: string | null;
}) {
  const user = await db.user.findUnique({ where: { id: params.userId } });
  if (!user?.passwordHash) {
    throw new AppError("VALIDATION_ERROR", "This account has no password set.");
  }

  // Re-authenticate before changing the credential. Without this, anyone who finds an
  // unlocked laptop can lock the real owner out of their own account.
  const ok = await verifyPassword(user.passwordHash, params.currentPassword);
  if (!ok) throw new AppError("AUTH_INVALID_CREDENTIALS", "That is not your current password.");

  const policy = checkPasswordPolicy(params.newPassword);
  if (!policy.ok) throw new AppError("VALIDATION_ERROR", policy.reason);

  if (await verifyPassword(user.passwordHash, params.newPassword)) {
    throw new AppError("VALIDATION_ERROR", "Choose a password you haven't used here before.");
  }

  const passwordHash = await hashPassword(params.newPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    await writeAuditLog(
      {
        actorId: user.id,
        actorType: "STUDENT",
        action: "user.password_changed",
        entityType: "User",
        entityId: user.id,
        metadata: { subtype: "SELF_SERVICE" },
        ipAddress: params.ipAddress,
      },
      tx,
    );
  });

  // Same reasoning as a reset: a password change invalidates everywhere else it was
  // used. The caller's own session is spared so they are not signed out of the page
  // they just used to do this.
  await db.session.updateMany({
    where: {
      userId: user.id,
      revokedAt: null,
      ...(params.currentSessionTokenHash
        ? { NOT: { tokenHash: params.currentSessionTokenHash } }
        : {}),
    },
    data: { revokedAt: new Date() },
  });

  await sendAuthEmail({
    to: user.email,
    subject: "Your AdmitFlow password was changed",
    body: "Your password was just changed. If this wasn't you, contact support immediately.",
  });
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface SessionView {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

/** Every session that could still be used to act as this student, right now. */
export async function listSessions(
  userId: string,
  currentTokenHash: string | null,
): Promise<SessionView[]> {
  const now = new Date();
  const rows = await db.session.findMany({
    where: {
      userId,
      revokedAt: null,
      expiresAt: { gt: now },
      absoluteExpiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  });

  return rows.map((row) => ({
    id: row.id,
    userAgent: row.userAgent,
    ipAddress: row.ipAddress,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    isCurrent: currentTokenHash !== null && row.tokenHash === currentTokenHash,
  }));
}

/** Revokes one session. Scoped by userId so an id from another account matches nothing. */
export async function revokeSession(userId: string, sessionId: string) {
  const result = await db.session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count === 0) {
    throw new AppError("RESOURCE_NOT_FOUND", "That session is not active.");
  }
  await writeAuditLog({
    actorId: userId,
    actorType: "STUDENT",
    action: "session.revoked",
    entityType: "Session",
    entityId: sessionId,
  });
}

// ---------------------------------------------------------------------------
// Data subject rights
// ---------------------------------------------------------------------------

/**
 * Everything the platform holds about this student, as one JSON document.
 *
 * Deliberately assembled from explicit selects rather than by handing back whole rows:
 * a `select: *` here would export password hashes and session token hashes the moment
 * someone added a relation, and an export endpoint is precisely where that must not
 * happen. Audit entries are excluded per docs/42 §3.2 — they are retained, but they are
 * not part of a student-facing export.
 */
export async function exportUserData(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      status: true,
      emailVerifiedAt: true,
      lastLoginAt: true,
      createdAt: true,
      profile: {
        select: {
          firstName: true,
          lastName: true,
          dateOfBirth: true,
          phone: true,
          budgetMin: true,
          budgetMax: true,
          budgetCurrency: true,
          onboardingCompletedAt: true,
          createdAt: true,
          educations: {
            select: {
              level: true,
              institutionName: true,
              fieldOfStudy: true,
              startDate: true,
              endDate: true,
              isCurrent: true,
              gradingScale: true,
              gradeValue: true,
            },
          },
          languageTests: {
            select: {
              testType: true,
              overallScore: true,
              sectionScores: true,
              testDate: true,
              expiryDate: true,
            },
          },
        },
      },
    },
  });
  if (!user) throw new AppError("RESOURCE_NOT_FOUND", "No such account.");

  const [documents, applications, purchases, bookings, reviews] = await Promise.all([
    db.document.findMany({
      where: { ownerId: userId },
      select: {
        type: true,
        status: true,
        originalFilename: true,
        sizeBytes: true,
        createdAt: true,
      },
    }),
    db.application.findMany({
      where: { studentId: userId },
      select: { status: true, submittedAt: true, createdAt: true, programId: true },
    }),
    db.purchase.findMany({
      where: { customer: { userId } },
      select: {
        status: true,
        createdAt: true,
        price: { select: { amount: true, currency: true, product: { select: { key: true } } } },
      },
    }),
    db.booking.findMany({
      where: { studentId: userId },
      select: { status: true, createdAt: true, slot: { select: { startsAt: true, endsAt: true } } },
    }),
    db.assessmentReview.findMany({
      where: { studentId: userId },
      select: { status: true, studentNote: true, reviewerNotes: true, createdAt: true },
    }),
  ]);

  await writeAuditLog({
    actorId: userId,
    actorType: "STUDENT",
    action: "user.data_exported",
    entityType: "User",
    entityId: userId,
  });

  return {
    exportedAt: new Date().toISOString(),
    // Says plainly what is not in here, so the file is not mistaken for the whole record.
    note:
      "This is the personal data AdmitFlow holds about you. Internal audit-log entries " +
      "are retained for security and dispute purposes and are not included; financial " +
      "records are summarised here and retained in full for the legally required period.",
    account: user,
    documents,
    applications,
    purchases,
    consultations: bookings,
    assessmentReviews: reviews,
  };
}

/** What deletion will and will not do, in the words the student is shown before agreeing. */
export const DELETION_DISCLOSURE = {
  deleted: [
    "Your profile, education history and test scores",
    "Your assessments and their results",
    "Your uploaded documents, removed from storage",
  ],
  retained: [
    "Payment and invoice records, which we are legally required to keep for tax and accounting — your name and contact details are removed from them",
    "Our internal audit log of actions taken on the account, which exists to show what happened if anything is ever disputed",
  ],
} as const;

export async function requestDeletion(userId: string) {
  const existing = await db.dataSubjectRequest.findFirst({
    where: { userId, type: "DELETION", status: "PENDING" },
  });
  if (existing) {
    throw new AppError("CONFLICT", "A deletion request is already in progress.");
  }

  const executeAfter = new Date(Date.now() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000);

  const request = await db.$transaction(async (tx: Prisma.TransactionClient) => {
    const row = await tx.dataSubjectRequest.create({
      data: {
        userId,
        type: "DELETION",
        status: "PENDING",
        executeAfter,
        summary: {
          willDelete: [...DELETION_DISCLOSURE.deleted],
          willRetain: [...DELETION_DISCLOSURE.retained],
          graceDays: DELETION_GRACE_DAYS,
        },
      },
    });
    // The account is parked, not destroyed. Nothing irreversible has happened yet, which
    // is what makes the grace period real rather than cosmetic.
    await tx.user.update({ where: { id: userId }, data: { status: "PENDING_DELETION" } });
    await writeAuditLog(
      {
        actorId: userId,
        actorType: "STUDENT",
        action: "user.deletion_requested",
        entityType: "DataSubjectRequest",
        entityId: row.id,
        metadata: { executeAfter: executeAfter.toISOString() },
      },
      tx,
    );
    return row;
  });

  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  await sendAuthEmail({
    to: user.email,
    subject: "Your AdmitFlow account is scheduled for deletion",
    body:
      `Your account will be deleted on ${executeAfter.toDateString()}. ` +
      "If you didn't ask for this, sign in before then and cancel it.",
  });

  return { id: request.id, executeAfter: executeAfter.toISOString() };
}

export async function cancelDeletion(userId: string) {
  const pending = await db.dataSubjectRequest.findFirst({
    where: { userId, type: "DELETION", status: "PENDING" },
  });
  if (!pending) throw new AppError("RESOURCE_NOT_FOUND", "There is no deletion request to cancel.");

  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.dataSubjectRequest.update({
      where: { id: pending.id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    // Back to a working account. ACTIVE is correct here because only a completed profile
    // could have reached this point.
    await tx.user.update({ where: { id: userId }, data: { status: "ACTIVE" } });
    await writeAuditLog(
      {
        actorId: userId,
        actorType: "STUDENT",
        action: "user.deletion_cancelled",
        entityType: "DataSubjectRequest",
        entityId: pending.id,
      },
      tx,
    );
  });
}

/** The pending deletion request for this account, if there is one. */
export async function getPendingDeletion(userId: string) {
  const row = await db.dataSubjectRequest.findFirst({
    where: { userId, type: "DELETION", status: "PENDING" },
    orderBy: { requestedAt: "desc" },
  });
  if (!row) return null;
  return {
    id: row.id,
    requestedAt: row.requestedAt.toISOString(),
    executeAfter: row.executeAfter?.toISOString() ?? null,
  };
}

/**
 * Executes the deletions whose grace period has passed.
 *
 * Called by the scheduled sweep, never inline from a request — the work is unbounded and
 * a student pressing a button should not be waiting on it.
 *
 * The two-tier split is docs/42 §3.2: personal data goes, records under an independent
 * legal retention obligation stay with the personal linkage scrubbed.
 */
export async function executeDueDeletions(now: Date = new Date()): Promise<{ deleted: number }> {
  const due = await db.dataSubjectRequest.findMany({
    where: { type: "DELETION", status: "PENDING", executeAfter: { lte: now } },
    take: 50,
  });

  let deleted = 0;
  for (const request of due) {
    await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const userId = request.userId;

      // Hard-delete the personal record. Profile children cascade or are removed here.
      const profile = await tx.profile.findUnique({ where: { userId }, select: { id: true } });
      if (profile) {
        await tx.education.deleteMany({ where: { profileId: profile.id } });
        await tx.languageTest.deleteMany({ where: { profileId: profile.id } });
        await tx.profile.delete({ where: { id: profile.id } });
      }

      // Documents: the stored objects are removed by the vault's own DELETED transition;
      // the rows are tombstoned so the state history survives without the filename.
      await tx.document.updateMany({
        where: { ownerId: userId },
        data: { status: "DELETED", originalFilename: "[removed]" },
      });

      // The account itself becomes an anonymous tombstone rather than a deleted row:
      // purchases and applications reference it, and those are retained.
      await tx.user.update({
        where: { id: userId },
        data: {
          status: "DELETED",
          email: `deleted-${userId}@deleted.invalid`,
          passwordHash: null,
          deletedAt: now,
        },
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });

      await tx.dataSubjectRequest.update({
        where: { id: request.id },
        data: {
          status: "FULFILLED",
          fulfilledAt: now,
          summary: {
            deleted: [...DELETION_DISCLOSURE.deleted],
            retained: [...DELETION_DISCLOSURE.retained],
          },
        },
      });

      await writeAuditLog(
        {
          actorId: null,
          actorType: "SYSTEM",
          action: "user.deleted",
          entityType: "User",
          entityId: userId,
          metadata: { requestId: request.id },
        },
        tx,
      );
      deleted += 1;
    });
  }

  return { deleted };
}
