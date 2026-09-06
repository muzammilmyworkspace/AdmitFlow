import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

// Opaque token/OTP generation and hashing — docs/13-authentication-authorization.md §3.
// Raw values are returned to the caller exactly once (to put in an email) and only ever
// stored as SHA-256 hashes, so a database leak can't be replayed against these flows.
//
// SHA-256 (not argon2) is correct here: these are 256-bit random values with no
// guessable structure, so the slow-hash property argon2 provides for human-chosen
// passwords buys nothing, and verification happens on a request path.

export const VERIFICATION_LINK_TTL_MS = 24 * 60 * 60 * 1000; // 24h — docs/13 §3.1
export const OTP_TTL_MS = 10 * 60 * 1000; // 10 min — docs/13 §3.1
export const OTP_MAX_ATTEMPTS = 5; // docs/12 §2, docs/47-rate-limiting.md
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000; // 30 min — docs/13 §3.3

export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url"); // 256-bit
}

export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// Constant-time comparison so a token/OTP check can't be narrowed by response timing.
export function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
