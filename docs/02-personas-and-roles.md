# 02 — Personas and Roles

**Document status:** Foundational — v1.0
**Depends on:** `00-project-charter.md`
**Read alongside:** `01-product-requirements.md`, `04-functional-requirements.md` (RBAC-dependent FRs)

---

## 1. Purpose

This document defines **who uses AdmitFlow** (personas) and **what each role is authorized to do** (RBAC). It is written so that adding the future roles listed in the charter — `UNIVERSITY_MANAGER`, `APPLICATION_REVIEWER`, `FINANCE_MANAGER`, `SUPPORT_AGENT`, `CONTENT_MANAGER`, `DATA_MANAGER`, `COMPLIANCE_ADMIN` — is a matter of defining new permission sets, not redesigning the authorization model.

**Decision:** Authorization is modeled as **Role → Permission → Resource-scope**, not as boolean flags on the User record (e.g., not `user.isConsultant = true`). A user has one primary role for v1 (STUDENT, CONSULTANT, ADMIN, SUPER_ADMIN), but the permission-checking layer must be written against permissions, not role names, so future many-role-per-user or fine-grained permission overrides don't require rewriting call sites. Rationale: hardcoding `if (role === 'ADMIN')` checks throughout the codebase is the single most common cause of RBAC rework; centralizing permission checks avoids it.

**Non-negotiable across every role:** All authorization is enforced **server-side**. Hiding a button or route on the frontend is a UX convenience only and must never be the only control preventing an action.

---

## 2. Persona: Prospective International Student (Primary)

**Who they are:** Ages ~17–30, applying to undergraduate or postgraduate programs abroad. Wide range in English proficiency, financial means, digital literacy, and access to reliable internet (mobile data common, intermittent connectivity common). Often a first-in-family applicant to study abroad, meaning no informal expert network to lean on.

**Goals:**
- Understand realistically where they can get in, without paying a consultant just to find out.
- Get a clear, ranked list of universities across ambition levels (Reach/Target/Safe).
- Keep all documents (transcripts, test scores, passport, financial proof) organized in one place.
- Know exactly what to do next at every stage, with no guesswork.
- Get an affordable second opinion when they want one, without being forced to pay for it.

**Pain points today:**
- Consultants are expensive and sometimes push a specific university for commission.
- Application requirements are scattered across dozens of inconsistent university websites.
- No visibility into "why was I told I likely won't get in" — assessments feel like a black box.
- Fear of missing a deadline or submitting the wrong document version.
- Uncertainty about visa steps until it's almost too late.

**Can see / do:**
- Their own profile, questionnaire answers, assessment results (all versions/history), documents, applications, consultations, payments, and notifications.
- Unlocked TARGET/SAFE recommendations once purchased.
- Booking and paying for consultations; joining a session.
- Submitting, withdrawing (pre-submission only), and tracking their own applications.
- Downloading/exporting their own data.

**Must NOT see / do:**
- Any other student's profile, documents, assessment, applications, payments, or consultation history — under any circumstance, including via direct object reference (URL/ID guessing).
- Locked TARGET/SAFE match details before purchase (must be omitted from the API response entirely, not shown-then-blurred).
- Internal scoring weights, rule configuration, or consultant/admin notes attached to their file.
- Other students' consultant reviews or admin verification notes about themselves beyond the final decision + reason shown to them.
- Bypass payment for any paywalled unlock, application fee, or consultation.

---

## 3. Persona: Consultant

**Who they are:** A vetted, paid subject-matter expert (former admissions officer, education counselor, or similar) who provides **optional** advisory sessions and, where enabled, document review services. Not a gatekeeper — students can complete the entire core journey without ever booking a consultant.

**Goals:**
- Efficiently see the context needed for a session (student profile, assessment, relevant documents) without digging through unrelated data.
- Manage their availability and bookings.
- Get paid reliably and see a clear earnings/session history.
- Provide feedback/notes tied to a specific booking, visible to the student who booked it.

**Pain points today (in a generic marketplace sense):**
- No visibility into a student's actual profile before a session (wastes session time on data-gathering).
- Payout opacity.
- No structured way to leave a written follow-up after a call.

**Can see / do:**
- Their own consultant profile, specialties, and availability calendar.
- Profile, assessment snapshot, and documents **explicitly shared for a specific booking** by the student at booking time (scoped access, not blanket access to the student's account).
- Session notes they authored for their own bookings.
- Their own payout/earnings history.

**Must NOT see / do:**
- Any student data not tied to an active/past booking with that specific consultant.
- Other consultants' bookings, earnings, or notes.
- Ability to modify a student's profile, documents, application, or entitlements.
- Ability to see platform-wide analytics, other consultants' performance, or admin tooling.

**Decision:** Consultant access to student data is **booking-scoped and time-bound** (e.g., access persists for a limited post-session window to allow follow-up, then expires) rather than persistent. Rationale: minimizes exposure surface consistent with privacy-first principle; a consultant who has stopped receiving bookings from a student should not retain indefinite access to that student's file.

---

## 4. Persona: Platform Admin (ADMIN)

**Who they are:** Internal SNZ Ventures staff operating day-to-day platform functions: document verification, application status updates, customer support, content upkeep, and routine entitlement fixes (e.g., a failed payment that actually succeeded on the processor side).

**Goals:**
- Verify uploaded documents quickly and consistently.
- Resolve student support issues (entitlement mismatches, stuck applications) without engineering involvement.
- Keep university/program data and questionnaire content current.
- Operate within guardrails that prevent accidental harm (e.g., cannot silently delete a student's account without a defined process).

**Can see / do:**
- All students' documents, applications, and entitlements **for the purpose of verification, support, and moderation** — access is logged.
- Verify/reject documents with a reason.
- Update application status on behalf of universities' published outcomes (offer received, rejected, waitlisted) where not automated.
- Grant/adjust entitlements manually (e.g., goodwill unlock, refund-driven revocation) — **always with a mandatory reason field, always audit-logged**.
- Manage university/program catalog data and questionnaire configuration (content only — not scoring-rule weights, unless also granted that specific permission).
- View (not export in bulk, unless additionally permitted) student PII needed for support tickets.

**Must NOT see / do:**
- Modify scoring/matching rule weights without the higher-privilege permission (see §7, this is reserved for SUPER_ADMIN or a future COMPLIANCE_ADMIN/DATA_MANAGER split).
- Access billing provider secrets/API keys or infrastructure configuration.
- Impersonate a student to take actions the student didn't request, without an explicit, logged "support impersonation" mode that is itself audited and time-boxed (see `04-functional-requirements.md`, Admin module).
- Permanently delete audit logs.

---

## 5. Persona: Super Admin (SUPER_ADMIN)

**Who they are:** A small number of senior SNZ Ventures operators/founders with full platform authority, including the ability to manage other admins and system-level configuration.

**Goals:**
- Manage admin accounts and role assignments.
- Configure and version the matching/scoring engine's rules.
- Configure pricing (Product/Price records).
- Access full audit trails for compliance and incident response.

**Can see / do:**
- Everything an ADMIN can, plus:
- Create/deactivate ADMIN and CONSULTANT accounts; assign roles.
- Publish new versions of scoring rules and questionnaire schemas (see the configurable questionnaire/scoring engine docs).
- Configure Product/Price/Entitlement definitions (pricing changes).
- View full, unredacted audit logs across the platform.
- Configure system-level settings (feature flags, integration keys via a secrets manager reference, not raw secret values in the UI).

**Must NOT see / do:**
- Nothing is technically hidden from SUPER_ADMIN, but **every sensitive action is still logged** — "super admin" is not "unaudited admin." Directly viewing a student's document content still requires an on-the-record reason for actions beyond passive listing (e.g., opening a specific private document).

---

## 6. Future Roles (Design-For, Not Build-For, in v1)

These roles must be addable by defining new permission sets against existing resources — no schema or authorization-model rework should be required. Each is described so the current design doesn't accidentally foreclose them.

| Future role | Eventual purpose | Design implication for v1 |
|---|---|---|
| `UNIVERSITY_MANAGER` | Represents a university; manages that university's own program listings, requirements, and receives/responds to applications directly in-platform. | University/Program data model must support an eventual "owning organization" relationship distinct from admin-managed catalog entries. |
| `APPLICATION_REVIEWER` | Reviews submitted applications for completeness/quality before/alongside university review (internal quality gate). | Application state machine must support a review sub-status distinct from "submitted" and "university decision," without renaming existing states. |
| `FINANCE_MANAGER` | Manages refunds, payout reconciliation, financial reporting, tax/invoice handling. | Payments/Entitlements model must expose read/reporting access separable from ADMIN's operational access; refund actions must already be a distinct permission from "grant entitlement." |
| `SUPPORT_AGENT` | Front-line support with narrower access than ADMIN (e.g., can view but not verify documents or touch entitlements). | Permission set must be splittable — "view student support context" separate from "verify document" separate from "adjust entitlement." |
| `CONTENT_MANAGER` | Manages marketing content, help articles, questionnaire copy — not sensitive student data. | Content/CMS-type data must be modeled separately from student PII so a content-only role has zero path to student records. |
| `DATA_MANAGER` | Manages university/program datasets, data imports, scoring-input data quality (not scoring policy itself). | University/program data ingestion must be a distinct permission from scoring-rule authoring. |
| `COMPLIANCE_ADMIN` | Oversees privacy requests (data export/deletion), audit review, regulatory reporting. | Data-subject-request workflows and audit log access must be first-class, permission-gated resources, not developer-only tooling. |

**Decision:** Permissions are modeled per-resource-action (e.g., `document:verify`, `entitlement:grant`, `application:review`, `scoring_rules:publish`, `audit_log:read`) and roles are named bundles of permissions. Rationale: this lets a future role like `SUPPORT_AGENT` be defined as a subset of ADMIN's permissions on day one of building it, with zero changes to how permission checks are written elsewhere in the code.

---

## 7. Object-Level Isolation (applies to every role)

This is called out separately because it is the most common real-world RBAC failure (IDOR — Insecure Direct Object Reference):

- Every resource (document, application, assessment, payment, consultation booking) is owned by exactly one student (or, for consultant-authored notes, additionally scoped to a consultant+booking pair).
- **Every** fetch-by-ID API call must verify the requesting user's permission against *that specific resource's ownership/scope*, not just "is this user's role allowed to read documents in general."
- Sequential or guessable IDs are not a substitute for authorization (do not rely on obscurity); even with non-guessable IDs (e.g., UUIDs), ownership checks are mandatory on every read/write.
- This rule applies identically to STUDENT, CONSULTANT, ADMIN (scoped to legitimate business purpose + audit logging), and every future role.

## 8. Role Summary Matrix

| Capability | STUDENT | CONSULTANT | ADMIN | SUPER_ADMIN |
|---|---|---|---|---|
| View own profile/documents/applications | Yes | N/A | N/A | N/A |
| View another student's data (unscoped) | No | No | Yes (support/verification, logged) | Yes (logged) |
| View a student's data (booking-scoped) | N/A | Yes (own bookings only) | N/A | N/A |
| Verify/reject documents | No | No | Yes | Yes |
| Grant/adjust entitlements | No | No | Yes (logged, reason required) | Yes |
| Configure pricing | No | No | No | Yes |
| Publish scoring rule versions | No | No | No | Yes |
| Manage admin accounts | No | No | No | Yes |
| Book/pay for consultation | Yes | N/A | No | No |
| Conduct consultation session | No | Yes | No | No |
| Read full audit log | No | No | Partial (own actions + support scope) | Yes (full) |

## 9. Related Documents

- `00-project-charter.md` — principles these roles must honor
- `01-product-requirements.md` — module-level requirements referencing these roles
- `03-user-journeys.md` — journeys involving Admin and Consultant actions
- `04-functional-requirements.md` — testable FRs including Admin module RBAC behavior
- `14-security-architecture.md` (separate doc) — full authorization implementation detail
