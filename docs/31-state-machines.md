# 31 — State Machines (Canonical Reference)

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0 — **CANONICAL**
**Owner:** SNZ Ventures Engineering
**Applies to:** Every subsystem that models entity lifecycle as a finite set of states

---

## 1. Purpose and Authority

This document is the **single source of truth** for every state machine in AdmitFlow. State names, transition directions, triggering actors, and side effects defined here are binding. Any other document (`21-application-management.md`, `23-notification-system.md`, `24-background-jobs.md`, future `12-document-lifecycle.md`, `13-booking-and-consultation.md`, `44-billing-and-subscriptions.md`, etc.) that restates one of these machines for narrative context **must reproduce it exactly** — same state names (spelling, casing, underscores), same transitions, same actor set. If a discrepancy is ever found between this document and another, **this document wins** and the other is a bug to be fixed, not an alternate interpretation.

**Rule for future authors/agents:** if a task requires a new state on an existing machine, this document is amended first, then every doc that reproduces that machine is updated in the same change. Never add a state to a narrative doc without updating this one.

**Note on `01-product-requirements.md` §7:** that document's early "Application State Machine (v1)" sketch (`Draft → Ready for Submission → Submitting → Submitted → ...`) was an illustrative product-requirements sketch written before the detailed design pass. **§3 of this document is the binding version** and supersedes it. The state names, cardinality of pre-submission states, and payment sequencing in §3 below are what engineering builds against.

Legend used in every transition table:
- **Actor** — who/what can trigger the transition: `STUDENT`, `ADMIN` (SUPER_ADMIN inherits all ADMIN-triggered transitions plus its own §5 of `02-personas-and-roles.md`), `CONSULTANT`, `SYSTEM` (a worker job, a scheduled job, or a webhook-driven server process — never a raw client request), or `EXTERNAL` (a payment provider webhook, treated as system-adjacent but called out separately because it is adversarial input, see `06-system-architecture.md` §4).
- **Side effects** — what must happen atomically or as a direct consequence of the transition: audit log, notification, status-history row, snapshot, cache invalidation, etc. "Status-history row" always means a new immutable row is inserted into the entity's own `*StatusHistory`/`*AuditLog` table — existing rows are never edited.

---

## 2. Account Lifecycle

**Entity:** `User.status`
**States:** `REGISTERED → EMAIL_UNVERIFIED → VERIFIED → ONBOARDING → ACTIVE → SUSPENDED → DEACTIVATED → DELETED`

| # | From | Event / Trigger | To | Actor | Side effects |
|---|---|---|---|---|---|
| A1 | *(none)* | Signup form submitted, `User` row created | `REGISTERED` | `STUDENT` (self-signup) or `ADMIN` (staff-created consultant/admin account) | `AuditLog` entry (`user.registered`) |
| A2 | `REGISTERED` | Same transaction as A1 — every new account is immediately unverified | `EMAIL_UNVERIFIED` | `SYSTEM` | Enqueue `email-send` job for `WELCOME` + verification link (see `23-notification-system.md`) |
| A3 | `EMAIL_UNVERIFIED` | Student clicks time-limited verification link (`EMAIL_VERIFICATION_CONFIRMED`) | `VERIFIED` | `STUDENT` | `EMAIL_VERIFIED` notification, `AuditLog` entry, verification token invalidated (single-use) |
| A4 | `VERIFIED` | Immediate system advance — there is no useful resting state between "email confirmed" and "must complete onboarding" | `ONBOARDING` | `SYSTEM` | none (informational status only, gates route access to the onboarding wizard) |
| A5 | `ONBOARDING` | Student completes the minimum required profile/questionnaire sections (`ONBOARDING_COMPLETED`) | `ACTIVE` | `STUDENT` | `AuditLog` entry, unlocks full product surface (assessment, applications, bookings) |
| A6 | `ACTIVE` | Admin suspends account for cause (ToS violation, fraud flag, payment dispute under investigation) — **reason field mandatory** | `SUSPENDED` | `ADMIN` | All active sessions revoked immediately, `AuditLog` entry with reason, student notified (email) with appeal contact path |
| A7 | `SUSPENDED` | Admin lifts suspension after review | `ACTIVE` | `ADMIN` | Notification, `AuditLog` entry |
| A8 | `ACTIVE` | Student requests account closure, or admin deactivates for a non-punitive reason (e.g. duplicate account merge) | `DEACTIVATED` | `STUDENT` or `ADMIN` | Sessions revoked, notification with reactivation-window explanation, `AuditLog` entry |
| A9 | `SUSPENDED` | Suspension escalates to permanent removal (severe ToS violation, legal request) — bypasses `DEACTIVATED` | `DELETED` | `ADMIN` (requires `SUPER_ADMIN` for the actual anonymization execution) | Same as A10, immediate |
| A10 | `DEACTIVATED` | Retention grace period elapses (**Decision: 30 days** — rationale: matches typical "undo account deletion" UX expectations and gives support time to handle disputed closures) with no reactivation, or a right-to-erasure request is formally fulfilled | `DELETED` | `SYSTEM` (scheduled job) or `ADMIN` (erasure request) | PII scrub/anonymize per `09-database-architecture.md` §6.3 (never a hard `DELETE`), `AuditLog` entry, irreversible from this point |
| A11 | `DEACTIVATED` | Student or admin reactivates within the grace period | `ACTIVE` | `STUDENT` or `ADMIN` | Notification, `AuditLog` entry |

**Decision:** `EMAIL_UNVERIFIED` accounts do not auto-delete. Rationale: deleting a row for a student who simply hasn't checked their inbox yet is a worse failure mode than an unverified row sitting idle; a scheduled hygiene job may flag (never delete) accounts unverified after 30 days for support follow-up.

---

## 3. Application State Machine

**Entity:** `Application.status`
**States:** `DRAFT → READY_FOR_REVIEW → READY_TO_SUBMIT → SUBMITTED → UNDER_REVIEW → ADDITIONAL_INFORMATION_REQUIRED → OFFER_RECEIVED / REJECTED / WAITLISTED → OFFER_ACCEPTED / OFFER_DECLINED`, with `WITHDRAWN` reachable from every non-terminal state.

Full narrative (readiness predicate, snapshot mechanics, edge cases) lives in `21-application-management.md`. This section is the transition table of record; `21` reproduces it verbatim.

| # | From | Event / Trigger | To | Actor | Side effects |
|---|---|---|---|---|---|
| P1 | *(none)* | Student selects a program from assessment results (or adds one manually, if allowed) and starts an application | `DRAFT` | `STUDENT` | `Application` row created, `ApplicationStatusHistory` row inserted, `AuditLog` entry |
| P2 | `DRAFT` | System recomputes readiness after every relevant mutation (field saved, document linked, fee paid) and finds all content-completeness conditions met (see `21` §2, items 1–3) | `READY_FOR_REVIEW` | `SYSTEM` | `ApplicationStatusHistory` row, checklist UI flips to "content complete" |
| P3 | `READY_FOR_REVIEW` | A required field is cleared or a linked document is removed/rejected, breaking completeness | `DRAFT` | `SYSTEM` | `ApplicationStatusHistory` row |
| P4 | `READY_FOR_REVIEW` | Full submission-readiness predicate (`21` §2, all 5 conditions including payment) evaluates true | `READY_TO_SUBMIT` | `SYSTEM` | `ApplicationStatusHistory` row, "Submit Application" action becomes available in the UI |
| P5 | `READY_TO_SUBMIT` | Payment is refunded/voided, or a verified document is later rejected on re-review, before the student submits | `READY_FOR_REVIEW` or `DRAFT` (whichever predicate level still holds) | `SYSTEM` | `ApplicationStatusHistory` row, student notified that submission is blocked again and why |
| P6 | `READY_TO_SUBMIT` | Student clicks final "Confirm & Submit" with explicit confirmation checkbox checked (`SUBMIT_APPLICATION`, carries a client-generated idempotency key) | `SUBMITTED` | `STUDENT` | Single DB transaction: create `ApplicationProfileSnapshot`, `ApplicationDocumentSnapshot` row(s), `ProgramSnapshot`, `RequirementSnapshot`; set `Application.submittedAt`; insert `ApplicationStatusHistory` row; `AuditLog` entry; enqueue `APPLICATION_SUBMITTED` notification job. See `09-database-architecture.md` §7 "Application → Submission" atomic unit. |
| P7 | `SUBMITTED` | Staff confirms (via the university's own portal/email, since no direct SIS integration exists in v1) that the application has been received into the university's active review queue | `UNDER_REVIEW` | `ADMIN` | `ApplicationStatusHistory` row, `APPLICATION_STATUS_CHANGED` notification |
| P8 | `UNDER_REVIEW` | Staff records that the university has requested additional information/documents | `ADDITIONAL_INFORMATION_REQUIRED` | `ADMIN` | `ApplicationStatusHistory` row, `APPLICATION_STATUS_CHANGED` notification describing exactly what is requested |
| P9 | `ADDITIONAL_INFORMATION_REQUIRED` | Student uploads/attaches the requested supplementary material and confirms submission of it (`SUBMIT_ADDITIONAL_INFORMATION`) | `UNDER_REVIEW` | `STUDENT` | New supplementary `ApplicationDocumentSnapshot` row(s) created (original submission snapshot is **never** edited — see `21` §4), `ApplicationStatusHistory` row, `AuditLog` entry, admin notified |
| P10 | `UNDER_REVIEW` or `ADDITIONAL_INFORMATION_REQUIRED` | Staff records the university's decision | `OFFER_RECEIVED`, `REJECTED`, or `WAITLISTED` | `ADMIN` | `ApplicationStatusHistory` row, `APPLICATION_STATUS_CHANGED` notification with decision + next-step guidance |
| P11 | `WAITLISTED` | Staff records the university's follow-up decision once the waitlist resolves | `OFFER_RECEIVED` or `REJECTED` | `ADMIN` | Same as P10 |
| P12 | `OFFER_RECEIVED` | Student accepts the offer | `OFFER_ACCEPTED` | `STUDENT` | `ApplicationStatusHistory` row, `AuditLog` entry, "what's next" prompt switches to visa-prep guidance |
| P13 | `OFFER_RECEIVED` | Student declines the offer | `OFFER_DECLINED` | `STUDENT` | `ApplicationStatusHistory` row, `AuditLog` entry |
| P14 | `DRAFT`, `READY_FOR_REVIEW`, or `READY_TO_SUBMIT` | Student withdraws before submitting — no cost, no fee ever charged | `WITHDRAWN` | `STUDENT` | `ApplicationStatusHistory` row |
| P15 | `SUBMITTED`, `UNDER_REVIEW`, `ADDITIONAL_INFORMATION_REQUIRED`, or `WAITLISTED` | Student withdraws after submitting (decided elsewhere, e.g. accepted another offer) | `WITHDRAWN` | `STUDENT` | `ApplicationStatusHistory` row, `AuditLog` entry. **Decision:** the application fee is non-refundable once `SUBMITTED` has been reached (it pays for AdmitFlow's processing/snapshotting work regardless of outcome) — refund policy detail lives in Terms of Service, not this doc; withdrawal never triggers an automatic refund. |

**Terminal states:** `WITHDRAWN`, `REJECTED`, `OFFER_ACCEPTED`, `OFFER_DECLINED`. No transition leaves a terminal state.

**Decision:** admission/eligibility requirements (minimum GPA, minimum test score — the factors that produced the Reach/Target/Safe classification) are **advisory, not submission-blocking**. A student may submit a "Reach" application knowing the odds. Only **application requirements** (required documents, required forms/questions, the application fee) are hard-blocking. Rationale: AdmitFlow's role is to make sure what is submitted is complete and verified, not to gatekeep ambition — blocking a Reach submission on eligibility would contradict the "we show you the honest odds, you decide" positioning in `00-project-charter.md`.

---

## 4. Document State

**Entity:** a single `Document` row's lifecycle, tracked per document-slot (a specific `DocumentRequirement` instance for a specific student, or a general vault document not tied to a specific requirement).
**States:** `REQUIRED → MISSING → UPLOAD_INITIATED → UPLOADED → PROCESSING → PENDING_REVIEW → VERIFIED / REJECTED → EXPIRED → REPLACED → DELETED`

| # | From | Event / Trigger | To | Actor | Side effects |
|---|---|---|---|---|---|
| D1 | *(none)* | A `DocumentRequirement` is resolved against a student (either a global vault requirement, e.g. passport, or a program-specific one at application-start time) | `REQUIRED` | `SYSTEM` | Appears in the student's document checklist |
| D2 | `REQUIRED` | No document has been provided yet — this is the resting/computed state shown to the student | `MISSING` | `SYSTEM` | Checklist shows outstanding item |
| D3 | `MISSING` | Student requests a signed upload URL | `UPLOAD_INITIATED` | `STUDENT` | Short-lived (10 min) signed S3 PUT URL issued; `Document` row created in this status |
| D4 | `UPLOAD_INITIATED` | Signed URL expires without a completed upload | `MISSING` | `SYSTEM` | Row marked abandoned or deleted; slot remains open |
| D5 | `UPLOAD_INITIATED` | S3 upload completes and the server confirms the object exists (HEAD check / S3 event) | `UPLOADED` | `SYSTEM` | Enqueue `malware-scan` job (see `24-background-jobs.md`) |
| D6 | `UPLOADED` | `malware-scan` + `document-processing` jobs pick up the object | `PROCESSING` | `SYSTEM` | Job start recorded |
| D7 | `PROCESSING` | Malware scan flags the file, or automated checks find a hard failure (corrupt file, unreadable, wrong file type despite passing extension checks) | `REJECTED` | `SYSTEM` | `DOCUMENT_REJECTED` notification (reason = automated), admin alerted for malware hits, `DocumentAuditLog` entry |
| D8 | `PROCESSING` | All automated checks pass | `PENDING_REVIEW` | `SYSTEM` | Appears in the admin verification queue |
| D9 | `PENDING_REVIEW` | Admin approves | `VERIFIED` | `ADMIN` | `DOCUMENT_VERIFIED` notification, `DocumentAuditLog` entry, triggers application-readiness recompute (P4 in §3) for any application referencing this document type |
| D10 | `PENDING_REVIEW` | Admin rejects with a mandatory reason | `REJECTED` | `ADMIN` | `DOCUMENT_REJECTED` notification with the reason, `DocumentAuditLog` entry |
| D11 | `VERIFIED` | Document's stated validity date passes (e.g. passport expiry, test score validity window) | `EXPIRED` | `SYSTEM` (scheduled job) | Student notified to re-upload; readiness recompute for any active unsubmitted application depending on it |
| D12 | `VERIFIED`, `REJECTED`, or `EXPIRED` | Student uploads a new version of the same document type | `REPLACED` *(applied to the old row; the new row independently begins at D3)* | `STUDENT` | Old row flagged `REPLACED`, remains queryable for history; new row starts its own cycle |
| D13 | `MISSING`, `UPLOADED`, `PENDING_REVIEW`, `VERIFIED`, `REJECTED`, `EXPIRED`, or `REPLACED` | Student or admin deletes the vault copy | `DELETED` | `STUDENT` or `ADMIN` | S3 object removed/tombstoned per retention policy, `DocumentAuditLog` entry. **This transition is blocked** (returns `CONFLICT`) if the document is referenced by an `ApplicationDocumentSnapshot` belonging to a non-`WITHDRAWN`, non-terminal application — see `21-application-management.md` §5 for the exact rule; a submitted document's *snapshot* is never affected by this transition regardless. |

---

## 5. Booking State

**Entity:** `Booking.status` (references an `AvailabilitySlot`)
**States:** `AVAILABLE → RESERVED → CONFIRMED → COMPLETED / CANCELLED / EXPIRED / NO_SHOW`

| # | From | Event / Trigger | To | Actor | Side effects |
|---|---|---|---|---|---|
| B1 | *(none)* | Consultant publishes availability | `AVAILABLE` | `CONSULTANT` | Slot visible in booking search |
| B2 | `AVAILABLE` | Student selects the slot and starts checkout | `RESERVED` | `STUDENT` | `SELECT ... FOR UPDATE` row lock on the slot inside a transaction (see `09-database-architecture.md` §7.3), `Booking` row created, 10-minute hold TTL starts |
| B3 | `RESERVED` | Hold TTL expires without a completed payment | `EXPIRED` | `SYSTEM` | Slot capacity released back to `AVAILABLE` for other students |
| B4 | `RESERVED` | Student abandons/cancels checkout before paying | `CANCELLED` | `STUDENT` | Slot released |
| B5 | `RESERVED` | Payment webhook confirms success | `CONFIRMED` | `EXTERNAL` (via `SYSTEM` reconciliation job) | `BOOKING_CONFIRMED` notification, slot capacity permanently decremented, calendar invite generated |
| B6 | `CONFIRMED` | Student cancels within the policy's minimum-notice window | `CANCELLED` | `STUDENT` | Refund issued per policy, consultant notified |
| B7 | `CONFIRMED` | Consultant cancels (unavailable) | `CANCELLED` | `CONSULTANT` or `ADMIN` | Full refund regardless of notice window, student notified and prompted to rebook |
| B8 | `CONFIRMED` | Scheduled session time passes and the session was held | `COMPLETED` | `SYSTEM` | Consultant prompted for session notes, student prompted for feedback |
| B9 | `CONFIRMED` | Scheduled session time passes and the student did not join | `NO_SHOW` | `ADMIN` or `CONSULTANT` | No-show policy applied (**Decision:** no refund on student no-show, one grace exception per rolling 12 months, rationale: protects consultant-paid time while tolerating a one-off genuine emergency), logged |

---

## 6. Subscription State

**Entity:** `Subscription.status` — **currently a design-for, not build-for, machine**: v1 entitlements are scoped per assessment run (see `01-product-requirements.md` §6, "Entitlement Scoping Decision"), not a recurring subscription. This machine exists now so a future "unlimited access" plan slots into the existing `Product`/`Price`/`Entitlement` model without a redesign.
**States:** `TRIALING → ACTIVE → PAST_DUE → CANCELED / EXPIRED`

| # | From | Event / Trigger | To | Actor | Side effects |
|---|---|---|---|---|---|
| S1 | *(none)* | Student starts a trial (future feature) | `TRIALING` | `STUDENT` | `Subscription` row created |
| S2 | `TRIALING` | Trial ends, first invoice succeeds | `ACTIVE` | `EXTERNAL` (billing provider webhook) | Entitlement granted/extended |
| S3 | `TRIALING` | Trial ends, first invoice fails | `PAST_DUE` | `EXTERNAL` | `PAYMENT_FAILED` notification, dunning sequence starts |
| S4 | `ACTIVE` | Renewal payment fails | `PAST_DUE` | `EXTERNAL` | `PAYMENT_FAILED` notification, dunning sequence starts |
| S5 | `PAST_DUE` | A retried payment succeeds within the dunning window | `ACTIVE` | `EXTERNAL` | Entitlement restored/confirmed |
| S6 | `PAST_DUE` | Dunning window exhausted without a successful payment | `CANCELED` | `SYSTEM` | Entitlement revoked, notification explaining why. **Decision:** `CANCELED` = ended due to non-payment/dunning failure; `EXPIRED` = a fixed-term subscription reached its natural end date without renewal being requested — these are kept distinct so churn analytics can separate "we couldn't collect payment" from "the term simply ended." |
| S7 | `ACTIVE` | Student cancels (effective at period end) | `CANCELED` (scheduled) → terminal at period end | `STUDENT` | Entitlement remains active through the paid period, then revoked |
| S8 | `TRIALING` | Student cancels during trial | `CANCELED` | `STUDENT` | No charge occurs |
| S9 | `ACTIVE` | Fixed-term subscription reaches its end date with no renewal configured | `EXPIRED` | `SYSTEM` | Entitlement revoked, renewal offer surfaced |

---

## 7. Cross-Reference Summary

| Machine | Canonical states | Primary consuming docs |
|---|---|---|
| Account | `REGISTERED, EMAIL_UNVERIFIED, VERIFIED, ONBOARDING, ACTIVE, SUSPENDED, DEACTIVATED, DELETED` | `02-personas-and-roles.md`, `14-security-architecture.md` |
| Document | `REQUIRED, MISSING, UPLOAD_INITIATED, UPLOADED, PROCESSING, PENDING_REVIEW, VERIFIED, REJECTED, EXPIRED, REPLACED, DELETED` | `15-document-vault-security.md`, `21-application-management.md`, `24-background-jobs.md` |
| Application | `DRAFT, READY_FOR_REVIEW, READY_TO_SUBMIT, SUBMITTED, UNDER_REVIEW, ADDITIONAL_INFORMATION_REQUIRED, OFFER_RECEIVED, WAITLISTED, REJECTED, OFFER_ACCEPTED, OFFER_DECLINED, WITHDRAWN` | `21-application-management.md`, `23-notification-system.md`, `24-background-jobs.md` |
| Booking | `AVAILABLE, RESERVED, CONFIRMED, COMPLETED, CANCELLED, EXPIRED, NO_SHOW` | `24-background-jobs.md` (booking-reminders), consultation docs |
| Subscription | `TRIALING, ACTIVE, PAST_DUE, CANCELED, EXPIRED` | future `44-billing-and-subscriptions.md` |

Every state name above is copy-paste canonical. Do not rename, re-case, or abbreviate when referencing these machines elsewhere.
