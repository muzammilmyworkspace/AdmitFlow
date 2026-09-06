import "server-only";
import argon2 from "argon2";

// Password hashing — docs/13-authentication-authorization.md §1 (argon2id).
//
// `server-only` makes importing this from a client component fail with a clear error at
// build time instead of a confusing "Can't resolve 'fs'" bundler trace from argon2's
// native binding. The shared, isomorphic policy rules live in ./password-policy.ts.

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // A malformed/corrupt stored hash must read as "wrong password", never as an
    // exception that leaks a different error shape to the caller than a bad password.
    return false;
  }
}

// NOTE: breached-password checking (k-anonymity range query against Pwned Passwords) is
// specified in docs/30-validation-rules.md §2 but not implemented yet — it needs an
// outbound HTTP call, which belongs behind the worker/service boundary. Tracked as a
// Phase 3 follow-up in docs/52-implementation-roadmap.md rather than silently dropped.
