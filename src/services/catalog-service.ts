import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "../../prisma/generated/client";

// University catalog — docs/26-university-data-management.md.
//
// Freshness matters as much as content here: a programme whose requirements haven't been
// verified recently is shown with a flag rather than silently presented as current
// (docs/54-decision-log.md D-7), because AdmitFlow's credibility rests on students being
// able to trust — and check — what they're told.

/** Staleness windows in months, per field class — docs/54-decision-log.md D-7. */
export const STALENESS_MONTHS = {
  /** GPA / English / fee / deadline data. */
  REQUIREMENTS: 6,
  /** Required-document lists and scholarship criteria. */
  DOCUMENTS: 9,
  /** Rankings and descriptive metadata. */
  DESCRIPTIVE: 12,
} as const;

export function isStale(verifiedAt: Date | null, months: number): boolean {
  if (!verifiedAt) return true;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return verifiedAt < cutoff;
}

export interface ProgramSearchFilters {
  query?: string;
  countryIds?: string[];
  level?: string;
  fieldOfStudy?: string;
  deliveryMode?: string;
  maxTuition?: number;
  currency?: string;
  intakeStatus?: string;
  maxIeltsRequired?: number;
}

export interface CursorPage {
  cursor?: string;
  pageSize?: number;
}

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;

/**
 * Cursor-paginated programme search — docs/34-performance-strategy.md.
 *
 * Cursor rather than offset because the catalog is browsed sequentially and offset
 * pagination both degrades on deep pages and can silently skip or repeat rows when the
 * underlying data changes mid-browse. Results are always bounded; there is no code path
 * that returns the whole catalog.
 */
export async function searchPrograms(filters: ProgramSearchFilters, page: CursorPage = {}) {
  const pageSize = Math.min(page.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

  const where: Prisma.ProgramWhereInput = {
    deletedAt: null,
    university: { deletedAt: null },
  };

  if (filters.query) {
    // Indexed prefix/substring search across the two fields students actually search by.
    // Full-text/trigram search is the documented upgrade path once the catalog is large
    // enough for this to matter (docs/34-performance-strategy.md).
    where.OR = [
      { name: { contains: filters.query, mode: "insensitive" } },
      { fieldOfStudy: { contains: filters.query, mode: "insensitive" } },
      { university: { name: { contains: filters.query, mode: "insensitive" }, deletedAt: null } },
    ];
  }
  if (filters.countryIds?.length) {
    where.university = { deletedAt: null, countryId: { in: filters.countryIds } };
  }
  if (filters.level) where.level = filters.level as Prisma.ProgramWhereInput["level"];
  if (filters.fieldOfStudy) {
    where.fieldOfStudy = { contains: filters.fieldOfStudy, mode: "insensitive" };
  }
  if (filters.deliveryMode) {
    where.deliveryMode = filters.deliveryMode as Prisma.ProgramWhereInput["deliveryMode"];
  }
  if (filters.intakeStatus) {
    where.intakes = {
      some: { status: filters.intakeStatus as "UPCOMING" | "OPEN" | "CLOSED" },
    };
  }
  if (filters.maxTuition) {
    where.tuitionFees = {
      some: {
        category: "INTERNATIONAL",
        amount: { lte: filters.maxTuition },
        ...(filters.currency ? { currency: filters.currency } : {}),
      },
    };
  }
  if (filters.maxIeltsRequired) {
    where.englishRequirements = {
      some: { testType: "IELTS", minOverallScore: { lte: filters.maxIeltsRequired } },
    };
  }

  const rows = await db.program.findMany({
    where,
    take: pageSize + 1, // one extra row tells us whether another page exists
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    orderBy: [{ name: "asc" }, { id: "asc" }],
    include: {
      university: { include: { country: true, metadata: true } },
      campus: { include: { city: true } },
      intakes: { orderBy: { applicationDeadline: "asc" } },
      tuitionFees: { where: { category: "INTERNATIONAL" }, orderBy: { effectiveFrom: "desc" } },
      englishRequirements: true,
      programRequirements: true,
    },
  });

  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;

  return {
    items: items.map(toProgramSummary),
    nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    hasMore,
    pageSize,
  };
}

export type ProgramSummary = ReturnType<typeof toProgramSummary>;

function toProgramSummary(program: Awaited<ReturnType<typeof loadProgram>>) {
  const tuition = program.tuitionFees[0] ?? null;
  const ielts = program.englishRequirements.find((r) => r.testType === "IELTS") ?? null;
  const minGpa = program.programRequirements.find((r) => r.requirementType === "MIN_GPA") ?? null;
  const nextIntake =
    program.intakes.find((i) => i.status === "OPEN") ??
    program.intakes.find((i) => i.status === "UPCOMING") ??
    null;
  const verifiedAt = program.university.metadata?.verifiedAt ?? null;

  return {
    id: program.id,
    name: program.name,
    level: program.level,
    fieldOfStudy: program.fieldOfStudy,
    durationMonths: program.durationMonths,
    deliveryMode: program.deliveryMode,
    university: {
      id: program.university.id,
      name: program.university.name,
      country: program.university.country.name,
      countryId: program.university.countryId,
      worldRanking: program.university.worldRanking,
    },
    city: program.campus?.city?.name ?? null,
    tuition: tuition
      ? { amount: Number(tuition.amount), currency: tuition.currency, perPeriod: tuition.perPeriod }
      : null,
    minIelts: ielts ? Number(ielts.minOverallScore) : null,
    minGpa: minGpa?.minValue !== null && minGpa?.minValue !== undefined ? Number(minGpa.minValue) : null,
    nextIntake: nextIntake
      ? {
          id: nextIntake.id,
          term: nextIntake.term,
          status: nextIntake.status,
          applicationDeadline: nextIntake.applicationDeadline,
        }
      : null,
    dataFreshness: {
      verifiedAt,
      isStale: isStale(verifiedAt, STALENESS_MONTHS.REQUIREMENTS),
      confidence: program.university.metadata?.confidence ?? null,
      source: program.university.metadata?.source ?? null,
    },
  };
}

async function loadProgram(id: string) {
  return db.program.findUniqueOrThrow({
    where: { id },
    include: {
      university: { include: { country: true, metadata: true } },
      campus: { include: { city: true } },
      intakes: { orderBy: { applicationDeadline: "asc" } },
      tuitionFees: { where: { category: "INTERNATIONAL" }, orderBy: { effectiveFrom: "desc" } },
      englishRequirements: true,
      programRequirements: true,
    },
  });
}

export async function getProgramDetail(id: string) {
  const program = await db.program.findUnique({
    where: { id },
    include: {
      university: { include: { country: true, metadata: true, scholarships: true } },
      campus: { include: { city: true } },
      intakes: { orderBy: { applicationDeadline: "asc" } },
      tuitionFees: { orderBy: { effectiveFrom: "desc" } },
      englishRequirements: true,
      programRequirements: true,
      documentRequirements: true,
      scholarships: true,
    },
  });
  if (!program || program.deletedAt) return null;

  return {
    ...toProgramSummary(program),
    intakes: program.intakes.map((i) => ({
      id: i.id,
      term: i.term,
      status: i.status,
      applicationOpenDate: i.applicationOpenDate,
      applicationDeadline: i.applicationDeadline,
      startDate: i.startDate,
      capacity: i.capacity,
    })),
    englishRequirements: program.englishRequirements.map((r) => ({
      testType: r.testType,
      minOverallScore: Number(r.minOverallScore),
    })),
    academicRequirements: program.programRequirements.map((r) => ({
      requirementType: r.requirementType,
      minValue: r.minValue === null ? null : Number(r.minValue),
      description: r.description,
      isMandatory: r.isMandatory,
    })),
    documentRequirements: program.documentRequirements.map((r) => ({
      documentType: r.documentType,
      isMandatory: r.isMandatory,
      description: r.description,
    })),
    scholarships: [...program.scholarships, ...program.university.scholarships.filter((s) => !s.programId)].map(
      (s) => ({
        id: s.id,
        name: s.name,
        amount: s.amount === null ? null : Number(s.amount),
        currency: s.currency,
        coveragePercent: s.coveragePercent === null ? null : Number(s.coveragePercent),
        eligibilityCriteria: s.eligibilityCriteria,
        applicationDeadline: s.applicationDeadline,
      }),
    ),
    tuitionFees: program.tuitionFees.map((f) => ({
      category: f.category,
      amount: Number(f.amount),
      currency: f.currency,
      perPeriod: f.perPeriod,
    })),
  };
}

/** Distinct field-of-study values, for search filter dropdowns. */
export async function listFieldsOfStudy(): Promise<string[]> {
  const rows = await db.program.findMany({
    where: { deletedAt: null },
    distinct: ["fieldOfStudy"],
    select: { fieldOfStudy: true },
    orderBy: { fieldOfStudy: "asc" },
  });
  return rows.map((r) => r.fieldOfStudy);
}

/**
 * A monotonic version tag for the whole catalog, stamped into assessment snapshots so a
 * historical result can say which catalog it was computed against
 * (docs/16-assessment-engine.md, docs/54-decision-log.md D-7).
 */
export async function getCatalogDataVersion(): Promise<string> {
  const [latest, count] = await Promise.all([
    db.program.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    db.program.count({ where: { deletedAt: null } }),
  ]);
  const stamp = latest?.updatedAt.toISOString().slice(0, 19).replace(/[-:T]/g, "") ?? "empty";
  return `catalog-${stamp}-${count}`;
}
