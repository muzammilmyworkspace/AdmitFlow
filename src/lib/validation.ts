import { z } from "zod";

// Shared input validation — docs/30-validation-rules.md.
//
// These exist because `z.string()` on a date field accepts "99999-01-01", and
// `z.number().positive()` on a budget accepts 9e15. Both are typos a real student will
// eventually make, and neither should reach the database or the scoring engine, where a
// nonsense value produces a confidently wrong assessment rather than an error.
//
// Client-side `min`/`max` attributes are affordances that make the same rules visible
// while typing; these are the authoritative check.

/** Widest date the product ever accepts, in either direction. */
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

function parseIsoDate(value: string): Date | null {
  // Require the exact YYYY-MM-DD shape browsers submit. Date.parse is far too lenient —
  // it happily accepts "1", "May", and "99999-1-1".
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  // Rejects impossible calendar dates that still parse, e.g. 2026-02-31 rolling into March.
  if (date.toISOString().slice(0, 10) !== value) return null;
  const year = date.getUTCFullYear();
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  return date;
}

/** A calendar date in YYYY-MM-DD form, within a sane century. */
export const isoDate = z.string().refine((v) => parseIsoDate(v) !== null, {
  message: `Enter a real date between ${MIN_YEAR} and ${MAX_YEAR}.`,
});

export const MIN_AGE_YEARS = 14;
export const MAX_AGE_YEARS = 100;

// Every refinement below is chained onto `isoDate`, and Zod runs a chained refinement even
// when the one before it failed. So each re-parses and bails out on null rather than
// asserting — otherwise malformed input throws inside the validator and surfaces as a 500
// instead of the 400 the student should get.

/**
 * Date of birth. Bounded by age rather than by year, so the rule stays correct as time
 * passes instead of drifting the way a hardcoded year range would.
 */
export const dateOfBirth = isoDate.refine(
  (v) => {
    const date = parseIsoDate(v);
    if (!date) return true; // isoDate already reported it; don't report it twice.
    const now = new Date();
    const age = (now.getTime() - date.getTime()) / (365.2425 * 24 * 60 * 60 * 1000);
    return age >= MIN_AGE_YEARS && age <= MAX_AGE_YEARS;
  },
  { message: `Enter a date of birth for someone between ${MIN_AGE_YEARS} and ${MAX_AGE_YEARS}.` },
);

/** A date that cannot be in the future — test results, past qualifications. */
export const pastDate = isoDate.refine(
  (v) => {
    const date = parseIsoDate(v);
    return date === null || date <= new Date();
  },
  { message: "This date cannot be in the future." },
);

/** Study dates: history plus a reasonable planning horizon for in-progress study. */
export const studyDate = isoDate.refine(
  (v) => {
    const date = parseIsoDate(v);
    if (!date) return true;
    const horizon = new Date();
    horizon.setFullYear(horizon.getFullYear() + 10);
    return date.getUTCFullYear() >= 1950 && date <= horizon;
  },
  { message: "Enter a study date within the last few decades." },
);

/**
 * Money. The upper bound is a typo-catcher, not a policy: nobody's annual tuition budget
 * is ten million, and a stray zero would otherwise sail through and make every programme
 * look affordable.
 */
export const MAX_BUDGET = 10_000_000;

export const money = z
  .number()
  .finite()
  .positive("Enter an amount greater than zero.")
  .max(MAX_BUDGET, "That amount looks like a typo — check the figure.");

export const currencyCode = z
  .string()
  .length(3, "Use a 3-letter currency code, e.g. EUR.")
  .regex(/^[A-Za-z]{3}$/, "Use a 3-letter currency code, e.g. EUR.")
  .transform((v) => v.toUpperCase());

/** Free-text that a human reads back. Trimmed, bounded, and never blank-after-trim. */
export const shortText = (max: number, label = "This field") =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`);

/** Optional free text: empty string and null both mean "not provided". */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/** Phone numbers vary too much by country to pattern-match; check shape, not format. */
export const phone = z
  .string()
  .trim()
  .max(30)
  .regex(/^[+()\d\s-]*$/, "A phone number can only contain digits, spaces, and + ( ) -")
  .nullish()
  .transform((v) => (v ? v : null));

/** Asserts `end` is not before `start` when both are given. */
export function assertDateOrder(
  start: string | null | undefined,
  end: string | null | undefined,
): boolean {
  if (!start || !end) return true;
  const from = parseIsoDate(start);
  const to = parseIsoDate(end);
  // An unparseable date is already reported by that field's own validator; don't pile a
  // confusing ordering error on top of it.
  if (!from || !to) return true;
  return from <= to;
}
