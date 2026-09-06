# 21 — Application Management

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering
**Depends on:** `31-state-machines.md` (canonical state names — reproduced here), `09-database-architecture.md` (snapshot storage, transaction boundaries), `06-system-architecture.md` (worker split), `02-personas-and-roles.md` (actor definitions)
**Applies to:** The Applications module end to end — draft creation through final outcome

---

## 1. Scope

This document defines the full lifecycle of a student's application to a specific university/program: what "ready to submit" means as a checkable predicate, the full state machine and its side effects, the submission-snapshot mechanism and why it exists, and the explicit "what happens if..." resilience requirements engineers must build against. It does not define the notification templates fired at each transition (`23-notification-system.md`) or the background jobs that process documents feeding into an application (`24-background-jobs.md`).

## 2. Pre-Submission Readiness: the "Ready to Submit" Predicate

**One-click "Apply" must never mean submitting incomplete or unverified information.** Before the `SUBMIT_APPLICATION` action is even offered to the student, the system evaluates a single server-side predicate, `isReadyToSubmit(applicationId)`, which is the logical AND of five conditions. All five are re-checked **again, authoritatively, inside the submit transaction itself** — the precomputed `READY_TO_SUBMIT` status is a UX convenience, never the actual authorization check.

| # | Condition | Definition | Blocking? |
|---|---|---|---|
| 1 | **Profile completeness** | Every profile field the target program's requirement set depends on (personal info, academic history, standardized test scores, financial declaration, passport/nationality) is present and non-null on the student's *current* `Profile`/`OnboardingProfile` as of the check. | Yes |
| 2 | **Document completeness** | For every `DocumentRequirement` resolved for this program (via `ProgramRequirement`), the student has at least one linked `Document` in status `VERIFIED` (see `31-state-machines.md` §4). **Decision:** `PENDING_REVIEW` or `UPLOADED` documents do **not** satisfy this condition — only `VERIFIED` does. Rationale: the locked architecture principle is explicit that one-click Apply must never submit *unverified* information; accepting merely-uploaded documents would silently reintroduce that risk. The trade-off (verification turnaround time gates submission) is accepted and surfaced to the student as an explicit "awaiting verification" checklist state, not hidden. | Yes |
| 3 | **Application requirements** | Non-document requirements from the program's requirement set are satisfied: required free-text answers present (e.g. statement of purpose meeting a minimum word count), required counts met (e.g. "2 recommendation letters" — checked as a count of `VERIFIED` documents of that sub-type, not just 2 uploads). | Yes |
| 4 | **Payment** | If the program/university configures an application fee (`Product`/`Price` record, see `01-project-requirements.md`/`00-project-charter.md` §"Application fee"), the corresponding `Payment` for this specific application is in a confirmed/settled state. If no fee applies, this condition is vacuously true. **Decision:** fee payment is resolved *before* the student reaches `READY_TO_SUBMIT`, as its own asynchronous checkout+webhook flow (per `06-system-architecture.md` §4) — it is not bundled synchronously into the final submit click. Rationale: payment confirmation is only ever authoritative via a signature-verified webhook processed by the worker; performing it "at submit time" inside a request handler would violate the runtime split and reintroduce a synchronous external dependency into the request path. | Yes |
| 5 | **Explicit student confirmation** | A confirmation checkbox/affirmation ("I confirm the information and documents in this application are accurate and I am ready to submit") is checked **in the same request** that triggers submission. This is never pre-recorded or defaulted — it is captured fresh with a timestamp and stored on the resulting `ApplicationStatusHistory` row. | Yes (gate on the action itself, not a precomputed flag) |

`isReadyToSubmit()` (conditions 1–4) is recomputed by the system on every event that could change its answer: profile field saved, document status change (`VERIFIED`/`REJECTED`/`EXPIRED`/`DELETED`), payment status change. Each recomputation may move the application between `DRAFT`, `READY_FOR_REVIEW`, and `READY_TO_SUBMIT` per the transition table in §3. Condition 5 is never part of the precomputed status — it only exists at the moment of the `SUBMIT_APPLICATION` call.

## 3. Application State Machine

**States and transition table are canonical in `31-state-machines.md` §3.** Reproduced here verbatim for narrative context; if this table and `31` ever diverge, `31` is correct.

```
DRAFT ──(content complete)──▶ READY_FOR_REVIEW ──(full predicate incl. payment)──▶ READY_TO_SUBMIT
  ▲__________________________________|                                                    |
  |  (predicate breaks: field cleared, doc rejected, payment voided)                       | SUBMIT_APPLICATION
  |                                                                                          | (student, explicit confirm)
  |                                                                                          ▼
  |                                                                                     SUBMITTED
  |                                                                                          | (admin confirms university intake)
  |                                                                                          ▼
  |                                                                                   UNDER_REVIEW ◀────────────┐
  |                                                                                          |                    |
  |                                                                          (university requests more info)     | (student submits
  |                                                                                          ▼                    |  supplementary docs)
  |                                                                     ADDITIONAL_INFORMATION_REQUIRED ──────────┘
  |                                                                                          |
  |                                                                     (university decision recorded by admin)
  |                                                                                          ▼
  |                                                                     OFFER_RECEIVED / REJECTED / WAITLISTED
  |                                                                                          |
  |                                                                              (student responds to offer)
  |                                                                                          ▼
  |                                                                         OFFER_ACCEPTED / OFFER_DECLINED
  |
  └── WITHDRAWN (student-triggered; reachable from DRAFT, READY_FOR_REVIEW, READY_TO_SUBMIT at no cost,
                 and from SUBMITTED / UNDER_REVIEW / ADDITIONAL_INFORMATION_REQUIRED / WAITLISTED post-submission,
                 fee non-refundable once SUBMITTED)
```

| From | Event/Trigger | To | Actor | Side effects |
|---|---|---|---|---|
| — | Student starts application from a matched program | `DRAFT` | STUDENT | `Application` row created; `ApplicationStatusHistory` row; `AuditLog` entry |
| `DRAFT` | Content-completeness reached (§2 items 1–3) | `READY_FOR_REVIEW` | SYSTEM | `ApplicationStatusHistory` row |
| `READY_FOR_REVIEW` | Completeness breaks | `DRAFT` | SYSTEM | `ApplicationStatusHistory` row |
| `READY_FOR_REVIEW` | Full predicate true (§2 items 1–4) | `READY_TO_SUBMIT` | SYSTEM | `ApplicationStatusHistory` row; "Submit" enabled |
| `READY_TO_SUBMIT` | Predicate breaks (refund, re-rejected doc) | `DRAFT` / `READY_FOR_REVIEW` | SYSTEM | `ApplicationStatusHistory` row; student notified submission is blocked again |
| `READY_TO_SUBMIT` | `SUBMIT_APPLICATION` (confirmation checked, idempotency key) | `SUBMITTED` | STUDENT | Snapshot transaction (§4), `ApplicationStatusHistory` row, `AuditLog` entry, `APPLICATION_SUBMITTED` notification enqueued |
| `SUBMITTED` | Staff confirms university received it | `UNDER_REVIEW` | ADMIN | `ApplicationStatusHistory` row, `APPLICATION_STATUS_CHANGED` notification |
| `UNDER_REVIEW` | University requests more info | `ADDITIONAL_INFORMATION_REQUIRED` | ADMIN | `ApplicationStatusHistory` row, notification detailing the request |
| `ADDITIONAL_INFORMATION_REQUIRED` | Student submits requested materials | `UNDER_REVIEW` | STUDENT | New supplementary `ApplicationDocumentSnapshot` row(s) (§4); `ApplicationStatusHistory` row |
| `UNDER_REVIEW` / `ADDITIONAL_INFORMATION_REQUIRED` | University decision recorded | `OFFER_RECEIVED` / `REJECTED` / `WAITLISTED` | ADMIN | `ApplicationStatusHistory` row, notification with decision + next steps |
| `WAITLISTED` | Waitlist resolves | `OFFER_RECEIVED` / `REJECTED` | ADMIN | Same as above |
| `OFFER_RECEIVED` | Student responds | `OFFER_ACCEPTED` / `OFFER_DECLINED` | STUDENT | `ApplicationStatusHistory` row, `AuditLog` entry |
| `DRAFT`/`READY_FOR_REVIEW`/`READY_TO_SUBMIT` | Student withdraws | `WITHDRAWN` | STUDENT | `ApplicationStatusHistory` row, no charge |
| `SUBMITTED`/`UNDER_REVIEW`/`ADDITIONAL_INFORMATION_REQUIRED`/`WAITLISTED` | Student withdraws | `WITHDRAWN` | STUDENT | `ApplicationStatusHistory` row, `AuditLog` entry, fee non-refundable |

## 4. The Snapshot Mechanism

**What freezes at submit time, and why.** The moment `SUBMIT_APPLICATION` succeeds (transition to `SUBMITTED`), the system creates four immutable JSON snapshot rows in the same database transaction as the status change (see `09-database-architecture.md` §7, "Application → Submission" atomic unit):

| Snapshot | What it freezes |
|---|---|
| `ApplicationProfileSnapshot` | A full copy of the student's `Profile`/`OnboardingProfile` fields relevant to this application, exactly as they existed at the submit instant. |
| `ApplicationDocumentSnapshot` | For each document backing this application, a copy of the document's metadata (filename, checksum, S3 object version, verification status, verifiedAt, verifiedBy) — **not** a copy of the file bytes, which remain a single S3 object referenced by key/version. |
| `ProgramSnapshot` | A copy of the target program's details (tuition, intake dates, admission requirements as displayed) as of submission. |
| `RequirementSnapshot` | A copy of the resolved `ProgramRequirement`/`DocumentRequirement` list that was used to compute readiness — the exact requirement wording and cardinality that governed this submission. |

**Why this exists, in application terms:** everything upstream of submission is live and editable — a student can update their GPA after an assessment, a university can revise its requirement list next intake, a document can be replaced. None of that may ever retroactively change what a *submitted* application says it contained. An admissions officer, a support agent investigating a dispute, or the student themselves six months later must be able to see **exactly** what was submitted, unaffected by anything that happened afterward. This is the same reproducibility principle already applied to `AssessmentSnapshot` (see `00-project-charter.md` §5, non-negotiable #5) extended to applications.

**Consequence:** after `SUBMITTED`, the application's read-only "submitted view" always renders from the snapshot rows, never by re-joining the student's live `Profile`/`Document`/`Program` tables. The live tables continue to serve the *current* profile/vault/catalog elsewhere in the product; they simply stop being the source of truth for this specific application's history.

## 5. `ADDITIONAL_INFORMATION_REQUIRED` Without Corrupting the Original Snapshot

When a university requests more information, the loop back to the student (`UNDER_REVIEW → ADDITIONAL_INFORMATION_REQUIRED → UNDER_REVIEW`, P8/P9 in `31-state-machines.md`) must never touch the original submission snapshot rows. The rule:

- The original `ApplicationProfileSnapshot`/`ApplicationDocumentSnapshot`/`ProgramSnapshot`/`RequirementSnapshot` rows created at P6 are **never updated, never deleted, never re-derived**.
- Supplementary material the student provides in response to an info request is stored as **new, additional** `ApplicationDocumentSnapshot` rows (and, if free-text answers are requested, a new `ApplicationSupplementaryResponse`-style row), each tagged with the `ApplicationStatusHistory` event that requested it and the one that fulfilled it.
- The application's full history is therefore always reconstructable as: "what was true at submission" (original snapshot, immutable) plus "what was added afterward, and why, and when" (a chronological list of supplementary snapshot rows) — never a single mutated blob that has lost the distinction between the two.

**Decision:** this is an additive-only model, never an in-place edit, even when the supplementary material replaces something in spirit (e.g. a corrected transcript). Rationale: legal/audit integrity requires being able to answer "what did the student originally submit" forever, independent of any later correction — the same rule already applied to soft-delete/audit tables in `09-database-architecture.md` §6.3.

## 6. "What Happens If..." — Resilience Requirements

These are binding requirements, not suggestions. Each row states the required system behavior.

| Scenario | Required behavior |
|---|---|
| **Double-submit** — student double-clicks Submit, or has two browser tabs open on the same `READY_TO_SUBMIT` application and submits from both | The `SUBMIT_APPLICATION` request carries a client-generated idempotency key (UUID minted client-side when the confirm dialog opens). The server enforces idempotency at two layers: (1) the state-machine guard — only an application in `READY_TO_SUBMIT` accepts this event; a second concurrent request finds the row already transitioned (via `SELECT ... FOR UPDATE` inside the submit transaction, consistent with the `version` optimistic-concurrency column already carried on `Application` per `09-database-architecture.md` §6.4) and returns the **existing** `SUBMITTED` result rather than erroring or re-submitting; (2) a unique constraint on `(applicationId, idempotencyKey)` on the submission-attempt record, so even a network-retried identical request is a no-op. **A disabled submit button is a UX nicety, never the actual control.** |
| **Submit, then immediately close the browser** | Submission is a single server-side transaction (§4) that completes independently of the client connection. By the time the client receives (or fails to receive) the response, the transaction has either fully committed (snapshot created, status = `SUBMITTED`) or fully rolled back (status unchanged, no partial snapshot). On next load, the application's true state is read from the server — there is no client-side "assume success" or "assume failure" logic. |
| **Submit, then the student's profile changes afterward** | No effect on the submitted application. The submitted view renders from `ApplicationProfileSnapshot`, not the live `Profile`. The student may still edit their live profile for future applications/assessments; this one is frozen. |
| **Submit, then a submitted/snapshotted document is later deleted from the vault** | **Decision: this cannot corrupt a submitted application, by construction.** `ApplicationDocumentSnapshot` stores its own copy of the document's metadata and references the S3 object by key **and version** (S3 versioning enabled on the document bucket, see `15-document-vault-security.md`). A student-initiated "delete" of a document that is referenced by a non-terminal, non-`WITHDRAWN` application's snapshot is **blocked at the API layer** (`CONFLICT`, see `29-error-handling.md`) — the student cannot delete the live vault row while it backs an active application. If the application has reached a terminal state (`WITHDRAWN`, `REJECTED`, `OFFER_ACCEPTED`, `OFFER_DECLINED`), deletion of the *live* vault copy is permitted, but it removes only the live `Document` row/S3 object going forward — the `ApplicationDocumentSnapshot`'s own metadata row and the specific S3 object version it points to are retained per the document retention schedule (`09-database-architecture.md` §8) regardless, so the submitted application's historical record is never affected. |
| **Payment succeeds but the webhook confirmation is delayed** | The application stays at whatever status it was in before payment (typically `READY_FOR_REVIEW`), showing a "processing payment" state, not `READY_TO_SUBMIT` and not a false failure. It flips to `READY_TO_SUBMIT` only once the worker's reconciliation job commits the payment-confirmed state, consistent with `06-system-architecture.md` §4. |
| **Payment fails** | Application remains below `READY_TO_SUBMIT` (payment condition unmet). No status value equivalent to the old "Draft — Payment Failed" sketch is needed under this state machine — the readiness predicate simply stays false with a specific, student-visible reason ("Application fee payment failed — try again"), which is a checklist detail, not a distinct `Application.status` enum value. |
| **Two admins act on the same application simultaneously** (e.g. both try to record a university decision) | Optimistic concurrency (`Application.version`) ensures the second write is rejected with "already actioned by [admin] at [time]," never a silent overwrite — same pattern as document double-verification in `01-product-requirements.md` §"Documents." |
| **Wrong role/ownership attempts to view or act on an application** | Server returns an authorization error without confirming the resource exists to an unauthorized caller (see `02-personas-and-roles.md` §7, object-level isolation; `29-error-handling.md` for the exact status codes). |
| **Session expires mid-form-fill (pre-submission)** | Draft fields are autosaved server-side as the student progresses (debounced field-level saves), not only at submission. Re-login resumes from the last saved point. |
| **Timezone differences on deadlines** | All deadlines are stored in UTC (`timestamptz`); the UI renders them in the recipient's current timezone setting, consistently, per `23-notification-system.md` §2 and the platform-wide UTC rule. |

## 7. Relationship to Other Documents

- `31-state-machines.md` — canonical state names/transitions (this doc must match it exactly).
- `23-notification-system.md` — the notification fired at each transition marked above.
- `24-background-jobs.md` — `application-reminders` and `deadline-alerts` jobs that watch `DRAFT`/`READY_FOR_REVIEW`/`READY_TO_SUBMIT` applications against program deadlines.
- `09-database-architecture.md` — snapshot table storage rationale (JSON columns), transaction boundaries, `version` optimistic concurrency.
- `15-document-vault-security.md` — document deletion rules, S3 versioning, retention.
- `29-error-handling.md` / `30-validation-rules.md` — error codes and validation used by the readiness checks in §2.
