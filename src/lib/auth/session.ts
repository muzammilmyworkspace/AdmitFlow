import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { generateOpaqueToken, hashToken } from "./tokens";

// Server-side session records — docs/13-authentication-authorization.md §2.
// The cookie carries an opaque random id, never a JWT or any embedded claim: every
// request resolves it against the Session table, which is what makes "log out
// everywhere" immediate and total rather than "eventually, when a token expires".

export const SESSION_COOKIE = "af_session";

const IDLE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // sliding, 30d — docs/13 §2.2
const ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // hard cap, 90d — docs/13 §2.2
const SLIDE_THRESHOLD = 0.25; // only extend once >25% through the idle window

export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ipAddress?: string | null } = {},
) {
  const rawToken = generateOpaqueToken();
  const now = Date.now();

  await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(rawToken),
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ipAddress ?? null,
      expiresAt: new Date(now + IDLE_TTL_MS),
      absoluteExpiresAt: new Date(now + ABSOLUTE_TTL_MS),
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, rawToken, {
    httpOnly: true,
    secure: process.env.APP_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(ABSOLUTE_TTL_MS / 1000),
  });

  return rawToken;
}

/**
 * The hash of the caller own session cookie, or null when unauthenticated.
 *
 * Lets a caller distinguish "this session" from the others in the session list, and
 * spare it when a password change revokes the rest. Returns the hash, never the raw
 * token, so nothing downstream can be tempted to reuse it as a credential.
 */
export async function currentSessionTokenHash(): Promise<string | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;
  return raw ? hashToken(raw) : null;
}

export async function getSessionUser() {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { user: { include: { profile: true, userRoles: { include: { role: true } } } } },
  });

  if (!session || session.revokedAt) return null;

  const now = new Date();
  // Both bounds are enforced: a session that keeps sliding forward still dies at its
  // absolute cap, bounding the blast radius of a long-lived stolen cookie.
  if (session.expiresAt <= now || session.absoluteExpiresAt <= now) return null;
  if (session.user.deletedAt || session.user.status === "DELETED") return null;

  // Sliding extension, written only when meaningfully aged — avoids a DB write per request.
  const elapsed = IDLE_TTL_MS - (session.expiresAt.getTime() - now.getTime());
  if (elapsed > IDLE_TTL_MS * SLIDE_THRESHOLD) {
    const slid = new Date(Math.min(now.getTime() + IDLE_TTL_MS, session.absoluteExpiresAt.getTime()));
    await db.session.update({ where: { id: session.id }, data: { expiresAt: slid } });
  }

  return { session, user: session.user };
}

export async function revokeCurrentSession() {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;
  if (raw) {
    await db.session.updateMany({
      where: { tokenHash: hashToken(raw), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  cookieStore.delete(SESSION_COOKIE);
}

export async function revokeAllSessions(userId: string): Promise<number> {
  const result = await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}
