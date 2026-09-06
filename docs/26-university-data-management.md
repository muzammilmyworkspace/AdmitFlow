# 26 — University Data Management

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering (University Catalog subsystem) + Content/Data Operations
**Depends on:** `00-project-charter.md`, `02-personas-and-roles.md`
**Read alongside:** `16-assessment-engine.md`, `17-university-matching-engine.md` (both consume this data model directly)
**Applies to:** All engineering work on the catalog schema, ingestion, and admin editing workflows

---

## 1. Purpose

This document defines the **normalized** data model behind every university, campus, program, requirement, intake, and scholarship in AdmitFlow, plus the governance workflow that keeps that data trustworthy enough to score real students' futures against. Two failure modes this model is explicitly designed to prevent:

1. **The flat-row trap.** A `University { name, country, courseName, minGPA, minIELTS, annualFee, zone }` table cannot represent a real university (multiple campuses, multiple programs per campus, multiple intakes per program, per-intake fee changes, country-specific requirement variants, conditional admission paths) without either duplicating rows into an unmaintainable mess or lying by flattening distinct things into one field. This document replaces that shape entirely.
2. **Silent staleness.** Data about deadlines, fees, and requirements changes constantly and by definition lags reality the moment it's captured. A system that treats a two-year-old scrape as equally trustworthy as a verification from last week will eventually tell a student something false at exactly the moment it matters most (a visa-linked proof-of-funds figure, a deadline). §4 defines what "stale" means and what the platform does about it — never nothing.

---

## 2. Entity Model (conceptual)

```
University
 ├─ UniversityMetadata           (1:1 — source/verification/versioning envelope for the university record itself)
 ├─ UniversityRanking[]          (1:many — one row per ranking body per year, e.g. QS 2026, THE 2026)
 ├─ Campus[]                     (1:many)
 │   └─ Program[]                (1:many — a program belongs to exactly one campus; a university offering
 │                                  "the same" program at two campuses is two Program rows, since fees,
 │                                  intakes, and sometimes requirements legitimately differ by campus)
 │       ├─ ProgramRequirement    (1:1 — academic entry requirement: minAcademicIndex, accepted grading
 │        │                          scales, conditional-admission flag, country-specific requirement
 │        │                          variants, backlog/gap tolerance if program-specific)
 │       ├─ EnglishRequirement[]  (1:many — one row per accepted test type: IELTS/TOEFL/PTE/Duolingo/MOI-waiver,
 │        │                          each with its own minimum + component sub-score minimums where applicable)
 │       ├─ RequiredDocument[]    (1:many — document type, mandatory/conditional, applies-to-intake-or-always)
 │       ├─ Intake[]              (1:many — term/year, applicationDeadline, applicationFee, admissionType
 │        │                          [FIXED_DEADLINE | ROLLING], seatsStatus if disclosed)
 │       │   └─ TuitionFee        (1:1 per intake — amount, currency, per-year/total, effectiveFrom;
 │       │                          modeled per-intake, not per-program, because fees legitimately change
 │       │                          between intakes)
 │       ├─ ProgramMetadata       (1:1 — source/verification/versioning envelope for this program record)
 │       └─ Scholarship[]         (many:many via ProgramScholarship — a scholarship can apply to multiple
 │                                    programs/campuses; modeled as its own entity, not copy-pasted per program)
 └─ RequiredDocument[]            (1:many — university-wide document requirements that apply regardless
                                     of program, e.g. a notarized passport copy every applicant needs)
```

Additional attributes carried at the `Program` level (not modeled as separate tables, but as fields, since they don't have their own lifecycle/versioning needs beyond the program's own):

- `degreeLevel` (Bachelor's / Master's / PhD / Diploma / Foundation)
- `fieldTaxonomyId` (reference to a shared `FieldTaxonomy`, used by candidate generation — `17-university-matching-engine.md` §2)
- `deliveryMode` (ON_CAMPUS / ONLINE / HYBRID)
- `studyDurationMonths`
- `applicationMethod` (DIRECT_PORTAL / COMMON_APP_EQUIVALENT / AGENT_ONLY / ADMITFLOW_ASSISTED) — informational, since AdmitFlow does not submit to embassies/immigration portals (`00-project-charter.md` §8) but does track how the *application itself* is meant to be filed
- `conditionalAdmissionAvailable` (boolean — read by `16-assessment-engine.md` §3.1/§5 hard-gate logic)

### 2.1 Why Program belongs to Campus, not University directly

**Decision:** `Program` is a child of `Campus`, and `Campus` is a child of `University` — a program is never attached directly to a university even for single-campus institutions (which simply get exactly one `Campus` row). Rationale: tuition, delivery mode availability, and sometimes entry requirements genuinely differ by campus for multi-campus universities (a common real-world case for large public universities with satellite campuses), and retrofitting a campus concept later onto a University→Program model would require a breaking migration of every existing program, intake, and historical `AssessmentResult` snapshot's understanding of "which record is this." Modeling it correctly from the start costs one extra join, not a rewrite risk later.

### 2.2 Why TuitionFee is per-Intake, not per-Program

**Decision:** fees are attached to `Intake`, not `Program`, even though most of the time a program's fee doesn't change between adjacent intakes. Rationale: fees genuinely do change year-over-year (and sometimes intake-over-intake for demand-priced or currency-pegged programs), and a `TuitionFee` row needs its own `effectiveFrom`/versioning envelope exactly like everything else in this model — attaching it to `Program` would force either mutating a shared fee record (breaking any already-generated `AssessmentResult` that referenced "the program's fee" at scoring time) or bolting on a second parallel history table. Per-intake keeps the fee as immutable, dated data from the start.

### 2.3 Why Scholarship is its own entity, not a field

**Decision:** `Scholarship` is modeled as a standalone entity linked to one or more programs (via `ProgramScholarship`), not as a discount field on `Program` or `TuitionFee`. Rationale: real scholarships have their own eligibility criteria (merit/need/nationality-based), award amounts/percentages, application processes, and deadlines independent of the program's own deadline — collapsing that into a `Program.scholarshipAvailable: boolean` (the flat-row trap this document exists to avoid) would throw away exactly the information a Budget Score improvement (`16-assessment-engine.md` §3.3, future extension) would need to reason about "could this gap be bridged."

---

## 3. Handling Real-World Variation

| Requirement | How the model handles it |
|---|---|
| Multiple campuses per university | `Campus[]` under `University`, each with its own address/city, own `Program[]` |
| Multiple programs per campus | `Program[]` under `Campus`, one row per distinct offering (a Master's and its part-time variant are two `Program` rows, not one row with a flag, since they typically have distinct `Intake`/fee/duration data) |
| Multiple intakes per program | `Intake[]` under `Program`, each with its own deadline, fee (via `TuitionFee`), and admission type |
| Multiple tuition currencies | `TuitionFee.currency` is an ISO 4217 code per intake; the matching engine's FX conversion (`17-university-matching-engine.md` §6, `16-assessment-engine.md` §3.3) reads this rather than assuming a single base currency |
| Country-specific GPA/English requirements | `ProgramRequirement` and `EnglishRequirement` support an optional `applicableNationality`/`applicableEducationCountry` scope — a program can have a base requirement plus one or more country-specific overrides (e.g., a different minimum for applicants with an Indian CBSE percentage vs. a US GPA, beyond what the conversion table alone captures, such as a program that requires an extra qualifying exam only for certain source countries) |
| Program-specific English requirements | `EnglishRequirement` is scoped to `Program` (not `University`), since a Business program and an Engineering program at the same university routinely have different English bars |
| Conditional requirements | `ProgramRequirement.conditionalAdmissionAvailable` plus a free-text `conditionalPathwayDescription` (e.g., "Foundation year available for academic index 65–77"); `EnglishRequirement` supports an analogous `preSessionalPathwayAvailable` | 
| Application deadlines/fees | Modeled on `Intake` (`applicationDeadline`, `applicationFee`), never on `Program`, since these vary intake-to-intake |
| Delivery mode | `Program.deliveryMode` enum |
| Study duration | `Program.studyDurationMonths` |
| Application method | `Program.applicationMethod` enum (informational/tracking only, per §2) |
| University-specific required documents | `RequiredDocument[]` at both `University` (applies to every program) and `Program` (program-specific, e.g. a portfolio for a Design program) level; the effective document list for a given application is the union of both, deduplicated by document type |

---

## 4. Data Quality, Freshness, and Governance

Every `University` and `Program` record (and, practically, every child record whose values feed scoring — `ProgramRequirement`, `EnglishRequirement`, `TuitionFee`, `Intake`) carries a governance envelope:

| Field | Meaning |
|---|---|
| `source` | Where the data came from: `UNIVERSITY_OFFICIAL_WEBSITE`, `UNIVERSITY_PARTNER_FEED`, `THIRD_PARTY_AGGREGATOR`, `MANUAL_ADMIN_ENTRY`, `STUDENT_REPORTED_UNVERIFIED` (lowest trust, never used to set a scoring-relevant field without independent verification) |
| `sourceUrl` | Direct link to the page/document the data was captured from, where applicable |
| `verifiedAt` | Timestamp of the last human (or automated-with-human-spot-check, per the sync pipeline in `06-system-architecture.md` §6 "University Catalog") confirmation that this value is still accurate |
| `verifiedBy` | User id of the admin/data operator who verified it (or a system identifier for an automated feed ingestion, which still requires periodic human spot-check per §4.2) |
| `lastUpdatedAt` | Timestamp of the last write to the record, regardless of whether that write was a re-verification or a substantive change — distinct from `verifiedAt`, since a record can be *updated* (e.g., a typo fix) without a fresh verification pass, and can be *verified* (re-confirmed unchanged) without any field actually changing |
| `confidence` | `HIGH` / `MEDIUM` / `LOW`, set by the verifier's own judgment of source reliability (e.g., scraped third-party aggregator data defaults to `MEDIUM` even when freshly captured; direct confirmation from a university admissions office email defaults to `HIGH`) |

### 4.1 Staleness definition

**Decision:** a record is **stale** when `verifiedAt` is older than a threshold defined per field group, not one global number, because different fields decay at different real-world rates:

| Field group | Staleness threshold (default) | Rationale |
|---|---|---|
| Core scoring-relevant fields: `ProgramRequirement` (GPA), `EnglishRequirement`, `TuitionFee`, `Intake.applicationDeadline`/`applicationFee` | **6 months** | These change most frequently (annual or per-intake fee/requirement revisions) and are the fields a hard-gate or SAFE-tier decision directly depends on (`16-assessment-engine.md` §3, §5) — the highest-consequence data in the system gets the shortest freshness window. |
| `UniversityRanking`, general `UniversityMetadata` descriptive fields (about-text, campus facilities, general reputation info) | **12 months** | Lower-consequence for a specific eligibility decision, and these bodies (QS, THE, etc.) typically only republish annually anyway, so a 6-month window would just generate false staleness flags against data that hasn't actually had a chance to change. |
| `RequiredDocument` lists, `Scholarship` general eligibility criteria | **9 months** | Middle ground — these change less often than fees/deadlines but more often than rankings. |

These defaults are configuration (a `DataFreshnessPolicy` reference table), editable by SUPER_ADMIN, so operational experience can tune the windows without a code change — but a sensible default must ship on day one rather than leaving every record perpetually "unknown freshness," so the values above are the shipped defaults.

**What "stale" triggers:** per `17-university-matching-engine.md` §6.2 — the record is never silently trusted as current. It is still used (never dropped from candidate generation or scoring), but the matching engine surfaces `dataFreshness: "STALE"` on the affected result field(s), appends a plain-language note ("last verified over 6 months ago — confirm with the university"), and applies it as a tie-breaking deprioritization signal, never as a numeric penalty to `matchScore` itself (rationale given in that document — freshness and compatibility are different axes and must not be conflated).

### 4.2 Verification cadence and re-verification workflow

- Any record ingested via an automated feed/sync job (`06-system-architecture.md` §5, "university data sync" — a worker job, never inline in a request) is written with `source` reflecting its automated origin and `confidence = MEDIUM` by default; it does **not** get a `verifiedAt` bump from the automated write alone — `verifiedAt` only advances when a human data operator (or the university's own future `UNIVERSITY_MANAGER` self-service, §5) explicitly confirms it, or an automated cross-check against a second independent source corroborates it (in which case `confidence` may rise to `HIGH` and `verifiedAt` advances, logged as `verifiedBy = "system:cross-check"`).
- A scheduled worker job (per `06-system-architecture.md`'s "university data sync" responsibility) surfaces a **Re-Verification Queue** to admins/data operators: any core scoring-relevant record whose `verifiedAt` is within 30 days of crossing its staleness threshold, ordered by how many active students currently have that program in an unpurchased assessment result (prioritizing re-verification effort where it protects the most students from acting on aging data).
- **Decision:** there is no automatic "expire and hide" behavior — a stale record is never automatically removed from the catalog or silently excluded from matching. Rationale: an overwhelming majority of stale-but-unverified records are still correct (universities don't change core requirements every six months as a rule) — auto-hiding would remove good matches over an operational lag, not a real problem with the data, and would violate the "never oversimplify/never silently drop good options" product principle. The correct response to staleness is disclosure, not deletion.

---

## 5. Admin Workflows and Editing Permissions

| Action | Who (per `02-personas-and-roles.md`) | Notes |
|---|---|---|
| View catalog data | ADMIN, SUPER_ADMIN | Read access is part of standard support/verification tooling |
| Add/edit university, campus, program, requirement, intake, fee, document, scholarship content | ADMIN, SUPER_ADMIN | Per `02-personas-and-roles.md` §4, this is explicitly **content**, distinct from scoring-*rule* weights (`16-assessment-engine.md`, SUPER_ADMIN-only) — an ADMIN can correct a university's minimum GPA data point; only SUPER_ADMIN can change how heavily GPA is *weighted* in the Overall Match Score |
| Mark a record re-verified (bump `verifiedAt`/`verifiedBy`/`confidence`) | ADMIN, SUPER_ADMIN | Requires the operator to affirmatively confirm — not a side effect of any other edit |
| Publish/manage `UniversityRanking` entries | ADMIN, SUPER_ADMIN | Rankings are reference data with their own `sourceUrl` per ranking body/year |
| **Future:** self-service edits to a university's own listing | `UNIVERSITY_MANAGER` (per `02-personas-and-roles.md` §6 — not built in v1) | **Design implication honored now:** every catalog table carries an `ownerOrganizationId` (nullable in v1, always null until universities have platform accounts) so a future `UNIVERSITY_MANAGER` role can be scoped to edit only records where they are the owning organization, without a schema migration. A `UNIVERSITY_MANAGER`'s edits would still require SUPER_ADMIN or `DATA_MANAGER` review/approval before affecting live scoring — self-reported data from an interested party starts at `confidence = MEDIUM` at best, same as any other unverified source, never auto-promoted to `HIGH` just because it came from the institution itself (an institution can be a source, but sourcing is not the same as independent verification). |
| **Future:** bulk data import/ingestion pipeline ownership, data-quality triage | `DATA_MANAGER` (per `02-personas-and-roles.md` §6 — not built in v1) | Distinct permission from `scoring_rules:publish` — a data-quality operator manages *inputs*, never scoring *policy*, consistent with the persona doc's design implication that catalog ingestion must be a separable permission from scoring-rule authoring |

**Non-negotiable:** every write to a scoring-relevant catalog field — whether a full edit or a re-verification bump — is captured by `AuditLogEntry` (actor, timestamp, what changed, before/after values) per the charter's "Auditable" principle. This is the same audit trail mechanism used for entitlement overrides (`18-paywall-and-entitlements.md` §5) — one audit log design, applied consistently across subsystems, not a bespoke logging table per module.

### 5.1 University-data versioning (the `universityDataVersion` referenced by assessment snapshots)

**Decision:** the catalog maintains a single monotonically increasing `universityDataVersion` identifier (e.g., a build/publish tag such as `cat_2026_08_v14`) that advances whenever a batch of catalog edits is committed — not a per-row version number that `16-assessment-engine.md`'s snapshot would have to track individually per program. Rationale: an `AssessmentResult` references one catalog-wide version, not N per-program versions, which keeps the snapshot contract in `16-assessment-engine.md` §6 simple (one field, `universityDataVersion`) while still being fully reproducible — given that version identifier, engineering/support can reconstruct exactly what every program's data looked like at that moment via the same audit trail. Every admin edit or re-verification that changes a scoring-relevant field advances this version; purely cosmetic edits (e.g., fixing a typo in a campus's descriptive text) are batched and do not need to advance it synchronously, but any edit to `ProgramRequirement`, `EnglishRequirement`, `TuitionFee`, or `Intake` fields **always** does, since those are exactly the fields `16-assessment-engine.md` scores against.

**Rule (restated from `16-assessment-engine.md` §6):** advancing `universityDataVersion` never touches any existing `AssessmentResult` row. Past results keep pointing at the older version; only assessments generated after the bump read the new data.

---

## 6. Related Documents

- `16-assessment-engine.md` — how `ProgramRequirement`/`EnglishRequirement`/`TuitionFee`/`Intake` fields are consumed by scoring, and the snapshot/versioning contract this document's `universityDataVersion` feeds
- `17-university-matching-engine.md` — candidate generation gates that read `degreeLevel`/`fieldTaxonomyId`/`Intake` availability, and the stale/missing-data handling that reads `verifiedAt`/`confidence`
- `02-personas-and-roles.md` — role definitions (`ADMIN`, `SUPER_ADMIN`, future `UNIVERSITY_MANAGER`, `DATA_MANAGER`) and the object-level isolation rules that also apply to catalog editing scope
- `06-system-architecture.md` — where the "university data sync" worker job sits in the overall system (never inline in the request path)
