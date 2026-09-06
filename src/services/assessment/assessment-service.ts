import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import { getCatalogDataVersion } from "@/services/catalog-service";
import type { Prisma } from "../../../prisma/generated/client";
import {
  DEFAULT_RULES,
  MATCHING_ENGINE_VERSION,
  assessProgram,
  type ProgramAssessment,
  type ProgramInput,
  type ScoringRules,
  type StudentInput,
} from "./scoring";
import { ESTIMATED_ENGLISH_INDEX, bestEnglishIndex, toAcademicIndex } from "./normalize";

// Assessment orchestration — docs/16-assessment-engine.md, docs/17-university-matching-engine.md.
//
// Loads the student's snapshot inputs and the catalog, runs the pure scoring engine over
// every candidate programme, and writes an immutable result + snapshot so the run stays
// reproducible and explainable even after rules or catalog data change
// (docs/54-decision-log.md D-6).

/** Loads the active rule set from the database, falling back to the seeded defaults. */
export async function loadActiveRules(): Promise<ScoringRules> {
  const rows = await db.assessmentRule.findMany({
    where: { isActive: true },
    orderBy: { version: "desc" },
  });

  const weightsRow = rows.find((r) => r.key === "weights");
  const thresholdsRow = rows.find((r) => r.key === "zone_thresholds");
  const guardrailsRow = rows.find((r) => r.key === "safe_guardrails");
  if (!weightsRow || !thresholdsRow || !guardrailsRow) return DEFAULT_RULES;

  return {
    version: `rules-v${weightsRow.version}`,
    weights: weightsRow.config as unknown as ScoringRules["weights"],
    thresholds: thresholdsRow.config as unknown as ScoringRules["thresholds"],
    safeGuardrails: guardrailsRow.config as unknown as ScoringRules["safeGuardrails"],
  };
}

async function buildStudentInput(profileId: string): Promise<{
  input: StudentInput;
  snapshot: Prisma.InputJsonValue;
  answerSnapshotId: string | null;
}> {
  const profile = await db.profile.findUniqueOrThrow({
    where: { id: profileId },
    include: {
      educations: { include: { academicRecords: true } },
      languageTests: true,
      preference: true,
      destinationCountries: { orderBy: { rank: "asc" } },
      user: {
        include: {
          documentsOwned: { where: { deletedAt: null } },
        },
      },
      questionnaireResponses: {
        where: { status: "SUBMITTED" },
        orderBy: { submittedAt: "desc" },
        take: 1,
        include: { answerSnapshot: true },
      },
    },
  });

  // Highest qualification drives the academic index — a master's grade is more relevant
  // than the high-school grade that preceded it.
  const graded = profile.educations.filter((e) => e.gradeValue !== null);
  const levelRank: Record<string, number> = {
    DOCTORATE: 4,
    MASTERS: 3,
    BACHELORS: 2,
    HIGH_SCHOOL: 1,
    OTHER: 0,
  };
  const highest = graded.sort(
    (a, b) => (levelRank[b.level] ?? 0) - (levelRank[a.level] ?? 0),
  )[0];
  const academicIndex = highest?.gradeValue
    ? toAcademicIndex(highest.gradingScale, Number(highest.gradeValue))
    : null;

  const englishFromTest = bestEnglishIndex(
    profile.languageTests.map((t) => ({
      testType: t.testType,
      overallScore: Number(t.overallScore),
      expiryDate: t.expiryDate,
    })),
  );
  const englishIsEstimated = englishFromTest === null;
  const englishIndex = englishFromTest ?? (academicIndex !== null ? ESTIMATED_ENGLISH_INDEX : null);

  const gapMonths = profile.educations
    .flatMap((e) => e.academicRecords)
    .reduce((max, r) => Math.max(max, r.gapMonths ?? 0), 0);
  const backlogCount = profile.educations
    .flatMap((e) => e.academicRecords)
    .filter((r) => r.hasGap).length;

  // Document readiness: the share of baseline (programme-agnostic) requirements the
  // student has a VERIFIED document for.
  const baselineRequirements = await db.documentRequirement.findMany({
    where: { programId: null, isMandatory: true },
  });
  const verifiedTypes = new Set(
    profile.user.documentsOwned.filter((d) => d.status === "VERIFIED").map((d) => d.type),
  );
  const documentsReadyRatio =
    baselineRequirements.length === 0
      ? 1
      : baselineRequirements.filter((r) => verifiedTypes.has(r.documentType)).length /
        baselineRequirements.length;

  const fieldsOfInterest = [
    ...new Set(profile.educations.map((e) => e.fieldOfStudy).filter((f): f is string => !!f)),
  ];

  const input: StudentInput = {
    academicIndex,
    englishIndex,
    englishIsEstimated,
    budgetMax: profile.budgetMax === null ? null : Number(profile.budgetMax),
    budgetCurrency: profile.budgetCurrency,
    destinationCountryIds: profile.destinationCountries.map((d) => d.countryId),
    fieldsOfInterest,
    preferredLevel: null,
    studyGapMonths: gapMonths,
    backlogCount,
    documentsReadyRatio,
  };

  // The snapshot freezes the inputs, not just the outputs, so a historical result can be
  // re-explained exactly as it was computed (docs/10-database-schema.md §7.4).
  const snapshot = {
    profile: {
      id: profile.id,
      budgetMax: profile.budgetMax === null ? null : Number(profile.budgetMax),
      budgetCurrency: profile.budgetCurrency,
      destinationCountryIds: input.destinationCountryIds,
    },
    educations: profile.educations.map((e) => ({
      level: e.level,
      institutionName: e.institutionName,
      gradingScale: e.gradingScale,
      gradeValue: e.gradeValue === null ? null : Number(e.gradeValue),
      fieldOfStudy: e.fieldOfStudy,
    })),
    languageTests: profile.languageTests.map((t) => ({
      testType: t.testType,
      overallScore: Number(t.overallScore),
      testDate: t.testDate.toISOString(),
      expiryDate: t.expiryDate?.toISOString() ?? null,
    })),
    preference: profile.preference
      ? {
          studyMode: profile.preference.studyMode,
          campusSizePreference: profile.preference.campusSizePreference,
          scholarshipPriority: profile.preference.scholarshipPriority,
          intakePreference: profile.preference.intakePreference,
        }
      : null,
    derivedInput: { ...input, destinationCountryIds: input.destinationCountryIds },
  } satisfies Prisma.InputJsonValue;

  return {
    input,
    snapshot,
    answerSnapshotId: profile.questionnaireResponses[0]?.answerSnapshot?.id ?? null,
  };
}

/** Candidate generation — narrows the catalog before scoring (docs/17 §"Candidate generation"). */
async function loadCandidatePrograms(student: StudentInput): Promise<ProgramInput[]> {
  const programs = await db.program.findMany({
    where: {
      deletedAt: null,
      university: { deletedAt: null },
      // Deliberately NOT filtered to the student's chosen countries: a strong match just
      // outside their stated list is worth surfacing as a REACH/TARGET option, and the
      // country factor already penalises it appropriately.
    },
    include: {
      university: true,
      intakes: { orderBy: { applicationDeadline: "asc" } },
      tuitionFees: { where: { category: "INTERNATIONAL" }, orderBy: { effectiveFrom: "desc" }, take: 1 },
      englishRequirements: { where: { testType: "IELTS" }, take: 1 },
      programRequirements: { where: { requirementType: "MIN_GPA" }, take: 1 },
    },
  });

  return programs.map((p) => {
    const intake =
      p.intakes.find((i) => i.status === "OPEN") ??
      p.intakes.find((i) => i.status === "UPCOMING") ??
      p.intakes[0] ??
      null;
    const tuition = p.tuitionFees[0] ?? null;
    const minGpaRow = p.programRequirements[0] ?? null;
    const ieltsRow = p.englishRequirements[0] ?? null;

    return {
      id: p.id,
      name: p.name,
      level: p.level,
      fieldOfStudy: p.fieldOfStudy,
      countryId: p.university.countryId,
      minGpa: minGpaRow?.minValue == null ? null : Number(minGpaRow.minValue),
      minIelts: ieltsRow ? Number(ieltsRow.minOverallScore) : null,
      tuitionAmount: tuition ? Number(tuition.amount) : null,
      tuitionCurrency: tuition?.currency ?? null,
      budgetHardCeiling: false,
      applicationDeadline: intake?.applicationDeadline ?? null,
      intakeStatus: intake?.status ?? null,
    } satisfies ProgramInput;
  });
}

export interface AssessmentRunResult {
  assessmentId: string;
  resultId: string;
  counts: Record<string, number>;
}

/**
 * Runs a full assessment for a student and persists an immutable result.
 *
 * Historical results are never recomputed in place — a re-run creates a new Assessment
 * row, so a student can always see what they were told before and why it changed.
 */
export async function runAssessment(
  userId: string,
  profileId: string,
  triggeredBy: "STUDENT_REQUEST" | "PROFILE_UPDATE" | "ADMIN_REQUEST" = "STUDENT_REQUEST",
): Promise<AssessmentRunResult> {
  const [{ input, snapshot, answerSnapshotId }, rules, catalogVersion] = await Promise.all([
    buildStudentInput(profileId),
    loadActiveRules(),
    getCatalogDataVersion(),
  ]);

  if (input.academicIndex === null) {
    throw new AppError(
      "ASSESSMENT_NOT_READY",
      "Add at least one qualification with a grade before running an assessment.",
    );
  }

  const candidates = await loadCandidatePrograms(input);
  if (candidates.length === 0) {
    throw new AppError("ASSESSMENT_NOT_READY", "The programme catalog is empty.");
  }

  const now = new Date();
  const scored = candidates
    .map((program) => assessProgram(input, program, rules, now))
    .filter((r) => r.zone !== "EXCLUDED")
    .sort(sortByRank);

  const counts = scored.reduce<Record<string, number>>((acc, r) => {
    acc[r.zone] = (acc[r.zone] ?? 0) + 1;
    return acc;
  }, {});

  const assessment = await db.$transaction(async (tx) => {
    const created = await tx.assessment.create({
      data: { profileId, triggeredBy, status: "COMPLETED" },
    });

    const result = await tx.assessmentResult.create({
      data: {
        assessmentId: created.id,
        profileId,
        matchingEngineVersion: MATCHING_ENGINE_VERSION,
        universityDataVersion: catalogVersion,
        rulesVersion: rules.version,
        results: scored as unknown as Prisma.InputJsonValue,
      },
    });

    if (answerSnapshotId) {
      await tx.assessmentSnapshot.create({
        data: {
          assessmentResultId: result.id,
          profileSnapshot: snapshot,
          answerSnapshotId,
          rulesConfigSnapshot: rules as unknown as Prisma.InputJsonValue,
          universityDataVersion: catalogVersion,
        },
      });
    }

    await writeAuditLog(
      {
        actorId: userId,
        actorType: "STUDENT",
        action: "assessment.run",
        entityType: "Assessment",
        entityId: created.id,
        metadata: { programsScored: scored.length, rulesVersion: rules.version },
      },
      tx,
    );

    return { created, result };
  });

  return {
    assessmentId: assessment.created.id,
    resultId: assessment.result.id,
    counts,
  };
}

/**
 * Ranking within a zone — docs/17 §"Tie-breaking".
 * Score first, then deadline actionability, then ranking as a tiebreak only (never a
 * scoring input), then a deterministic id sort so repeated runs are stable.
 */
function sortByRank(a: ProgramAssessment, b: ProgramAssessment): number {
  if (b.overallScore !== a.overallScore) return b.overallScore - a.overallScore;
  const aDeadline = a.factors.find((f) => f.factorKey === "deadline")?.rawScore ?? 0;
  const bDeadline = b.factors.find((f) => f.factorKey === "deadline")?.rawScore ?? 0;
  if (bDeadline !== aDeadline) return bDeadline - aDeadline;
  return a.programId.localeCompare(b.programId);
}

export async function getLatestAssessment(profileId: string) {
  return db.assessmentResult.findFirst({
    where: { profileId },
    orderBy: { generatedAt: "desc" },
    include: { assessment: true },
  });
}

export async function listAssessments(profileId: string) {
  return db.assessmentResult.findMany({
    where: { profileId },
    orderBy: { generatedAt: "desc" },
    select: {
      id: true,
      generatedAt: true,
      matchingEngineVersion: true,
      rulesVersion: true,
      universityDataVersion: true,
      assessmentId: true,
    },
  });
}
