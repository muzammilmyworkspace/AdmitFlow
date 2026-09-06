// ============================================================================
// seedCatalog — DEMO university catalog (NOT real-world data)
// ============================================================================
//
// Every university, program, requirement, fee and intake in this file is
// FICTIONAL. The names are invented so that no student, screenshot, support
// ticket or exported report can ever mistake this data for a real admission
// requirement of a real institution. Per the project charter's no-fabrication
// rule, we must never present invented requirements as authoritative — so:
//
//   * university names are deliberately not real institutions;
//   * every `UniversityMetadata` row is written with
//     `source: "DEMO DATA — not a real institution"`, `confidence: LOW` and
//     `sourceUrl: null`, so the UI's provenance/confidence surfaces flag it;
//   * requirement, scholarship and document copy carries a `(DEMO DATA …)`
//     suffix so the marker survives even when a row is read in isolation;
//   * websites use the reserved `.example` TLD (RFC 2606) and can never resolve.
//
// This diverges deliberately from docs/37-seed-data-strategy.md §6 (which
// suggested real institution names for realism): the charter's no-fabrication
// rule wins — real names attached to invented requirements is exactly the
// confusion we must avoid. The `confidence: LOW` marking is stricter than
// docs/37 §4.2's MEDIUM for the same reason.
//
// The shape (spread of GPA thresholds, English bands, rankings, tuition and
// intake statuses) is chosen to exercise the matching engine's REACH/TARGET/
// SAFE zones, its "no ranking available" path, and its budget-fit scoring —
// not to describe any real admissions landscape.
//
// Idempotency: safe to rerun. Every write is `upsert` on a real unique
// constraint, or `findFirst`-then-`create` on a deterministic natural key.
// Nothing is ever deleted, and existing rows are left untouched (`update: {}`)
// so a locally edited demo row is not clobbered by a reseed.
// ============================================================================

import type {
  DeliveryMode,
  DocumentType,
  IntakeStatus,
  LanguageTestType,
  PrismaClient,
  ProgramLevel,
  ProgramRequirementType,
} from "./generated/client";

// ---------------------------------------------------------------------------
// Provenance markers
// ---------------------------------------------------------------------------

const DEMO_SOURCE = "DEMO DATA — not a real institution";
const DEMO_ACCREDITOR = "Demo Accreditation Council (fictional)";
const DEMO_REVIEWED_AT = new Date("2026-09-01T00:00:00.000Z");
const TUITION_EFFECTIVE_FROM = "2026-01-01";

/** Appends the demo marker to free-text copy that a student could read out of context. */
function demo(text: string): string {
  return `${text} (DEMO DATA — illustrative only, not a real requirement)`;
}

/** Parses a `YYYY-MM-DD` literal as a UTC instant, so seeds are timezone-stable. */
function d(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

// ---------------------------------------------------------------------------
// Geography
// ---------------------------------------------------------------------------

type CountryIso = "GB" | "CA" | "DE" | "AU" | "NL";

interface CityDef {
  readonly name: string;
  readonly timezone: string;
}

interface CountryDef {
  readonly isoCode2: CountryIso;
  readonly name: string;
  readonly region: string;
  readonly cities: readonly CityDef[];
}

const COUNTRIES: readonly CountryDef[] = [
  {
    isoCode2: "GB",
    name: "United Kingdom",
    region: "Europe",
    cities: [
      { name: "London", timezone: "Europe/London" },
      { name: "Manchester", timezone: "Europe/London" },
      { name: "Bristol", timezone: "Europe/London" },
    ],
  },
  {
    isoCode2: "CA",
    name: "Canada",
    region: "North America",
    cities: [
      { name: "Toronto", timezone: "America/Toronto" },
      { name: "Vancouver", timezone: "America/Vancouver" },
      { name: "Calgary", timezone: "America/Edmonton" },
    ],
  },
  {
    isoCode2: "DE",
    name: "Germany",
    region: "Europe",
    cities: [
      { name: "Berlin", timezone: "Europe/Berlin" },
      { name: "Munich", timezone: "Europe/Berlin" },
      { name: "Hamburg", timezone: "Europe/Berlin" },
    ],
  },
  {
    isoCode2: "AU",
    name: "Australia",
    region: "Oceania",
    cities: [
      { name: "Sydney", timezone: "Australia/Sydney" },
      { name: "Melbourne", timezone: "Australia/Melbourne" },
      { name: "Brisbane", timezone: "Australia/Brisbane" },
    ],
  },
  {
    isoCode2: "NL",
    name: "Netherlands",
    region: "Europe",
    cities: [
      { name: "Amsterdam", timezone: "Europe/Amsterdam" },
      { name: "Rotterdam", timezone: "Europe/Amsterdam" },
    ],
  },
];

/** ISO 4217 code used for every tuition row in that country. */
const CURRENCY_BY_COUNTRY: Record<CountryIso, string> = {
  GB: "GBP",
  CA: "CAD",
  DE: "EUR",
  AU: "AUD",
  NL: "EUR",
};

// ---------------------------------------------------------------------------
// Intake calendar
// ---------------------------------------------------------------------------
//
// Statuses are pinned relative to a 2026-09-07 "today" rather than derived at
// run time, so a reseed produces byte-identical rows (docs/37 §2 determinism).
// The mix is deliberate: CLOSED intakes let the UI exercise its "you have
// missed this deadline" path, UPCOMING ones the "not open yet" path.

interface IntakeTemplate {
  readonly open: string;
  readonly deadline: string;
  readonly start: string;
  readonly status: IntakeStatus;
}

const INTAKE_TERMS = {
  "Fall 2026": { open: "2025-10-01", deadline: "2026-06-30", start: "2026-09-21", status: "CLOSED" },
  "Winter 2026/27": { open: "2026-03-01", deadline: "2026-07-15", start: "2026-10-12", status: "CLOSED" },
  "Winter 2027": { open: "2026-05-15", deadline: "2026-10-15", start: "2027-01-11", status: "OPEN" },
  "Spring 2027": { open: "2026-06-01", deadline: "2026-11-30", start: "2027-01-18", status: "OPEN" },
  "February 2027": { open: "2026-06-01", deadline: "2026-11-01", start: "2027-02-01", status: "OPEN" },
  "Semester 1 2027": { open: "2026-07-01", deadline: "2026-11-15", start: "2027-02-22", status: "OPEN" },
  "Summer 2027": { open: "2026-09-01", deadline: "2027-01-15", start: "2027-04-06", status: "OPEN" },
  "Semester 2 2027": { open: "2027-01-15", deadline: "2027-05-30", start: "2027-07-19", status: "UPCOMING" },
  "Fall 2027": { open: "2026-10-01", deadline: "2027-06-30", start: "2027-09-20", status: "UPCOMING" },
  "September 2027": { open: "2026-10-01", deadline: "2027-05-01", start: "2027-09-01", status: "UPCOMING" },
  "Winter 2027/28": { open: "2027-01-10", deadline: "2027-07-15", start: "2027-10-11", status: "UPCOMING" },
} as const satisfies Record<string, IntakeTemplate>;

type TermKey = keyof typeof INTAKE_TERMS;

interface IntakeRef {
  readonly term: TermKey;
  /** Omitted where the demo institution publishes no cap — exercises the nullable path. */
  readonly capacity?: number;
}

// ---------------------------------------------------------------------------
// English requirements
// ---------------------------------------------------------------------------
//
// Programs declare one IELTS band plus the alternative tests they accept; the
// equivalent scores are derived from a single table so the demo catalog stays
// internally consistent (a student who clears IELTS 6.5 clears TOEFL 79 too).
// These equivalences are illustrative, not any official concordance.

type IeltsBand = 5.5 | 6 | 6.5 | 7 | 7.5;
type AlternateTest = Extract<LanguageTestType, "TOEFL" | "PTE" | "DUOLINGO">;

const EQUIVALENT_SCORES: Record<IeltsBand, Record<AlternateTest, number>> = {
  5.5: { TOEFL: 46, PTE: 42, DUOLINGO: 95 },
  6: { TOEFL: 60, PTE: 50, DUOLINGO: 105 },
  6.5: { TOEFL: 79, PTE: 58, DUOLINGO: 115 },
  7: { TOEFL: 94, PTE: 65, DUOLINGO: 125 },
  7.5: { TOEFL: 102, PTE: 73, DUOLINGO: 135 },
};

interface EnglishSpec {
  readonly testType: LanguageTestType;
  readonly minOverallScore: number;
  /** Absent where the demo program publishes no per-section minimums. */
  readonly minSectionScores?: Record<string, number>;
}

function englishSpecs(band: IeltsBand, alternates: readonly AlternateTest[]): readonly EnglishSpec[] {
  const sectionFloor = Math.max(5, band - 0.5);
  const specs: EnglishSpec[] = [
    {
      testType: "IELTS",
      minOverallScore: band,
      minSectionScores: {
        listening: sectionFloor,
        reading: sectionFloor,
        writing: sectionFloor,
        speaking: sectionFloor,
      },
    },
  ];

  for (const alternate of alternates) {
    const overall = EQUIVALENT_SCORES[band][alternate];
    if (alternate === "TOEFL") {
      const perSection = Math.max(12, Math.floor(overall / 4) - 2);
      specs.push({
        testType: "TOEFL",
        minOverallScore: overall,
        minSectionScores: {
          reading: perSection,
          listening: perSection,
          speaking: perSection,
          writing: perSection,
        },
      });
    } else {
      specs.push({ testType: alternate, minOverallScore: overall });
    }
  }

  return specs;
}

// ---------------------------------------------------------------------------
// Catalog shape
// ---------------------------------------------------------------------------

type FieldOfStudy =
  | "Computer Science"
  | "Data Science"
  | "Business Administration"
  | "Mechanical Engineering"
  | "Public Health"
  | "Economics"
  | "Psychology"
  | "Environmental Science"
  | "Law"
  | "Nursing";

interface CampusDef {
  readonly name: string;
  /** `null` for a fully online campus (no `City` row to attach to). */
  readonly city: string | null;
  readonly isOnline: boolean;
}

interface ExtraRequirementDef {
  readonly requirementType: Exclude<ProgramRequirementType, "MIN_GPA">;
  readonly minValue?: number;
  readonly description: string;
  readonly isMandatory: boolean;
}

interface ProgramDocumentDef {
  readonly documentType: DocumentType;
  readonly isMandatory: boolean;
  readonly description: string;
}

interface ProgramDef {
  readonly name: string;
  readonly level: ProgramLevel;
  readonly fieldOfStudy: FieldOfStudy;
  readonly durationMonths: number;
  readonly deliveryMode: DeliveryMode;
  /** Must match one of the parent university's campus names. */
  readonly campus: string;
  /** MIN_GPA threshold on a 4.0 scale — always written, the matcher depends on it. */
  readonly minGpa: number;
  readonly requirements?: readonly ExtraRequirementDef[];
  readonly ielts: IeltsBand;
  readonly alsoAccepts: readonly AlternateTest[];
  readonly intakes: readonly IntakeRef[];
  /** INTERNATIONAL, PER_YEAR, in the country's currency. */
  readonly tuitionPerYear: number;
  readonly tuitionEffectiveTo?: string;
  readonly documents?: readonly ProgramDocumentDef[];
}

interface UniversityDef {
  readonly name: string;
  readonly countryIso: CountryIso;
  readonly websiteUrl: string;
  /** `null` on three universities so the "no ranking available" path is exercised. */
  readonly worldRanking: number | null;
  readonly campuses: readonly CampusDef[];
  readonly programs: readonly ProgramDef[];
}

// Reusable requirement fragments — declared once, referenced from programs.
const GRE_REQUIRED: ExtraRequirementDef = {
  requirementType: "STANDARDIZED_TEST",
  minValue: 310,
  description: "GRE General Test, combined verbal and quantitative score of at least 310",
  isMandatory: true,
};

const RELATED_BACHELORS: ExtraRequirementDef = {
  requirementType: "PRIOR_FIELD",
  description: "A completed bachelor's degree in a closely related discipline",
  isMandatory: true,
};

const CLINICAL_CLEARANCE: ExtraRequirementDef = {
  requirementType: "OTHER",
  description: "Criminal record check and immunisation record before clinical placement",
  isMandatory: true,
};

const REFERENCE_LETTERS: ProgramDocumentDef = {
  documentType: "RECOMMENDATION_LETTER",
  isMandatory: true,
  description: "Two academic or professional references",
};

const PROOF_OF_FUNDS: ProgramDocumentDef = {
  documentType: "FINANCIAL_STATEMENT",
  isMandatory: true,
  description: "Proof of funds covering one year of tuition and living costs",
};

// ---------------------------------------------------------------------------
// The catalog — 12 fictional universities, 48 programs
// ---------------------------------------------------------------------------

const UNIVERSITIES: readonly UniversityDef[] = [
  {
    name: "Northgate University",
    countryIso: "GB",
    websiteUrl: "https://www.northgate-university.example",
    worldRanking: 62,
    campuses: [
      { name: "Northgate Central Campus", city: "London", isOnline: false },
      { name: "Northgate Online", city: null, isOnline: true },
    ],
    programs: [
      {
        name: "MSc Advanced Computer Science",
        level: "MASTERS",
        fieldOfStudy: "Computer Science",
        durationMonths: 12,
        deliveryMode: "ON_CAMPUS",
        campus: "Northgate Central Campus",
        minGpa: 3.4,
        requirements: [RELATED_BACHELORS],
        ielts: 7,
        alsoAccepts: ["TOEFL", "PTE"],
        intakes: [
          { term: "Spring 2027", capacity: 60 },
          { term: "Fall 2027", capacity: 120 },
        ],
        tuitionPerYear: 32000,
        documents: [REFERENCE_LETTERS],
      },
      {
        name: "MSc Data Science and Analytics",
        level: "MASTERS",
        fieldOfStudy: "Data Science",
        durationMonths: 12,
        deliveryMode: "ON_CAMPUS",
        campus: "Northgate Central Campus",
        minGpa: 3.3,
        requirements: [GRE_REQUIRED],
        ielts: 7,
        alsoAccepts: ["TOEFL"],
        intakes: [{ term: "Fall 2027", capacity: 90 }],
        tuitionPerYear: 34500,
        documents: [REFERENCE_LETTERS, PROOF_OF_FUNDS],
      },
      {
        name: "LLM International Commercial Law",
        level: "MASTERS",
        fieldOfStudy: "Law",
        durationMonths: 12,
        deliveryMode: "ON_CAMPUS",
        campus: "Northgate Central Campus",
        minGpa: 3.5,
        requirements: [
          {
            requirementType: "PRIOR_FIELD",
            description: "A qualifying law degree or equivalent professional legal qualification",
            isMandatory: true,
          },
        ],
        ielts: 7.5,
        alsoAccepts: ["TOEFL", "PTE"],
        intakes: [{ term: "Fall 2027", capacity: 45 }],
        tuitionPerYear: 29000,
        documents: [REFERENCE_LETTERS],
      },
      {
        name: "BSc Economics",
        level: "BACHELORS",
        fieldOfStudy: "Economics",
        durationMonths: 36,
        deliveryMode: "ON_CAMPUS",
        campus: "Northgate Central Campus",
        minGpa: 3.2,
        ielts: 6.5,
        alsoAccepts: ["TOEFL", "DUOLINGO"],
        intakes: [
          { term: "Fall 2026", capacity: 150 },
          { term: "Fall 2027", capacity: 150 },
        ],
        tuitionPerYear: 26500,
      },
    ],
  },
  {
    name: "Riverbend Institute of Technology",
    countryIso: "GB",
    websiteUrl: "https://www.riverbend-tech.example",
    worldRanking: 210,
    campuses: [
      { name: "Riverbend Main Campus", city: "Manchester", isOnline: false },
      { name: "Riverbend Online", city: null, isOnline: true },
    ],
    programs: [
      {
        name: "BSc Computer Science",
        level: "BACHELORS",
        fieldOfStudy: "Computer Science",
        durationMonths: 36,
        deliveryMode: "ON_CAMPUS",
        campus: "Riverbend Main Campus",
        minGpa: 3,
        ielts: 6,
        alsoAccepts: ["TOEFL", "PTE"],
        intakes: [
          { term: "Spring 2027", capacity: 80 },
          { term: "Fall 2027", capacity: 200 },
        ],
        tuitionPerYear: 21000,
      },
      {
        name: "MSc Mechanical Engineering",
        level: "MASTERS",
        fieldOfStudy: "Mechanical Engineering",
        durationMonths: 12,
        deliveryMode: "ON_CAMPUS",
        campus: "Riverbend Main Campus",
        minGpa: 3.1,
        requirements: [RELATED_BACHELORS],
        ielts: 6.5,
        alsoAccepts: ["TOEFL"],
        intakes: [{ term: "Fall 2027", capacity: 70 }],
        tuitionPerYear: 24500,
        documents: [REFERENCE_LETTERS],
      },
      {
        name: "MSc Data Science (Online)",
        level: "MASTERS",
        fieldOfStudy: "Data Science",
        durationMonths: 24,
        deliveryMode: "ONLINE",
        campus: "Riverbend Online",
        minGpa: 2.8,
        ielts: 6,
        alsoAccepts: ["DUOLINGO", "PTE"],
        intakes: [
          { term: "Spring 2027" },
          { term: "Fall 2027" },
        ],
        tuitionPerYear: 12500,
      },
      {
        name: "Graduate Diploma in Environmental Science",
        level: "DIPLOMA",
        fieldOfStudy: "Environmental Science",
        durationMonths: 9,
        deliveryMode: "HYBRID",
        campus: "Riverbend Main Campus",
        minGpa: 2.5,
        ielts: 6,
        alsoAccepts: ["TOEFL"],
        intakes: [{ term: "Spring 2027", capacity: 35 }],
        tuitionPerYear: 14000,
      },
    ],
  },
  {
    name: "Kingsmoor Metropolitan University",
    countryIso: "GB",
    websiteUrl: "https://www.kingsmoor-met.example",
    worldRanking: null,
    campuses: [
      { name: "Kingsmoor City Campus", city: "Bristol", isOnline: false },
      { name: "Kingsmoor Distance Learning", city: null, isOnline: true },
    ],
    programs: [
      {
        name: "BSc Nursing",
        level: "BACHELORS",
        fieldOfStudy: "Nursing",
        durationMonths: 36,
        deliveryMode: "ON_CAMPUS",
        campus: "Kingsmoor City Campus",
        minGpa: 2.4,
        requirements: [CLINICAL_CLEARANCE],
        ielts: 6.5,
        alsoAccepts: ["TOEFL"],
        intakes: [{ term: "Fall 2027", capacity: 110 }],
        tuitionPerYear: 18500,
      },
      {
        name: "BA Business Administration",
        level: "BACHELORS",
        fieldOfStudy: "Business Administration",
        durationMonths: 36,
        deliveryMode: "ON_CAMPUS",
        campus: "Kingsmoor City Campus",
        minGpa: 2.2,
        ielts: 6,
        alsoAccepts: ["PTE", "DUOLINGO"],
        intakes: [
          { term: "Spring 2027", capacity: 90 },
          { term: "Fall 2027", capacity: 180 },
        ],
        tuitionPerYear: 16000,
      },
      {
        name: "BSc Psychology",
        level: "BACHELORS",
        fieldOfStudy: "Psychology",
        durationMonths: 36,
        deliveryMode: "ON_CAMPUS",
        campus: "Kingsmoor City Campus",
        minGpa: 2.6,
        ielts: 6,
        alsoAccepts: ["TOEFL"],
        intakes: [{ term: "Fall 2027", capacity: 100 }],
        tuitionPerYear: 17000,
      },
      {
        name: "Certificate in Public Health Practice",
        level: "CERTIFICATE",
        fieldOfStudy: "Public Health",
        durationMonths: 6,
        deliveryMode: "ONLINE",
        campus: "Kingsmoor Distance Learning",
        minGpa: 2,
        ielts: 5.5,
        alsoAccepts: ["DUOLINGO"],
        intakes: [{ term: "Spring 2027" }],
        tuitionPerYear: 8200,
      },
    ],
  },
  {
    name: "Maple Ridge University",
    countryIso: "CA",
    websiteUrl: "https://www.mapleridge-university.example",
    worldRanking: 118,
    campuses: [
      { name: "Maple Ridge North Campus", city: "Toronto", isOnline: false },
      { name: "Maple Ridge Harbour Campus", city: "Vancouver", isOnline: false },
    ],
    programs: [
      {
        name: "MSc Computer Science",
        level: "MASTERS",
        fieldOfStudy: "Computer Science",
        durationMonths: 24,
        deliveryMode: "ON_CAMPUS",
        campus: "Maple Ridge North Campus",
        minGpa: 3.5,
        requirements: [GRE_REQUIRED, RELATED_BACHELORS],
        ielts: 7,
        alsoAccepts: ["TOEFL", "PTE"],
        intakes: [
          { term: "Winter 2027", capacity: 40 },
          { term: "Fall 2027", capacity: 85 },
        ],
        tuitionPerYear: 42000,
        documents: [REFERENCE_LETTERS, PROOF_OF_FUNDS],
      },
      {
        name: "Master of Public Health",
        level: "MASTERS",
        fieldOfStudy: "Public Health",
        durationMonths: 20,
        deliveryMode: "ON_CAMPUS",
        campus: "Maple Ridge North Campus",
        minGpa: 3.2,
        requirements: [
          {
            requirementType: "WORK_EXPERIENCE",
            minValue: 1,
            description: "At least one year of health-sector work or volunteering experience",
            isMandatory: false,
          },
        ],
        ielts: 7,
        alsoAccepts: ["TOEFL"],
        intakes: [{ term: "Fall 2027", capacity: 55 }],
        tuitionPerYear: 38500,
        documents: [REFERENCE_LETTERS],
      },
      {
        name: "BComm Business Administration",
        level: "BACHELORS",
        fieldOfStudy: "Business Administration",
        durationMonths: 48,
        deliveryMode: "ON_CAMPUS",
        campus: "Maple Ridge North Campus",
        minGpa: 3,
        ielts: 6.5,
        alsoAccepts: ["TOEFL", "DUOLINGO"],
        intakes: [
          { term: "Fall 2026", capacity: 220 },
          { term: "Winter 2027", capacity: 60 },
        ],
        tuitionPerYear: 35000,
      },
      {
        name: "BSc Environmental Science",
        level: "BACHELORS",
        fieldOfStudy: "Environmental Science",
        durationMonths: 48,
        deliveryMode: "ON_CAMPUS",
        campus: "Maple Ridge Harbour Campus",
        minGpa: 2.9,
        ielts: 6.5,
        alsoAccepts: ["PTE"],
        intakes: [{ term: "Fall 2027", capacity: 95 }],
        tuitionPerYear: 33000,
      },
    ],
  },
  {
    name: "Pacific Crest University",
    countryIso: "CA",
    websiteUrl: "https://www.pacificcrest-university.example",
    worldRanking: 355,
    campuses: [{ name: "Pacific Crest Seaside Campus", city: "Vancouver", isOnline: false }],
    programs: [
      {
        name: "MA Economics",
        level: "MASTERS",
        fieldOfStudy: "Economics",
        durationMonths: 16,
        deliveryMode: "ON_CAMPUS",
        campus: "Pacific Crest Seaside Campus",
        minGpa: 3.3,
        requirements: [RELATED_BACHELORS],
        ielts: 6.5,
        alsoAccepts: ["TOEFL"],
        intakes: [
          { term: "Winter 2027", capacity: 30 },
          { term: "Fall 2027", capacity: 50 },
        ],
        tuitionPerYear: 29000,
        documents: [REFERENCE_LETTERS],
      },
      {
        name: "BSc Psychology",
        level: "BACHELORS",
        fieldOfStudy: "Psychology",
        durationMonths: 48,
        deliveryMode: "ON_CAMPUS",
        campus: "Pacific Crest Seaside Campus",
        minGpa: 2.8,
        ielts: 6.5,
        alsoAccepts: ["DUOLINGO"],
        intakes: [{ term: "Fall 2027", capacity: 130 }],
        tuitionPerYear: 27500,
      },
      {
        name: "MEng Mechanical Engineering",
        level: "MASTERS",
        fieldOfStudy: "Mechanical Engineering",
        durationMonths: 20,
        deliveryMode: "HYBRID",
        campus: "Pacific Crest Seaside Campus",
        minGpa: 3.1,
        requirements: [
          {
            requirementType: "WORK_EXPERIENCE",
            minValue: 2,
            description: "Two years of engineering practice, or a completed co-op placement",
            isMandatory: true,
          },
        ],
        ielts: 6.5,
        alsoAccepts: ["TOEFL", "PTE"],
        intakes: [{ term: "Winter 2027", capacity: 25 }],
        tuitionPerYear: 31000,
        documents: [REFERENCE_LETTERS],
      },
      {
        name: "MSc Data Science",
        level: "MASTERS",
        fieldOfStudy: "Data Science",
        durationMonths: 16,
        deliveryMode: "ON_CAMPUS",
        campus: "Pacific Crest Seaside Campus",
        minGpa: 3.2,
        requirements: [
          {
            requirementType: "OTHER",
            description: "Evidence of prior study in calculus, linear algebra and programming",
            isMandatory: true,
          },
        ],
        ielts: 6.5,
        alsoAccepts: ["TOEFL"],
        intakes: [{ term: "Fall 2027", capacity: 65 }],
        tuitionPerYear: 32500,
        documents: [PROOF_OF_FUNDS],
      },
    ],
  },
  {
    name: "Bowmont Polytechnic",
    countryIso: "CA",
    websiteUrl: "https://www.bowmont-polytechnic.example",
    worldRanking: null,
    campuses: [
      { name: "Bowmont Trades Campus", city: "Calgary", isOnline: false },
      { name: "Bowmont Flexible Learning", city: null, isOnline: true },
    ],
    programs: [
      {
        name: "Diploma in Software Development",
        level: "DIPLOMA",
        fieldOfStudy: "Computer Science",
        durationMonths: 24,
        deliveryMode: "ON_CAMPUS",
        campus: "Bowmont Trades Campus",
        minGpa: 2.2,
        ielts: 6,
        alsoAccepts: ["DUOLINGO"],
        intakes: [
          { term: "Winter 2027", capacity: 45 },
          { term: "Fall 2027", capacity: 90 },
        ],
        tuitionPerYear: 19500,
      },
      {
        name: "Diploma in Practical Nursing",
        level: "DIPLOMA",
        fieldOfStudy: "Nursing",
        durationMonths: 24,
        deliveryMode: "ON_CAMPUS",
        campus: "Bowmont Trades Campus",
        minGpa: 2.5,
        requirements: [CLINICAL_CLEARANCE],
        ielts: 6.5,
        alsoAccepts: ["TOEFL"],
        intakes: [{ term: "Fall 2027", capacity: 60 }],
        tuitionPerYear: 21000,
      },
      {
        name: "Certificate in Business Analytics",
        level: "CERTIFICATE",
        fieldOfStudy: "Business Administration",
        durationMonths: 8,
        deliveryMode: "ONLINE",
        campus: "Bowmont Flexible Learning",
        minGpa: 2,
        ielts: 5.5,
        alsoAccepts: ["DUOLINGO", "PTE"],
        intakes: [{ term: "Winter 2027" }],
        tuitionPerYear: 9800,
      },
      {
        name: "Bachelor of Environmental Technology",
        level: "BACHELORS",
        fieldOfStudy: "Environmental Science",
        durationMonths: 48,
        deliveryMode: "HYBRID",
        campus: "Bowmont Trades Campus",
        minGpa: 2.6,
        ielts: 6,
        alsoAccepts: ["TOEFL"],
        intakes: [{ term: "Fall 2027", capacity: 70 }],
        tuitionPerYear: 23000,
      },
    ],
  },
  {
    name: "Falkenstein Technical University",
    countryIso: "DE",
    websiteUrl: "https://www.falkenstein-tu.example",
    worldRanking: 145,
    campuses: [{ name: "Falkenstein Hauptcampus", city: "Munich", isOnline: false }],
    programs: [
      {
        name: "MSc Mechanical Engineering",
        level: "MASTERS",
        fieldOfStudy: "Mechanical Engineering",
        durationMonths: 24,
        deliveryMode: "ON_CAMPUS",
        campus: "Falkenstein Hauptcampus",
        minGpa: 3.4,
        requirements: [RELATED_BACHELORS],
        ielts: 6.5,
        alsoAccepts: ["TOEFL"],
        intakes: [
          { term: "Winter 2026/27", capacity: 80 },
          { term: "Summer 2027", capacity: 40 },
        ],
        tuitionPerYear: 8500,
        documents: [PROOF_OF_FUNDS],
      },
      {
        name: "MSc Computer Science",
        level: "MASTERS",
        fieldOfStudy: "Computer Science",
        durationMonths: 24,
        deliveryMode: "ON_CAMPUS",
        campus: "Falkenstein Hauptcampus",
        minGpa: 3.3,
        requirements: [RELATED_BACHELORS],
        ielts: 6.5,
        alsoAccepts: ["TOEFL", "PTE"],
        intakes: [
          { term: "Summer 2027", capacity: 50 },
          { term: "Winter 2027/28", capacity: 100 },
        ],
        tuitionPerYear: 9000,
        documents: [PROOF_OF_FUNDS],
      },
      {
        name: "BSc Data Science",
        level: "BACHELORS",
        fieldOfStudy: "Data Science",
        durationMonths: 36,
        deliveryMode: "ON_CAMPUS",
        campus: "Falkenstein Hauptcampus",
        minGpa: 3,
        ielts: 6,
        alsoAccepts: ["TOEFL"],
        intakes: [{ term: "Winter 2027/28", capacity: 120 }],
        tuitionPerYear: 8000,
      },
      {
        name: "MSc Environmental Science",
        level: "MASTERS",
        fieldOfStudy: "Environmental Science",
        durationMonths: 24,
        deliveryMode: "ON_CAMPUS",
        campus: "Falkenstein Hauptcampus",
        minGpa: 3.1,
        ielts: 6.5,
        alsoAccepts: ["PTE"],
        intakes: [{ term: "Summer 2027", capacity: 35 }],
        tuitionPerYear: 8800,
      },
    ],
  },
  {
    name: "Rosenthal University",
    countryIso: "DE",
    websiteUrl: "https://www.rosenthal-university.example",
    worldRanking: 480,
    campuses: [
      { name: "Rosenthal Mitte Campus", city: "Berlin", isOnline: false },
      { name: "Rosenthal Hafen Campus", city: "Hamburg", isOnline: false },
    ],
    programs: [
      {
        name: "MA Economics",
        level: "MASTERS",
        fieldOfStudy: "Economics",
        durationMonths: 24,
        deliveryMode: "ON_CAMPUS",
        campus: "Rosenthal Mitte Campus",
        minGpa: 3,
        ielts: 6.5,
        alsoAccepts: ["TOEFL"],
        intakes: [
          { term: "Summer 2027", capacity: 45 },
          { term: "Winter 2027/28", capacity: 60 },
        ],
        tuitionPerYear: 10500,
      },
      {
        name: "LLM European Law",
        level: "MASTERS",
        fieldOfStudy: "Law",
        durationMonths: 12,
        deliveryMode: "ON_CAMPUS",
        campus: "Rosenthal Mitte Campus",
        minGpa: 3.3,
        requirements: [
          {
            requirementType: "PRIOR_FIELD",
            description: "A first degree in law, or a degree with substantial legal content",
            isMandatory: true,
          },
        ],
        ielts: 7,
        alsoAccepts: ["TOEFL", "PTE"],
        intakes: [{ term: "Winter 2027/28", capacity: 30 }],
        tuitionPerYear: 12000,
        documents: [REFERENCE_LETTERS],
      },
      {
        name: "BA Psychology",
        level: "BACHELORS",
        fieldOfStudy: "Psychology",
        durationMonths: 36,
        deliveryMode: "ON_CAMPUS",
        campus: "Rosenthal Hafen Campus",
        minGpa: 2.8,
        ielts: 6,
        alsoAccepts: ["DUOLINGO"],
        intakes: [{ term: "Winter 2027/28", capacity: 140 }],
        tuitionPerYear: 9500,
      },
      {
        name: "MSc Public Health",
        level: "MASTERS",
        fieldOfStudy: "Public Health",
        durationMonths: 24,
        deliveryMode: "HYBRID",
        campus: "Rosenthal Hafen Campus",
        minGpa: 2.9,
        requirements: [
          {
            requirementType: "WORK_EXPERIENCE",
            minValue: 1,
            description: "One year of professional experience in a health or social care setting",
            isMandatory: false,
          },
        ],
        ielts: 6.5,
        alsoAccepts: ["TOEFL"],
        intakes: [{ term: "Summer 2027", capacity: 40 }],
        tuitionPerYear: 11000,
        documents: [REFERENCE_LETTERS],
      },
    ],
  },
  {
    name: "Southern Cross Bay University",
    countryIso: "AU",
    websiteUrl: "https://www.southerncrossbay.example",
    worldRanking: 88,
    campuses: [
      { name: "Southern Cross Bay Harbour Campus", city: "Sydney", isOnline: false },
      { name: "Southern Cross Bay Southbank Campus", city: "Melbourne", isOnline: false },
    ],
    programs: [
      {
        name: "Master of Data Science",
        level: "MASTERS",
        fieldOfStudy: "Data Science",
        durationMonths: 24,
        deliveryMode: "ON_CAMPUS",
        campus: "Southern Cross Bay Harbour Campus",
        minGpa: 3.4,
        requirements: [RELATED_BACHELORS],
        ielts: 7,
        alsoAccepts: ["TOEFL", "PTE"],
        intakes: [
          { term: "Semester 1 2027", capacity: 75 },
          { term: "Semester 2 2027", capacity: 40 },
        ],
        tuitionPerYear: 45000,
        documents: [REFERENCE_LETTERS, PROOF_OF_FUNDS],
      },
      {
        name: "Bachelor of Laws",
        level: "BACHELORS",
        fieldOfStudy: "Law",
        durationMonths: 48,
        deliveryMode: "ON_CAMPUS",
        campus: "Southern Cross Bay Harbour Campus",
        minGpa: 3.3,
        ielts: 7,
        alsoAccepts: ["TOEFL"],
        intakes: [{ term: "Semester 1 2027", capacity: 90 }],
        tuitionPerYear: 41000,
      },
      {
        name: "Master of Business Administration",
        level: "MASTERS",
        fieldOfStudy: "Business Administration",
        durationMonths: 18,
        deliveryMode: "HYBRID",
        campus: "Southern Cross Bay Southbank Campus",
        minGpa: 3,
        requirements: [
          {
            requirementType: "WORK_EXPERIENCE",
            minValue: 3,
            description: "Three years of full-time professional experience after first degree",
            isMandatory: true,
          },
        ],
        ielts: 6.5,
        alsoAccepts: ["TOEFL", "PTE"],
        intakes: [
          { term: "Semester 1 2027", capacity: 60 },
          { term: "Semester 2 2027", capacity: 60 },
        ],
        tuitionPerYear: 43500,
        documents: [REFERENCE_LETTERS, PROOF_OF_FUNDS],
      },
      {
        name: "Bachelor of Nursing",
        level: "BACHELORS",
        fieldOfStudy: "Nursing",
        durationMonths: 36,
        deliveryMode: "ON_CAMPUS",
        campus: "Southern Cross Bay Southbank Campus",
        minGpa: 2.9,
        requirements: [CLINICAL_CLEARANCE],
        ielts: 7,
        alsoAccepts: ["PTE"],
        intakes: [{ term: "Semester 1 2027", capacity: 100 }],
        tuitionPerYear: 38000,
      },
    ],
  },
  {
    name: "Coral Harbour University",
    countryIso: "AU",
    websiteUrl: "https://www.coralharbour-university.example",
    worldRanking: 880,
    campuses: [
      { name: "Coral Harbour Bayside Campus", city: "Brisbane", isOnline: false },
      { name: "Coral Harbour Open Campus", city: null, isOnline: true },
    ],
    programs: [
      {
        name: "Bachelor of Computer Science",
        level: "BACHELORS",
        fieldOfStudy: "Computer Science",
        durationMonths: 36,
        deliveryMode: "ON_CAMPUS",
        campus: "Coral Harbour Bayside Campus",
        minGpa: 2.6,
        ielts: 6,
        alsoAccepts: ["TOEFL", "DUOLINGO"],
        intakes: [
          { term: "Semester 1 2027", capacity: 160 },
          { term: "Semester 2 2027", capacity: 80 },
        ],
        tuitionPerYear: 32000,
      },
      {
        name: "Master of Public Health",
        level: "MASTERS",
        fieldOfStudy: "Public Health",
        durationMonths: 18,
        deliveryMode: "ONLINE",
        campus: "Coral Harbour Open Campus",
        minGpa: 2.7,
        ielts: 6.5,
        alsoAccepts: ["TOEFL"],
        intakes: [{ term: "Semester 1 2027" }],
        tuitionPerYear: 26000,
        documents: [REFERENCE_LETTERS],
      },
      {
        name: "Bachelor of Psychology",
        level: "BACHELORS",
        fieldOfStudy: "Psychology",
        durationMonths: 36,
        deliveryMode: "ON_CAMPUS",
        campus: "Coral Harbour Bayside Campus",
        minGpa: 2.5,
        ielts: 6,
        alsoAccepts: ["PTE"],
        intakes: [{ term: "Semester 2 2027", capacity: 85 }],
        tuitionPerYear: 30500,
      },
      {
        name: "Graduate Certificate in Environmental Management",
        level: "CERTIFICATE",
        fieldOfStudy: "Environmental Science",
        durationMonths: 6,
        deliveryMode: "HYBRID",
        campus: "Coral Harbour Bayside Campus",
        minGpa: 2.3,
        ielts: 6,
        alsoAccepts: ["DUOLINGO"],
        intakes: [{ term: "Semester 1 2027", capacity: 25 }],
        tuitionPerYear: 15500,
      },
    ],
  },
  {
    name: "Amstelveld University",
    countryIso: "NL",
    websiteUrl: "https://www.amstelveld-university.example",
    worldRanking: 41,
    campuses: [{ name: "Amstelveld Canal Campus", city: "Amsterdam", isOnline: false }],
    programs: [
      {
        name: "MSc Artificial Intelligence",
        level: "MASTERS",
        fieldOfStudy: "Computer Science",
        durationMonths: 24,
        deliveryMode: "ON_CAMPUS",
        campus: "Amstelveld Canal Campus",
        minGpa: 3.8,
        requirements: [GRE_REQUIRED, RELATED_BACHELORS],
        ielts: 7.5,
        alsoAccepts: ["TOEFL", "PTE"],
        intakes: [{ term: "September 2027", capacity: 50 }],
        tuitionPerYear: 22000,
        documents: [REFERENCE_LETTERS, PROOF_OF_FUNDS],
      },
      {
        name: "MSc Economics and Policy",
        level: "MASTERS",
        fieldOfStudy: "Economics",
        durationMonths: 12,
        deliveryMode: "ON_CAMPUS",
        campus: "Amstelveld Canal Campus",
        minGpa: 3.4,
        requirements: [RELATED_BACHELORS],
        ielts: 7,
        alsoAccepts: ["TOEFL"],
        intakes: [
          { term: "February 2027", capacity: 35 },
          { term: "September 2027", capacity: 70 },
        ],
        tuitionPerYear: 19500,
        documents: [REFERENCE_LETTERS],
      },
      {
        name: "LLM International Human Rights Law",
        level: "MASTERS",
        fieldOfStudy: "Law",
        durationMonths: 12,
        deliveryMode: "ON_CAMPUS",
        campus: "Amstelveld Canal Campus",
        minGpa: 3.5,
        ielts: 7.5,
        alsoAccepts: ["TOEFL"],
        intakes: [{ term: "September 2027", capacity: 28 }],
        tuitionPerYear: 20500,
        documents: [REFERENCE_LETTERS],
      },
      {
        name: "BSc Psychology",
        level: "BACHELORS",
        fieldOfStudy: "Psychology",
        durationMonths: 36,
        deliveryMode: "ON_CAMPUS",
        campus: "Amstelveld Canal Campus",
        minGpa: 3.2,
        ielts: 6.5,
        alsoAccepts: ["TOEFL", "DUOLINGO"],
        intakes: [{ term: "September 2027", capacity: 115 }],
        tuitionPerYear: 16500,
      },
    ],
  },
  {
    name: "Delfshaven University of Applied Sciences",
    countryIso: "NL",
    websiteUrl: "https://www.delfshaven-uas.example",
    worldRanking: null,
    campuses: [
      { name: "Delfshaven Harbour Campus", city: "Rotterdam", isOnline: false },
      { name: "Delfshaven Online Campus", city: null, isOnline: true },
    ],
    programs: [
      {
        name: "BSc Business Administration",
        level: "BACHELORS",
        fieldOfStudy: "Business Administration",
        durationMonths: 48,
        deliveryMode: "ON_CAMPUS",
        campus: "Delfshaven Harbour Campus",
        minGpa: 2.4,
        ielts: 6,
        alsoAccepts: ["TOEFL", "DUOLINGO"],
        intakes: [
          { term: "February 2027", capacity: 55 },
          { term: "September 2027", capacity: 160 },
        ],
        tuitionPerYear: 11500,
      },
      {
        name: "BSc Mechanical Engineering",
        level: "BACHELORS",
        fieldOfStudy: "Mechanical Engineering",
        durationMonths: 48,
        deliveryMode: "ON_CAMPUS",
        campus: "Delfshaven Harbour Campus",
        minGpa: 2.5,
        ielts: 6,
        alsoAccepts: ["PTE"],
        intakes: [{ term: "September 2027", capacity: 90 }],
        tuitionPerYear: 12000,
      },
      {
        name: "Diploma in Nursing Studies",
        level: "DIPLOMA",
        fieldOfStudy: "Nursing",
        durationMonths: 18,
        deliveryMode: "HYBRID",
        campus: "Delfshaven Harbour Campus",
        minGpa: 2.2,
        requirements: [CLINICAL_CLEARANCE],
        ielts: 6,
        alsoAccepts: ["TOEFL"],
        intakes: [{ term: "February 2027", capacity: 40 }],
        tuitionPerYear: 10000,
      },
      {
        name: "MSc Environmental Science",
        level: "MASTERS",
        fieldOfStudy: "Environmental Science",
        durationMonths: 18,
        deliveryMode: "ONLINE",
        campus: "Delfshaven Online Campus",
        minGpa: 2.8,
        ielts: 6,
        alsoAccepts: ["DUOLINGO", "TOEFL"],
        intakes: [{ term: "September 2027" }],
        tuitionPerYear: 13500,
        tuitionEffectiveTo: "2028-08-31",
        documents: [REFERENCE_LETTERS],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Scholarships
// ---------------------------------------------------------------------------

interface ScholarshipDef {
  readonly university: string;
  /** `null` for a university-wide award. */
  readonly program: string | null;
  readonly name: string;
  readonly amount: number | null;
  readonly currency: string | null;
  readonly coveragePercent: number | null;
  readonly eligibilityCriteria: string;
  readonly applicationDeadline: string | null;
}

const SCHOLARSHIPS: readonly ScholarshipDef[] = [
  {
    university: "Northgate University",
    program: null,
    name: "Northgate Global Excellence Award",
    amount: 8000,
    currency: "GBP",
    coveragePercent: null,
    eligibilityCriteria: "International applicants with a GPA of 3.5 or above on a 4.0 scale",
    applicationDeadline: "2027-03-31",
  },
  {
    university: "Northgate University",
    program: "MSc Data Science and Analytics",
    name: "Northgate Data Science Merit Bursary",
    amount: null,
    currency: null,
    coveragePercent: 25,
    eligibilityCriteria: "Offer holders on the MSc Data Science and Analytics with a quantitative first degree",
    applicationDeadline: "2027-04-15",
  },
  {
    university: "Riverbend Institute of Technology",
    program: null,
    name: "Riverbend Access Scholarship",
    amount: 4500,
    currency: "GBP",
    coveragePercent: null,
    eligibilityCriteria: "Applicants from countries on the widening-participation list, any level of study",
    applicationDeadline: "2027-05-01",
  },
  {
    university: "Maple Ridge University",
    program: null,
    name: "Maple Ridge International Entrance Scholarship",
    amount: 10000,
    currency: "CAD",
    coveragePercent: null,
    eligibilityCriteria: "Automatically considered for all international applicants with a GPA of 3.3 or above",
    applicationDeadline: "2027-02-28",
  },
  {
    university: "Maple Ridge University",
    program: "Master of Public Health",
    name: "Maple Ridge Public Health Leadership Grant",
    amount: null,
    currency: null,
    coveragePercent: 50,
    eligibilityCriteria: "MPH applicants with demonstrated community health leadership and two references",
    applicationDeadline: "2027-04-30",
  },
  {
    university: "Falkenstein Technical University",
    program: null,
    name: "Falkenstein Engineering Fellowship",
    amount: 6000,
    currency: "EUR",
    coveragePercent: null,
    eligibilityCriteria: "Engineering master's applicants with a related bachelor's degree and IELTS 6.5 or above",
    applicationDeadline: "2027-01-31",
  },
  {
    university: "Southern Cross Bay University",
    program: null,
    name: "Southern Cross Bay Vice-Chancellor's Award",
    amount: null,
    currency: null,
    coveragePercent: 30,
    eligibilityCriteria: "Top decile of international offer holders across all faculties",
    applicationDeadline: "2026-12-15",
  },
  {
    university: "Coral Harbour University",
    program: null,
    name: "Coral Harbour Regional Opportunity Bursary",
    amount: 5000,
    currency: "AUD",
    coveragePercent: null,
    eligibilityCriteria: "Undergraduate applicants who will be the first in their family to attend university",
    applicationDeadline: null,
  },
  {
    university: "Amstelveld University",
    program: null,
    name: "Amstelveld Merit Fellowship",
    amount: 12000,
    currency: "EUR",
    coveragePercent: null,
    eligibilityCriteria: "Master's applicants with a GPA of 3.6 or above and a research-oriented statement of purpose",
    applicationDeadline: null,
  },
];

// ---------------------------------------------------------------------------
// Catalog-wide document requirements (programId = null)
// ---------------------------------------------------------------------------

const GENERIC_DOCUMENTS: readonly ProgramDocumentDef[] = [
  { documentType: "PASSPORT", isMandatory: true, description: "Photo page of a passport valid for the whole study period" },
  { documentType: "TRANSCRIPT", isMandatory: true, description: "Official transcripts for every completed qualification" },
  { documentType: "DEGREE_CERTIFICATE", isMandatory: true, description: "Degree or school-leaving certificate, with a certified translation if not in English" },
  { documentType: "LANGUAGE_TEST_REPORT", isMandatory: true, description: "English language test report taken within the last two years" },
  { documentType: "SOP", isMandatory: true, description: "Statement of purpose of 500 to 1000 words" },
  { documentType: "CV", isMandatory: false, description: "Curriculum vitae covering education and any work experience" },
];

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

function cityKey(iso: CountryIso, cityName: string): string {
  return `${iso}:${cityName}`;
}

function programKey(universityName: string, programName: string): string {
  return `${universityName}::${programName}`;
}

/**
 * Seeds the demo university catalog. Idempotent: rerunning creates nothing new
 * and mutates nothing existing.
 */
export async function seedCatalog(db: PrismaClient): Promise<void> {
  const countryIdByIso = new Map<CountryIso, string>();
  const cityIdByKey = new Map<string, string>();

  // --- Countries and cities -------------------------------------------------
  for (const country of COUNTRIES) {
    const countryRow = await db.country.upsert({
      where: { isoCode2: country.isoCode2 },
      update: {},
      create: { isoCode2: country.isoCode2, name: country.name, region: country.region },
    });
    countryIdByIso.set(country.isoCode2, countryRow.id);

    for (const city of country.cities) {
      const existingCity = await db.city.findFirst({
        where: { countryId: countryRow.id, name: city.name },
      });
      const cityRow =
        existingCity ??
        (await db.city.create({
          data: { countryId: countryRow.id, name: city.name, timezone: city.timezone },
        }));
      cityIdByKey.set(cityKey(country.isoCode2, city.name), cityRow.id);
    }
  }

  const universityIdByName = new Map<string, string>();
  const programIdByKey = new Map<string, string>();

  // --- Universities, campuses, programs and everything hanging off a program --
  for (const uni of UNIVERSITIES) {
    const countryId = countryIdByIso.get(uni.countryIso);
    if (countryId === undefined) {
      throw new Error(`seedCatalog: country ${uni.countryIso} was not seeded before ${uni.name}`);
    }

    const existingUniversity = await db.university.findFirst({
      where: { name: uni.name, countryId },
    });
    const university =
      existingUniversity ??
      (await db.university.create({
        data: {
          name: uni.name,
          countryId,
          websiteUrl: uni.websiteUrl,
          worldRanking: uni.worldRanking,
          accreditationBody: DEMO_ACCREDITOR,
          deletedAt: null,
        },
      }));
    universityIdByName.set(uni.name, university.id);

    // Provenance: never HIGH/MEDIUM, never a source URL — this data is invented.
    await db.universityMetadata.upsert({
      where: { universityId: university.id },
      update: {},
      create: {
        universityId: university.id,
        source: DEMO_SOURCE,
        sourceUrl: null,
        verifiedAt: null,
        verifiedBy: null,
        confidence: "LOW",
        lastReviewedAt: DEMO_REVIEWED_AT,
      },
    });

    const campusIdByName = new Map<string, string>();
    for (const campus of uni.campuses) {
      const cityId = campus.city === null ? null : cityIdByKey.get(cityKey(uni.countryIso, campus.city));
      if (campus.city !== null && cityId === undefined) {
        throw new Error(`seedCatalog: city ${campus.city} (${uni.countryIso}) missing for campus ${campus.name}`);
      }

      const existingCampus = await db.campus.findFirst({
        where: { universityId: university.id, name: campus.name },
      });
      const campusRow =
        existingCampus ??
        (await db.campus.create({
          data: {
            universityId: university.id,
            cityId: cityId ?? null,
            name: campus.name,
            isOnline: campus.isOnline,
          },
        }));
      campusIdByName.set(campus.name, campusRow.id);
    }

    const currency = CURRENCY_BY_COUNTRY[uni.countryIso];

    for (const programDef of uni.programs) {
      const campusId = campusIdByName.get(programDef.campus);
      if (campusId === undefined) {
        throw new Error(`seedCatalog: campus ${programDef.campus} missing for program ${programDef.name}`);
      }

      const existingProgram = await db.program.findFirst({
        where: { universityId: university.id, name: programDef.name },
      });
      const program =
        existingProgram ??
        (await db.program.create({
          data: {
            universityId: university.id,
            campusId,
            name: programDef.name,
            level: programDef.level,
            fieldOfStudy: programDef.fieldOfStudy,
            durationMonths: programDef.durationMonths,
            deliveryMode: programDef.deliveryMode,
          },
        }));
      programIdByKey.set(programKey(uni.name, programDef.name), program.id);

      // Requirements — MIN_GPA first and always, the matching engine keys off it.
      const minGpaRequirement = {
        requirementType: "MIN_GPA" as const,
        minValue: programDef.minGpa,
        description: `Minimum cumulative GPA of ${programDef.minGpa.toFixed(1)} on a 4.0 scale`,
        isMandatory: true,
      };

      for (const requirement of [minGpaRequirement, ...(programDef.requirements ?? [])]) {
        const description = demo(requirement.description);
        const existingRequirement = await db.programRequirement.findFirst({
          where: {
            programId: program.id,
            requirementType: requirement.requirementType,
            description,
          },
        });
        if (existingRequirement === null) {
          await db.programRequirement.create({
            data: {
              programId: program.id,
              requirementType: requirement.requirementType,
              minValue: requirement.minValue ?? null,
              description,
              isMandatory: requirement.isMandatory,
            },
          });
        }
      }

      // English requirements — unique on (programId, testType), so upsert directly.
      for (const spec of englishSpecs(programDef.ielts, programDef.alsoAccepts)) {
        await db.englishRequirement.upsert({
          where: { programId_testType: { programId: program.id, testType: spec.testType } },
          update: {},
          create: {
            programId: program.id,
            testType: spec.testType,
            minOverallScore: spec.minOverallScore,
            // Left unset (SQL NULL) where the demo program publishes no section minimums.
            ...(spec.minSectionScores === undefined ? {} : { minSectionScores: spec.minSectionScores }),
          },
        });
      }

      // Intakes — unique on (programId, term).
      for (const intakeRef of programDef.intakes) {
        const template = INTAKE_TERMS[intakeRef.term];
        await db.intake.upsert({
          where: { programId_term: { programId: program.id, term: intakeRef.term } },
          update: {},
          create: {
            programId: program.id,
            term: intakeRef.term,
            applicationOpenDate: d(template.open),
            applicationDeadline: d(template.deadline),
            startDate: d(template.start),
            status: template.status,
            capacity: intakeRef.capacity ?? null,
          },
        });
      }

      // International tuition, per year.
      const effectiveFrom = d(TUITION_EFFECTIVE_FROM);
      const existingFee = await db.tuitionFee.findFirst({
        where: {
          programId: program.id,
          category: "INTERNATIONAL",
          perPeriod: "PER_YEAR",
          effectiveFrom,
        },
      });
      if (existingFee === null) {
        await db.tuitionFee.create({
          data: {
            programId: program.id,
            category: "INTERNATIONAL",
            amount: programDef.tuitionPerYear,
            currency,
            perPeriod: "PER_YEAR",
            effectiveFrom,
            effectiveTo: programDef.tuitionEffectiveTo === undefined ? null : d(programDef.tuitionEffectiveTo),
          },
        });
      }

      // Program-specific document requirements (on top of the catalog-wide set).
      for (const document of programDef.documents ?? []) {
        const existingDocument = await db.documentRequirement.findFirst({
          where: { programId: program.id, documentType: document.documentType },
        });
        if (existingDocument === null) {
          await db.documentRequirement.create({
            data: {
              programId: program.id,
              documentType: document.documentType,
              isMandatory: document.isMandatory,
              description: demo(document.description),
            },
          });
        }
      }
    }
  }

  // --- Scholarships ---------------------------------------------------------
  for (const scholarship of SCHOLARSHIPS) {
    const universityId = universityIdByName.get(scholarship.university);
    if (universityId === undefined) {
      throw new Error(`seedCatalog: unknown university ${scholarship.university} on scholarship ${scholarship.name}`);
    }

    let programId: string | null = null;
    if (scholarship.program !== null) {
      const resolved = programIdByKey.get(programKey(scholarship.university, scholarship.program));
      if (resolved === undefined) {
        throw new Error(`seedCatalog: unknown program ${scholarship.program} on scholarship ${scholarship.name}`);
      }
      programId = resolved;
    }

    const existingScholarship = await db.scholarship.findFirst({
      where: { universityId, name: scholarship.name },
    });
    if (existingScholarship === null) {
      await db.scholarship.create({
        data: {
          universityId,
          programId,
          name: scholarship.name,
          amount: scholarship.amount,
          currency: scholarship.currency,
          coveragePercent: scholarship.coveragePercent,
          eligibilityCriteria: demo(scholarship.eligibilityCriteria),
          applicationDeadline:
            scholarship.applicationDeadline === null ? null : d(scholarship.applicationDeadline),
        },
      });
    }
  }

  // --- Catalog-wide document requirements ------------------------------------
  for (const document of GENERIC_DOCUMENTS) {
    const existingDocument = await db.documentRequirement.findFirst({
      where: { programId: null, documentType: document.documentType },
    });
    if (existingDocument === null) {
      await db.documentRequirement.create({
        data: {
          programId: null,
          documentType: document.documentType,
          isMandatory: document.isMandatory,
          description: demo(document.description),
        },
      });
    }
  }

  const programCount = UNIVERSITIES.reduce((total, uni) => total + uni.programs.length, 0);
  console.log(
    `Catalog seed complete (DEMO DATA): ${COUNTRIES.length} countries, ${UNIVERSITIES.length} universities, ` +
      `${programCount} programs, ${SCHOLARSHIPS.length} scholarships.`,
  );
}
