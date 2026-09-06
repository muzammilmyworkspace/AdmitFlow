// Password policy — docs/30-validation-rules.md §2 (min 12 chars, 3 of 4 character
// classes, no forced rotation, per NIST 800-63B).
//
// Deliberately isomorphic and dependency-free: the signup/reset forms show these
// requirements *before* submission and the server enforces them, so both sides must read
// the same rule. Hashing lives in ./password.ts, which is server-only — keeping them in
// one module pulled argon2's native binding into the browser bundle and broke the build.

export const PASSWORD_MIN_LENGTH = 12;

export const PASSWORD_REQUIREMENTS = [
  `At least ${PASSWORD_MIN_LENGTH} characters`,
  "At least 3 of: uppercase, lowercase, number, symbol",
] as const;

export function checkPasswordPolicy(password: string): { ok: true } | { ok: false; reason: string } {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, reason: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  const classes = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) {
    return {
      ok: false,
      reason: "Password must include at least 3 of: uppercase, lowercase, number, symbol.",
    };
  }
  return { ok: true };
}
