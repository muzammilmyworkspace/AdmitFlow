// Assessment scoring engine — docs/16-assessment-engine.md, docs/17-university-matching-engine.md.
//
// Pure functions only: no database, no clock beyond what's passed in. That is deliberate
// — this is the logic whose output students make expensive decisions on, so it must be
// exhaustively unit-testable without a database, and reproducible given the same inputs
// (docs/35-testing-strategy.md rates this Tier 0).
//
// The engine is configurable and versioned: weights and thresholds arrive as a rules
// object loaded from the database, and every result records which version produced it.
// Changing a weight creates a NEW version; it never rewrites history
// (docs/54-decision-log.md D-6).

export const MATCHING_ENGINE_VERSION = "matching-engine-v1";

export type Zone = "SAFE" | "TARGET" | "REACH" | "EXCLUDED";

export interface ScoringWeights {
  academic: number;
  english: number;
  budget: number;
  programFit: number;
  countryPreference: number;
  risk: number;
  deadline: number;
  documentReadiness: number;
}

export interface ZoneThresholds {
  reachMin: number;
  targetMin: number;
  safeMin: number;
}

/** Extra floors a programme must clear to be called SAFE — docs/16 §"SAFE guardrails". */
export interface SafeGuardrails {
  minAcademic: number;
  minEnglish: number;
  minDeadline: number;
  minRisk: number;
}

export interface ScoringRules {
  version: string;
  weights: ScoringWeights;
  thresholds: ZoneThresholds;
  safeGuardrails: SafeGuardrails;
}

// Defaults from docs/54-decision-log.md D-6. These are seeded into AssessmentRule rows
// and are editable by an admin; this object is the fallback and the seed source, not a
// hardcoded rule the engine reads at runtime in preference to the database.
export const DEFAULT_RULES: ScoringRules = {
  version: "rules-v1",
  weights: {
    academic: 25,
    english: 20,
    budget: 15,
    programFit: 15,
    countryPreference: 10,
    risk: 10,
    deadline: 3,
    documentReadiness: 2,
  },
  thresholds: { reachMin: 20, targetMin: 58, safeMin: 78 },
  safeGuardrails: { minAcademic: 70, minEnglish: 70, minDeadline: 40, minRisk: 50 },
};

export interface StudentInput {
  /** Normalized 0–4 academic index. */
  academicIndex: number | null;
  /** Normalized 0–9 IELTS-equivalent index, or null when no test exists. */
  englishIndex: number | null;
  /** True when englishIndex is an estimate rather than a real test result. */
  englishIsEstimated: boolean;
  budgetMax: number | null;
  budgetCurrency: string | null;
  destinationCountryIds: string[];
  fieldsOfInterest: string[];
  preferredLevel: string | null;
  studyGapMonths: number;
  backlogCount: number;
  documentsReadyRatio: number;
}

export interface ProgramInput {
  id: string;
  name: string;
  level: string;
  fieldOfStudy: string;
  countryId: string;
  minGpa: number | null;
  minIelts: number | null;
  tuitionAmount: number | null;
  tuitionCurrency: string | null;
  budgetHardCeiling: boolean;
  applicationDeadline: Date | null;
  intakeStatus: string | null;
}

export interface FactorScore {
  factorKey: keyof ScoringWeights;
  weight: number;
  rawScore: number;
  weightedScore: number;
  reasoning: string;
  /** True when the factor had no data and was excluded from the weighted average. */
  skipped: boolean;
}

export interface ProgramAssessment {
  programId: string;
  overallScore: number;
  zone: Zone;
  eligibilityStatus: "ELIGIBLE" | "BORDERLINE" | "NOT_ELIGIBLE";
  factors: FactorScore[];
  strengths: string[];
  weaknesses: string[];
  missingRequirements: string[];
  flags: string[];
  reasoning: string;
}

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

/**
 * Tolerance-band scoring rather than a hard cutoff.
 *
 * A student 0.1 GPA below a stated minimum is not "ineligible, score 0" — that would be
 * both wrong (universities exercise discretion) and useless (every near-miss would look
 * identical to a total mismatch). The band degrades smoothly and bottoms out only when
 * the gap is genuinely large.
 */
function bandScore(actual: number, required: number, fullMarginAbove: number, zeroMarginBelow: number) {
  const diff = actual - required;
  if (diff >= fullMarginAbove) return 100;
  if (diff >= 0) return 80 + (diff / fullMarginAbove) * 20;
  if (diff <= -zeroMarginBelow) return 0;
  // Below the requirement: decays from 80 toward 0 across the tolerance window.
  return clamp(80 * (1 + diff / zeroMarginBelow));
}

function scoreAcademic(student: StudentInput, program: ProgramInput): Omit<FactorScore, "weight" | "weightedScore"> {
  if (student.academicIndex === null || program.minGpa === null) {
    return {
      factorKey: "academic",
      rawScore: 0,
      skipped: true,
      reasoning: "No comparable grade data for this programme.",
    };
  }
  const raw = bandScore(student.academicIndex, program.minGpa, 0.6, 1.0);
  const diff = student.academicIndex - program.minGpa;
  return {
    factorKey: "academic",
    rawScore: raw,
    skipped: false,
    reasoning:
      diff >= 0.3
        ? `Your grades are comfortably above the stated minimum (${student.academicIndex.toFixed(2)} vs ${program.minGpa.toFixed(2)} GPA).`
        : diff >= 0
          ? `Your grades meet the stated minimum (${student.academicIndex.toFixed(2)} vs ${program.minGpa.toFixed(2)} GPA).`
          : `Your grades are below the stated minimum (${student.academicIndex.toFixed(2)} vs ${program.minGpa.toFixed(2)} GPA).`,
  };
}

function scoreEnglish(student: StudentInput, program: ProgramInput): Omit<FactorScore, "weight" | "weightedScore"> {
  if (program.minIelts === null) {
    return {
      factorKey: "english",
      rawScore: 0,
      skipped: true,
      reasoning: "This programme does not publish an English requirement.",
    };
  }
  if (student.englishIndex === null) {
    return {
      factorKey: "english",
      rawScore: 0,
      skipped: true,
      reasoning: "No English test result on file yet.",
    };
  }
  let raw = bandScore(student.englishIndex, program.minIelts, 1.0, 1.5);
  // An estimate is capped so a guess can never look as strong as a real score, and (via
  // the SAFE guardrail) can never produce a SAFE placement — docs/16 §"Missing inputs".
  if (student.englishIsEstimated) raw = Math.min(raw, 70);
  return {
    factorKey: "english",
    rawScore: raw,
    skipped: false,
    reasoning: student.englishIsEstimated
      ? `Estimated from your English-medium education; a real test score is needed to confirm (programme requires IELTS ${program.minIelts}).`
      : student.englishIndex >= program.minIelts
        ? `Your English score meets the requirement (${student.englishIndex} vs IELTS ${program.minIelts}).`
        : `Your English score is below the requirement (${student.englishIndex} vs IELTS ${program.minIelts}).`,
  };
}

function scoreBudget(student: StudentInput, program: ProgramInput): Omit<FactorScore, "weight" | "weightedScore"> {
  if (student.budgetMax === null || program.tuitionAmount === null) {
    return {
      factorKey: "budget",
      rawScore: 0,
      skipped: true,
      reasoning: "No comparable budget or tuition figure.",
    };
  }
  // Currency mismatch is reported honestly rather than silently compared: converting
  // without a live FX rate would invent precision that isn't there (docs/55 N-1).
  if (student.budgetCurrency && program.tuitionCurrency && student.budgetCurrency !== program.tuitionCurrency) {
    return {
      factorKey: "budget",
      rawScore: 50,
      skipped: false,
      reasoning: `Tuition is in ${program.tuitionCurrency} and your budget is in ${student.budgetCurrency} — compare these yourself, we don't convert currencies.`,
    };
  }
  const ratio = student.budgetMax / program.tuitionAmount;
  const raw = ratio >= 1.2 ? 100 : ratio >= 1 ? 85 + (ratio - 1) * 75 : clamp(ratio * 85);
  return {
    factorKey: "budget",
    rawScore: raw,
    skipped: false,
    reasoning:
      ratio >= 1
        ? `Tuition of ${program.tuitionAmount.toLocaleString()} ${program.tuitionCurrency} fits inside your stated budget.`
        : `Tuition of ${program.tuitionAmount.toLocaleString()} ${program.tuitionCurrency} is above your stated budget.`,
  };
}

function scoreProgramFit(student: StudentInput, program: ProgramInput): Omit<FactorScore, "weight" | "weightedScore"> {
  if (student.fieldsOfInterest.length === 0) {
    return { factorKey: "programFit", rawScore: 60, skipped: false, reasoning: "No field preference recorded." };
  }
  const field = program.fieldOfStudy.toLowerCase();
  const exact = student.fieldsOfInterest.some((f) => f.toLowerCase() === field);
  const partial = student.fieldsOfInterest.some(
    (f) => field.includes(f.toLowerCase()) || f.toLowerCase().includes(field),
  );
  const levelMatches = !student.preferredLevel || student.preferredLevel === program.level;
  const base = exact ? 100 : partial ? 75 : 35;
  const raw = levelMatches ? base : Math.max(20, base - 30);
  return {
    factorKey: "programFit",
    rawScore: raw,
    skipped: false,
    reasoning: exact
      ? `${program.fieldOfStudy} matches your stated field of interest.`
      : partial
        ? `${program.fieldOfStudy} is related to your stated interests.`
        : `${program.fieldOfStudy} is outside your stated field of interest.`,
  };
}

function scoreCountry(student: StudentInput, program: ProgramInput): Omit<FactorScore, "weight" | "weightedScore"> {
  if (student.destinationCountryIds.length === 0) {
    return { factorKey: "countryPreference", rawScore: 60, skipped: false, reasoning: "No destination preference recorded." };
  }
  const rank = student.destinationCountryIds.indexOf(program.countryId);
  if (rank === -1) {
    return {
      factorKey: "countryPreference",
      rawScore: 15,
      skipped: false,
      reasoning: "This country is not among your chosen destinations.",
    };
  }
  const raw = clamp(100 - rank * 12);
  return {
    factorKey: "countryPreference",
    rawScore: raw,
    skipped: false,
    reasoning: rank === 0 ? "Your first-choice destination." : `Destination choice #${rank + 1}.`,
  };
}

function scoreRisk(student: StudentInput): Omit<FactorScore, "weight" | "weightedScore"> {
  let raw = 100;
  const notes: string[] = [];
  if (student.studyGapMonths > 0) {
    // Short gaps are normal and barely penalised; long ones matter to admissions teams.
    const penalty = student.studyGapMonths <= 12 ? 5 : Math.min(45, 5 + (student.studyGapMonths - 12) * 1.5);
    raw -= penalty;
    notes.push(`${student.studyGapMonths} month study gap`);
  }
  if (student.backlogCount > 0) {
    raw -= Math.min(35, student.backlogCount * 8);
    notes.push(`${student.backlogCount} backlog${student.backlogCount === 1 ? "" : "s"}`);
  }
  return {
    factorKey: "risk",
    rawScore: clamp(raw),
    skipped: false,
    reasoning: notes.length === 0 ? "No study gaps or backlogs recorded." : `Accounting for ${notes.join(" and ")}.`,
  };
}

function scoreDeadline(program: ProgramInput, now: Date): Omit<FactorScore, "weight" | "weightedScore"> {
  if (!program.applicationDeadline || program.intakeStatus === null) {
    return { factorKey: "deadline", rawScore: 0, skipped: true, reasoning: "No intake dates published." };
  }
  if (program.intakeStatus === "CLOSED") {
    return { factorKey: "deadline", rawScore: 0, skipped: false, reasoning: "Applications for this intake have closed." };
  }
  const days = Math.floor((program.applicationDeadline.getTime() - now.getTime()) / 86_400_000);
  if (days < 0) {
    return { factorKey: "deadline", rawScore: 0, skipped: false, reasoning: "The application deadline has passed." };
  }
  const raw = days >= 90 ? 100 : days >= 30 ? 75 : days >= 14 ? 50 : 25;
  return {
    factorKey: "deadline",
    rawScore: raw,
    skipped: false,
    reasoning:
      days >= 90
        ? `Plenty of time — ${days} days until the deadline.`
        : `Only ${days} days until the deadline.`,
  };
}

function scoreDocuments(student: StudentInput): Omit<FactorScore, "weight" | "weightedScore"> {
  const raw = clamp(student.documentsReadyRatio * 100);
  return {
    factorKey: "documentReadiness",
    rawScore: raw,
    skipped: false,
    reasoning:
      raw >= 100
        ? "All baseline documents are verified."
        : `${Math.round(raw)}% of your baseline documents are ready.`,
  };
}

/**
 * Scores one programme for one student.
 *
 * Skipped factors (no data on either side) are excluded and their weight is
 * redistributed proportionally across the factors that DID have data — scoring a missing
 * field as 0 would punish the student for the catalog's gaps, and scoring it 100 would
 * flatter them (docs/16 §"Missing catalog fields").
 */
export function assessProgram(
  student: StudentInput,
  program: ProgramInput,
  rules: ScoringRules,
  now: Date = new Date(),
): ProgramAssessment {
  const parts = [
    scoreAcademic(student, program),
    scoreEnglish(student, program),
    scoreBudget(student, program),
    scoreProgramFit(student, program),
    scoreCountry(student, program),
    scoreRisk(student),
    scoreDeadline(program, now),
    scoreDocuments(student),
  ];

  const activeWeight = parts
    .filter((p) => !p.skipped)
    .reduce((sum, p) => sum + rules.weights[p.factorKey], 0);

  const factors: FactorScore[] = parts.map((p) => {
    const nominal = rules.weights[p.factorKey];
    // Redistribution: an active factor's effective weight is its share of the weight
    // that actually had data behind it.
    const effective = p.skipped || activeWeight === 0 ? 0 : (nominal / activeWeight) * 100;
    return {
      ...p,
      weight: nominal,
      weightedScore: (p.rawScore * effective) / 100,
    };
  });

  const overallScore = Math.round(factors.reduce((sum, f) => sum + f.weightedScore, 0));
  const byKey = Object.fromEntries(factors.map((f) => [f.factorKey, f])) as Record<
    keyof ScoringWeights,
    FactorScore
  >;

  const missingRequirements: string[] = [];
  if (byKey.academic && !byKey.academic.skipped && program.minGpa !== null && (student.academicIndex ?? 0) < program.minGpa) {
    missingRequirements.push(`Minimum GPA of ${program.minGpa.toFixed(2)}`);
  }
  if (byKey.english && program.minIelts !== null) {
    if (student.englishIndex === null) {
      missingRequirements.push(`An English test result (IELTS ${program.minIelts} or equivalent)`);
    } else if (student.englishIndex < program.minIelts) {
      missingRequirements.push(`IELTS ${program.minIelts} (you have ${student.englishIndex})`);
    }
  }
  if (student.documentsReadyRatio < 1) missingRequirements.push("Some baseline documents are not yet verified");

  const flags: string[] = [];
  if (student.englishIsEstimated) flags.push("ESTIMATED_PENDING_TEST");
  if (program.intakeStatus === "CLOSED") flags.push("INTAKE_CLOSED");

  const zone = assignZone(overallScore, byKey, rules, flags);

  const strengths = factors
    .filter((f) => !f.skipped && f.rawScore >= 80)
    .map((f) => f.reasoning);
  const weaknesses = factors
    .filter((f) => !f.skipped && f.rawScore < 50)
    .map((f) => f.reasoning);

  const eligibilityStatus =
    missingRequirements.length === 0
      ? "ELIGIBLE"
      : byKey.academic.rawScore >= 50 && (byKey.english.skipped || byKey.english.rawScore >= 50)
        ? "BORDERLINE"
        : "NOT_ELIGIBLE";

  return {
    programId: program.id,
    overallScore,
    zone,
    eligibilityStatus,
    factors,
    strengths,
    weaknesses,
    missingRequirements,
    flags,
    reasoning: buildReasoning(zone, overallScore, byKey),
  };
}

/**
 * Zone assignment. SAFE additionally requires clearing hard floors on the factors that
 * actually determine admissibility — a high weighted average built on a strong budget
 * and a weak academic score is not a "safer option", and calling it one would be exactly
 * the kind of overclaim the product forbids (docs/00-project-charter.md, docs/16).
 */
export function assignZone(
  overallScore: number,
  byKey: Record<keyof ScoringWeights, FactorScore>,
  rules: ScoringRules,
  flags: string[],
): Zone {
  if (overallScore < rules.thresholds.reachMin) return "EXCLUDED";
  if (flags.includes("INTAKE_CLOSED")) return "REACH";

  if (overallScore >= rules.thresholds.safeMin) {
    const g = rules.safeGuardrails;
    const englishOk = byKey.english.skipped
      ? false // no English evidence at all can never be SAFE
      : byKey.english.rawScore >= g.minEnglish && !flags.includes("ESTIMATED_PENDING_TEST");
    const passes =
      byKey.academic.rawScore >= g.minAcademic &&
      englishOk &&
      byKey.deadline.rawScore >= g.minDeadline &&
      byKey.risk.rawScore >= g.minRisk;
    // Demoted rather than promoted when a floor is missed.
    return passes ? "SAFE" : "TARGET";
  }

  return overallScore >= rules.thresholds.targetMin ? "TARGET" : "REACH";
}

function buildReasoning(
  zone: Zone,
  score: number,
  byKey: Record<keyof ScoringWeights, FactorScore>,
): string {
  // Language is deliberately compatibility-based, never predictive: the platform is an
  // assessment tool, not the university or the immigration authority.
  const lead: Record<Zone, string> = {
    SAFE: "Strong compatibility based on the information you provided.",
    TARGET: "Good compatibility, with some areas to strengthen.",
    REACH: "An ambitious option — several requirements are a stretch.",
    EXCLUDED: "Compatibility is low based on the information you provided.",
  };
  const drivers = [byKey.academic, byKey.english, byKey.budget]
    .filter((f) => !f.skipped)
    .map((f) => `${f.factorKey}: ${Math.round(f.rawScore)}/100`)
    .join(", ");
  return `${lead[zone]} Overall compatibility ${score}/100 (${drivers}).`;
}
