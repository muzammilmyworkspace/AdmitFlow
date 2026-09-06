# 01 — Product Requirements

**Document status:** Foundational — v1.0
**Depends on:** `00-project-charter.md`, `02-personas-and-roles.md`
**Feeds:** `03-user-journeys.md`, `04-functional-requirements.md`, `05-non-functional-requirements.md`

---

## 1. Purpose and Scope

This document specifies, per module, what a student (and where relevant, consultant/admin) **must be able to do**, what the system **must never do**, and what the UI **must always show**. It also enumerates required system behavior for common real-world failure/edge conditions ("resilience requirements") so that engineers do not have to guess correct behavior when refresh, network, concurrency, or timing issues occur.

Requirement IDs in this document (e.g., `PR-AUTH-1`) are product-level; they are elaborated into testable functional requirements in `04-functional-requirements.md` (`FR-<module>-<n>`).

**Copy Rule (applies everywhere in this document):** Any UI text referencing admission or visa likelihood must use only: *Strong Match*, *High Confidence*, *Safer Options*, *Strong Eligibility*, or equivalent qualified language. The words "guaranteed," "100%," "certain," or "assured" must never appear in relation to admission or visa outcomes anywhere in the product, including transactional emails and marketing pages reachable from the app.

---

## 2. Module: Auth & Account

### Must let a student do
- Create an account with email + password (custom auth, own User/Session tables — no third-party auth provider dependency for core login).
- Verify their email via a time-limited, single-use verification link/code before accessing onboarding beyond basic profile creation.
- Log in, log out, and log out of all sessions/devices.
- Reset a forgotten password via a time-limited, single-use reset link.
- View and revoke active sessions (device/browser/last-active list).
- Update email (with re-verification) and password (with current-password confirmation).
- Delete their account, triggering the data-deletion workflow (subject to legal retention needs, e.g., financial records tied to payments).

### Must NOT
- Must not allow login before email verification for any flow that touches document upload, payment, or application submission (read-only browsing of the public marketing/matching-explainer content is fine pre-verification).
- Must not reveal whether an email is registered on the password-reset request screen (respond identically whether or not the account exists, to prevent account enumeration).
- Must not store passwords in plaintext or with fast, unsalted hashes (see `05-non-functional-requirements.md` and `14-security-architecture.md`).
- Must not allow session tokens to be reused after logout or password change (session invalidation must be immediate and server-enforced).

### Must show
- Clear password strength/requirements at signup.
- Explicit "check your email" state after signup with a resend option (rate-limited).
- Session list with device, approximate location (from IP, best-effort), and last-active time, with a "this device" indicator.

### Resilience requirements
| Scenario | Required behavior |
|---|---|
| User refreshes mid-signup (before email verification) | On next login attempt, system recognizes the unverified account and resumes at "verify your email," not a duplicate-signup error without explanation. |
| User opens two tabs and verifies email in one | The second tab, on next action, re-checks server-side session/verification state rather than trusting stale client state; it must not show "unverified" after a successful verification elsewhere. |
| Session expires mid-action (e.g., mid-document-upload) | The action fails gracefully with a clear "session expired, please log in again" message; in-progress form data is preserved client-side (e.g., local draft) where feasible so the student does not retype everything. |
| User double-clicks "Log In" / "Sign Up" | Request is idempotent or the button is disabled after first click; must not create two accounts or two sessions from one submission. |
| Password reset link used twice | Second use is rejected with a clear "this link has already been used" message; token is single-use and invalidated after first successful reset. |
| Password reset link expired | Clear message with a way to request a new link, not a generic error. |

---

## 3. Module: Onboarding / Profile

### Must let a student do
- Complete a progressive, resumable wizard covering: Education, Destination, Budget, English proficiency, Academic Risk, Preferences (full field detail in the Questionnaire Engine doc — this document only sets product requirements, and the wizard sections must map onto the versioned Questionnaire → Sections → Questions → Options model described there).
- Save partial progress at any point and resume later, on any device, after logging back in.
- Edit any previously answered question before running (or re-running) an assessment.
- See a visible progress indicator (e.g., "Step 3 of 6") at all times.

### Must NOT
- Must not force a student to re-enter previously saved answers after a refresh, tab switch, or brief network drop.
- Must not silently discard an in-progress answer if the student navigates back.
- Must not make any onboarding question mandatory beyond what is needed to run a meaningful assessment (minimize required fields consistent with privacy-first principle) — mark genuinely optional fields as optional in the UI.

### Must show
- Which fields are required vs. optional.
- A clear indication when profile data has changed since the last assessment was run (see cross-module resilience row below).

### Resilience requirements
| Scenario | Required behavior |
|---|---|
| Refresh mid-wizard | Last saved step/answers are restored from the server (autosave per question or per section, not only on "Next"). |
| Two tabs editing onboarding simultaneously | Last-write-wins at the field/section level is acceptable, but the system must not corrupt data into a partially-merged invalid state; on save conflict, the tab with stale data is informed and offered a refresh. |
| Lost internet mid-save | Client retries with backoff; UI shows a non-blocking "saving..." / "changes saved" / "offline — will retry" indicator rather than silently failing. |
| Profile changed after an assessment was already run | The existing assessment result remains valid and viewable exactly as computed (immutable snapshot — see §4), but the UI clearly prompts "Your profile has changed since this assessment — re-run for updated matches," without auto-invalidating the paid unlock tied to the old assessment (see §6 Entitlements scoping). |

---

## 4. Module: Assessment / Matching

### Must let a student do
- Run an eligibility assessment once onboarding has sufficient data (minimum required sections completed).
- View their REACH-zone matches for free, immediately after assessment.
- See, for every match (locked or unlocked), the zone (Reach/Target/Safe) and a plain-language explanation of the primary factors driving that classification (e.g., "Your GPA and IELTS score exceed this program's typical range" ) — transparency is a core principle, not a nice-to-have.
- Re-run the assessment after updating their profile, producing a new, separately stored, versioned result — never overwriting the prior result.
- View their history of past assessment runs.

### Must NOT
- Must never state or imply a guaranteed outcome, in the assessment result or match cards, per the Copy Rule in §1.
- Must never send TARGET/SAFE match details (university name, program name, specific rationale) to the client before purchase — locked content is **omitted from the API response entirely**, replaced only by a count/teaser (e.g., "12 Target matches available"), never sent-then-blurred/CSS-hidden. This is a hard security and integrity requirement, not just UX polish.
- Must not use hardcoded if/else eligibility logic; matching runs through the versioned, configurable weighted scoring engine (see Architecture docs) so that rule changes are auditable and don't require a code deploy.
- Must not silently re-score a past result when scoring rules or university data change — past results are frozen snapshots (§ below).

### Must show
- Zone badges (Reach / Target / Safe) with a one-line definition of each, visible on first use (e.g., a dismissible legend or persistent tooltip):
  - **Reach:** Ambitious — admission is possible but less certain given current profile.
  - **Target:** Strong compatibility with the student's current profile.
  - **Safe:** Higher-confidence compatibility based on current profile — **not** a guarantee of admission.
- The assessment "as of" date/version, and a way to see what changed if re-run.
- A snapshot indicator so a student understands *why* an old assessment might differ from a new one (e.g., "Matches based on your profile as of Jan 3, 2026").

### Snapshot & Reproducibility Requirement (cross-cutting, high priority)
Every assessment result must persist a full, immutable snapshot at the time it was generated: the student's profile data, questionnaire answers, the scoring rules version applied, and the university-dataset version applied. This is required so that:
1. A student's past result can always be explained and reproduced exactly, even after rules/data are later updated.
2. Support/compliance can answer "why did this student see these matches on this date" with certainty.
3. Paid unlocks remain meaningful — a student who paid to unlock TARGET matches for assessment run #1 keeps that access to run #1's results regardless of later rule changes (see §6 for exact entitlement scoping decision).

### Resilience requirements
| Scenario | Required behavior |
|---|---|
| Assessment engine fails/times out mid-run | Student sees a clear failure state with a retry option; no partial/corrupt result is persisted or shown as complete. |
| Profile changes after assessment, student views old result | Old result renders exactly as originally computed (from the snapshot), never recalculated on the fly against current profile data. |
| University data changes after assessment (e.g., a program closes) | Old result still shows the program as it was at assessment time, but the student-facing detail view for that program (if navigated to live) indicates if the program is no longer current, without altering the historical assessment record. |
| Two rapid re-run clicks | Only one assessment run is processed per click; duplicate submissions are deduplicated (e.g., disable button during processing, idempotency key on the request). |

---

## 5. Module: Document Vault

### Must let a student do
- Upload required document types (transcripts, degree certificates, test score reports, passport, financial proof, etc. — exact required set is configurable per destination/program, not hardcoded).
- See the status of each document: `Pending Review`, `Verified`, `Rejected` (with a specific reason), `Expired` (for time-bound documents like language test scores).
- Re-upload a replacement for a rejected or expired document, preserving version history (student and admin can see prior submitted versions and their rejection reasons).
- Download/view their own previously uploaded documents at any time.
- Delete a document they own, provided it is not already attached to a submitted application (see cross-module rule below).

### Must NOT
- Must never expose a public or guessable URL to any document. All document access is via short-lived, signed URLs generated on demand after a server-side authorization check (S3 private buckets only — no public bucket policies, no Supabase Storage).
- Must not allow a document to be permanently deleted if it is referenced by a submitted (non-draft) application — it must be retained for audit/record purposes even if the student wants it hidden from active view (soft-delete / "withdrawn" state, not hard delete, in that case).
- Must not accept files exceeding a configured size/type allowlist without a clear, specific error (not a generic failure).

### Must show
- Upload progress for large files.
- A clear, specific rejection reason for any rejected document (never just "rejected" with no explanation).
- Which documents are required vs. optional for the student's selected destination/programs.
- Expiry countdown for time-bound documents (e.g., language test validity).

### Resilience requirements
| Scenario | Required behavior |
|---|---|
| Double upload of the same document (accidental double submit) | System detects duplicate submission (e.g., disable control during upload, idempotency key) and does not create two pending-review entries for the same slot. |
| Network drop mid-upload | Upload is resumable or cleanly fails with a retry option; no partial/corrupt file is stored or marked "uploaded." |
| Document deleted by student after being referenced elsewhere (e.g., attached to an application already submitted) | Deletion is blocked with an explanit message ("This document is part of a submitted application and cannot be deleted; you can upload a replacement instead") — enforced server-side, not just hidden in UI. |
| Admin rejects a document while student is mid-re-upload of a different one | Each document's state is independent; rejecting one document must not affect the status of others in the same submission batch. |
| Signed URL expires while student is viewing/downloading | Client requests a fresh signed URL transparently (or shows a clear "link expired, click to reload" action) rather than a broken image/404 with no explanation. |

---

## 6. Module: University Discovery / Paywall

### Must let a student do
- Browse REACH matches freely, with full detail (university, program, tuition, location, why it matched).
- See a clear, honest teaser of locked TARGET/SAFE matches (e.g., count and zone, no identifying details) and a clear price to unlock.
- Purchase an unlock via the standard payment flow, immediately gaining access to that assessment run's TARGET/SAFE detail without needing to refresh or re-navigate.
- See what they've already unlocked (their entitlement history) at any time, distinctly from what's still locked.
- Search/filter unlocked and free matches (by country, tuition range, field, etc.).

### Must NOT
- Must never send locked match details to the client and hide them with CSS/blur/frontend gating — this is a data leakage risk (a technical user could read the network response) and a direct violation of the "omit, don't obscure" architecture decision.
- Must not charge twice for the same unlock scope (see idempotency requirement below).
- Must not let an unlock silently expire or be revoked without a clear reason and notification (e.g., a refund-driven revocation must notify the student).

### Must show
- Exact price before purchase confirmation, in the student's configured currency (see NFRs for currency handling), sourced from the live Product/Price config, never a hardcoded string.
- What exactly the unlock covers (e.g., "Unlocks Target & Safe matches for this assessment run") — entitlement scope must be explicit, not implied.
- Payment receipt/confirmation, retrievable later from account history.

### Entitlement Scoping Decision
**Decision:** An unlock entitlement is scoped to a specific **assessment run** (not "all future assessments" and not "lifetime account access"), i.e., `Entitlement` records reference the specific `AssessmentResult.id`. Rationale: this keeps pricing fair and simple (pay to see this set of matches) while remaining technically ready for a future "unlimited access" subscription product, since the generic Product/Price/Entitlement/Subscription model can add a broader-scoped entitlement type later without restructuring the core tables. A re-run assessment after a profile change requires its own unlock unless a future subscription entitlement grants blanket access — this trade-off is called out to students in copy ("Re-running your assessment after a profile update may require unlocking Target/Safe matches again").

### Resilience requirements
| Scenario | Required behavior |
|---|---|
| Double-click "Unlock now" / double payment submission | Idempotency key on the payment intent ensures only one charge and one entitlement grant per logical purchase; if a duplicate charge somehow occurs at the payment provider level, reconciliation must detect and flag it for refund, and the student must never end up charged twice for the same unlock. |
| Payment succeeds but webhook/confirmation is delayed | UI shows a "processing your purchase" state, not a false failure; entitlement is granted once the authoritative payment-confirmed event is received, and the UI polls/updates without requiring a manual refresh. |
| Duplicate webhook delivery from payment provider | Webhook handler is idempotent (keyed by provider event ID) — processing the same event twice must not grant a duplicate entitlement or send duplicate confirmation emails. |
| Student refreshes immediately after successful purchase | Unlocked content is immediately visible (entitlement check reflects true server state), not gated behind stale cached "locked" data. |
| Refund issued by admin/finance after unlock already viewed | Entitlement is revoked going forward with a clear notification to the student explaining why; access to already-downloaded documents/data the student legitimately received is a policy decision left to Terms of Service, but in-app access to locked detail is removed. |

---

## 7. Module: Applications

### Must let a student do
- Start a draft application for a specific matched (or manually added, if allowed) university/program.
- See exactly which documents/info are still missing before submission (a completeness checklist).
- Submit a completed application, triggering the application fee payment as part of (or immediately preceding) submission.
- Track application status through a defined state machine (see below) with timestamps for each transition.
- Withdraw a draft (pre-submission) application at no cost.
- View submitted application content read-only after submission (no silent edits post-submission; corrections go through a defined amendment/resubmission path if the target university allows it).

### Must NOT
- Must not allow submission while required documents are missing or unverified (server-side validation, not just a frontend-disabled button).
- Must not allow two submissions of the same application from a double-click/double-tap (idempotent submission).
- Must not silently drop an application if the payment fails after documents were "submitted" client-side — submission and payment success are coupled such that a failed payment leaves the application in `Draft — Payment Failed`, never falsely in `Submitted`.

### Application State Machine (v1)
```
Draft → Ready for Submission → Submitting (payment in flight) → Submitted
Submitted → Under Review (optional, if AdmitFlow-side review is enabled)
Submitted/Under Review → Decision: Offer / Rejected / Waitlisted
Offer → Accepted / Declined
Draft → Withdrawn (student-initiated, pre-submission only)
Submitting → Draft (Payment Failed) [on payment failure, returns to draft with reason]
```

### Must show
- A visual status tracker (not just a text label) so the student always knows where they stand.
- Missing-item checklist before submission is enabled.
- Application fee amount and what it covers, before the student commits to pay.
- Decision outcome, including next-step guidance (e.g., an Offer transitions the student's "what's next" prompt to visa prep).

### Resilience requirements
| Scenario | Required behavior |
|---|---|
| Refresh mid-submission (payment processing) | UI re-checks true server-side application/payment state on load rather than assuming failure; must not show a false "failed" while a payment is actually still processing, and must not allow a second submission attempt while one is in flight. |
| Double-click submit | Submission request is idempotent (idempotency key); only one application-fee charge and one `Submitted` transition occurs. |
| Double payment for the same application fee | Same idempotency protection as unlocks (§6); provider-level duplicate charges must be detected and reconciled, never silently kept. |
| Session expires mid-application-form-fill | Draft data is autosaved server-side as the student progresses (not only at submission), so re-login resumes from the last saved point, not from zero. |
| Wrong permission/role attempts to view/modify an application | Server returns an authorization error (403/404-style, not leaking existence of the resource to unauthorized users) — a student can never fetch another student's application by ID. |
| A document attached to a submitted application is later deleted | Not permitted (see §5) — application integrity requires attached documents to remain retrievable for as long as the application record exists. |
| Timezone change (student travels or changes device timezone) between viewing a deadline and submission | Deadlines are stored in UTC and rendered in the student's *current* locale/timezone setting consistently; the countdown/deadline shown must reflect the same absolute UTC instant regardless of which timezone is currently active on the viewing device. |

---

## 8. Module: Consultations

### Must let a student do
- Browse consultant profiles (specialty, rating, price, available times shown in the student's local timezone).
- Book an available slot and pay the consultation fee as part of booking confirmation.
- Reschedule or cancel within a defined policy window (e.g., configurable minimum notice period), receiving a refund per policy if cancelled in time.
- Join the session via a provided link at the scheduled time.
- View session history and any notes the consultant leaves afterward.

### Must NOT
- Must not allow booking a slot that has just been taken by another student (double-booking) — slot locking/availability must be authoritative server-side at confirmation time, not just at initial display.
- Must not charge for a booking that fails to actually reserve the slot (payment and slot reservation must be atomic/compensating — if the slot becomes unavailable after payment starts, the payment must not be captured, or must be automatically refunded).
- Must not give the consultant access to student data beyond what's needed for that specific booking (see `02-personas-and-roles.md` §3).

### Must show
- All times in the **student's** local timezone, clearly labeled, with the consultant's timezone context available if helpful (e.g., "3:00 PM your time (Berlin) — 6:00 PM consultant's time (Dubai)").
- Cancellation/refund policy before booking confirmation.
- Clear confirmation with a calendar-addable event.

### Resilience requirements
| Scenario | Required behavior |
|---|---|
| Two students attempt to book the same slot simultaneously | Only one booking succeeds; the second sees an immediate "this slot was just taken, please choose another" message rather than a false success or a silent double-booking. |
| Double-click "Confirm & Pay" | Idempotent booking request; one charge, one booking. |
| Payment succeeds but booking confirmation write fails | System must reconcile — either the booking is created from the confirmed payment record (compensating action) or the payment is automatically refunded; a student must never pay with no resulting booking and no refund. |
| Student's timezone changes between booking and session (e.g., travel) | The session time is stored as an absolute UTC instant; the display recalculates to the student's *current* timezone setting so the countdown/reminder is always correct, never "frozen" to the timezone at booking time. |
| Consultant cancels | Student is notified immediately, automatically refunded (or offered rebooking) per policy, and the slot is not left ambiguously "booked" in either party's view. |

---

## 9. Module: Payments / Entitlements

### Must let a student do
- Pay via supported methods for unlocks, application fees, and consultations through one consistent, trusted checkout experience.
- View a full, exportable history of charges and resulting entitlements/receipts.
- Understand exactly what each historical charge was for (linked to the specific assessment run, application, or booking).

### Must NOT
- Must never represent an entitlement as a boolean flag on the user (e.g., no `user.hasUnlockedTarget`) — entitlements are always modeled via the generic Product/Price/Entitlement/Subscription tables so scope, expiry, and future subscription products are representable without schema change.
- Must not process a payment without an idempotency key tied to the specific student action (unlock purchase, application fee, booking).
- Must not retain full raw payment card data on AdmitFlow's own servers (payment processor handles card data; AdmitFlow stores only processor references/tokens).

### Must show
- Currency clearly, matching the student's configured currency/locale (see NFRs).
- Refund status and timeline when applicable.

### Resilience requirements (consolidated — see also §6, §7, §8 for context-specific variants)
| Scenario | Required behavior |
|---|---|
| Duplicate webhook delivery (any payment event) | Idempotent processing keyed by provider event ID across all payment types (unlock, application fee, consultation) — never double-grant, double-charge-record, or double-notify. |
| Payment provider outage mid-checkout | Student sees a clear "payment temporarily unavailable, please try again shortly" state; no partial entitlement is granted; the attempted charge is not silently retried without student awareness. |
| Currency/locale mismatch (e.g., student's account currency changes between quote and payment) | Price is locked at the point checkout begins (a short-lived quote) and honored through completion of that specific transaction; a stale quote beyond a defined window is refreshed rather than silently charged at a changed rate. |

---

## 10. Module: Notifications

### Must let a student do
- Receive timely notifications (email at minimum in v1; in-app notification center) for: verification email, document verified/rejected, assessment complete, purchase confirmation, application status changes, consultation booking/reminder/cancellation, and account security events (password changed, new device login).
- Configure non-critical notification preferences (e.g., marketing/tips emails opt-out) — security and transactional notifications (payment receipts, verification, password changes) are never optional.

### Must NOT
- Must not send a notification containing another student's data (obvious, but explicitly required given templating systems can leak cross-user data if not scoped correctly per send).
- Must not send duplicate notifications for the same event due to retries/duplicate job processing (background jobs must be idempotent — see BullMQ job design in architecture docs).

### Must show
- An in-app notification center with read/unread state.
- Clear, actionable notification content (link directly to the relevant application/document/booking, not just to a generic dashboard).

### Resilience requirements
| Scenario | Required behavior |
|---|---|
| Background worker retries a failed notification job | Retry must not result in duplicate emails/notifications for the same logical event (idempotency key per notification event). |
| Student's timezone/locale changes after a scheduled reminder (e.g., consultation reminder) was queued | Reminder content reflects the correct absolute time; if the underlying event time is unchanged, the reminder is still accurate because it was scheduled against a UTC instant, not a pre-rendered local-time string. |

---

## 11. Module: Admin

### Must let an admin do
- Review a queue of pending documents and verify/reject with a mandatory reason.
- View and update application statuses reflecting real-world university decisions not otherwise automated.
- Grant/adjust/revoke entitlements manually with a mandatory reason (fully audit-logged).
- Manage university/program catalog content and questionnaire content (content, not scoring policy, unless also SUPER_ADMIN).
- Search/filter students, applications, documents, and payments for support purposes, with all such access logged.

### Must NOT
- Must not take any action without it being attributable (actor, timestamp, reason) in the audit log — no admin action is "invisible."
- Must not bulk-export student PII without a permission specifically scoped to that action (separate from general admin access).
- Must not permanently delete audit log entries.
- Must not modify a submitted application's substantive content on the student's behalf without it being visible to the student as an admin-attributed change.

### Must show
- Queue counts and SLAs (e.g., "14 documents pending review, oldest 2 days old") so verification backlogs are visible, not hidden.
- Full audit trail for any record an admin is viewing (who changed what, when).

### Resilience requirements
| Scenario | Required behavior |
|---|---|
| Two admins act on the same pending document simultaneously | Optimistic concurrency control (e.g., version check) ensures the second admin's action is rejected with a clear "already actioned by [admin] at [time]" message, not a silent overwrite. |
| Admin grants an entitlement, then the underlying payment is found to be fraudulent/reversed | Revocation flow exists, is logged, and triggers the standard student notification (§6, §9). |
| Wrong-permission access attempt (e.g., a CONSULTANT session token used to hit an admin API route) | Server-side authorization rejects the request regardless of any frontend route restrictions; this must be true even if a frontend bug would have rendered the admin UI. |

---

## 12. Cross-Cutting "What Happens If..." Requirements Index

For traceability, every resilience scenario named in the prompt is covered above; this index maps each to its section for quick lookup:

| Scenario | Section |
|---|---|
| Refresh mid-flow | §2 (auth), §3 (onboarding), §7 (application) |
| Two tabs open | §2 (auth), §3 (onboarding) |
| Lost internet | §3 (onboarding), §5 (upload) |
| Double-click submit | §2, §4, §5, §6, §7, §8 (per module) |
| Double payment | §6, §7, §8, §9 |
| Double upload | §5 |
| Expired session | §2, §3, §7 |
| Wrong permission/role | §7, §11 (and universally per `02-personas-and-roles.md` §7) |
| Profile changed after assessment | §3, §4, §6 |
| Document deleted | §5, §7 |
| Timezone change | §7, §8, §10 |
| Duplicate webhook | §6, §9, §10 |

## 13. Related Documents

- `03-user-journeys.md` — narrative walkthroughs implementing these requirements
- `04-functional-requirements.md` — testable FR-per-module breakdown
- `05-non-functional-requirements.md` — performance/security/accessibility bar these requirements must be delivered within
