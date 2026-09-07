import { describe, expect, it } from "vitest";
import {
  MAX_AGE_YEARS,
  MAX_BUDGET,
  MIN_AGE_YEARS,
  assertDateOrder,
  currencyCode,
  dateOfBirth,
  isoDate,
  money,
  optionalText,
  pastDate,
  phone,
  shortText,
  studyDate,
} from "./validation";

// Regression cover for the class of bug a student found by typing into the date picker:
// a bare <input type="date"> lets you enter a five-digit year, and nothing downstream
// questioned it.

function isoOffsetYears(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

describe("isoDate", () => {
  it("accepts a normal calendar date", () => {
    expect(isoDate.safeParse("2002-01-01").success).toBe(true);
  });

  it.each([
    ["five-digit year", "99999-01-01"],
    ["six-digit year", "202555-01-01"],
    ["year below 1900", "1200-01-01"],
    ["year above 2100", "2500-01-01"],
    ["a day February never has", "2002-02-31"],
    ["month 13", "2002-13-01"],
    ["day 00", "2002-01-00"],
    ["unpadded parts", "2002-1-1"],
    ["a slashed date", "01/01/2002"],
    ["free text", "yesterday"],
    ["empty", ""],
    ["a datetime", "2002-01-01T00:00:00Z"],
  ])("rejects %s", (_label, value) => {
    expect(isoDate.safeParse(value).success).toBe(false);
  });
});

describe("dateOfBirth", () => {
  it("accepts someone of a plausible age", () => {
    expect(dateOfBirth.safeParse(isoOffsetYears(22)).success).toBe(true);
  });

  it("rejects a birth date in the future", () => {
    expect(dateOfBirth.safeParse("2099-01-01").success).toBe(false);
  });

  it("rejects someone implausibly young or old", () => {
    expect(dateOfBirth.safeParse(isoOffsetYears(MIN_AGE_YEARS - 1)).success).toBe(false);
    expect(dateOfBirth.safeParse(isoOffsetYears(MAX_AGE_YEARS + 1)).success).toBe(false);
  });

  // The refinements are chained onto isoDate, and Zod runs a chained refinement even after
  // the previous one failed. Before this was guarded, malformed input threw inside the
  // validator and the student got a 500 instead of "enter a real date".
  it("reports malformed input as a validation failure, never by throwing", () => {
    for (const bad of ["99999-01-01", "2002-02-31", "not-a-date", ""]) {
      expect(() => dateOfBirth.safeParse(bad)).not.toThrow();
      expect(dateOfBirth.safeParse(bad).success).toBe(false);
    }
  });

  it("reports a malformed date once, not twice", () => {
    const result = dateOfBirth.safeParse("99999-01-01");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toHaveLength(1);
  });
});

describe("pastDate", () => {
  it("accepts a date already past", () => {
    expect(pastDate.safeParse("2020-06-01").success).toBe(true);
  });

  it("rejects a future date", () => {
    expect(pastDate.safeParse("2099-01-01").success).toBe(false);
  });

  it("does not throw on malformed input", () => {
    expect(() => pastDate.safeParse("99999-01-01")).not.toThrow();
    expect(pastDate.safeParse("99999-01-01").success).toBe(false);
  });
});

describe("studyDate", () => {
  it("accepts a past study date and a near-future one", () => {
    expect(studyDate.safeParse("2019-09-01").success).toBe(true);
    const soon = new Date();
    soon.setFullYear(soon.getFullYear() + 2);
    expect(studyDate.safeParse(soon.toISOString().slice(0, 10)).success).toBe(true);
  });

  it("rejects a date beyond the planning horizon", () => {
    const far = new Date();
    far.setFullYear(far.getFullYear() + 25);
    expect(studyDate.safeParse(far.toISOString().slice(0, 10)).success).toBe(false);
  });

  it("does not throw on malformed input", () => {
    expect(() => studyDate.safeParse("99999-01-01")).not.toThrow();
    expect(studyDate.safeParse("99999-01-01").success).toBe(false);
  });
});

describe("assertDateOrder", () => {
  it("accepts an ordered pair and a missing half", () => {
    expect(assertDateOrder("2018-09-01", "2022-06-01")).toBe(true);
    expect(assertDateOrder("2018-09-01", null)).toBe(true);
    expect(assertDateOrder(null, "2022-06-01")).toBe(true);
    expect(assertDateOrder("2022-06-01", "2022-06-01")).toBe(true);
  });

  it("rejects an end before its start", () => {
    expect(assertDateOrder("2022-06-01", "2018-09-01")).toBe(false);
  });

  // The field's own validator already reports a malformed date; adding an ordering error
  // on top of it just makes the form harder to read.
  it("stays quiet when either date is unparseable", () => {
    expect(assertDateOrder("99999-01-01", "2018-09-01")).toBe(true);
    expect(assertDateOrder("2018-09-01", "garbage")).toBe(true);
  });
});

describe("money", () => {
  it("accepts a realistic budget", () => {
    expect(money.safeParse(40000).success).toBe(true);
  });

  it.each([
    ["zero", 0],
    ["negative", -5],
    ["a stray-zero typo", MAX_BUDGET + 1],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["NaN", Number.NaN],
  ])("rejects %s", (_label, value) => {
    expect(money.safeParse(value).success).toBe(false);
  });
});

describe("currencyCode", () => {
  it("normalises to upper case", () => {
    const result = currencyCode.safeParse("eur");
    expect(result.success && result.data).toBe("EUR");
  });

  it.each(["EUROS", "EU", "E1R", "€€€", ""])("rejects %s", (value) => {
    expect(currencyCode.safeParse(value).success).toBe(false);
  });
});

describe("shortText", () => {
  const name = shortText(100, "First name");

  it("trims surrounding whitespace", () => {
    const result = name.safeParse("  Ada  ");
    expect(result.success && result.data).toBe("Ada");
  });

  it("rejects whitespace-only and over-long input", () => {
    expect(name.safeParse("   ").success).toBe(false);
    expect(name.safeParse("a".repeat(101)).success).toBe(false);
  });

  it("names the field in its message", () => {
    const result = name.safeParse("");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toContain("First name");
  });
});

describe("optionalText", () => {
  it("treats blank, null and undefined alike as absent", () => {
    for (const value of ["", "   ", null, undefined]) {
      const result = optionalText(200).safeParse(value);
      expect(result.success && result.data).toBe(null);
    }
  });
});

describe("phone", () => {
  it("accepts international formatting", () => {
    expect(phone.safeParse("+92 (300) 123-4567").success).toBe(true);
  });

  it("rejects letters and over-long input", () => {
    expect(phone.safeParse("call me").success).toBe(false);
    expect(phone.safeParse("1".repeat(31)).success).toBe(false);
  });

  it("maps blank to null", () => {
    const result = phone.safeParse("");
    expect(result.success && result.data).toBe(null);
  });
});
