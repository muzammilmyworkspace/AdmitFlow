// Input normalization for the assessment engine — docs/16-assessment-engine.md.
//
// Students arrive with grades on five different scales and English scores from five
// different tests. The engine compares against a single academic index (0–4) and a single
// IELTS-equivalent index (0–9), so all conversion happens here, in one place, where it
// can be tested and corrected without touching scoring logic.

import type { GradingScale, LanguageTestType } from "../../../prisma/generated/client";

/**
 * Converts any supported grading scale to a 0–4 index.
 *
 * These are approximate published equivalences, not an authoritative conversion — real
 * credential evaluation is a professional service. That's exactly why the engine treats
 * the result as a compatibility signal with tolerance bands rather than a pass/fail gate.
 */
export function toAcademicIndex(scale: GradingScale, value: number): number {
  switch (scale) {
    case "GPA_4":
      return clamp(value, 0, 4);
    case "GPA_5":
      return clamp((value / 5) * 4, 0, 4);
    case "PERCENTAGE":
      return percentageToGpa4(value);
    case "UK_HONOURS":
      // UK honours classification boundaries: 70+ First, 60+ 2:1, 50+ 2:2, 40+ Third.
      if (value >= 70) return 4.0;
      if (value >= 60) return 3.3;
      if (value >= 50) return 2.7;
      if (value >= 40) return 2.0;
      return clamp((value / 40) * 2, 0, 2);
    case "OTHER":
      return percentageToGpa4(value);
  }
}

function percentageToGpa4(value: number): number {
  if (value >= 85) return 4.0;
  if (value >= 80) return 3.7;
  if (value >= 75) return 3.3;
  if (value >= 70) return 3.0;
  if (value >= 65) return 2.7;
  if (value >= 60) return 2.3;
  if (value >= 55) return 2.0;
  if (value >= 50) return 1.7;
  return clamp((value / 50) * 1.7, 0, 1.7);
}

/** Converts any supported English test to an IELTS-equivalent 0–9 index. */
export function toIeltsEquivalent(testType: LanguageTestType, score: number): number {
  switch (testType) {
    case "IELTS":
      return clamp(score, 0, 9);
    case "TOEFL":
      // Published IELTS/TOEFL iBT comparison bands.
      if (score >= 118) return 9;
      if (score >= 115) return 8.5;
      if (score >= 110) return 8;
      if (score >= 102) return 7.5;
      if (score >= 94) return 7;
      if (score >= 79) return 6.5;
      if (score >= 60) return 6;
      if (score >= 46) return 5.5;
      if (score >= 35) return 5;
      return clamp((score / 35) * 5, 0, 5);
    case "PTE":
      if (score >= 89) return 9;
      if (score >= 84) return 8.5;
      if (score >= 79) return 8;
      if (score >= 73) return 7.5;
      if (score >= 65) return 7;
      if (score >= 59) return 6.5;
      if (score >= 51) return 6;
      if (score >= 43) return 5.5;
      if (score >= 36) return 5;
      return clamp((score / 36) * 5, 0, 5);
    case "DUOLINGO":
      if (score >= 155) return 9;
      if (score >= 145) return 8.5;
      if (score >= 140) return 8;
      if (score >= 130) return 7.5;
      if (score >= 120) return 7;
      if (score >= 115) return 6.5;
      if (score >= 105) return 6;
      if (score >= 95) return 5.5;
      if (score >= 85) return 5;
      return clamp((score / 85) * 5, 0, 5);
    case "CAMBRIDGE":
      if (score >= 200) return 8;
      if (score >= 185) return 7.5;
      if (score >= 176) return 6.5;
      if (score >= 169) return 6;
      if (score >= 160) return 5.5;
      return clamp(((score - 80) / 80) * 5, 0, 5);
    case "OTHER":
      // An unrecognised test is mapped conservatively from a 0–100 scale.
      return clamp((score / 100) * 9, 0, 9);
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Picks the strongest still-valid test result.
 *
 * Expired results are excluded rather than quietly used: most universities require a
 * score taken within two years, so scoring against an expired certificate would tell the
 * student they qualify for something they can't currently apply to.
 */
export function bestEnglishIndex(
  tests: { testType: LanguageTestType; overallScore: number; expiryDate: Date | null }[],
  now: Date = new Date(),
): number | null {
  const valid = tests.filter((t) => !t.expiryDate || t.expiryDate > now);
  if (valid.length === 0) return null;
  return Math.max(...valid.map((t) => toIeltsEquivalent(t.testType, t.overallScore)));
}

/**
 * Estimates an English level for a student with no test on file, from prior
 * English-medium study. Capped low on purpose and always flagged by the caller — an
 * estimate must never be able to produce a SAFE placement (docs/16).
 */
export const ESTIMATED_ENGLISH_INDEX = 6.0;
