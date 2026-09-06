# 27 — Audit Logging

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering
**Depends on:** `09-database-architecture.md` (immutability/transaction conventions), `02-personas-and-roles.md` (RBAC)
**Read alongside:** `25-admin-platform.md` (per-module event mapping), `28-observability.md` (operational logs — a different system, see §1), `42-gdpr-and-data-privacy.md` (authoritative cross-category retention table; this document sets only the audit-log-specific number)

---

## 1. Purpose and Scope, and How This Differs From Observability Logging

This document defines AdmitFlow's **audit log** — the immutable, permanent record of who did what to which resource, for compliance, dispute resolution, and security incident response. This is a distinct system from the **operational/application logs** defined in `28-observability.md`:

| | Audit Log | Operational Logs |
|---|---|---|
| Purpose | Compliance-grade record of sensitive actions | Debugging, performance, reliability |
| Storage | `AuditLog` table, Postgres, append-only | Log aggregation platform, retained per operational policy (much shorter) |
| Retention | Years (see §5) | Weeks to months |
| Who reads it | ADMIN/SUPER_ADMIN/COMPLIANCE_ADMIN via the Audit Log Viewer (`25-admin-platform.md` §12.3) | Engineering, via APM/log tooling |
| Content | Actor, action, resource, reason, IP/UA — never payload contents | Structured request/error/perf data |
| Mutability | Never updated or deleted by application code | Rotated/expired per retention policy, not a legal record |

A single user-facing action typically produces entries in **both** systems (an operational log line for the HTTP request, an audit log entry for the sensitive state change it caused) — they serve different consumers and must not be conflated into one table or one retention policy.

## 2. Storage Model: Append-Only, Truly Immutable

**Decision:** `AuditLog` is a dedicated Postgres table with no `deletedAt` column and no update path in application code — not even soft delete. Rationale: soft delete implies the possibility of "hiding" a row from default queries, which is the wrong property for a compliance record; an audit log entry must be either present and readable forever (subject to §5's access policy) or not exist at all (it must never exist-but-be-hidden). This mirrors the treatment of `WebhookEvent` and `ApplicationStatusHistory` in `09-database-architecture.md` §6.3.

**Enforcement, not just convention:**
- The application's database role has `INSERT` and `SELECT` privileges on `AuditLog` only — no `UPDATE`, no `DELETE` grant at the database level. A bug or a compromised application credential cannot alter history even in principle; this is enforced by Postgres grants, not solely by "the ORM code doesn't call update."
- Every write to `AuditLog` happens inside the same transaction as the state-changing operation it records (per `09-database-architecture.md` §7's "Admin action → Audit log" transaction boundary) — never a best-effort, fire-and-forget call issued after commit. If the transaction rolls back, no audit entry is left describing an action that didn't actually happen; if the audit insert itself fails, the whole transaction fails, because "the state changed but nobody can prove it" is treated as equally bad as "the state didn't change."
- Bulk/system-triggered actions (scheduled jobs, migrations, data backfills) still write `AuditLog` rows with `actorType = SYSTEM` and a service identifier as `actor` — there is no code path, human or automated, that mutates audited resources without a corresponding entry.
- Long-term, rows are **archived** (moved to cheaper cold storage, e.g. an immutable S3 object-lock bucket) once they age past the active-query window, but archival is a copy-then-verify-then-mark operation, never a delete-from-Postgres-without-a-durable-copy operation — "archived" must never become a euphemism for "gone."

## 3. Schema

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key (per `09-database-architecture.md` §5). |
| `actor` | UUID, nullable FK → `User.id` | The user who performed the action. Nullable only for `actorType = SYSTEM`. References `User.id` directly (never a denormalized snapshot), consistent with `09-database-architecture.md` §6.2 — users are soft-deleted, never hard-deleted, so this FK always resolves. |
| `actorType` | enum: `USER`, `SYSTEM` | Distinguishes human-initiated from job/scheduler-initiated entries. |
| `action` | enum (string) | One of the event names in §4. |
| `resource` | string | The resource type acted on (e.g. `Document`, `Application`, `Entitlement`, `FeatureFlag`) — a stable identifier, not a free-text description. |
| `resourceId` | UUID | The specific row affected. Composite queries use `(resource, resourceId, createdAt DESC)` per `09-database-architecture.md` §9's indexing rule. |
| `timestamp` | `timestamptz` (UTC) | Set once at write time; this is `createdAt` in effect but named `timestamp` here to make its semantic role explicit in every consumer. |
| `metadata` | JSONB | Structured, action-specific context. See §3.1 for what belongs here and the hard rule on what never does. |
| `ipAddress` | string (inet) | Captured from the request at the time of the action. |
| `userAgent` | string | Captured from the request at the time of the action. |

This table is one of the explicit, justified JSON-column exceptions catalogued in `09-database-architecture.md` §4 — `metadata` varies by action type, is never filtered by internal field at the database layer, and the columns that *are* queried (`actor`, `action`, `resource`, `resourceId`, `timestamp`) are real indexed columns.

### 3.1 What Goes in `metadata` — and the Hard Rule on What Never Does

`metadata` carries the specific facts that make an entry useful for review: a reason string, a before/after value pair for a changed field, an amount and currency, a status transition, a version ID. It is always **structured** (real keys, not a single dumped free-text blob) so the Audit Log Viewer can render it consistently across action types.

**Rule — never logged in `metadata` (or anywhere in `AuditLog`), full stop:** passwords, password hashes, session tokens, API keys/secrets, full document file contents, full payment card numbers or CVV, or any other secret/credential material. Where a log entry needs to reference a sensitive object, it references it **by ID** (`resourceId`, or a `metadata.documentId`) so an authorized reviewer can look the object up through its own access-controlled path — the audit log itself is never a second, less-guarded copy of sensitive content. This is the same principle applied in `28-observability.md` to operational logs, enforced independently in both systems because they have different authorized readers.

## 4. Audit Event Catalog

The following event names are the fixed, canonical vocabulary for `AuditLog.action` — used exactly as spelled here across this document, `25-admin-platform.md`, `45-analytics-and-events.md`, and any future doc that needs to reference "the event fired when X happens." Adding a genuinely new top-level lifecycle event to this list is a deliberate, reviewed change (it becomes a durable public contract other docs and code depend on); a one-off or admin-console-specific action instead uses the generic `ADMIN_ACTION` event with a `metadata.subtype` (§4.1) rather than growing this list unboundedly.

| Event | Fired when | Typical `resource` |
|---|---|---|
| `USER_CREATED` | An account is created (self-signup or admin-created) | `User` |
| `USER_LOGIN` | A successful authentication | `User` |
| `PASSWORD_CHANGED` | A password is changed or reset | `User` |
| `PROFILE_UPDATED` | A user edits their own profile fields | `User`/`Profile` |
| `DOCUMENT_UPLOADED` | A document is uploaded | `Document` |
| `DOCUMENT_VIEWED` | A document's content is opened/rendered (student viewing their own, or admin/consultant viewing under a permitted scope) | `Document` |
| `DOCUMENT_DOWNLOADED` | A document's file is downloaded | `Document` |
| `DOCUMENT_REJECTED` | An admin rejects a document in verification | `Document` |
| `DOCUMENT_VERIFIED` | An admin approves a document in verification | `Document` |
| `ASSESSMENT_RUN` | An assessment is generated for a student | `AssessmentResult` |
| `PAYMENT_CREATED` | A payment intent/transaction is initiated | `Payment` |
| `PAYMENT_COMPLETED` | A payment is confirmed successful by the provider | `Payment` |
| `REFUND_ISSUED` | A refund is processed | `Payment` |
| `ENTITLEMENT_GRANTED` | An entitlement is created (via payment or manual admin grant) | `Entitlement` |
| `APPLICATION_CREATED` | A draft application is started | `Application` |
| `APPLICATION_SUBMITTED` | An application is submitted | `Application` |
| `APPLICATION_STATUS_CHANGED` | An application's status transitions (system- or admin-driven) | `Application` |
| `BOOKING_CREATED` | A consultation booking is made (student- or admin-initiated) | `Booking` |
| `BOOKING_CANCELLED` | A consultation booking is cancelled (student- or admin-initiated) | `Booking` |
| `ADMIN_ACTION` | Any admin-console action with no dedicated event above — see §4.1 for the subtype registry | Varies (`metadata.subtype` + `resource` together identify it) |

### 4.1 `ADMIN_ACTION` Subtype Registry

`ADMIN_ACTION` is the escape hatch for admin-console overrides that don't correspond to a normal user-facing lifecycle event (a student never "changes a feature flag," so there's no natural top-level event name to reuse). `metadata.subtype` is a second, equally-stable string enum, extended over time as new admin modules ship (per `25-admin-platform.md`'s module list) without touching the top-level `action` enum. Registry as of this document:

`USER_SUSPENDED`, `USER_REACTIVATED`, `IMPERSONATION_STARTED`, `IMPERSONATION_ENDED`, `UNIVERSITY_UPDATED`, `PROGRAM_UPDATED`, `REQUIREMENT_UPDATED`, `INTAKE_UPDATED`, `FEE_UPDATED`, `SCHOLARSHIP_UPDATED`, `APPLICATION_REVIEWER_ASSIGNED`, `ENTITLEMENT_REVOKED`, `CONSULTATION_SLOT_CREATED`, `CONSULTATION_SLOT_CANCELLED`, `CONTENT_PUBLISHED`, `FEATURE_FLAG_CHANGED`, `SYSTEM_SETTING_CHANGED`, `ASSESSMENT_RULE_VERSION_PUBLISHED`, `AUDIT_LOG_ACCESSED`, `ROLE_ASSIGNED`, `ROLE_REVOKED`, `ADMIN_ACCOUNT_CREATED`, `ADMIN_ACCOUNT_DEACTIVATED`.

### 4.2 Rule: Reuse the Specific Event Before Reaching for `ADMIN_ACTION`

When an admin performs an action a student/consultant could also trigger in the normal product flow (cancelling a booking, causing a document rejection, changing an application's status), the entry uses the **same top-level event** (`BOOKING_CANCELLED`, `DOCUMENT_REJECTED`, `APPLICATION_STATUS_CHANGED`) with `actor` set to the admin and `metadata.onBehalfOf`/`metadata.source = "ADMIN_OVERRIDE"` added — never a parallel admin-only event name for the same underlying state change. This keeps downstream consumers (analytics, the student's own journey timeline in `25-admin-platform.md` §4.1) able to query one event name regardless of who triggered it, while the audit trail still distinguishes actor from subject. `ADMIN_ACTION` is reserved for actions with **no student-facing equivalent at all**.

## 5. Access Policy

**Decision:** Audit log read access is restricted to `ADMIN`, `SUPER_ADMIN`, and (once built) `COMPLIANCE_ADMIN`, gated by the dedicated `audit_log:read` permission — never bundled into any other permission, including general admin permissions (`25-admin-platform.md` §12.3). Rationale: the audit log is the record that would surface an admin's own misconduct; access to it must be a deliberate, separately-grantable permission so it can be scoped tightly (e.g. to `COMPLIANCE_ADMIN` and a small number of `SUPER_ADMIN`s) rather than incidentally handed to every admin who happens to have general platform access.

- **Self-auditing:** every read of the Audit Log Viewer is itself logged (`ADMIN_ACTION`/`AUDIT_LOG_ACCESSED`, `resource = AuditLog`, `metadata` capturing the filter criteria used, e.g. which user's history was queried) — access to the log of logs is not exempt from being logged. This is the one place the system logs "viewing" at the level of a search/filter action rather than a single-record view, because knowing *whose history an admin looked up* is itself a security-relevant fact (e.g. an admin querying a public figure's or a coworker's record with no open ticket).
- **No bulk export by default:** exporting audit log data (as opposed to viewing it filtered/paginated in the console) requires a further-restricted `audit_log:export` permission, consistent with the general bulk-export-is-separately-gated rule in `25-admin-platform.md` §3.
- **Never editable, never deletable, from the UI or the API** — there is no "correct a mistaken log entry" feature. A wrong or misleading action is addressed by writing a **new** clarifying entry that references the original by `resourceId`/timestamp, exactly as financial corrections are handled by a new offsetting transaction rather than editing history.

## 6. Retention

**Decision: Every `AuditLog` entry is retained for a minimum of 7 years from its `timestamp`, with no per-event-type exception carved out in this document.** Rationale:
- Financial-adjacent events (`PAYMENT_CREATED`, `PAYMENT_COMPLETED`, `REFUND_ISSUED`, `ENTITLEMENT_GRANTED`, and the financial `ADMIN_ACTION` subtypes) need a multi-year retention floor anyway to align with typical financial/tax record-keeping expectations (commonly ~7 years) — this is the driving number.
- Rather than maintaining a second, per-event-type retention matrix specifically for the audit log (in addition to the cross-category data-retention table already owned by `42-gdpr-and-data-privacy.md`), a **single uniform 7-year floor for the entire table** is simpler to implement correctly, simpler to prove correct during a compliance review ("what is the audit log retention policy" has one answer, not twenty), and errs toward *more* retention for non-financial events rather than less — an acceptable trade given audit logs contain no raw sensitive document content in the first place (§3.1).
- This retention floor applies independent of the underlying resource's own lifecycle: if a `User` is anonymized under a right-to-erasure request (`09-database-architecture.md` §6.3), their historical `AuditLog` rows are **not** deleted or altered — the `actor`/`resourceId` FK continues pointing at the now-anonymized user row, exactly as payment and other legally-retained records do. The audit log itself contains no free-text PII beyond what §3.1 already permits (IDs, reasons, IP/UA), so retaining it post-anonymization does not reintroduce the erased data.
- After 7 years, rows are eligible for archival to cold, immutable storage (§2) rather than deletion by default; actual deletion (if ever required by a specific, narrower legal obligation) is a distinct, separately-approved process, not an automatic job — this document does not authorize automatic deletion of any audit row.
- The authoritative, full cross-category retention table (documents, profiles, financial records, sessions, etc.) lives in `42-gdpr-and-data-privacy.md`; this section only fixes the audit-log-specific number so that doc and this one don't drift out of sync — read that document for how audit log retention fits alongside every other data category's retention stance.

## 7. Summary of Decisions in This Document

| # | Decision | Rationale (short) |
|---|---|---|
| D1 | `AuditLog` is truly immutable — no soft delete, no `UPDATE`/`DELETE` grant at the DB level | Compliance record must never be "hidden," only ever absent-by-design |
| D2 | Audit writes share a transaction with the state change they record | An unlogged sensitive action is treated as a bug, not an edge case |
| D3 | Fixed catalog of 19 top-level event names; `ADMIN_ACTION` + `metadata.subtype` for admin-console-specific overrides | Stable vocabulary other docs/code can reference without the enum growing unboundedly |
| D4 | Reuse a specific event (actor-attributed) before reaching for `ADMIN_ACTION` | One event name per real-world action, regardless of who triggered it |
| D5 | Never log secrets, tokens, or document contents in `metadata` — reference by ID | Audit log must not become a second, less-guarded copy of sensitive data |
| D6 | Read access gated by dedicated `audit_log:read` permission (ADMIN/SUPER_ADMIN/COMPLIANCE_ADMIN only); every read is itself logged | Prevents the log from being incidentally readable by every admin; makes access to it accountable |
| D7 | Uniform 7-year retention floor for all audit events, archival (not deletion) thereafter | Aligns with financial record-keeping needs; simpler to prove correct than a per-type matrix |

## 8. Related Documents

- `25-admin-platform.md` — per-module mapping of admin actions to the events defined here
- `09-database-architecture.md` — immutability, transaction-boundary, and JSON-column conventions this document builds on
- `28-observability.md` — the separate operational logging system
- `42-gdpr-and-data-privacy.md` — authoritative cross-category data retention table
