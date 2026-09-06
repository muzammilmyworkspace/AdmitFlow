# 10 — Database Schema (Conceptual ERD)

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering
**Applies to:** Prisma schema authoring, migration design, API/data-access layers

---

## 1. How to Read This Document

Each entity lists: **Purpose**, **Key fields** (name — type — notes), **Relationships** (cardinality + target), and **Notable constraints**. Types are written in Prisma-ish shorthand (`String`, `Int`, `Decimal`, `DateTime`, `Boolean`, `Json`, `Enum`) for clarity; the authoritative types are defined when the Prisma schema is written from this document. Unless stated otherwise, **every entity has** `id: String @id @default(uuid())`, `createdAt: DateTime`, `updatedAt: DateTime` — these are omitted from the field lists below to avoid repetition; only *additional* audit columns (`createdBy`, `updatedBy`, `deletedAt`, `version`) are called out explicitly per entity. See `09-database-architecture.md` for the conventions these follow.

Domains, in order: (1) Identity & Access, (2) Student Profile, (3) Questionnaire, (4) Documents, (5) University Catalog, (6) Assessment & Matching, (7) Commerce & Entitlements, (8) Applications, (9) Consultations, (10) Notifications, (11) Platform & Ops. A cascade-delete policy matrix and a full relationship index close the document.

---

## 2. Identity & Access

### 2.1 `User`
**Purpose:** The root identity record for every actor in the system (student, consultant, admin, super admin). One row per human account.
**Key fields:** `email: String @unique`, `emailVerifiedAt: DateTime?`, `passwordHash: String?` (argon2id; nullable — OAuth-only accounts may have none), `status: Enum(REGISTERED, EMAIL_UNVERIFIED, VERIFIED, ONBOARDING, ACTIVE, SUSPENDED, DEACTIVATED, DELETED)` — the full account lifecycle state machine per `31-state-machines.md` §1 (canonical; this corrects an earlier draft of this section that used a collapsed 3-value enum), `deletedAt: DateTime?`, `lastLoginAt: DateTime?`.
**Relationships:** 1:1 `Profile`; 1:N `Session`; 1:N `OAuthAccount`; N:N `Role` via `UserRole`; 1:N `Document` (as owner); 1:N `Application` (as owner); 1:N `Booking` (as student); 1:1 `Consultant` (optional, if the user is also a consultant); 1:N `Payment`/`Purchase`/`Entitlement` (as customer, via `Customer`); referenced by `createdBy`/`updatedBy`/actor columns across many tables.
**Notable constraints:** unique index on `email` (case-insensitive, enforced via a citext column or a normalized-lowercase generated column); soft delete only — **never** hard-deleted or cascade-deleted into financial/audit tables (§12). Anonymization (PII scrub) is a distinct audited operation from `deletedAt` being set.

### 2.2 `Role`
**Purpose:** A named permission bundle (`STUDENT`, `CONSULTANT`, `ADMIN`, `SUPER_ADMIN`, and reserved-for-future `UNIVERSITY_MANAGER`, `APPLICATION_REVIEWER`, `FINANCE_MANAGER`, `SUPPORT_AGENT`, `CONTENT_MANAGER`, `DATA_MANAGER`, `COMPLIANCE_ADMIN` per `02-personas-and-roles.md`).
**Key fields:** `name: String @unique`, `description: String`, `isSystem: Boolean` (true for roles that ship by default and cannot be deleted via admin UI).
**Relationships:** N:N `User` via `UserRole`; N:N `Permission` via `RolePermission`.
**Notable constraints:** unique `name`; `isSystem` roles protected from deletion at the application layer.

### 2.3 `Permission`
**Purpose:** A granular capability (`document:review`, `entitlement:override`, `application:submit_on_behalf`, `payment:refund`, etc.) — RBAC is permission-based under the hood, roles are just named bundles.
**Key fields:** `key: String @unique` (dot-namespaced), `description: String`.
**Relationships:** N:N `Role` via `RolePermission`.
**Notable constraints:** unique `key`.

### 2.4 `UserRole` (join table)
**Purpose:** Assigns roles to users, with assignment metadata.
**Key fields:** `userId: String`, `roleId: String`, `assignedAt: DateTime`, `assignedBy: String?` (FK `User.id`).
**Relationships:** N:1 `User`, N:1 `Role`.
**Notable constraints:** composite unique `(userId, roleId)`; FK `onDelete: Restrict` from the `User`/`Role` side is not applicable since `User` soft-deletes — role rows for a soft-deleted user are left intact for audit purposes (an inactive account's role history is not erased).

### 2.5 `RolePermission` (join table)
**Purpose:** Assigns permissions to roles.
**Key fields:** `roleId: String`, `permissionId: String`.
**Relationships:** N:1 `Role`, N:1 `Permission`.
**Notable constraints:** composite unique `(roleId, permissionId)`.

### 2.6 `Session`
**Purpose:** An authenticated session (server-side session record backing an HTTP-only session cookie or refresh token; supports revocation, "log out everywhere", and session-listing UI).
**Key fields:** `userId: String`, `tokenHash: String @unique` (never store the raw token), `userAgent: String?`, `ipAddress: String?`, `expiresAt: DateTime`, `revokedAt: DateTime?`.
**Relationships:** N:1 `User` (cascade delete allowed here — see §12; sessions have no independent retention value once the user is gone/anonymized).
**Notable constraints:** unique `tokenHash`; index on `(userId, expiresAt)` for "active sessions for user."

### 2.7 `OAuthAccount`
**Purpose:** Links a third-party identity provider account (Google, etc.) to a `User`, supporting multiple linked providers per user.
**Key fields:** `userId: String`, `provider: Enum(GOOGLE, ...)`, `providerAccountId: String`, `accessTokenEnc: String?` (encrypted at rest if stored at all), `refreshTokenEnc: String?`, `linkedAt: DateTime`.
**Relationships:** N:1 `User`.
**Notable constraints:** **composite unique `(provider, providerAccountId)`** — a given provider identity can only ever link to one `User` row, DB-enforced (prevents account-takeover-via-relink race conditions).

---

## 3. Student Profile

### 3.1 `Profile`
**Purpose:** The student's core profile beyond bare identity — the "who is this student" record the onboarding flow populates and the assessment engine reads.
**Key fields:** `userId: String @unique`, `firstName: String`, `lastName: String`, `dateOfBirth: DateTime?`, `nationalityCountryId: String?` (FK `Country`), `currentCountryId: String?` (FK `Country`), `phone: String?`, `destinationCountryIds: String[]` (or a join table `ProfileDestinationCountry` — see decision below), `budgetMin: Decimal?`, `budgetMax: Decimal?`, `budgetCurrency: String?` (ISO 4217), `onboardingCompletedAt: DateTime?`, `version: Int`.
**Relationships:** 1:1 `User`; 1:N `Education`; 1:N `AcademicRecord`; 1:N `LanguageTest`; 1:1 `Preference`.
**Notable constraints:** unique `userId` (true 1:1). **Decision:** preferred destination countries are modeled as a join table `ProfileDestinationCountry(profileId, countryId, rank)` rather than a Postgres array column — rationale: needs referential integrity to `Country`, ordering (`rank`), and is queried ("students interested in Country X") which arrays make expensive and unindexable in the general case.

### 3.2 `Education`
**Purpose:** One prior educational qualification/institution the student attended (repeatable — high school, bachelor's, etc.).
**Key fields:** `profileId: String`, `level: Enum(HIGH_SCHOOL, BACHELORS, MASTERS, DOCTORATE, OTHER)`, `institutionName: String`, `countryId: String` (FK `Country`), `fieldOfStudy: String?`, `startDate: DateTime?`, `endDate: DateTime?`, `isCurrent: Boolean`, `gradingScale: Enum(GPA_4, GPA_5, PERCENTAGE, UK_HONOURS, OTHER)`, `gradeValue: Decimal?`.
**Relationships:** N:1 `Profile`; 1:N `AcademicRecord` (per-term/per-year records supporting the same education entry, e.g. for gap/trend analysis).
**Notable constraints:** index `(profileId, isCurrent)`.

### 3.3 `AcademicRecord`
**Purpose:** Fine-grained academic history supporting "academic risk/gap" analysis (per-year marks, repeated years, documented gap periods) — deliberately separate from `Education` so the assessment engine can reason about trends and gaps, not just a final GPA.
**Key fields:** `educationId: String`, `termLabel: String` (e.g. "Year 2", "Semester 1 2023"), `gradeValue: Decimal?`, `hasGap: Boolean`, `gapReason: String?`, `gapMonths: Int?`.
**Relationships:** N:1 `Education`.
**Notable constraints:** index `educationId`.

### 3.4 `LanguageTest`
**Purpose:** A reported English (or other) proficiency test result (IELTS, TOEFL, PTE, Duolingo, etc.), used both for assessment scoring and later for `EnglishRequirement` matching and document vault linkage (the score report is a `Document`).
**Key fields:** `profileId: String`, `testType: Enum(IELTS, TOEFL, PTE, DUOLINGO, CAMBRIDGE, OTHER)`, `overallScore: Decimal`, `sectionScores: Json` (component breakdown — varies by test type, see decision below), `testDate: DateTime`, `expiryDate: DateTime?`, `documentId: String?` (FK `Document`, the uploaded score report).
**Relationships:** N:1 `Profile`; N:0..1 `Document`.
**Notable constraints:** index `(profileId, testType)`. **Decision:** `sectionScores` is JSON because each test type reports a different set of sub-scores (IELTS: listening/reading/writing/speaking; Duolingo: literacy/conversation/comprehension/production) — normalizing would require either a table-per-test-type or a wide nullable-everything table; `overallScore` (the only universally comparable, universally queried field) is a real indexed column.

### 3.5 `Preference`
**Purpose:** Softer, non-hard-constraint preferences that influence matching/ranking but are not eligibility gates (campus size, climate, scholarship priority weighting, program mode).
**Key fields:** `profileId: String @unique`, `studyMode: Enum(ON_CAMPUS, ONLINE, HYBRID, NO_PREFERENCE)`, `campusSizePreference: Enum(SMALL, MEDIUM, LARGE, NO_PREFERENCE)`, `scholarshipPriority: Enum(LOW, MEDIUM, HIGH)`, `intakePreference: String?` (e.g. "Fall 2026").
**Relationships:** 1:1 `Profile`.
**Notable constraints:** unique `profileId`.

---

## 4. Questionnaire (Configurable, Versioned)

### 4.1 `Questionnaire`
**Purpose:** A named questionnaire instrument (v1 has one: "Eligibility & Fit Questionnaire" — but the model supports multiple, e.g. a future "Visa Readiness Questionnaire").
**Key fields:** `key: String @unique` (e.g. `ELIGIBILITY_FIT`), `name: String`, `isActive: Boolean`.
**Relationships:** 1:N `QuestionnaireVersion`.

### 4.2 `QuestionnaireVersion`
**Purpose:** An immutable, published version of a questionnaire's structure. New versions are created when questions are added/changed/removed; existing responses always reference the version they were answered against.
**Key fields:** `questionnaireId: String`, `versionNumber: Int`, `status: Enum(DRAFT, PUBLISHED, RETIRED)`, `publishedAt: DateTime?`, `retiredAt: DateTime?`.
**Relationships:** N:1 `Questionnaire`; 1:N `Section`; 1:N `QuestionnaireResponse`.
**Notable constraints:** composite unique `(questionnaireId, versionNumber)`. A `PUBLISHED` version's `Section`/`Question`/`QuestionOption` rows are treated as immutable by convention (edits create a new draft version instead) — enforced by application logic, not a DB trigger, but called out here because it is load-bearing for reproducibility.

### 4.3 `Section`
**Purpose:** A logical grouping of questions within a questionnaire version (e.g. "Academic Background", "Financial Readiness").
**Key fields:** `questionnaireVersionId: String`, `title: String`, `order: Int`.
**Relationships:** N:1 `QuestionnaireVersion`; 1:N `Question`.
**Notable constraints:** index `(questionnaireVersionId, order)`.

### 4.4 `Question`
**Purpose:** A single question within a section.
**Key fields:** `sectionId: String`, `key: String` (stable machine key used inside answer JSON payloads, e.g. `budget_flexibility`), `label: String`, `type: Enum(SINGLE_CHOICE, MULTI_CHOICE, NUMBER, TEXT, DATE, BOOLEAN, SCALE)`, `isRequired: Boolean`, `order: Int`, `helpText: String?`.
**Relationships:** N:1 `Section`; 1:N `QuestionOption` (for choice types).
**Notable constraints:** composite unique `(sectionId, key)` — `key` must be stable and unique within its section so `AnswerSnapshot` payloads can reliably reference it.

### 4.5 `QuestionOption`
**Purpose:** A selectable option for `SINGLE_CHOICE`/`MULTI_CHOICE` questions.
**Key fields:** `questionId: String`, `value: String`, `label: String`, `order: Int`, `scoreWeight: Decimal?` (optional direct scoring hook consumed by `AssessmentRule`).
**Relationships:** N:1 `Question`.
**Notable constraints:** composite unique `(questionId, value)`.

### 4.6 `QuestionnaireResponse`
**Purpose:** One student's completed (or in-progress) attempt at a specific `QuestionnaireVersion`.
**Key fields:** `profileId: String`, `questionnaireVersionId: String`, `status: Enum(IN_PROGRESS, SUBMITTED)`, `submittedAt: DateTime?`.
**Relationships:** N:1 `Profile`; N:1 `QuestionnaireVersion`; 1:1 `AnswerSnapshot` (created on submission).
**Notable constraints:** index `(profileId, questionnaireVersionId)`; a student may have at most one `IN_PROGRESS` response per `questionnaireVersionId` (partial unique index `WHERE status = 'IN_PROGRESS'`), but multiple historical `SUBMITTED` responses over time (retaking after major life changes) are allowed.

### 4.7 `AnswerSnapshot`
**Purpose:** The immutable, frozen answer payload for a submitted `QuestionnaireResponse` — what the assessment engine actually reads and what gets embedded into `AssessmentResult.snapshot`.
**Key fields:** `questionnaireResponseId: String @unique`, `payload: Json` (map of `questionKey → answerValue`), `capturedAt: DateTime`.
**Relationships:** 1:1 `QuestionnaireResponse`.
**Notable constraints:** unique `questionnaireResponseId`; **never updated after creation** (application-layer invariant — a re-answer creates a new `QuestionnaireResponse` + `AnswerSnapshot` pair, never an in-place edit). JSON justified per `09-database-architecture.md` §4 (shape follows the versioned, admin-configurable question set).

---

## 5. Documents (Private Vault)

### 5.1 `Document`
**Purpose:** Metadata for one uploaded file in the private vault (passport, transcript, certificate, language test report, SOP, CV, recommendation letter, financial document, etc.). File bytes live only in S3.
**Key fields:** `ownerId: String` (FK `User`), `type: Enum(PASSPORT, TRANSCRIPT, DEGREE_CERTIFICATE, LANGUAGE_TEST_REPORT, SOP, CV, RECOMMENDATION_LETTER, FINANCIAL_STATEMENT, OTHER)`, `s3Bucket: String`, `s3Key: String @unique`, `originalFilename: String`, `mimeType: String`, `sizeBytes: BigInt`, `checksumSha256: String`, `status: Enum` (state machine — see §5.1.1), `currentVersionNumber: Int`, `deletedAt: DateTime?`.
**Relationships:** N:1 `User` (owner); 1:N `DocumentReview`; 1:N `DocumentAuditLog`; 0..1:N `DocumentRequirement` (a document may satisfy a specific requirement, tracked via `DocumentRequirement.fulfillingDocumentId`); referenced by `ApplicationDocument`, `LanguageTest.documentId`.
**Notable constraints:** unique `s3Key` (never reused, even after deletion — deleted objects' keys are retired, not recycled); index `(ownerId, status)` (the "student's pending/rejected documents" query); soft delete only.

**§5.1.1 Document status state machine (not a 3-value enum):**
`UPLOAD_INITIATED → UPLOADED → PROCESSING → PENDING_REVIEW → VERIFIED | REJECTED → EXPIRED → REPLACED → DELETED` (the pre-row states `REQUIRED`/`MISSING` are surfaced by the requirements engine before any `Document` row exists — see below). Each transition is written by the same transaction that inserts the corresponding `DocumentAuditLog` row (see `09-database-architecture.md` §7). `REJECTED` is terminal for that specific version but not for the logical document — the student uploads a new version, which increments `currentVersionNumber`, creates a fresh review cycle, and transitions the prior version to `REPLACED`. **Decision:** modeled as an enum `status` column *plus* full history in `DocumentAuditLog` (not a separate `DocumentStatus` transition table as a database construct) because the transition graph is fixed/code-defined (not admin-configurable), so a dedicated state-machine table would add joins without adding flexibility; the audit log already captures every transition with actor+timestamp+reason. **The full state definitions, the complete from/to/trigger/actor/side-effect transition table, malware-scan and validation gating, and the required security tests for this state machine are owned by `15-document-vault-security.md` §3 — that document is authoritative for state-machine behavior; this schema doc only fixes the column/enum shape and must be kept in sync with it, not read as a competing definition.**

### 5.2 `DocumentRequirement`
**Purpose:** Defines what document types/qualities a given `Program` (or a generic baseline) requires, and links to whichever `Document` a student has supplied to fulfill it.
**Key fields:** `programId: String?` (nullable — null means a generic/baseline requirement, e.g. "passport" required for every application regardless of program), `documentType: Enum` (same enum as `Document.type`), `isMandatory: Boolean`, `description: String?`, `fulfillingDocumentId: String?` (FK `Document`, set once the student attaches a document).
**Relationships:** N:1 `Program` (optional); N:0..1 `Document`.
**Notable constraints:** index `(programId, documentType)`.

### 5.3 `DocumentReview`
**Purpose:** One reviewer's (admin/ops) verification pass over a specific document version.
**Key fields:** `documentId: String`, `reviewerId: String` (FK `User`), `versionNumber: Int` (which version of the document was reviewed), `outcome: Enum(APPROVED, REJECTED)` (drives `Document.status` to `VERIFIED`/`REJECTED` respectively — see `15-document-vault-security.md` §3, §8.1), `reasonCode: String?` (**required, enforced at the API layer, when `outcome = REJECTED`** — e.g. `illegible_scan`, `wrong_document_type`, `expired_validity`, `incomplete_pages`, `mismatched_name`, `suspected_fraud`, `other`), `notes: String?`, `reviewedAt: DateTime`.
**Relationships:** N:1 `Document`; N:1 `User` (reviewer).
**Notable constraints:** index `(documentId, versionNumber)`.

### 5.4 `DocumentAuditLog`
**Purpose:** Append-only log of every status transition and access event for a document (upload, scan result, review outcome, admin override, download-via-signed-URL issuance).
**Key fields:** `documentId: String`, `actorId: String?` (FK `User`, nullable for SYSTEM actions), `actorType: Enum(STUDENT, ADMIN, SYSTEM)`, `action: String` (e.g. `STATUS_CHANGED`, `SIGNED_URL_ISSUED`, `REVIEW_RECORDED`), `fromStatus: String?`, `toStatus: String?`, `metadata: Json?`, `createdAt: DateTime`.
**Relationships:** N:1 `Document`.
**Notable constraints:** index `(documentId, createdAt DESC)`; append-only, no `deletedAt`, no update path. This table is distinct from the platform-wide `AuditLog` (§11.1) because document access/review events are high-volume and domain-specific (signed-URL issuance in particular is logged here for security review, not duplicated into the general audit log unless it is also an admin override).

---

## 6. University Catalog

### 6.1 `Country`
**Purpose:** Reference data for countries (nationality, destination, city parent).
**Key fields:** `isoCode2: String @unique`, `name: String`, `region: String?`.

### 6.2 `City`
**Purpose:** Reference data for cities (campus location).
**Key fields:** `countryId: String`, `name: String`, `timezone: String?`.
**Relationships:** N:1 `Country`.
**Notable constraints:** index `countryId`.

### 6.3 `University`
**Purpose:** A degree-granting institution.
**Key fields:** `name: String`, `countryId: String`, `websiteUrl: String?`, `logoS3Key: String?`, `worldRanking: Int?`, `accreditationBody: String?`, `deletedAt: DateTime?`.
**Relationships:** N:1 `Country`; 1:N `Campus`; 1:N `Program`; 1:1 `UniversityMetadata`.
**Notable constraints:** soft delete only (a university disappearing must not orphan historical `AssessmentResult`/`ApplicationSnapshot` data, which reference it via snapshots, not live FK dependence — see §9).

### 6.4 `Campus`
**Purpose:** A physical (or "online") campus of a university — a university can have multiple campuses in different cities.
**Key fields:** `universityId: String`, `cityId: String?` (nullable for fully online campuses), `name: String`, `isOnline: Boolean`, `deletedAt: DateTime?`.
**Relationships:** N:1 `University`; N:1 `City` (optional); 1:N `Program` (a program is offered at a specific campus, or campus-agnostic if null — see `Program.campusId`).
**Notable constraints:** soft delete only.

### 6.5 `Program`
**Purpose:** A specific degree program offered by a university (e.g. "MSc Data Science").
**Key fields:** `universityId: String`, `campusId: String?`, `name: String`, `level: Enum(BACHELORS, MASTERS, DOCTORATE, DIPLOMA, CERTIFICATE)`, `fieldOfStudy: String`, `durationMonths: Int`, `deliveryMode: Enum(ON_CAMPUS, ONLINE, HYBRID)`, `deletedAt: DateTime?`.
**Relationships:** N:1 `University`; N:1 `Campus` (optional); 1:N `Intake`; 1:N `ProgramRequirement`; 1:N `EnglishRequirement`; 1:N `TuitionFee`; 1:N `Scholarship`; 1:N `DocumentRequirement`.
**Notable constraints:** index `(universityId, level, fieldOfStudy)` (catalog browsing/filtering); soft delete only.

### 6.6 `ProgramRequirement`
**Purpose:** Non-language academic eligibility requirements for a program (minimum GPA, required prior field of study, standardized test requirements like GRE/GMAT).
**Key fields:** `programId: String`, `requirementType: Enum(MIN_GPA, PRIOR_FIELD, STANDARDIZED_TEST, WORK_EXPERIENCE, OTHER)`, `minValue: Decimal?`, `description: String`, `isMandatory: Boolean`.
**Relationships:** N:1 `Program`.
**Notable constraints:** index `programId`.

### 6.7 `EnglishRequirement`
**Purpose:** Minimum English proficiency thresholds per program, per accepted test type (a program typically accepts several test types with different minimum scores).
**Key fields:** `programId: String`, `testType: Enum` (same as `LanguageTest.testType`), `minOverallScore: Decimal`, `minSectionScores: Json?` (per-section minimums, varies by test type — same JSON justification as `LanguageTest.sectionScores`).
**Relationships:** N:1 `Program`.
**Notable constraints:** composite unique `(programId, testType)`.

### 6.8 `Intake`
**Purpose:** A specific admission cycle/term for a program (e.g. "Fall 2026").
**Key fields:** `programId: String`, `term: String` (e.g. "Fall 2026"), `applicationOpenDate: DateTime`, `applicationDeadline: DateTime`, `startDate: DateTime`, `status: Enum(UPCOMING, OPEN, CLOSED)`, `capacity: Int?`.
**Relationships:** N:1 `Program`; 1:N `Application` (applications target a specific intake).
**Notable constraints:** composite unique `(programId, term)`; index `(programId, status)`.

### 6.9 `TuitionFee`
**Purpose:** Cost data for a program, potentially varying by intake/student category (domestic vs. international).
**Key fields:** `programId: String`, `category: Enum(INTERNATIONAL, DOMESTIC)`, `amount: Decimal`, `currency: String`, `perPeriod: Enum(TOTAL, PER_YEAR, PER_SEMESTER)`, `effectiveFrom: DateTime`, `effectiveTo: DateTime?`.
**Relationships:** N:1 `Program`.
**Notable constraints:** index `(programId, category, effectiveFrom)`.

### 6.10 `Scholarship`
**Purpose:** A scholarship or funding opportunity associated with a program (or university-wide, `programId` nullable).
**Key fields:** `universityId: String`, `programId: String?`, `name: String`, `amount: Decimal?`, `currency: String?`, `coveragePercent: Decimal?`, `eligibilityCriteria: String`, `applicationDeadline: DateTime?`, `deletedAt: DateTime?`.
**Relationships:** N:1 `University`; N:1 `Program` (optional).
**Notable constraints:** soft delete only.

### 6.11 `UniversityMetadata`
**Purpose:** Data-provenance tracking for catalog trustworthiness — every university record's data must be traceable to a source and verification event, since AdmitFlow's credibility depends on catalog accuracy.
**Key fields:** `universityId: String @unique`, `source: String` (e.g. "official website", "manual research", "partner feed"), `sourceUrl: String?`, `verifiedAt: DateTime?`, `verifiedBy: String?` (FK `User`), `confidence: Enum(HIGH, MEDIUM, LOW)`, `lastReviewedAt: DateTime?`.
**Relationships:** 1:1 `University`.
**Notable constraints:** unique `universityId`. **Decision:** provenance is tracked at the `University` level (one row) rather than per-field, per-program — rationale: v1 catalog curation is a whole-record research/verification workflow (an ops person verifies a university's data in one pass), not a per-field pipeline; per-field provenance is a plausible v2 extension if automated data feeds are introduced, at which point `UniversityMetadata` would be joined by a `ProgramMetadata`/field-level table rather than reworking this one.

---

## 7. Assessment & Matching Engine

### 7.1 `Assessment`
**Purpose:** One student's request/session for an eligibility assessment (the umbrella record; a student may run this multiple times as their profile changes, e.g. after a new IELTS score).
**Key fields:** `profileId: String`, `triggeredBy: Enum(STUDENT_REQUEST, PROFILE_UPDATE, ADMIN_REQUEST)`, `status: Enum(PENDING, COMPLETED, FAILED)`.
**Relationships:** N:1 `Profile`; 1:1 `AssessmentResult` (on completion).
**Notable constraints:** index `(profileId, status)`.

### 7.2 `AssessmentRule`
**Purpose:** A single versioned scoring rule/weight used by the matching engine (e.g. "GPA fit curve", "budget fit", "English proficiency gap penalty", "academic gap penalty"). Rules are admin-tunable configuration, not hardcoded logic.
**Key fields:** `key: String`, `version: Int`, `ruleType: Enum(THRESHOLD, WEIGHTED_FACTOR, PENALTY, BONUS)`, `config: Json` (rule-specific parameters — see `09-database-architecture.md` §4), `isActive: Boolean`, `effectiveFrom: DateTime`, `effectiveTo: DateTime?`.
**Relationships:** referenced (by `key`+`version`, not FK) from `AssessmentSnapshot.rulesVersionRef` — see rationale below.
**Notable constraints:** composite unique `(key, version)`. **Decision:** a rule set's *identity* for reproducibility purposes is a `rulesVersion` label (e.g. `"matching-rules-2026.03"`) stored in the snapshot rather than a live FK to individual `AssessmentRule` rows — rationale: an assessment must remain reproducible even if individual rule rows are later edited for correction; the snapshot captures the fully-resolved rule configuration *as JSON at generation time* (§7.4), and `rulesVersion` is a human/audit-readable pointer back to "what config was active," not a dependency the historical record relies on at read time.

### 7.3 `AssessmentResult`
**Purpose:** The output of one completed assessment: zone placement (REACH/TARGET/SAFE) for each matched program, with explainability, gated for TARGET/SAFE by entitlement at the API layer (not by hiding data at the DB layer — see `14-security-architecture.md`).
**Key fields:** `assessmentId: String @unique`, `profileId: String`, `matchingEngineVersion: String`, `universityDataVersion: String`, `rulesVersion: String`, `generatedAt: DateTime`, `results: Json` (array of `{ programId, intakeId, zone: REACH|TARGET|SAFE, overallScore, factors: [{ factorKey, weight, rawScore, weightedScore, reasoning }] }`).
**Relationships:** 1:1 `Assessment`; N:1 `Profile`; 1:1 `AssessmentSnapshot`.
**Notable constraints:** unique `assessmentId`. **Decision:** `results` is JSON (per-program, per-factor explainability array) rather than normalized `AssessmentResultItem`/`AssessmentResultFactor` tables — rationale: this is explicitly historical, immutable, reproducibility-critical data (§4 category (b) in `09-database-architecture.md`); it is always read whole (rendered as one result page), never filtered by individual factor value at the DB layer, and normalizing would not add query capability the product needs while adding migration risk to a table that must never be touched by later schema evolution. `programId`/`intakeId` values inside the JSON are **not** enforced FKs (deliberately — see §9, historical integrity vs. live catalog changes) but are validated at write time by application code against the catalog as it existed at `generatedAt`.

### 7.4 `AssessmentSnapshot`
**Purpose:** The full reproducibility snapshot backing an `AssessmentResult` — the frozen inputs, not just the outputs.
**Key fields:** `assessmentResultId: String @unique`, `profileSnapshot: Json` (frozen `Profile`+`Education`+`AcademicRecord`+`LanguageTest`+`Preference` at generation time), `answerSnapshotId: String` (FK `AnswerSnapshot` — this one *is* a real FK since `AnswerSnapshot` is itself immutable, see §4.7), `rulesConfigSnapshot: Json` (fully-resolved `AssessmentRule` configs used), `universityDataVersion: String`.
**Relationships:** 1:1 `AssessmentResult`; N:1 `AnswerSnapshot`.
**Notable constraints:** unique `assessmentResultId`; never updated after creation (application-layer invariant, same as `AnswerSnapshot`).

---

## 8. Commerce & Entitlements

### 8.1 `Product`
**Purpose:** A sellable thing (TARGET/SAFE unlock, application fee, consultation) — generic, never a boolean flag (Charter/architecture non-negotiable).
**Key fields:** `key: String @unique` (e.g. `TARGET_UNLOCK`, `APPLICATION_FEE`, `CONSULTATION_40MIN`), `name: String`, `type: Enum(ONE_TIME, RECURRING)`, `isActive: Boolean`.
**Relationships:** 1:N `Price`; 1:N `Entitlement` (grant template — see `Entitlement.productId`).

### 8.2 `Price`
**Purpose:** A specific price point for a product, supporting multi-currency and price changes over time without losing historical pricing on past purchases.
**Key fields:** `productId: String`, `amount: Decimal`, `currency: String` (ISO 4217), `billingInterval: Enum(ONE_TIME, MONTHLY, YEARLY)?`, `isActive: Boolean`, `effectiveFrom: DateTime`, `effectiveTo: DateTime?`, `stripePriceId: String?`, `paypalPlanId: String?`.
**Relationships:** N:1 `Product`; 1:N `Purchase`; 1:N `Subscription`.
**Notable constraints:** index `(productId, currency, isActive)`. Past `Purchase`/`Payment` rows reference the specific `Price.id` used, so historical receipts remain accurate even after prices change.

### 8.3 `Customer`
**Purpose:** Payment-provider-facing identity for a `User` (a thin mapping table so `User` itself never carries provider-specific billing fields).
**Key fields:** `userId: String @unique`, `stripeCustomerId: String? @unique`, `paypalPayerId: String? @unique`.
**Relationships:** 1:1 `User`; 1:N `Payment`; 1:N `Subscription`.
**Notable constraints:** unique `userId`; unique `stripeCustomerId`/`paypalPayerId` where present.

### 8.4 `Subscription`
**Purpose:** A recurring billing relationship (not launched in v1 per Charter §8, but modeled now so it requires no rework — see `Product.type = RECURRING`).
**Key fields:** `customerId: String`, `priceId: String`, `status: Enum(TRIALING, ACTIVE, PAST_DUE, CANCELED, EXPIRED)`, `currentPeriodStart: DateTime`, `currentPeriodEnd: DateTime`, `cancelAtPeriodEnd: Boolean`, `providerSubscriptionId: String @unique`.
**Relationships:** N:1 `Customer`; N:1 `Price`; 1:N `Entitlement` (entitlements can be sourced from a subscription rather than a one-time purchase).
**Notable constraints:** unique `providerSubscriptionId`.

### 8.5 `Purchase`
**Purpose:** A one-time commercial transaction record (the domain-level "order"), distinct from `Payment` (the provider-facing settlement record) — one `Purchase` can in principle have multiple `Payment` attempts (a failed card retried).
**Key fields:** `customerId: String`, `priceId: String`, `status: Enum(PENDING, COMPLETED, FAILED, REFUNDED)`, `quantity: Int`.
**Relationships:** N:1 `Customer`; N:1 `Price`; 1:N `Payment`; 1:N `Entitlement` (entitlements granted as a result of this purchase).
**Notable constraints:** index `(customerId, status)`.

### 8.6 `Payment`
**Purpose:** The provider-facing settlement record for one payment attempt (Stripe PaymentIntent / PayPal Order), the financial system-of-record row.
**Key fields:** `purchaseId: String?` (nullable to allow ad hoc/manual payments), `customerId: String`, `provider: Enum(STRIPE, PAYPAL)`, `providerTransactionId: String @unique`, `amount: Decimal`, `currency: String`, `status: Enum(REQUIRES_ACTION, SUCCEEDED, FAILED, REFUNDED, PARTIALLY_REFUNDED)`, `failureReason: String?`, `refundedAmount: Decimal?`.
**Relationships:** N:1 `Purchase` (optional); N:1 `Customer`.
**Notable constraints:** **unique `providerTransactionId`** (DB-enforced — prevents duplicate settlement records from webhook retries); index `(customerId, status)`. **Never** hard-deleted, never cascade-deleted from `User` (§12).

### 8.7 `Entitlement`
**Purpose:** The generic access grant — "this customer has access to X" — never a boolean flag on `User`/`Profile`. Covers TARGET/SAFE unlock scope, per-application-fee-paid status, consultation credits, etc.
**Key fields:** `customerId: String`, `productId: String`, `sourceType: Enum(PURCHASE, SUBSCRIPTION, ADMIN_GRANT, PROMOTIONAL)`, `sourcePurchaseId: String?`, `sourceSubscriptionId: String?`, `scope: Json?` (e.g. `{ assessmentId: "..." }` if the unlock is scoped to one assessment rather than account-wide — see decision below), `grantedAt: DateTime`, `expiresAt: DateTime?`, `revokedAt: DateTime?`, `revokedReason: String?`, `version: Int`.
**Relationships:** N:1 `Customer`; N:1 `Product`; N:0..1 `Purchase`; N:0..1 `Subscription`.
**Notable constraints:** index `(customerId, productId, revokedAt)` (the "does this customer currently have this entitlement" lookup, the single most frequent query against this table). **Decision:** `scope` is JSON because entitlement scoping rules vary by product (`TARGET_UNLOCK` might scope to one `assessmentId`; `CONSULTATION_CREDIT` might scope to a `consultantSpecialty`); the alternative (a nullable FK column per possible scope type) would grow a new nullable column every time a new scoped product is introduced, which is exactly the "boolean-flag-by-another-name" anti-pattern this model exists to avoid. Admin overrides (`sourceType = ADMIN_GRANT`) always require a corresponding `AuditLog` row (§7 transaction-boundary rule in `09-database-architecture.md`).

### 8.8 `WebhookEvent`
**Purpose:** Idempotency ledger for inbound payment-provider webhooks (Stripe/PayPal) — guarantees the same provider event can never be processed twice, even under provider retries or concurrent delivery.
**Key fields:** `provider: Enum(STRIPE, PAYPAL)`, `providerEventId: String`, `eventType: String`, `rawPayload: Json`, `receivedAt: DateTime`, `processedAt: DateTime?`, `processingStatus: Enum(RECEIVED, PROCESSING, PROCESSED, FAILED)`, `failureReason: String?`.
**Relationships:** none by FK (deliberately decoupled — it references entities like `Payment`/`Purchase` only by ID inside `rawPayload`/application logic, not by schema FK, since a webhook may arrive for an event AdmitFlow can't yet map to a local row, e.g. out-of-order delivery).
**Notable constraints:** **composite unique `(provider, providerEventId)`** — the core idempotency guarantee, enforced by the database, not just an application-level "have I seen this before" check (which is itself a race condition under concurrent delivery). See `41-backup-and-disaster-recovery.md` §Webhook Recovery for replay procedure.

---

## 9. Applications

### 9.1 `Application`
**Purpose:** A student's application to a specific program/intake through AdmitFlow — the live, mutable "in progress" record up until submission.
**Key fields:** `studentId: String`, `programId: String`, `intakeId: String`, `status: Enum(DRAFT, READY_FOR_REVIEW, READY_TO_SUBMIT, SUBMITTED, UNDER_REVIEW, ADDITIONAL_INFORMATION_REQUIRED, OFFER_RECEIVED, REJECTED, WAITLISTED, OFFER_ACCEPTED, OFFER_DECLINED, WITHDRAWN)` — the canonical application state machine per `31-state-machines.md` §3 (this corrects an earlier draft of this section, written before that canonical doc existed, which used a shorter/differently-named list including `DOCUMENTS_PENDING`/`UNDER_UNIVERSITY_REVIEW`/`CONDITIONAL_OFFER`/`ENROLLED`), `submittedAt: DateTime?`, `deletedAt: DateTime?`, `version: Int`.
**Relationships:** N:1 `User` (student); N:1 `Program`; N:1 `Intake`; 1:1 `ApplicationSnapshot` (created at submission, §9.2); 1:N `ApplicationDocument`; 1:N `ApplicationStatusHistory`.
**Notable constraints:** composite index `(studentId, status)` (per §9 of `09-database-architecture.md`); index `(programId, intakeId)`; soft delete only (withdrawal is a `status`, not a delete — `deletedAt` is reserved for account-level cleanup, e.g. GDPR erasure of a long-closed application, and even then the `ApplicationSnapshot` persists per §12).

### 9.2 `ApplicationSnapshot`
**Purpose:** The umbrella "this application was submitted with exactly this state" record — created once, atomically, at submission (see `09-database-architecture.md` §7 transaction boundary), never updated after.
**Key fields:** `applicationId: String @unique`, `capturedAt: DateTime`.
**Relationships:** 1:1 `Application`; 1:1 `ApplicationProfileSnapshot`; 1:N `ApplicationDocumentSnapshot`; 1:1 `ProgramSnapshot`; 1:N `RequirementSnapshot`.
**Notable constraints:** unique `applicationId`.

### 9.3 `ApplicationProfileSnapshot`
**Purpose:** Frozen copy of the student's profile/education/language-test data as of submission — the application must never silently reflect the student's *current* live profile after the fact.
**Key fields:** `applicationSnapshotId: String @unique`, `payload: Json` (frozen `Profile`+`Education`+`AcademicRecord`+`LanguageTest` graph).
**Relationships:** 1:1 `ApplicationSnapshot`.
**Notable constraints:** unique `applicationSnapshotId`; immutable after creation.

### 9.4 `ApplicationDocumentSnapshot`
**Purpose:** Frozen reference + metadata for each document that was part of the submission package (which S3 object version, checksum, review status at time of submission) — a later re-upload or re-review of the live `Document` must not alter what was actually submitted.
**Key fields:** `applicationSnapshotId: String`, `documentId: String` (FK `Document`, informational reference — see decision), `versionNumberAtSubmission: Int`, `s3KeyAtSubmission: String`, `checksumAtSubmission: String`, `reviewStatusAtSubmission: String`.
**Relationships:** N:1 `ApplicationSnapshot`; N:1 `Document` (reference).
**Notable constraints:** index `applicationSnapshotId`. **Decision:** keeps a real FK to `Document` (unlike `AssessmentResult.results`' catalog references) because `Document` is soft-deleted (never hard-deleted) and the specific S3 object version is separately frozen in `s3KeyAtSubmission` — so the FK stays resolvable and the byte-identity is still frozen even if the live `Document` row's `status`/`currentVersionNumber` changes later.

### 9.5 `ProgramSnapshot`
**Purpose:** Frozen copy of the program's details (name, requirements summary, tuition, deadline) as of submission — protects against the program's live data changing (e.g. a tuition update, a corrected requirement) after the student already submitted under the old terms.
**Key fields:** `applicationSnapshotId: String @unique`, `programId: String` (informational reference), `payload: Json` (frozen `Program`+`Intake`+`TuitionFee` at submission time).
**Relationships:** 1:1 `ApplicationSnapshot`.
**Notable constraints:** unique `applicationSnapshotId`.

### 9.6 `RequirementSnapshot`
**Purpose:** Frozen copy of each `ProgramRequirement`/`EnglishRequirement`/`DocumentRequirement` the application was evaluated against at submission.
**Key fields:** `applicationSnapshotId: String`, `requirementType: String`, `payload: Json` (frozen requirement definition + whether it was met at submission).
**Relationships:** N:1 `ApplicationSnapshot`.
**Notable constraints:** index `applicationSnapshotId`.

### 9.7 `ApplicationDocument`
**Purpose:** The *live*, pre-submission working set of which documents are attached to a draft application (distinct from the frozen `ApplicationDocumentSnapshot`, which only exists after submission).
**Key fields:** `applicationId: String`, `documentId: String`, `documentRequirementId: String?` (which requirement this fulfills).
**Relationships:** N:1 `Application`; N:1 `Document`; N:0..1 `DocumentRequirement`.
**Notable constraints:** composite unique `(applicationId, documentId)`.

### 9.8 `ApplicationStatusHistory`
**Purpose:** Append-only history of every `Application.status` transition, with actor and reason — mirrors `DocumentAuditLog`'s role but for applications.
**Key fields:** `applicationId: String`, `fromStatus: String?`, `toStatus: String`, `changedBy: String?` (FK `User`, nullable for system/university-feed-driven transitions), `reason: String?`, `changedAt: DateTime`.
**Relationships:** N:1 `Application`.
**Notable constraints:** index `(applicationId, changedAt DESC)`; append-only.

---

## 10. Consultations

### 10.1 `Consultant`
**Purpose:** A user acting as a paid consultant (extends `User` with consultant-specific profile fields).
**Key fields:** `userId: String @unique`, `bio: String?`, `specialties: String[]`, `defaultSessionMinutes: Int`, `isAcceptingBookings: Boolean`, `deletedAt: DateTime?`.
**Relationships:** 1:1 `User`; 1:N `AvailabilitySlot`; 1:N `Booking`.
**Notable constraints:** unique `userId`; soft delete only.

### 10.2 `AvailabilitySlot`
**Purpose:** A bookable time slot a consultant has opened up.
**Key fields:** `consultantId: String`, `startsAt: DateTime`, `endsAt: DateTime`, `status: Enum(OPEN, HELD, BOOKED, CANCELED)`, `version: Int`.
**Relationships:** N:1 `Consultant`; 1:0..1 `Booking`.
**Notable constraints:** **composite unique `(consultantId, startsAt)`** — the primary DB-level double-booking prevention mechanism, combined with `SELECT ... FOR UPDATE` at the application layer (see `09-database-architecture.md` §7.3); index `(consultantId, status, startsAt)` for calendar rendering.

### 10.3 `Booking`
**Purpose:** A confirmed (or held-pending-payment) reservation of a slot by a student.
**Key fields:** `slotId: String @unique`, `studentId: String`, `consultantId: String`, `status: Enum(HELD, CONFIRMED, COMPLETED, CANCELED, NO_SHOW)`, `holdExpiresAt: DateTime?` (payment-hold TTL, so an abandoned checkout releases the slot), `meetingLink: String?`, `version: Int`.
**Relationships:** 1:1 `AvailabilitySlot`; N:1 `User` (student); N:1 `Consultant`.
**Notable constraints:** **unique `slotId`** (a slot maps to at most one non-canceled booking — enforced as a partial unique index `WHERE status != 'CANCELED'` so a canceled booking can free the slot for a new one without violating uniqueness); index `(studentId, status)`; index `(consultantId, status)`.

---

## 11. Notifications

### 11.1 `NotificationTemplate`
**Purpose:** A versioned, admin-editable message template (email/SMS/in-app) keyed by event type.
**Key fields:** `key: String @unique` (e.g. `DOCUMENT_REJECTED`, `BOOKING_CONFIRMED`, `PAYMENT_SUCCEEDED`), `channel: Enum(EMAIL, SMS, IN_APP, PUSH)`, `subjectTemplate: String?`, `bodyTemplate: String`, `isActive: Boolean`, `version: Int`.
**Relationships:** 1:N `Notification`.
**Notable constraints:** unique `key` per active version (composite unique `(key, version)`), with `isActive` marking the current one.

### 11.2 `Notification`
**Purpose:** One notification instance sent (or queued) to a user.
**Key fields:** `userId: String`, `templateId: String`, `channel: Enum(EMAIL, SMS, IN_APP, PUSH)`, `status: Enum(QUEUED, SENT, DELIVERED, FAILED, READ)`, `metadata: Json` (interpolation context — varies per template, see `09-database-architecture.md` §4), `sentAt: DateTime?`, `readAt: DateTime?`.
**Relationships:** N:1 `User`; N:1 `NotificationTemplate`.
**Notable constraints:** index `(userId, status)`; index `(userId, readAt)` for unread-count queries.

---

## 12. Platform & Ops

### 12.1 `AuditLog`
**Purpose:** The platform-wide, append-only log of sensitive/administrative actions (entitlement overrides, role changes, refunds, document status overrides not already covered by `DocumentAuditLog`, admin impersonation, data exports/erasures) — the general-purpose compliance trail, complementing the domain-specific `DocumentAuditLog`/`ApplicationStatusHistory`.
**Key fields:** `actorId: String?` (FK `User`, nullable for SYSTEM), `actorType: Enum(STUDENT, ADMIN, SUPER_ADMIN, SYSTEM)`, `action: String` (namespaced, e.g. `entitlement.override_grant`, `user.role_changed`, `payment.refund_issued`), `entityType: String`, `entityId: String`, `before: Json?`, `after: Json?`, `metadata: Json?`, `ipAddress: String?`, `createdAt: DateTime`.
**Relationships:** N:1 `User` (actor, optional).
**Notable constraints:** composite index `(entityType, entityId, createdAt DESC)`; index `(actorId, createdAt DESC)`; append-only — no update, no delete, no `deletedAt`.

### 12.2 `FeatureFlag`
**Purpose:** Runtime-toggleable feature gating, including the `DEMO_MODE` flag referenced in `50-test-accounts.md` (which must default to, and be structurally incapable of silently becoming, `true` in production — see that document and `37-seed-data-strategy.md`).
**Key fields:** `key: String @unique`, `description: String`, `isEnabled: Boolean`, `rules: Json?` (targeting rules — e.g. percentage rollout, specific user IDs, environment restriction).
**Notable constraints:** unique `key`.

### 12.3 `SystemSetting`
**Purpose:** Generic operational configuration not tied to a specific product/pricing table (e.g. booking hold TTL minutes, max document upload size, support contact email).
**Key fields:** `key: String @unique`, `value: Json`, `description: String?`.
**Notable constraints:** unique `key`.

---

## 13. Cascade-Delete Policy Matrix

Postgres/Prisma `onDelete` behavior by relationship, stated explicitly because getting this wrong is a data-integrity and compliance failure mode:

| Parent → Child | Behavior | Rationale |
|---|---|---|
| `User` → `Session` | `CASCADE` | Sessions have no standalone value once the account is gone/anonymized. |
| `User` → `OAuthAccount` | `CASCADE` | Same as `Session`. |
| `User` → `Profile`/`Education`/`AcademicRecord`/`LanguageTest`/`Preference` | `CASCADE` **only as part of the audited anonymization flow**, never a raw ad hoc delete; ordinary soft-delete of `User` does NOT cascade — these rows persist (subject to anonymization scrubbing fields, not row deletion) so that `AssessmentSnapshot`/`ApplicationProfileSnapshot` history that embeds copies of this data remains internally consistent with what a "deleted" user's data looked like. |
| `User` → `Document` | **RESTRICT / soft-delete only** | Documents may be referenced by submitted `ApplicationDocumentSnapshot` rows; never cascade-delete. |
| `User` → `Payment`, `Purchase`, `Entitlement`, `Subscription` | **FORBIDDEN — RESTRICT** | Financial and entitlement history must survive user account deletion for legal/audit retention (§8 of `09-database-architecture.md`). |
| `User` → `AuditLog` | **FORBIDDEN — RESTRICT** (actor FK persists, nullable actorId only used for true SYSTEM rows) | Compliance trail must not disappear when the actor's account is later deleted. |
| `User` → `Application` | **RESTRICT / soft-delete only** | Same rationale as `Document`. |
| `University`/`Program`/`Campus` → historical `AssessmentResult.results` / `ApplicationSnapshot` family | **No FK dependency at all** (JSON reference or explicit snapshot copy, see §7.3, §9.3-9.6) | Historical records must survive catalog changes/soft-deletes entirely; there is nothing to cascade because there is no live dependency. |
| `AvailabilitySlot` → `Booking` | **RESTRICT** | A slot with an active booking cannot be silently deleted; cancel the booking first (explicit status transition, itself audited). |
| `Application` → `ApplicationSnapshot` (+ children) | **RESTRICT** | Once created, a submission snapshot is permanent regardless of what happens to the live `Application` row afterward (including its own soft-delete). |
| `Product`/`Price` → `Purchase`/`Payment`/`Entitlement` | **RESTRICT** | Historical purchases must keep referencing the exact price paid, even if the product/price is later deactivated (`isActive = false`, never deleted). |
| `QuestionnaireVersion` → `QuestionnaireResponse` | **RESTRICT** | A published version can be retired (`status = RETIRED`) but never deleted while responses reference it. |
| `Document` → `DocumentReview`, `DocumentAuditLog` | **RESTRICT** (soft-delete cascades logically via `deletedAt`, rows persist) | Review/audit history for a document must survive the document itself being marked deleted. |

**General rule:** cascade `DELETE` is reserved for genuinely dependent, valueless-in-isolation child rows (sessions, OAuth links, in-progress draft state with no historical significance). Anything with financial, legal, audit, or reproducibility significance is `RESTRICT` (or has no FK at all, by design) and is managed exclusively through soft delete / anonymization / status transitions — never a hard cascading delete.

## 14. Relationship Cardinality Quick Reference

| Relationship | Cardinality | Notes |
|---|---|---|
| User ↔ Profile | 1:1 | |
| User ↔ Role | N:N via `UserRole` | |
| Role ↔ Permission | N:N via `RolePermission` | |
| Profile ↔ Education | 1:N | |
| Education ↔ AcademicRecord | 1:N | |
| Profile ↔ LanguageTest | 1:N | |
| Profile ↔ Preference | 1:1 | |
| QuestionnaireVersion ↔ Section ↔ Question ↔ QuestionOption | 1:N chain | |
| QuestionnaireResponse ↔ AnswerSnapshot | 1:1 | |
| University ↔ Campus | 1:N | |
| University ↔ Program | 1:N | |
| Program ↔ Intake | 1:N | |
| Program ↔ ProgramRequirement / EnglishRequirement / TuitionFee / Scholarship / DocumentRequirement | 1:N each | |
| University ↔ UniversityMetadata | 1:1 | |
| Assessment ↔ AssessmentResult | 1:1 | |
| AssessmentResult ↔ AssessmentSnapshot | 1:1 | |
| Product ↔ Price | 1:N | |
| Customer ↔ Purchase / Payment / Subscription / Entitlement | 1:N each | |
| Purchase ↔ Payment | 1:N | (retries) |
| Application ↔ ApplicationSnapshot | 1:1 | |
| ApplicationSnapshot ↔ ApplicationProfileSnapshot | 1:1 | |
| ApplicationSnapshot ↔ ApplicationDocumentSnapshot | 1:N | |
| ApplicationSnapshot ↔ ProgramSnapshot | 1:1 | |
| ApplicationSnapshot ↔ RequirementSnapshot | 1:N | |
| Application ↔ ApplicationDocument | 1:N | |
| Application ↔ ApplicationStatusHistory | 1:N | |
| Consultant ↔ AvailabilitySlot | 1:N | |
| AvailabilitySlot ↔ Booking | 1:0..1 | |
| NotificationTemplate ↔ Notification | 1:N | |
| Document ↔ DocumentReview / DocumentAuditLog | 1:N each | |

---

## 15. Summary of Decisions in This Document

| # | Decision | Rationale (short) |
|---|---|---|
| D1 | `ProfileDestinationCountry` join table instead of an array column | Referential integrity + rank ordering + queryability |
| D2 | `LanguageTest.sectionScores`, `EnglishRequirement.minSectionScores` as JSON | Test-type-dependent shape |
| D3 | Document lifecycle modeled as enum + full `DocumentAuditLog`, not a separate transition-table state machine | Fixed, code-defined transition graph; history already captured |
| D4 | `AssessmentRule` versions are config rows; reproducibility relies on a resolved JSON snapshot (`AssessmentSnapshot.rulesConfigSnapshot`), not a live FK from historical results | Historical results must survive later rule edits/corrections |
| D5 | `AssessmentResult.results` is JSON, program/intake references inside it are not enforced FKs | Immutable historical record must survive catalog changes |
| D6 | `UniversityMetadata` provenance tracked at university level, not per-field | Matches v1 curation workflow; extensible later |
| D7 | `Entitlement.scope` is JSON rather than growing nullable scope-type columns | Avoids reintroducing boolean/column-per-feature anti-pattern |
| D8 | `WebhookEvent` has no FK to `Payment`/`Purchase`, unique on `(provider, providerEventId)` | Must accept events before local mapping is resolvable; idempotency is the only hard guarantee needed |
| D9 | `ApplicationDocumentSnapshot` keeps a real FK to `Document` (unlike catalog snapshots) because `Document` is never hard-deleted | S3 key/checksum freeze already guarantees byte-identity |
| D10 | Cascade delete restricted to valueless dependent rows (sessions, OAuth links); everything financial/audit/legal is RESTRICT + soft delete | Compliance and reproducibility integrity |
