import { describe, expect, it } from "vitest";
import {
  generateOpaqueToken,
  generateOtp,
  hashToken,
  safeEqualHex,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  PASSWORD_RESET_TTL_MS,
  VERIFICATION_LINK_TTL_MS,
} from "./tokens";

// docs/13-authentication-authorization.md §3.1/§3.3 fixes these durations and limits;
// they are asserted here so a future edit can't quietly change a security window.

describe("auth tokens", () => {
  it("generates unique, non-trivial opaque tokens", () => {
    const tokens = new Set(Array.from({ length: 50 }, generateOpaqueToken));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(token.length).toBeGreaterThanOrEqual(43); // 256-bit base64url
  });

  it("generates zero-padded 6-digit OTPs", () => {
    for (let i = 0; i < 200; i++) expect(generateOtp()).toMatch(/^\d{6}$/);
  });

  it("hashes deterministically and never returns the raw value", () => {
    const raw = "some-token-value";
    expect(hashToken(raw)).toBe(hashToken(raw));
    expect(hashToken(raw)).not.toContain(raw);
    expect(hashToken(raw)).toHaveLength(64); // sha256 hex
  });

  it("produces different hashes for different inputs", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });

  it("compares hashes safely, including mismatched lengths", () => {
    const a = hashToken("x");
    expect(safeEqualHex(a, a)).toBe(true);
    expect(safeEqualHex(a, hashToken("y"))).toBe(false);
    expect(safeEqualHex(a, "abcd")).toBe(false);
  });

  it("holds the documented security windows", () => {
    expect(VERIFICATION_LINK_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(OTP_TTL_MS).toBe(10 * 60 * 1000);
    expect(PASSWORD_RESET_TTL_MS).toBe(30 * 60 * 1000);
    expect(OTP_MAX_ATTEMPTS).toBe(5);
  });
});
