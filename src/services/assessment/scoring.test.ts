import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULES,
  assessProgram,
  type ProgramInput,
  type StudentInput,
} from "./scoring";

// docs/35-testing-strategy.md rates the scoring engine Tier 0: it is the logic students
// make expensive, hard-to-reverse decisions on, so it is tested exhaustively and without
// a database.

const NOW = new Date("2026-09-07T00:00:00Z");

function student(overrides: Partial<StudentInput> = {}): StudentInput {
  return {
    academicIndex: 3.2,
    englishIndex: 7.0,
    englishIsEstimated: false,
    budgetMax: 30000,
    budgetCurrency: "GBP",
    destinationCountryIds: ["gb"],
    fieldsOfInterest: ["Computer Science"],
    preferredLevel: null,
    studyGapMonths: 0,
    backlogCount: 0,
    documentsReadyRatio: 1,
    ...overrides,
  };
}

function program(overrides: Partial<ProgramInput> = {}): ProgramInput {
  return {
    id: "p1",
    name: "MSc Computer Science",
    level: "MASTERS",
    fieldOfStudy: "Computer Science",
    countryId: "gb",
    minGpa: 3.0,
    minIelts: 6.5,
    tuitionAmount: 20000,
    tuitionCurrency: "GBP",
    budgetHardCeiling: false,
    applicationDeadline: new Date("2027-01-15T00:00:00Z"),
    intakeStatus: "OPEN",
    ...overrides,
  };
}

describe("assessProgram — zones", () => {
  it("places a strong, well-evidenced profile in SAFE", () => {
    const result = assessProgram(student(), program(), DEFAULT_RULES, NOW);
    expect(result.zone).toBe("SAFE");
    expect(result.overallScore).toBeGreaterThanOrEqual(DEFAULT_RULES.thresholds.safeMin);
    expect(result.eligibilityStatus).toBe("ELIGIBLE");
  });

  it("places a clearly under-qualified profile in REACH", () => {
    const result = assessProgram(
      student({ academicIndex: 2.0, englishIndex: 5.0 }),
      program({ minGpa: 3.7, minIelts: 7.5 }),
      DEFAULT_RULES,
      NOW,
    );
    expect(result.zone).toBe("REACH");
    expect(result.missingRequirements.length).toBeGreaterThan(0);
  });

  it("excludes a profile with essentially no compatibility", () => {
    const result = assessProgram(
      student({
        academicIndex: 0.5,
        englishIndex: 2.0,
        budgetMax: 1000,
        destinationCountryIds: ["xx"],
        fieldsOfInterest: ["Music"],
        documentsReadyRatio: 0,
        studyGapMonths: 60,
        backlogCount: 6,
      }),
      program({ minGpa: 3.9, minIelts: 8.0, tuitionAmount: 60000 }),
      DEFAULT_RULES,
      NOW,
    );
    expect(result.zone).toBe("EXCLUDED");
  });
});

describe("assessProgram — SAFE guardrails", () => {
  // The guardrails exist so a high weighted average built on the wrong things cannot be
  // sold to a student as a "strong match". Each of these would clear the raw threshold.

  it("demotes to TARGET when English is only an estimate, however strong the rest", () => {
    const result = assessProgram(
      student({ englishIsEstimated: true, englishIndex: 9 }),
      program(),
      DEFAULT_RULES,
      NOW,
    );
    expect(result.flags).toContain("ESTIMATED_PENDING_TEST");
    expect(result.zone).not.toBe("SAFE");
  });

  it("demotes to TARGET when the academic floor is missed", () => {
    const result = assessProgram(
      // Budget and preferences are perfect; grades are not.
      student({ academicIndex: 2.5, budgetMax: 100000 }),
      program({ minGpa: 3.5 }),
      DEFAULT_RULES,
      NOW,
    );
    expect(result.zone).not.toBe("SAFE");
  });

  it("never returns SAFE for a closed intake", () => {
    const result = assessProgram(
      student(),
      program({ intakeStatus: "CLOSED" }),
      DEFAULT_RULES,
      NOW,
    );
    expect(result.flags).toContain("INTAKE_CLOSED");
    expect(result.zone).toBe("REACH");
  });

  it("never returns SAFE when there is no English evidence at all", () => {
    const result = assessProgram(
      student({ englishIndex: null, englishIsEstimated: true }),
      program(),
      DEFAULT_RULES,
      NOW,
    );
    expect(result.zone).not.toBe("SAFE");
  });
});

describe("assessProgram — tolerance bands", () => {
  it("scores a near-miss well above a distant miss rather than both at zero", () => {
    const nearMiss = assessProgram(
      student({ academicIndex: 2.95 }),
      program({ minGpa: 3.0 }),
      DEFAULT_RULES,
      NOW,
    );
    const distantMiss = assessProgram(
      student({ academicIndex: 1.5 }),
      program({ minGpa: 3.0 }),
      DEFAULT_RULES,
      NOW,
    );

    const near = nearMiss.factors.find((f) => f.factorKey === "academic")!.rawScore;
    const distant = distantMiss.factors.find((f) => f.factorKey === "academic")!.rawScore;
    expect(near).toBeGreaterThan(distant);
    expect(near).toBeGreaterThan(50);
    expect(distant).toBe(0);
  });

  it("does not reward exceeding a requirement without limit", () => {
    const meets = assessProgram(student({ academicIndex: 3.6 }), program({ minGpa: 3.0 }), DEFAULT_RULES, NOW);
    const exceeds = assessProgram(student({ academicIndex: 4.0 }), program({ minGpa: 3.0 }), DEFAULT_RULES, NOW);
    const a = meets.factors.find((f) => f.factorKey === "academic")!.rawScore;
    const b = exceeds.factors.find((f) => f.factorKey === "academic")!.rawScore;
    expect(a).toBe(100);
    expect(b).toBe(100);
  });
});

describe("assessProgram — missing data", () => {
  it("redistributes weight instead of scoring an absent catalog field as zero", () => {
    const withData = assessProgram(student(), program(), DEFAULT_RULES, NOW);
    const withoutTuition = assessProgram(
      student(),
      program({ tuitionAmount: null, tuitionCurrency: null }),
      DEFAULT_RULES,
      NOW,
    );

    const budget = withoutTuition.factors.find((f) => f.factorKey === "budget")!;
    expect(budget.skipped).toBe(true);
    expect(budget.weightedScore).toBe(0);
    // The missing field must not drag the overall score down — a catalog gap is our
    // problem, not the student's.
    expect(withoutTuition.overallScore).toBeGreaterThanOrEqual(withData.overallScore - 2);
  });

  it("keeps the weighted total bounded at 100 when everything scores perfectly", () => {
    const result = assessProgram(
      student({ academicIndex: 4.0, englishIndex: 9, budgetMax: 999999 }),
      program({ minGpa: 2.0, minIelts: 5.0, tuitionAmount: 1000 }),
      DEFAULT_RULES,
      NOW,
    );
    expect(result.overallScore).toBeLessThanOrEqual(100);
  });
});

describe("assessProgram — currency", () => {
  it("refuses to compare across currencies rather than inventing a conversion", () => {
    const result = assessProgram(
      student({ budgetCurrency: "PKR", budgetMax: 5_000_000 }),
      program({ tuitionCurrency: "GBP", tuitionAmount: 20000 }),
      DEFAULT_RULES,
      NOW,
    );
    const budget = result.factors.find((f) => f.factorKey === "budget")!;
    expect(budget.reasoning).toMatch(/don't convert currencies/i);
    expect(budget.rawScore).toBe(50);
  });
});

describe("assessProgram — explainability", () => {
  it("always explains every scored factor", () => {
    const result = assessProgram(student(), program(), DEFAULT_RULES, NOW);
    for (const factor of result.factors.filter((f) => !f.skipped)) {
      expect(factor.reasoning.length).toBeGreaterThan(10);
    }
  });

  it("never uses guarantee language in its reasoning", () => {
    // The charter forbids implying a guaranteed outcome. This asserts the copy the
    // student actually sees, so a future wording change can't quietly reintroduce it.
    const forbidden = /guarantee|guaranteed|certain to|will be admitted|assured/i;
    for (const zone of [
      assessProgram(student(), program(), DEFAULT_RULES, NOW),
      assessProgram(student({ academicIndex: 2.0 }), program(), DEFAULT_RULES, NOW),
    ]) {
      expect(zone.reasoning).not.toMatch(forbidden);
      for (const factor of zone.factors) expect(factor.reasoning).not.toMatch(forbidden);
    }
  });

  it("lists what is missing so the student knows what to fix", () => {
    const result = assessProgram(
      student({ englishIndex: 5.5, documentsReadyRatio: 0.5 }),
      program({ minIelts: 7.0 }),
      DEFAULT_RULES,
      NOW,
    );
    expect(result.missingRequirements.join(" ")).toMatch(/IELTS 7/);
    expect(result.missingRequirements.join(" ")).toMatch(/documents/i);
  });
});

describe("assessProgram — risk factors", () => {
  it("penalises a long study gap more than a short one", () => {
    const short = assessProgram(student({ studyGapMonths: 6 }), program(), DEFAULT_RULES, NOW);
    const long = assessProgram(student({ studyGapMonths: 48 }), program(), DEFAULT_RULES, NOW);
    const a = short.factors.find((f) => f.factorKey === "risk")!.rawScore;
    const b = long.factors.find((f) => f.factorKey === "risk")!.rawScore;
    expect(a).toBeGreaterThan(b);
  });

  it("treats a passed deadline as unactionable", () => {
    const result = assessProgram(
      student(),
      program({ applicationDeadline: new Date("2026-01-01T00:00:00Z") }),
      DEFAULT_RULES,
      NOW,
    );
    expect(result.factors.find((f) => f.factorKey === "deadline")!.rawScore).toBe(0);
    expect(result.zone).not.toBe("SAFE");
  });
});

describe("assessProgram — determinism", () => {
  it("produces identical output for identical input", () => {
    const a = assessProgram(student(), program(), DEFAULT_RULES, NOW);
    const b = assessProgram(student(), program(), DEFAULT_RULES, NOW);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("reads thresholds from the rule set rather than hardcoding them", () => {
    const withDefaults = assessProgram(student(), program(), DEFAULT_RULES, NOW);
    expect(withDefaults.zone).toBe("SAFE");

    // A threshold no score can reach must demote the same profile — this is what proves
    // an admin retuning the rules actually changes outcomes.
    const unreachable = {
      ...DEFAULT_RULES,
      thresholds: { reachMin: 20, targetMin: 58, safeMin: 101 },
    };
    expect(assessProgram(student(), program(), unreachable, NOW).zone).toBe("TARGET");

    // And a lowered bar must promote a profile the defaults would not call SAFE.
    const lenient = {
      ...DEFAULT_RULES,
      thresholds: { reachMin: 10, targetMin: 20, safeMin: 30 },
      safeGuardrails: { minAcademic: 0, minEnglish: 0, minDeadline: 0, minRisk: 0 },
    };
    const weak = student({ academicIndex: 2.6, englishIndex: 6.0 });
    expect(assessProgram(weak, program(), DEFAULT_RULES, NOW).zone).not.toBe("SAFE");
    expect(assessProgram(weak, program(), lenient, NOW).zone).toBe("SAFE");
  });
});

describe("free-tier coverage (regression)", () => {
  // A browser test caught this: a strong profile matched 15 SAFE and 33 TARGET
  // programmes and zero REACH ones, so zone-based gating alone showed that student
  // nothing at all behind a paywall. The engine legitimately produces zero REACH for a
  // good profile — the fix belongs in the projection layer's free preview, and this test
  // pins the engine behaviour that makes the fix necessary so it isn't "corrected" here.
  it("can legitimately produce zero REACH matches for a strong profile", () => {
    const strong = student({ academicIndex: 3.8, englishIndex: 8.0, budgetMax: 80000 });
    const zones = [3.0, 3.2, 3.4].map(
      (minGpa) => assessProgram(strong, program({ minGpa }), DEFAULT_RULES, NOW).zone,
    );
    expect(zones).not.toContain("REACH");
  });
});
