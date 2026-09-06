# 25 — Admin Platform

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering
**Depends on:** `02-personas-and-roles.md` (RBAC model), `09-database-architecture.md` (schema conventions, transaction boundaries)
**Read alongside:** `27-audit-logging.md` (event catalog referenced throughout this document), `14-security-architecture.md` (authorization enforcement), `28-observability.md` (system health dashboard backing data)

---

## 1. Purpose and Scope

This document defines the **admin back-office** as a first-class product surface, not an internal tool bolted on after launch. It enumerates every admin module, the minimum permission required to use it, what each module writes to the audit log, and the UI/workflow shape engineers should build against. It does not define the audit log schema itself (`27-audit-logging.md`) or the permission-bundle implementation details beyond what is already fixed in `02-personas-and-roles.md`.

**Binding rule — ADMIN OVERRIDES:** Any admin action that changes state a student, consultant, or the system would otherwise control on its own (granting/revoking an entitlement, refunding a payment, verifying/rejecting a document, changing an application's status, creating/cancelling a consultation slot or booking on someone's behalf, editing university/program/requirement/intake/fee data, editing assessment rule weights/thresholds, toggling a feature flag, editing a system setting) is an **admin override**. Every admin override:

1. Requires a specific permission (never a bare role-name check — see §2).
2. Requires the acting admin to supply a **reason** (free text, minimum length enforced client- and server-side) before the action commits.
3. Produces an audit log entry — written in the **same database transaction** as the state change itself (per `09-database-architecture.md` §7, "Admin action → Audit log") — whose `metadata.reason` carries that text. An override that "succeeded" but has no matching audit row is treated as a production incident, not a logging gap.
4. Is visible in the Audit Log Viewer (§9.3) filterable by actor, resource, and date.

This rule is referenced by every module section below as "**subject to the ADMIN OVERRIDES rule**" rather than repeated in full each time.

## 2. Authorization Model for This Document

Every module below states a "minimum permission." These are resource-action permission strings per `02-personas-and-roles.md` §6 (e.g. `document:verify`, `entitlement:grant`), never role names — a permission is granted to whichever role bundle includes it today (`ADMIN`, `SUPER_ADMIN`) and can be granted to a future role (`SUPPORT_AGENT`, `FINANCE_MANAGER`, etc.) without touching the authorization code path. All checks are enforced server-side on every API route and every server action; the admin console hiding a nav item or button is a UX convenience only.

**Decision:** Admin console pages and API routes share the exact same permission constants — the frontend never derives "can I see this" from role name, only from the permission set returned at session start. Rationale: prevents the single most common RBAC regression, where a new role gets a menu item hidden but the underlying route is still open to it (or the reverse — a route locked down but the button still rendered, confusing support staff).

## 3. Admin Console — Information Architecture

The admin console is a distinct authenticated area (`/admin/*`) from the student/consultant app, sharing the same auth session but gated by an admin-capable permission set at the top-level layout (no admin permission → 403, not a silent redirect that leaks the existence of the area). Left-nav sections map 1:1 to the modules in this document:

```
/admin
  /users                 Users
  /universities          Universities & Programs
  /applications          Applications
  /documents             Documents
  /payments              Payments & Subscriptions
  /consultations         Consultations
  /content               Content
  /assessment-rules      Assessment Rules
  /system
    /feature-flags
    /settings
    /audit-log
    /health
```

Every list view in every module supports: server-side pagination, column-level filtering, and CSV export gated by a distinct `*:export` permission (bulk export of student PII is a materially bigger exposure than viewing one record at a time, so it is never bundled into the base `*:read` permission).

## 4. Module: Users

**Covers:** students, consultants, admins — one unified directory with role-scoped detail views.

**Minimum permission:**
- List/search/view: `user:read`
- Suspend/reactivate: `user:suspend`
- Impersonate (support): `user:impersonate` (separate from `user:suspend` — see §4.3)
- Manually adjust an entitlement from a user's page: `entitlement:grant` (see §8)

### 4.1 Search and Profile View

- Search by name, email, phone, user ID, and (for consultants) specialty tags. Search is a real indexed query path (see `09-database-architecture.md` §9), not a full-table scan — this is a daily-use tool at scale.
- Profile view shows: identity/contact fields, role(s), account status (active/suspended/pending-verification), and a **journey timeline** — a single reverse-chronological feed built from `AuditLog` + domain tables: signup → email verification → onboarding → assessment run(s) → document uploads/verifications → applications → bookings → payments. This is the primary tool support staff use to answer "what has this student actually done," so it must read from real events, not be hand-assembled per ticket.
- No student PII is rendered beyond what the support/verification purpose requires by default (e.g. document *contents* are not inlined into the profile view — see §6 for the dedicated, separately-audited document viewer).

### 4.2 Suspend / Reactivate

Suspending a user blocks login and any token-based API access immediately (session invalidation, not just a UI flag) but never hard-deletes or cascades to their financial/audit history (per `09-database-architecture.md` §6.3). Subject to the ADMIN OVERRIDES rule — reason required (e.g. "fraud investigation," "requested by student pending refund dispute").

### 4.3 Impersonation (Support Mode)

**Decision: Impersonation is included, but only as a narrowly-scoped, time-limited, fully-audited "view and act as" support tool — never a silent, indefinite admin capability.** Rationale: without it, diagnosing "the student says X is broken but I can't reproduce it" forces either (a) asking the student to share credentials (worse — untraceable, violates least-privilege, and trains users to hand over passwords), or (b) support staff querying the database directly (worse — no consistent audit trail, easy to bypass application-level checks by accident). A properly-scoped impersonation mode is the safer of the three options, provided it is constrained as follows:

- Requires the distinct `user:impersonate` permission — never bundled into general `user:read`/`user:suspend`.
- **Time-limited:** an impersonation session is capped (default: 15 minutes), auto-expires, and cannot be silently renewed — the admin must explicitly re-initiate (and re-justify) a new session, which is itself logged as a new event.
- **Reason required** before the session starts, same as any override.
- **Explicitly audited at start and end**, not just at the individual actions taken while impersonating (see `27-audit-logging.md` for the `IMPERSONATION_STARTED`/`IMPERSONATION_ENDED` event pair). Every action performed during the session is separately logged under its own normal event type, with `metadata.impersonatedBy` set to the admin's ID and `actor` set to the student — so the trail shows both "who was really driving" and "whose account this affected."
- **Visibly indicated** to the acting admin throughout (persistent banner) — never a mode that could be entered accidentally.
- **Scope limits:** an impersonated session can perform actions available to the student's own account (view documents, retry a failed upload, re-trigger a notification) but is explicitly blocked from the highest-sensitivity actions even in impersonation mode — changing the student's password/email, initiating a payment/refund, or deleting the account — those require the admin to use their own dedicated override tools (§7, §8), which carry their own permission and audit trail, rather than acting "as" the student for financial/security-critical operations.
- Read-only document/payment *viewing* while impersonating still fires `DOCUMENT_VIEWED`/equivalent events attributed to the student-as-actor with the impersonation metadata attached, not suppressed just because an admin is driving.

## 5. Module: Universities

**Covers:** universities, campuses, programs, requirements, intakes, fees, scholarships.

**Minimum permission:**
- Read (catalog browsing): `university:read`
- Create/edit: `university:write` (today granted to `ADMIN`/`SUPER_ADMIN`; the natural home for the future `UNIVERSITY_MANAGER` and `DATA_MANAGER` roles as narrower slices of this permission)
- Publish a change that affects live assessments/applications: `university:publish` (see §5.1)

### 5.1 Versioned Snapshots, Not In-Place Mutation of Referenced Data

University/program/requirement/intake/fee data is **live, editable, CRUD-managed data** for catalog-browsing purposes, but any assessment or application that has already used a piece of this data references an immutable snapshot of it (`ProgramSnapshot`, `RequirementSnapshot` — per `09-database-architecture.md` §4), never the live row. Consequences for this module's UI:

- Editing a program's requirements, fees, or an intake's deadline updates the live record used for *future* matching/assessment runs and *future* application submissions.
- It does **not** retroactively change what a student was already shown or what an already-submitted application recorded — that student's `ApplicationDocumentSnapshot`/`ProgramSnapshot` stays exactly as it was at submission time.
- The edit UI must show "last published version" and "currently editing (unpublished draft)" as distinct states so an admin editing a program's requirements mid-cycle doesn't assume the change is retroactive.
- Every create/edit is an admin override (reason required, e.g. "university updated IELTS minimum for Fall 2027 intake") and logged via `ADMIN_ACTION` with `metadata.subtype` identifying which entity type changed (see `27-audit-logging.md` §4).

### 5.2 CRUD Surfaces

| Entity | Notes |
|---|---|
| University | Name, country, accreditation info, ranking metadata (source + date, never a hardcoded/unsourced number — ties to `44-seo-strategy.md`'s no-fabricated-stats rule, which applies equally to internal display of "facts"). |
| Campus | Belongs to a University; location, contact. |
| Program | Belongs to a Campus; degree level, field, duration, language of instruction, tuition. |
| Requirement | Belongs to a Program (+ optionally Intake-specific overrides); test-score minimums, document checklist, GPA thresholds. |
| Intake | Belongs to a Program; application window, deadline, seats (informational — not a live booking-capacity system). |
| Fee | Application fee, deposit, currency; versioned like the rest — a fee change never rewrites what an already-submitted application was charged. |
| Scholarship | Eligibility criteria (structured, not free text, so it can be surfaced in matching), award amount/type, deadline. |

## 6. Module: Applications

**Minimum permission:**
- List/filter/view: `application:read`
- Add reviewer note: `application:annotate`
- Assign a reviewer: `application:assign`
- Manually override status: `application:override_status` (distinct permission — the natural seam for the future `APPLICATION_REVIEWER` role, which gets `application:read` + `application:annotate` but not `application:override_status`)

### 6.1 List / Filter

Filterable by status, university, program, intake, assigned reviewer, submission date range, and a "needs attention" smart filter (submitted > N days ago with no status change, or flagged by an automated completeness check). Status values follow the application state machine defined in the domain functional-requirements doc; this module only consumes that state machine, it does not redefine it.

### 6.2 Review Workflow

- **Reviewer assignment:** an admin/reviewer can self-assign or be assigned an application; assignment is stored on the application (`Application.assignedReviewerId`) and shown in the list view so work isn't duplicated. Assignment changes are logged (`ADMIN_ACTION`, subtype `APPLICATION_REVIEWER_ASSIGNED`).
- **Notes:** free-text internal notes attached to an application, visible to admin/reviewer roles only (never surfaced to the student verbatim — the student sees status + a curated reason where applicable, per `02-personas-and-roles.md` §2 "must not see"). Notes are timestamped and attributed, stored append-only (edits create a new note rather than mutating history) so a reviewer's original assessment can't be quietly rewritten after the fact.
- **Manual status override:** subject to the ADMIN OVERRIDES rule. Used when a university's decision arrives outside any automated integration ("offer received," "rejected," "waitlisted," "deferred"). Logged via the dedicated `APPLICATION_STATUS_CHANGED` event (not a generic `ADMIN_ACTION`, since this is a first-class lifecycle event other students'/analytics' consumers need a stable name for) with `metadata.previousStatus`, `metadata.newStatus`, `metadata.reason`, and `metadata.source = "ADMIN_OVERRIDE"` to distinguish it from a student- or system-triggered transition of the same event type.

## 7. Module: Documents

**Minimum permission:**
- View verification queue: `document:read`
- Approve/reject: `document:verify`
- View a specific document's file content (not just metadata): `document:view_content` (deliberately split from `document:read` — see below)

### 7.1 Why Viewing Content Is Its Own Permission

Listing documents (filename, type, upload date, status) and *opening* a document's actual bytes (a scanned passport, a transcript) are different sensitivity tiers. **Decision:** `document:view_content` is a distinct permission from `document:read`, and every content view fires `DOCUMENT_VIEWED` regardless of role — including for `SUPER_ADMIN` — per the rule in `02-personas-and-roles.md` §5 that no role is "unaudited." This lets the platform later grant `SUPPORT_AGENT` the ability to see the *queue* (triage, escalate) without being able to open passport scans, without any model change.

### 7.2 Verification Queue

- Queue ordered oldest-first by default, filterable by document type and student, with an SLA indicator (age since upload) so aging items surface visually rather than requiring a manual sort.
- **Approve:** sets `Document.status = VERIFIED`, logs `DOCUMENT_VERIFIED`.
- **Reject:** requires a reason selected from a structured reason list (e.g. "illegible," "expired," "wrong document type," "name mismatch") plus optional free text, sets `Document.status = REJECTED`, logs `DOCUMENT_REJECTED` with `metadata.reasonCode` and `metadata.reasonText`. The structured code exists specifically so rejection-reason analytics don't require parsing free text later.
- Both actions are subject to the ADMIN OVERRIDES rule (reason required — verification's "approve" already implicitly satisfies this via the structured queue action itself, but rejection's reason is mandatory, not optional).
- Downloading a document (e.g. to review outside the inline viewer) is a separate, also-logged action: `DOCUMENT_DOWNLOADED`.

## 8. Module: Payments

**Minimum permission:**
- View transactions/subscriptions: `payment:read`
- Issue a refund: `payment:refund`
- Manually grant/revoke an entitlement outside the normal payment flow: `entitlement:grant`

### 8.1 Transaction List

Filterable by student, product/price, status (succeeded/failed/refunded/disputed), date range, and payment provider reference — the provider's transaction ID is always shown and linkable (read-only) to the provider dashboard for reconciliation, without embedding provider secrets in the admin UI (see `28-observability.md` and `14-security-architecture.md` for secret handling).

### 8.2 Refunds

Refunds are always issued through the platform's refund action (which calls the payment provider's refund API and updates local state in one transaction, per `09-database-architecture.md` §7), never performed directly in the provider's dashboard and then "synced" — that path has no way to guarantee the corresponding `Entitlement` is revoked consistently. Subject to the ADMIN OVERRIDES rule; logs `REFUND_ISSUED` with `metadata.amount`, `metadata.currency`, `metadata.reason`, and `metadata.originalPaymentId`. If the refund also revokes an entitlement, that is a second, linked audit entry (`ADMIN_ACTION`, subtype `ENTITLEMENT_REVOKED`) referencing the same `resourceId` family so the two are visibly connected in the Audit Log Viewer.

### 8.3 Subscription Management

View/cancel a subscription, view renewal history, and (permission-gated separately, `payment:refund` again — cancellation without refund is lower-risk than a monetary refund but still an override) force-cancel on a student's behalf with reason.

### 8.4 Manual Entitlement Adjustment

The catch-all "goodwill unlock" / "fix a stuck payment" tool. Always requires `entitlement:grant`, always requires a reason, always logs `ENTITLEMENT_GRANTED` (grant) or `ADMIN_ACTION`/subtype `ENTITLEMENT_REVOKED` (revoke) with `metadata.entitlementType`, `metadata.reason`, and — critically — `metadata.linkedPaymentId` set to `null` when the grant has no corresponding payment, so audit review can immediately distinguish "paid normally," "paid but system missed it," and "comped/goodwill," which is exactly the distinction finance reconciliation needs.

## 9. Module: Consultations

**Minimum permission:**
- Manage consultant profiles/status: `consultant:manage`
- Manage availability slots: `consultation:manage_slots`
- View/override bookings: `booking:override`

### 9.1 Consultant Management

Onboard/deactivate consultant accounts, edit public profile fields (bio, specialties, rate), and view a consultant's own booking/earnings history (read-only from the admin side — admins do not edit a consultant's earnings figures directly; adjustments flow through the Payments module so there is one source of truth for money movement, not two).

### 9.2 Availability Slot Management

Admins can create/cancel availability slots on a consultant's behalf (e.g. onboarding a consultant who isn't yet self-serve, or clearing a slot for an emergency). This reuses the same concurrency-safe slot/booking machinery defined in `09-database-architecture.md` §7.3 (`SELECT ... FOR UPDATE` + unique constraint) — an admin-initiated slot change is not a separate, less-safe code path. Subject to the ADMIN OVERRIDES rule when it affects an existing booking (cancelling a slot that already has a confirmed booking requires a reason and notifies the affected student).

### 9.3 Booking List / Overrides

List all bookings, filterable by consultant, student, status, date. Admin-initiated cancellation or reschedule of a booking reuses the `BOOKING_CANCELLED` event (actor = admin, `metadata.onBehalfOf` = student ID) rather than inventing a parallel event name, per the event-reuse rule in `27-audit-logging.md` §3.

## 10. Module: Content

**Minimum permission:** `content:manage` (the direct future home of `CONTENT_MANAGER` — this permission is deliberately scoped to content tables only and has no path to student PII, per `02-personas-and-roles.md` §6).

Covers FAQs, guides, and landing-page content blocks (hero copy, feature descriptions, testimonials-if-real — see `44-seo-strategy.md`'s no-fabricated-social-proof rule, which this module enforces at the data-entry level by never offering a free-text "stat" field that isn't wired to a real computed value). Content items are versioned with a draft/published state (unpublished drafts are never served to `/faq`, `/guides`, etc.) and edits log `ADMIN_ACTION`/subtype `CONTENT_PUBLISHED`. Because content has no student-data sensitivity, this is the one admin module where the audit requirement exists for change-tracking/rollback purposes rather than privacy/compliance purposes — the standard still applies, just for a different reason.

## 11. Module: Assessment Rules

**Minimum permission:** `assessment_rules:publish` — deliberately **not** bundled into `ADMIN`'s base permission set; only `SUPER_ADMIN` (and, later, a purpose-built role) can change what materially affects a student's Reach/Target/Safe outcome. This mirrors `02-personas-and-roles.md` §4's explicit restriction.

### 11.1 Why This Module Is Different From the Rest

Every other module in this document lets admins edit data that takes effect immediately for future use. Assessment rules cannot work that way, because `AssessmentRule` is **versioned**, and every historical `AssessmentResult` permanently references the version that produced it (per the locked architecture decision and `09-database-architecture.md` §4's `AssessmentResult.snapshot` rationale). This module is therefore a **publishing workflow**, not a simple CRUD form.

### 11.2 Editor Concept

- **Scoring weight editor:** per-factor weights (academic fit, budget fit, test scores, etc.) shown as a live-editable table with a running validation that weights are well-formed (e.g. sum to a defined total, or independently bounded — whichever the scoring model requires) before a draft can be submitted for publishing.
- **Zone threshold editor:** the score cutoffs that separate Reach/Target/Safe, edited the same way.
- **Eligibility rule configuration:** hard-gate rules (e.g. minimum GPA below which a program is excluded outright rather than merely scored low) as structured conditions, not free-text logic — structured so they can be validated and diffed between versions.
- **Draft → Review → Publish:** edits are saved as a **new draft version** of `AssessmentRule`, never as an in-place edit of a version already in use. A draft can be edited freely; **publishing** it is the irreversible, audited action that makes it the active version for all *future* assessment runs. Already-generated `AssessmentResult` rows keep pointing at whichever version was active when they ran — publishing a new version never recalculates them (per the locked "never silently recalculated" rule).
- **Version history view:** every past version, its effective date range, and how many `AssessmentResult` rows reference it — so an admin can see the real-world impact before publishing a change and can never delete a version still referenced by historical results (enforced the same way financial/audit records resist cascade-delete, per `09-database-architecture.md` §6.3).
- Publishing a version logs `ADMIN_ACTION`/subtype `ASSESSMENT_RULE_VERSION_PUBLISHED` with `metadata.versionId`, `metadata.previousActiveVersionId`, and `metadata.reason` (e.g. "Q3 2026 recalibration based on outcome data").

## 12. Module: System

**Minimum permission:**
- Feature flags: `system:manage_flags`
- Settings: `system:manage_settings`
- Audit log viewer: `audit_log:read` (see `27-audit-logging.md` §5 for the access policy — deliberately not bundled with any other system permission)
- Health dashboard: `system:read_health`

### 12.1 Feature Flags

Boolean/percentage/targeted-rollout flags stored in `FeatureFlag` (per `09-database-architecture.md` §4). Every flag change is subject to the ADMIN OVERRIDES rule (a flag flip can materially change product behavior for real users) and logs `ADMIN_ACTION`/subtype `FEATURE_FLAG_CHANGED` with `metadata.flagKey`, `metadata.previousValue`, `metadata.newValue`.

### 12.2 System Settings

Non-flag configuration (`SystemSetting`) — e.g. support contact email shown in the UI, maintenance-mode banner text, default currency. Same override discipline as flags; logs `ADMIN_ACTION`/subtype `SYSTEM_SETTING_CHANGED`. Settings never hold secrets/API keys directly (those live in the secrets manager per `14-security-architecture.md`) — the settings UI can reference which secret a setting points at by name, never display or accept the raw value.

### 12.3 Audit Log Viewer

Read-only, filterable by actor, action/event type, resource type + ID, date range, and free-text search over `metadata` (bounded, since `metadata` never contains secrets or document contents — see `27-audit-logging.md` §3). Every access to this viewer is itself logged (`ADMIN_ACTION`/subtype `AUDIT_LOG_ACCESSED`) — accessing the log of logs is not exempt from being logged.

### 12.4 System Health Dashboard

Read-only operational view surfacing the metrics defined in `28-observability.md` §4 (API latency, error rate, queue depth/failure rate, webhook failure rate, DB connectivity) plus the liveness/readiness status of the Next.js app and the worker service. This module does not duplicate an APM tool — it is a thin, permission-gated internal summary view backed by the same metrics pipeline, useful for non-engineering staff (e.g. an on-call support lead) to answer "is something broken right now" without needing APM tool access.

## 13. Module → Permission → Audit Summary Table

| Module | Key permission(s) | Primary audit event(s) |
|---|---|---|
| Users — view/search | `user:read` | `DOCUMENT_VIEWED` (if content opened), none for plain profile view |
| Users — suspend/reactivate | `user:suspend` | `ADMIN_ACTION` (`USER_SUSPENDED`/`USER_REACTIVATED`) |
| Users — impersonate | `user:impersonate` | `ADMIN_ACTION` (`IMPERSONATION_STARTED`/`IMPERSONATION_ENDED`) + normal events for actions taken |
| Universities — CRUD | `university:write`, `university:publish` | `ADMIN_ACTION` (`UNIVERSITY_UPDATED`, `PROGRAM_UPDATED`, `REQUIREMENT_UPDATED`, `INTAKE_UPDATED`, `FEE_UPDATED`, `SCHOLARSHIP_UPDATED`) |
| Applications — assign/annotate | `application:assign`, `application:annotate` | `ADMIN_ACTION` (`APPLICATION_REVIEWER_ASSIGNED`) |
| Applications — status override | `application:override_status` | `APPLICATION_STATUS_CHANGED` (`metadata.source = ADMIN_OVERRIDE`) |
| Documents — verify/reject | `document:verify` | `DOCUMENT_VERIFIED` / `DOCUMENT_REJECTED` |
| Documents — view content | `document:view_content` | `DOCUMENT_VIEWED` / `DOCUMENT_DOWNLOADED` |
| Payments — refund | `payment:refund` | `REFUND_ISSUED` |
| Payments — entitlement adjust | `entitlement:grant` | `ENTITLEMENT_GRANTED` / `ADMIN_ACTION` (`ENTITLEMENT_REVOKED`) |
| Consultations — slots | `consultation:manage_slots` | `ADMIN_ACTION` (`CONSULTATION_SLOT_CREATED`/`CONSULTATION_SLOT_CANCELLED`) |
| Consultations — booking override | `booking:override` | `BOOKING_CREATED` / `BOOKING_CANCELLED` (admin-attributed) |
| Content — manage | `content:manage` | `ADMIN_ACTION` (`CONTENT_PUBLISHED`) |
| Assessment Rules — publish | `assessment_rules:publish` | `ADMIN_ACTION` (`ASSESSMENT_RULE_VERSION_PUBLISHED`) |
| System — flags | `system:manage_flags` | `ADMIN_ACTION` (`FEATURE_FLAG_CHANGED`) |
| System — settings | `system:manage_settings` | `ADMIN_ACTION` (`SYSTEM_SETTING_CHANGED`) |
| System — audit log read | `audit_log:read` | `ADMIN_ACTION` (`AUDIT_LOG_ACCESSED`) |
| System — health dashboard | `system:read_health` | none (read-only operational telemetry, not a sensitive resource) |

## 14. Related Documents

- `27-audit-logging.md` — full audit event schema and catalog referenced throughout
- `02-personas-and-roles.md` — RBAC/permission model this document builds on
- `09-database-architecture.md` — snapshot/versioning and transaction-boundary conventions referenced in §5, §7, §11
- `28-observability.md` — metrics backing the System Health Dashboard (§12.4)
- `14-security-architecture.md` — authorization enforcement mechanics, secrets handling
