import { describe, expect, it } from "vitest";
import { bestEnglishIndex, toAcademicIndex, toIeltsEquivalent } from "./normalize";

// These conversions decide whether a student is told they qualify for something. A
// regression here is silent and consequential, so the boundaries are pinned.

describe("toAcademicIndex", () => {
  it("passes a 4.0-scale GPA through unchanged", () => {
    expect(toAcademicIndex("GPA_4", 3.5)).toBe(3.5);
  });

  it("rescales a 5.0-scale GPA proportionally", () => {
    expect(toAcademicIndex("GPA_5", 5)).toBe(4);
    expect(toAcademicIndex("GPA_5", 2.5)).toBe(2);
  });

  it("maps percentages onto recognisable GPA bands", () => {
    expect(toAcademicIndex("PERCENTAGE", 90)).toBe(4.0);
    expect(toAcademicIndex("PERCENTAGE", 70)).toBe(3.0);
    expect(toAcademicIndex("PERCENTAGE", 45)).toBeLessThan(1.7);
  });

  it("maps UK honours classifications at their published boundaries", () => {
    expect(toAcademicIndex("UK_HONOURS", 70)).toBe(4.0); // First
    expect(toAcademicIndex("UK_HONOURS", 60)).toBe(3.3); // 2:1
    expect(toAcademicIndex("UK_HONOURS", 50)).toBe(2.7); // 2:2
    expect(toAcademicIndex("UK_HONOURS", 40)).toBe(2.0); // Third
  });

  it("clamps out-of-range input rather than producing an impossible index", () => {
    expect(toAcademicIndex("GPA_4", 9)).toBe(4);
    expect(toAcademicIndex("GPA_4", -1)).toBe(0);
  });
});

describe("toIeltsEquivalent", () => {
  it("passes IELTS through unchanged", () => {
    expect(toIeltsEquivalent("IELTS", 7.5)).toBe(7.5);
  });

  it("converts other tests into the same comparable scale", () => {
    expect(toIeltsEquivalent("TOEFL", 94)).toBe(7);
    expect(toIeltsEquivalent("PTE", 65)).toBe(7);
    expect(toIeltsEquivalent("DUOLINGO", 120)).toBe(7);
  });

  it("is monotonic — a higher raw score never converts to a lower index", () => {
    for (const test of ["TOEFL", "PTE", "DUOLINGO"] as const) {
      const max = { TOEFL: 120, PTE: 90, DUOLINGO: 160 }[test];
      let previous = -1;
      for (let raw = 0; raw <= max; raw += 1) {
        const value = toIeltsEquivalent(test, raw);
        expect(value).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    }
  });
});

describe("bestEnglishIndex", () => {
  const now = new Date("2026-09-07T00:00:00Z");

  it("returns null when the student has no tests", () => {
    expect(bestEnglishIndex([], now)).toBeNull();
  });

  it("picks the strongest result across different test types", () => {
    const result = bestEnglishIndex(
      [
        { testType: "IELTS", overallScore: 6.0, expiryDate: null },
        { testType: "TOEFL", overallScore: 110, expiryDate: null }, // ≈ 8.0
      ],
      now,
    );
    expect(result).toBe(8);
  });

  it("ignores expired results rather than crediting a score the student cannot use", () => {
    const result = bestEnglishIndex(
      [
        { testType: "IELTS", overallScore: 8.5, expiryDate: new Date("2026-01-01T00:00:00Z") },
        { testType: "IELTS", overallScore: 6.5, expiryDate: new Date("2027-01-01T00:00:00Z") },
      ],
      now,
    );
    expect(result).toBe(6.5);
  });

  it("returns null when every result has expired", () => {
    const result = bestEnglishIndex(
      [{ testType: "IELTS", overallScore: 8.5, expiryDate: new Date("2025-01-01T00:00:00Z") }],
      now,
    );
    expect(result).toBeNull();
  });
});
