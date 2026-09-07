import "server-only";
import { db } from "@/lib/db";
import { ENTITLEMENTS, hasEntitlement } from "@/services/entitlement-service";
import { describeFreshness } from "@/services/catalog-service";
import type { ProgramAssessment } from "./scoring";

// ============================================================================
// THE PAYWALL PROJECTION — the platform's single most important security boundary.
//
// docs/54-decision-log.md D-5, docs/12-api-contracts.md §4, docs/36-security-testing.md
// §4 (SEC-LEAK-*), docs/49-threat-model.md §5.
//
// A locked result is NOT sent with a "locked: true" flag next to its real name for the
// frontend to blur. The identifying fields are never put into the payload at all. Anyone
// can open devtools; client-side hiding is decoration, not access control.
//
// Concretely, for a locked entry the response carries ONLY: the zone, an opaque
// placeholder id, and the fact that it is locked. No programme name, no university name,
// no country, no city, no tuition, no deadline, no score, no factor breakdown, no
// reasoning — because each of those is independently enough to identify or evaluate the
// programme the student hasn't paid for.
// ============================================================================

export interface UnlockedResult {
  locked: false;
  programId: string;
  zone: string;
  overallScore: number;
  eligibilityStatus: string;
  program: {
    name: string;
    level: string;
    fieldOfStudy: string;
    durationMonths: number;
    deliveryMode: string;
    university: string;
    country: string;
    city: string | null;
    worldRanking: number | null;
  };
  tuition: { amount: number; currency: string; perPeriod: string } | null;
  nextIntake: { term: string; status: string; applicationDeadline: string } | null;
  factors: {
    factorKey: string;
    weight: number;
    rawScore: number;
    reasoning: string;
    skipped: boolean;
  }[];
  strengths: string[];
  weaknesses: string[];
  missingRequirements: string[];
  flags: string[];
  reasoning: string;
  dataFreshness: {
    verifiedAt: string | null;
    isStale: boolean;
    source: string | null;
    label: string | null;
  };
}

export interface LockedResult {
  locked: true;
  /** Positional placeholder only — deliberately NOT the real programme id. */
  placeholderId: string;
  zone: string;
}

export type ProjectedResult = UnlockedResult | LockedResult;

export interface ProjectedResults {
  assessmentId: string;
  resultId: string;
  generatedAt: string;
  matchingEngineVersion: string;
  rulesVersion: string;
  universityDataVersion: string;
  results: ProjectedResult[];
  counts: { REACH: number; TARGET: number; SAFE: number };
  lockedCounts: { TARGET: number; SAFE: number };
  entitlements: { target: boolean; safe: boolean };
  /** How many of the visible entries are the always-free preview (see FREE_PREVIEW_COUNT). */
  freePreviewCount: number;
}

/**
 * The free tier is never empty.
 *
 * Gating purely by zone looked right until a strong profile was tested against it: a
 * student with good grades and a real IELTS score matched 15 SAFE and 33 TARGET
 * programmes and **zero** REACH ones — so the "free assessment" showed them nothing at
 * all behind a paywall. That is precisely the dark pattern the charter forbids, and it
 * penalises exactly the students the product works best for.
 *
 * So on top of every REACH match, the highest-scoring matches are always readable. The
 * paywall still gates the overwhelming majority (45 of 48 in that case) and now has an
 * honest story to tell: here are your three best, here is what unlocking the rest buys.
 */
export const FREE_PREVIEW_COUNT = 3;

/**
 * Projects a stored assessment result for a specific viewer.
 *
 * Every caller that returns assessment data to a client MUST go through this function.
 * There is intentionally no "raw results" accessor exported from this module.
 */
export async function projectResultsForUser(
  userId: string,
  resultId: string,
): Promise<ProjectedResults | null> {
  const stored = await db.assessmentResult.findUnique({
    where: { id: resultId },
    include: { assessment: { include: { profile: true } } },
  });
  if (!stored) return null;

  // Object-level authorization: a result belongs to exactly one student, and knowing a
  // result id must never be enough to read it (docs/49-threat-model.md).
  const owner = await db.profile.findUnique({
    where: { id: stored.profileId },
    select: { userId: true },
  });
  if (!owner || owner.userId !== userId) return null;

  const [canSeeTarget, canSeeSafe] = await Promise.all([
    hasEntitlement(userId, ENTITLEMENTS.TARGET_RESULTS, { assessmentId: stored.assessmentId }),
    hasEntitlement(userId, ENTITLEMENTS.SAFE_RESULTS, { assessmentId: stored.assessmentId }),
  ]);

  const raw = stored.results as unknown as ProgramAssessment[];

  // The free preview: the best matches that zone gating alone would have hidden. Chosen
  // by score and then by id so the same assessment always previews the same programmes —
  // a preview that reshuffled per request would look broken and be untestable.
  const previewIds = new Set(
    raw
      .filter((r) => !isZoneVisible(r.zone, canSeeTarget, canSeeSafe))
      .sort((a, b) => b.overallScore - a.overallScore || a.programId.localeCompare(b.programId))
      .slice(0, FREE_PREVIEW_COUNT)
      .map((r) => r.programId),
  );

  const isVisible = (entry: ProgramAssessment) =>
    isZoneVisible(entry.zone, canSeeTarget, canSeeSafe) || previewIds.has(entry.programId);

  // Hydrate catalog detail only for the entries this viewer is allowed to see. Locked
  // entries are never even looked up, so their data cannot leak through a logging or
  // serialization mistake further down.
  const visibleIds = raw.filter(isVisible).map((r) => r.programId);

  const programs = await db.program.findMany({
    where: { id: { in: visibleIds } },
    include: {
      university: { include: { country: true, metadata: true } },
      campus: { include: { city: true } },
      intakes: { orderBy: { applicationDeadline: "asc" } },
      tuitionFees: { where: { category: "INTERNATIONAL" }, orderBy: { effectiveFrom: "desc" }, take: 1 },
    },
  });
  const programById = new Map(programs.map((p) => [p.id, p]));

  const counts = { REACH: 0, TARGET: 0, SAFE: 0 };
  const lockedCounts = { TARGET: 0, SAFE: 0 };

  const results: ProjectedResult[] = raw.map((entry, index) => {
    if (entry.zone in counts) counts[entry.zone as keyof typeof counts] += 1;

    if (!isVisible(entry)) {
      if (entry.zone === "TARGET" || entry.zone === "SAFE") lockedCounts[entry.zone] += 1;
      return { locked: true, placeholderId: `locked-${index}`, zone: entry.zone };
    }

    const program = programById.get(entry.programId);
    if (!program) {
      // The programme was removed from the catalog since this assessment ran. The
      // historical result stays valid but there is nothing current to show.
      return { locked: true, placeholderId: `withdrawn-${index}`, zone: entry.zone };
    }

    const intake =
      program.intakes.find((i) => i.status === "OPEN") ??
      program.intakes.find((i) => i.status === "UPCOMING") ??
      null;
    const tuition = program.tuitionFees[0] ?? null;
    const verifiedAt = program.university.metadata?.verifiedAt ?? null;

    return {
      locked: false,
      programId: program.id,
      zone: entry.zone,
      overallScore: entry.overallScore,
      eligibilityStatus: entry.eligibilityStatus,
      program: {
        name: program.name,
        level: program.level,
        fieldOfStudy: program.fieldOfStudy,
        durationMonths: program.durationMonths,
        deliveryMode: program.deliveryMode,
        university: program.university.name,
        country: program.university.country.name,
        city: program.campus?.city?.name ?? null,
        worldRanking: program.university.worldRanking,
      },
      tuition: tuition
        ? { amount: Number(tuition.amount), currency: tuition.currency, perPeriod: tuition.perPeriod }
        : null,
      nextIntake: intake
        ? {
            term: intake.term,
            status: intake.status,
            applicationDeadline: intake.applicationDeadline.toISOString(),
          }
        : null,
      factors: entry.factors.map((f) => ({
        factorKey: f.factorKey,
        weight: f.weight,
        rawScore: Math.round(f.rawScore),
        reasoning: f.reasoning,
        skipped: f.skipped,
      })),
      strengths: entry.strengths,
      weaknesses: entry.weaknesses,
      missingRequirements: entry.missingRequirements,
      flags: entry.flags,
      reasoning: entry.reasoning,
      dataFreshness: {
        verifiedAt: verifiedAt?.toISOString() ?? null,
        isStale: !verifiedAt,
        source: program.university.metadata?.source ?? null,
        // Same wording as the catalog, so a programme isn't described one way in search
        // and another way in a match.
        label: describeFreshness(
          verifiedAt,
          program.university.metadata?.confidence ?? null,
          program.university.metadata?.source ?? null,
        ).label,
      },
    };
  });

  return {
    assessmentId: stored.assessmentId,
    resultId: stored.id,
    generatedAt: stored.generatedAt.toISOString(),
    matchingEngineVersion: stored.matchingEngineVersion,
    rulesVersion: stored.rulesVersion,
    universityDataVersion: stored.universityDataVersion,
    results,
    counts,
    lockedCounts,
    entitlements: { target: canSeeTarget, safe: canSeeSafe },
    freePreviewCount: previewIds.size,
  };
}

/** REACH is always free; TARGET and SAFE each require their own entitlement. */
function isZoneVisible(zone: string, canSeeTarget: boolean, canSeeSafe: boolean): boolean {
  if (zone === "REACH") return true;
  if (zone === "TARGET") return canSeeTarget;
  if (zone === "SAFE") return canSeeSafe;
  return false;
}
