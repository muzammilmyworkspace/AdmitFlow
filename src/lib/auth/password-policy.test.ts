import { describe, expect, it } from "vitest";
import { checkPasswordPolicy, PASSWORD_MIN_LENGTH } from "./password-policy";

// docs/30-validation-rules.md §2 — min 12 chars, at least 3 of 4 character classes.
// docs/35-testing-strategy.md rates auth/security paths as highest-coverage.

describe("checkPasswordPolicy", () => {
  it("rejects passwords shorter than the minimum", () => {
    const result = checkPasswordPolicy("Ab1!efgh"); // 8 chars, 4 classes
    expect(result.ok).toBe(false);
    expect(PASSWORD_MIN_LENGTH).toBe(12);
  });

  it("rejects a long password using only two character classes", () => {
    const result = checkPasswordPolicy("abcdefghijklmnop"); // lowercase only
    expect(result.ok).toBe(false);
    expect(checkPasswordPolicy("abcdefghijklmnop1").ok).toBe(false); // lower + digit = 2
  });

  it("accepts a long password with three character classes", () => {
    expect(checkPasswordPolicy("CorrectHorse42").ok).toBe(true); // upper+lower+digit
  });

  it("accepts a long password with all four character classes", () => {
    expect(checkPasswordPolicy("CorrectHorse42!").ok).toBe(true);
  });

  it("counts symbols as a character class", () => {
    expect(checkPasswordPolicy("correcthorse42!").ok).toBe(true); // lower+digit+symbol
  });

  it("explains why a password was rejected rather than failing silently", () => {
    const result = checkPasswordPolicy("short");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/12 characters/);
  });
});
