# 09 — Database Architecture

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering
**Applies to:** All schema design, migrations, and data-access code

---

## 1. Purpose and Scope

This document defines the philosophy and binding conventions for AdmitFlow's relational data layer. It does not enumerate every table (see `10-database-schema.md` for the conceptual ERD) and does not define the migration process step-by-step (see `51-seed-and-migration-plan.md`). It answers: *why is the schema shaped this way*, so that every future table follows the same rules without re-litigating them.

## 2. Locked Storage Decisions (context, not open questions)

These are set at the architecture level and are assumed throughout this document and `10-database-schema.md`:

- **PostgreSQL (managed, e.g. RDS/Cloud SQL-equivalent) + Prisma ORM** is the only relational data store. No secondary relational database, no NoSQL document store for core domain data.
- **AWS S3 (private buckets, signed URLs only)** is the only store for file bytes (documents, generated PDFs, exports). The database never stores file content — only object keys, checksums, sizes, content-types, and versioning metadata.
- **Redis** is used only as an ephemeral cache and BullMQ job queue backing store — never as a system of record. See `41-backup-and-disaster-recovery.md` for what that implies operationally.
- No Supabase Auth, no Supabase Storage. Auth is a custom `User`/`Session`/`Role`/`Permission` model (see `10-database-schema.md`, and `14-security-architecture.md` for the auth threat model).

## 3. Modeling Philosophy: Normalize by Default

AdmitFlow's domain (education, documents, payments, legal-adjacent audit data) is dominated by entities with stable structure, many-to-many relationships (a program has many intakes, an intake belongs to many students' assessments), and a strong need for referential integrity (a scholarship must point at a real program; a payment must point at a real product/price). The default modeling stance is therefore:

- **Third-normal-form relational modeling for anything that is queried, filtered, joined, reported on, or referenced by a foreign key.** Examples: universities, programs, requirements, documents, applications, payments, entitlements, bookings.
- **Explicit join tables for every many-to-many relationship** (e.g. `UserRole`, `RolePermission`, `ProgramRequirement`), never comma-separated lists or array columns standing in for relationships that need referential integrity, uniqueness constraints, or their own metadata (e.g. `assignedAt`, `assignedBy`).
- **No "one big JSON blob" entities.** A table that would need to be queried by field, filtered, aggregated, or joined must have those fields as real columns. JSON is the exception that must be justified (§4), not the default.

This is a conscious rejection of the "just throw it in a JSONB column, Postgres can index that too" shortcut. That approach saves schema-design time up front and costs correctness, query performance, and onboarding clarity for every engineer/agent afterward — unacceptable for a system that will be extended by many contributors (human and AI) over years.

## 4. Where JSON Columns Are Justified (and only there)

JSON/JSONB columns are used **only** where the shape of the data is genuinely dynamic, versioned, or exists purely as an immutable snapshot that is never queried by its internal fields at the database layer. Every use below is an explicit exception, not a pattern to copy for convenience:

| Table.column | What it holds | Why JSON is correct here | Why NOT normalized columns |
|---|---|---|---|
| `QuestionnaireResponse.answers` (raw capture) / `AnswerSnapshot.payload` | The student's answers to a specific `QuestionnaireVersion`, keyed by `questionId` | Questionnaire content (which questions exist, their type, options) is itself versioned and admin-configurable — the *shape* of an answer set changes release to release. Normalizing would require a schema migration every time an admin adds a question. | The set of questions is not fixed at schema-design time; it is product configuration data (see `QuestionnaireVersion`/`Question` tables, which ARE normalized — only the *answer payload instance* is JSON). |
| `AssessmentResult.snapshot` (profile snapshot, questionnaire snapshot, matching results, per-factor scores) | A frozen, point-in-time copy of everything that produced one assessment run | This is an immutable historical record by design (§7 of `00-project-charter.md`: reproducibility). It must never be recalculated or reshaped by later schema changes to `Profile`/`Questionnaire`. Storing it as structured JSON guarantees the snapshot is exactly what was shown to the student, forever, independent of live-table evolution. | Normalizing would mean the "historical" data lives in the same mutable tables as live data — a later `Profile` migration or backfill would silently corrupt historical assessments, which is the exact failure mode this architecture forbids. |
| `ApplicationProfileSnapshot.payload`, `ApplicationDocumentSnapshot.payload`, `ProgramSnapshot.payload`, `RequirementSnapshot.payload` | Frozen copies of profile/document-metadata/program/requirement data as of the submission moment | Same reproducibility rationale as above, applied to applications: once submitted, an application must reflect exactly what was true at submission time, even if the student's live profile, the university's program details, or requirements change afterward. | Same as above — mutable normalized tables cannot serve as a legal/audit-grade historical record. |
| `AuditLog.metadata`, `AuditLog.before`, `AuditLog.after` | Free-form before/after state and contextual details for an audited action | Audit log entries cover dozens of heterogeneous action types (role change, entitlement grant, document status override, refund) each with a different natural set of fields. Forcing one normalized shape across all action types would mean a wide, mostly-null table or a table per action type, both worse for an append-only log that is read sequentially/filtered by actor+action+time, not by internal field value. | The columns actually queried (`actorId`, `action`, `entityType`, `entityId`, `createdAt`) are real indexed columns (§6); only the payload nobody filters by at the DB layer is JSON. |
| `AssessmentRule.config` | Rule-specific parameters (weights, thresholds, factor definitions) for one versioned scoring rule | Rule types differ in shape (a "GPA threshold" rule and a "budget fit curve" rule take different parameters) and are authored/tuned by product/ops without a deploy. | `AssessmentRule` itself (id, version, ruleType, isActive, effectiveFrom) is normalized and queried; only its internal parameter set is JSON, matching the same "content varies, is configuration, is versioned" test as questionnaire answers. |
| `Notification.metadata`, `WebhookEvent.rawPayload` | Notification template-interpolation context; the provider's raw webhook body | `metadata` varies per notification type (a "document rejected" notification carries different context than a "booking confirmed" one); `rawPayload` is stored verbatim for audit/replay (see `41-backup-and-disaster-recovery.md` §Webhook Recovery) and must not be lossy-transformed into columns. | Neither is ever filtered/joined by internal field at the DB layer; both are read back whole by application code. |
| `FeatureFlag.rules`, `SystemSetting.value` | Targeting rules for a flag; a setting's value, which varies by setting | Flags/settings are a generic key-value-with-structure system by nature — that is the entire point of the table. | N/A — these tables exist specifically to avoid a schema migration per new flag/setting. |

**Rule going forward:** before adding a JSON column, the design must satisfy at least one of: (a) the shape is admin-configurable and versioned (questionnaire, rules, flags), or (b) the data is an immutable point-in-time snapshot that must never be affected by later schema evolution (assessment/application snapshots), or (c) the data is a heterogeneous, append-only audit/log payload never filtered by internal field at the DB layer. If none apply, the field is a real column.

## 5. Primary Keys: UUID (v4) Throughout

**Decision:** Every table uses a UUID (v4) primary key (`id UUID PRIMARY KEY DEFAULT gen_random_uuid()` at the Postgres level, `@id @default(uuid())` in Prisma), with no auto-increment integer PKs anywhere in the schema.

Rationale:
- **No enumeration/scanning attacks.** Sequential integer IDs let an attacker or careless client guess adjacent records (`/documents/1043` → try `1044`). This directly supports Charter non-negotiable #4 (object-level data isolation) — UUIDs are a defense-in-depth layer on top of (never a replacement for) server-side authorization checks.
- **Safe to generate client-side or pre-transaction.** IDs for related rows (e.g. a `Booking` and its `AvailabilitySlot` reservation) can be minted before the insert, simplifying idempotency keys and distributed-flow code (e.g. Stripe idempotency keys derived from a pre-generated `Payment.id`).
- **Merge/replay safety.** Snapshot tables, seed data, and any future multi-region or data-migration work never collide on ID space, unlike auto-increment sequences.
- **Cost accepted:** UUIDs are 16 bytes vs. 4/8 for int/bigint, and are not naturally sortable by creation order. This is mitigated by (a) always indexing `createdAt` alongside `id` for chronological queries, and (b) the write-volume profile of AdmitFlow (an admissions platform, not a high-frequency trading system) does not make the index-size/write-amplification cost material at the target scale (100–10,000+ students; see `00-project-charter.md` §6).

## 6. Timestamps, Audit Columns, and Soft Delete

### 6.1 Timestamps

- All timestamps are stored in **UTC**, as Postgres `timestamptz`. The application layer converts to the user's locale/timezone only at presentation time. No `timestamp without time zone` columns are permitted.
- Every table has `createdAt` (set once, immutable) and `updatedAt` (bumped on every mutation — enforced via Prisma `@updatedAt` or a DB trigger for tables written outside the ORM, e.g. bulk jobs).

### 6.2 Actor Attribution

Where an entity's creation or mutation is attributable to a specific actor (i.e., anything other than pure system-generated child rows), the entity carries:

- `createdBy UUID` — nullable FK to `User.id` (nullable to allow system/seed-originated rows; never nullable for student-authored entities like `Document`, `Application`).
- `updatedBy UUID` — nullable FK to `User.id`, updated whenever `updatedAt` changes due to a user-initiated action (not bumped for purely internal recomputation with no actor, e.g. a nightly job — those log to `AuditLog` with `actorType = SYSTEM` instead).

**Decision:** `createdBy`/`updatedBy` reference `User.id` directly (not a denormalized name/email snapshot) because `User` rows are soft-deleted, never hard-deleted (§6.3), so the FK always resolves even for a since-deactivated admin. Rationale: preserves a working audit trail without needing a separate "actor snapshot" table for every audited entity.

### 6.3 Soft Delete

**Decision:** Entities with historical, legal-retention, or referential significance use soft delete (`deletedAt TIMESTAMPTZ NULL`) instead of hard `DELETE`. This applies to (non-exhaustive; see `10-database-schema.md` per-entity notes for the authoritative list): `User`, `University`, `Campus`, `Program`, `Document`, `Application`, `Booking`, `Consultant`, `Scholarship`, `Intake`.

Rules:
- A soft-deleted row is excluded from all default application queries (enforced via a Prisma middleware / repository-layer convention that always filters `deletedAt: null` unless explicitly querying "including deleted," which is itself a permissioned, audited action).
- Soft delete **never cascades** to financial or audit history. Explicitly forbidden: deleting a `User` must never cascade-delete `Payment`, `Purchase`, `AuditLog`, `ApplicationProfileSnapshot`, `ApplicationDocumentSnapshot`, `AssessmentResult`, or `WebhookEvent` rows that reference them (see `10-database-schema.md` §Cascade Policy for the full matrix). Those rows persist indefinitely (subject to the retention schedule in §8) with their FK intact, pointing at a soft-deleted (anonymizable, see below) user.
- **Right-to-erasure interaction:** a legally-requested data deletion is handled as a distinct, audited "anonymize" operation (scrub PII fields on `User`/`Profile` in place, set `deletedAt`) — never a hard `DELETE FROM users`. Financial/legal records that must be retained (payments, invoices, audit logs) retain the FK to the now-anonymized user row rather than losing referential integrity. Full retention periods live in §8 and are cross-referenced from the privacy/security docs.
- Tables that are pure append-only history or already immutable-by-nature (e.g. `AuditLog`, `WebhookEvent`, `ApplicationStatusHistory`, `AssessmentSnapshot`) do **not** get a `deletedAt` column at all — there is nothing to soft-delete; they are never deleted, full stop, subject only to the retention/archival policy in §8.

### 6.4 Optimistic Concurrency (`version`)

**Decision:** Entities that are subject to concurrent mutation by multiple actors or processes carry an integer `version` column (starting at 1, incremented on every update), used for optimistic locking at the application layer (`UPDATE ... WHERE id = $1 AND version = $2`). This applies at minimum to: `AvailabilitySlot`/`Booking` (double-booking prevention, belt-and-suspenders alongside the DB unique constraint — see §7.3), `Entitlement`, `Application`, `DocumentReview`, and `Profile`. Rationale: prevents silent lost-update bugs (e.g. two admin tabs overriding the same entitlement) without taking a DB-level row lock for the whole request lifecycle.

## 7. Transaction Boundaries

**Rule:** any operation that must be all-or-nothing from the user's or the system's perspective is wrapped in a single database transaction (Prisma `$transaction`), never split across separate round-trips with app-level "undo" logic. The following are the mandatory transaction boundaries; new features must extend this list rather than inventing ad-hoc atomicity:

| Flow | Atomic unit | Why |
|---|---|---|
| **Payment → Entitlement** | Create/update `Payment` row (provider-confirmed) + create `Entitlement` row(s) + (if applicable) create/update `Subscription` + write `WebhookEvent.processedAt` | A payment must never be marked successful without the corresponding access being granted, and access must never be granted without a confirmed payment record. Both are written in one transaction keyed off `WebhookEvent.providerEventId` uniqueness (see §7.2). |
| **Booking → Reservation** | Check `AvailabilitySlot` capacity/lock + create `Booking` row + decrement/mark slot capacity | Must be atomic and concurrency-safe to prevent two students booking the same consultant slot (§7.3). |
| **Application → Submission** | Create `ApplicationProfileSnapshot` + `ApplicationDocumentSnapshot` row(s) + `ProgramSnapshot` + `RequirementSnapshot` + update `Application.status` + insert `ApplicationStatusHistory` row | A submitted application must never exist with a partial/missing snapshot — that would silently reintroduce the "results drift" problem snapshots exist to prevent. |
| **Admin action → Audit log** | The mutating statement(s) (e.g. entitlement override, document status override, refund) + the corresponding `AuditLog` insert | An admin action that changed state but failed to log is a compliance gap; the write and its audit record are one transaction, never a best-effort "fire and forget" log call after commit. |
| **Assessment generation → Snapshot** | Compute results + write `AssessmentResult` + `AssessmentSnapshot` (profile/questionnaire/rules/version references) | Guarantees no `AssessmentResult` ever exists without its full reproducibility snapshot (Charter non-negotiable #5). |
| **Document status transition → Audit log** | `Document.status` update (state machine transition, see `12-document-lifecycle.md` if authored separately, or the state machine section of the domain doc) + `DocumentAuditLog` insert | Every document state change must be traceable; a status change without a log entry is treated as a bug, not an edge case. |

### 7.1 Isolation Level

**Decision:** `READ COMMITTED` (Postgres default) for general application traffic; `SERIALIZABLE` (or `SELECT ... FOR UPDATE` row locking) specifically for the booking-reservation transaction and any entitlement-grant path where a race condition would cause double-grant/double-book. Rationale: `SERIALIZABLE` everywhere has a throughput cost not justified for read-heavy browsing/matching traffic; it is reserved for the specific narrow paths where a race condition is a correctness bug, not just a performance concern.

### 7.2 Idempotency

Every external-system-triggered mutation (payment webhooks, OAuth callbacks, retried API calls) is idempotent at the database level via a unique constraint, not merely "checked" in application code before writing (checks-then-write is itself a race condition). See `10-database-schema.md` (`WebhookEvent`, `Payment`) for the concrete constraints.

### 7.3 Concurrency-Sensitive Writes

Booking creation follows this pattern: `SELECT ... FOR UPDATE` the target `AvailabilitySlot` row inside a transaction, verify remaining capacity, insert the `Booking`, commit — combined with a DB-level unique constraint on `(consultantId, startsAt)` (or `slotId` where slots are pre-materialized rows) so that even a bug in the application-level lock path cannot produce two confirmed bookings for the same slot. Constraints are the backstop; the transaction is the primary mechanism.

## 8. Data Retention Philosophy (summary — detail in `41-backup-and-disaster-recovery.md` and privacy docs)

| Data category | Retention stance |
|---|---|
| Financial records (`Payment`, `Purchase`, `Invoice`-equivalent) | Retained per applicable financial/tax law (typically 7 years) regardless of user deletion requests; never cascade-deleted. |
| Audit logs (`AuditLog`, `DocumentAuditLog`) | Retained indefinitely (or per compliance policy once finalized); append-only, no update/delete path in application code. |
| Assessment/application snapshots | Retained for the life of the account plus a post-closure grace period (default: 3 years after account anonymization) to support dispute resolution and analytics on historical accuracy of the matching engine. |
| Documents (S3 objects + metadata) | Retained per user-facing retention policy; deleted (object + metadata) only via an explicit, audited student- or admin-initiated deletion, subject to legal holds if an application referencing the document is still active. |
| Session/auth artifacts | Short-lived; sessions expire and are periodically purged (see `14-security-architecture.md`). |

## 9. Indexing Philosophy

Indexing is treated as part of schema design, not an afterthought tuned in production. Full per-entity index lists live in `10-database-schema.md`; the rules governing them are:

1. **Every foreign key column is indexed.** Postgres does not auto-index FKs (unlike the referenced PK side); every `*Id` FK column gets a btree index at minimum, since FK columns are joined and filtered constantly (e.g. "all documents for this student," "all bookings for this consultant").
2. **Every column used in a `WHERE`, `ORDER BY`, or unique-lookup in a known query pattern is indexed.** This includes status/enum columns that gate high-frequency queries (`Application.status`, `Document.status`, `Booking.status`), and lookup keys (`User.email`, `OAuthAccount.(provider, providerAccountId)`).
3. **Composite indexes match real query shapes, column order matters.** The leading column of a composite index is the one most commonly used alone or as the primary filter. Concrete examples required at minimum:
   - `(studentId, status)` on `Application` — "this student's active applications."
   - `(studentId, status)` on `Document` — "this student's pending-review documents."
   - `(universityId, intakeId)` on `Program`/`ProgramRequirement` lookups — "requirements for this university's this intake."
   - `(consultantId, startsAt)` on `AvailabilitySlot`/`Booking` — "this consultant's schedule," and doubles as the double-booking-prevention unique constraint.
   - `(entityType, entityId, createdAt DESC)` on `AuditLog`/`DocumentAuditLog` — "history for this specific entity, newest first."
   - `(provider, providerEventId)` unique on `WebhookEvent` — idempotency lookup (also a uniqueness constraint, not just an index).
4. **Partial indexes** are used where a query pattern only ever targets a subset of rows, e.g. an index on `Document.status` filtered to `WHERE deletedAt IS NULL` for the "pending review queue," keeping the index small and the queue scan fast as historical soft-deleted rows accumulate.
5. **No speculative indexing.** An index is added because a documented query pattern needs it (this document, an API endpoint's access pattern, or a reporting requirement), not "because the column might be searched someday" — every index has a write-cost; unused indexes are removed during schema review.

## 10. Schema Change Policy

**Rule:** all schema changes are made exclusively through versioned Prisma migrations, reviewed like any other code change, and applied through the deployment pipeline — never by connecting to the production database and running ad hoc DDL. The full workflow (naming convention, review/test/deploy/verify/rollback process, and how this interacts with seed/reference data) is defined in `51-seed-and-migration-plan.md`; this document only states the binding rule that the workflow exists and must always be used.

## 11. Summary of Decisions in This Document

| # | Decision | Rationale (short) |
|---|---|---|
| D1 | UUID v4 PKs everywhere, no auto-increment | Prevents enumeration attacks, safe pre-generation, no cross-environment ID collisions |
| D2 | Normalize by default; JSON only for versioned/configurable payloads, immutable snapshots, and heterogeneous audit payloads | Query/join/report integrity; avoids unmaintainable blob schemas |
| D3 | All timestamps UTC `timestamptz`; `createdAt`/`updatedAt` on every table | Consistent cross-timezone correctness |
| D4 | `createdBy`/`updatedBy` reference `User.id` directly, relying on soft-delete (never hard-delete) of users | Working audit trail without denormalized actor snapshots |
| D5 | Soft delete for historically/legally significant entities; never cascade to financial/audit records | Legal retention + audit integrity |
| D6 | Optimistic `version` column on concurrency-sensitive entities | Prevents silent lost updates without long-held row locks |
| D7 | Transactional atomicity mandatory for payment→entitlement, booking→reservation, application→submission, admin action→audit log, assessment→snapshot | Correctness under concurrency and partial failure |
| D8 | `SERIALIZABLE`/row-locking reserved for booking and entitlement-grant races; `READ COMMITTED` elsewhere | Balances correctness and throughput |
| D9 | Idempotency enforced via DB unique constraints (`WebhookEvent.providerEventId`, payment transaction IDs), not app-level checks alone | Check-then-write is itself a race condition |
| D10 | Indexing driven by documented query patterns (FKs, filters, composites), reviewed for waste | Predictable performance at 100–10,000+ student scale |
