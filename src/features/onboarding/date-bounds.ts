import { MAX_AGE_YEARS, MIN_AGE_YEARS } from "@/lib/validation";

// Client-side bounds for the wizard's date inputs.
//
// A bare <input type="date"> accepts a six-digit year — typing "99999" in the year box is
// valid as far as the browser is concerned. These `min`/`max` attributes make the same
// rules the server enforces visible while typing, so the constraint is discovered in the
// picker rather than as a rejected save.
//
// Computed at module load from the shared age bounds, so the two can't drift apart.

function isoOffsetYears(years: number): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date.toISOString().slice(0, 10);
}

export const DOB_RANGE = {
  min: isoOffsetYears(MAX_AGE_YEARS),
  max: isoOffsetYears(MIN_AGE_YEARS),
} as const;

export const STUDY_DATE_RANGE = {
  min: "1950-01-01",
  max: (() => {
    const date = new Date();
    date.setFullYear(date.getFullYear() + 10);
    return date.toISOString().slice(0, 10);
  })(),
} as const;

/** Today, for inputs that must not accept a future date (test results). */
export const TODAY = new Date().toISOString().slice(0, 10);
