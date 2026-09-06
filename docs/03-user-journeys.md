# 03 — User Journeys

**Document status:** Foundational — v1.0
**Depends on:** `00-project-charter.md`, `01-product-requirements.md`, `02-personas-and-roles.md`

---

## 1. Purpose

This document walks through five representative journeys step by step, including decision points, failure/edge paths, and where audit logging or notifications must fire. Each step lists the **student/actor action** and the **system response**. These journeys are the reference for QA test-case design and for UI flow design; they must stay consistent with `01-product-requirements.md`.

Notation: **[LOG]** = audit log entry required. **[NOTIFY]** = notification fires (email and/or in-app).

---

## 2. Journey A: New Student Signup → First Assessment → First Unlock Purchase

1. Student lands on marketing/homepage, clicks "Get Started."
2. Student enters email + password. **System:** validates password strength client- and server-side, creates a `User` record in `Unverified` state, creates a `Session`. **[LOG]** account created. **[NOTIFY]** verification email sent.
3. Student is routed to "Check your email" screen. **Decision point:** does the student verify immediately or later?
   - **Path 2a (verifies now):** clicks link in email → system validates single-use token → marks account `Verified` → redirects to onboarding wizard. **[LOG]** email verified.
   - **Path 2b (closes tab, returns later):** logs in later with unverified account → system shows "please verify your email" with a resend option (rate-limited) rather than blocking login entirely for read-only areas.
   - **Failure path:** token expired → system shows "link expired" with a one-click resend, not a dead end.
4. Student begins onboarding wizard: Education → Destination → Budget → English → Academic Risk → Preferences. Each section autosaves on completion (and periodically within a section for long free-text fields).
   - **Decision point:** student closes the browser mid-wizard. On return, wizard resumes exactly at the last saved section, not from step 1.
5. Student completes minimum required sections and reaches "Run Assessment." **System:** validates required fields are present server-side (not just frontend-gated); if incomplete, shows exactly which fields are missing.
6. Student clicks "Run Assessment." **System:** enqueues an assessment job (or runs synchronously if fast enough) against the versioned scoring engine, using the current questionnaire answers, current scoring-rules version, and current university-dataset version. **[LOG]** assessment run created, with version metadata recorded in the snapshot.
   - **Failure path:** engine error/timeout → student sees "something went wrong, try again" with a retry button; no partial result is saved as complete.
7. Assessment completes. Student sees REACH-zone matches immediately and in full detail, plus a locked-content teaser: "12 Target matches and 5 Safe matches available — Unlock for €9.99."
   - System explicitly renders zone definitions (Reach/Target/Safe) with the "not a guarantee" disclaimer visible near Safe-zone messaging.
8. Student clicks "Unlock Target & Safe Matches." **System:** shows exact price (from live Product/Price config, in student's currency) and what it covers (this specific assessment run) before confirming.
9. Student confirms and enters payment details (or uses a saved method). **System:** creates a payment intent with an idempotency key tied to (student, assessment run, product).
   - **Decision point — double-click:** if the student double-clicks "Pay," the second click is a no-op against the same idempotency key; only one charge occurs.
10. Payment succeeds. **System:** payment provider webhook (idempotent, keyed by provider event ID) confirms payment → creates an `Entitlement` scoped to this `AssessmentResult.id` → unlocks TARGET/SAFE detail. **[LOG]** payment succeeded, entitlement granted. **[NOTIFY]** purchase confirmation + receipt emailed.
    - **Failure path — webhook delayed:** UI shows "processing your purchase..." and polls/updates automatically once the webhook lands, rather than a false failure.
    - **Failure path — payment fails:** student sees the specific decline reason where the processor provides one, and is returned to the payment step without having lost their assessment result.
11. Student now sees full TARGET/SAFE match detail with rationale for each, without needing to refresh.

**Key resilience notes:** every idempotency point above maps to `01-product-requirements.md` §6/§9. Object-level isolation ensures nothing here ever exposes another student's assessment or payment data.

---

## 3. Journey B: Document Upload → Verification → Rejection → Re-upload

1. Student navigates to Document Vault; sees a checklist of required documents for their selected destination/programs (configurable per destination, not hardcoded).
2. Student selects "Transcript" slot, chooses a file, uploads. **System:** validates type/size client-side first (fast feedback) and again server-side (authoritative); streams to S3 private bucket via a pre-signed upload URL scoped to that student and document slot. **[LOG]** document uploaded (metadata only — not content — in the log).
   - **Failure path — network drop mid-upload:** upload fails cleanly with a retry option; no partial file is recorded as `Pending Review`.
   - **Failure path — double submit:** control is disabled during upload and an idempotency key prevents two `Pending Review` entries for the same slot.
3. Document enters `Pending Review` state. Student sees this status immediately; admin queue count increments.
4. Admin opens the document review queue (sorted oldest-first per SLA visibility requirement), opens the student's transcript. **System:** generates a short-lived signed URL for the admin to view the file; access is logged. **[LOG]** admin viewed document.
5. **Decision point — admin verifies or rejects:**
   - **Path 5a (Verified):** admin marks `Verified`. **[LOG]** document verified (admin id, timestamp). **[NOTIFY]** student notified document verified.
   - **Path 5b (Rejected):** admin marks `Rejected` and **must** enter a specific reason (e.g., "Document is not in English and no certified translation was attached"). **[LOG]** document rejected with reason. **[NOTIFY]** student notified with the specific reason, not a generic "rejected."
6. Student sees `Rejected` status with the reason, and a "Re-upload" action on the same slot.
7. Student uploads a replacement file. **System:** preserves the prior rejected version in history (both student and admin can see it and the original reason) and creates a new `Pending Review` entry for the same slot, versioned. **[LOG]** new version uploaded referencing prior version.
8. Cycle repeats from step 4 until `Verified`, or the student proceeds without that document if it is optional for their chosen path.
   - **Edge case:** student attempts to delete the rejected document instead of replacing it, after it has already been referenced by a submitted application elsewhere. **System:** blocks hard deletion with an explanatory message (per `01-product-requirements.md` §5); the student can still upload a replacement version.

---

## 4. Journey C: University Selection → Application Submission → Status Tracking → Offer

1. Student browses unlocked TARGET matches, selects a program, clicks "Start Application."
2. **System:** creates a `Draft` application, pre-populates known fields from the student's profile/documents, and shows a live completeness checklist (missing documents, missing profile fields, required program-specific questions).
3. Student fills remaining program-specific questions and attaches/confirms required documents (reusing already-verified vault documents where applicable — no redundant re-upload required).
4. Student reaches "Ready for Submission" once the checklist is fully green. **System:** enables the Submit action only when server-side validation independently confirms completeness (not solely a frontend check).
5. Student clicks "Submit Application." **System:** transitions application to `Submitting`, initiates the application fee payment (idempotency key tied to this specific application) as part of the same flow.
   - **Decision point — double-click submit:** idempotent submission ensures only one fee charge and one `Submitted` transition.
   - **Failure path — payment fails:** application returns to `Draft — Payment Failed` with the specific reason; no false `Submitted` state is ever shown.
6. Payment succeeds. **System:** application transitions to `Submitted`, timestamped. **[LOG]** application submitted, fee charged. **[NOTIFY]** submission confirmation with receipt.
7. Student tracks status on a visual tracker: `Submitted` → (optionally `Under Review`) → `Decision Pending`.
8. **Decision point — outcome varies:**
   - **Path 8a (Offer):** admin (or automated import, future) updates status to `Offer`. **[LOG]** status change (actor, timestamp, source). **[NOTIFY]** student notified immediately; "what's next" prompt shifts to visa prep guidance.
   - **Path 8b (Rejected):** status updates to `Rejected`. **[NOTIFY]** student notified with any feedback available; UI gently surfaces remaining REACH/TARGET/SAFE options rather than a dead end.
   - **Path 8c (Waitlisted):** status updates to `Waitlisted`; student is told this is not a rejection and to expect a further update, with an estimated timeframe if known.
9. Student accepts the offer. **System:** records `Accepted` with timestamp, triggers visa-prep checklist activation. **[LOG]** offer accepted. **[NOTIFY]** confirmation + visa-prep next steps.

**Edge case — timezone/deadline:** the program's application deadline is stored in UTC; regardless of the student's device timezone at any point in this journey, the countdown shown always reflects the same absolute instant (see `01-product-requirements.md` §7).

---

## 5. Journey D: Consultation Discovery → Booking → Payment → Session

1. Student navigates to Consultations, browses consultant profiles filtered by specialty (e.g., "US Graduate Admissions").
2. Student opens a consultant's profile, sees available slots rendered in the student's local timezone (with the consultant's timezone shown alongside for context).
3. Student selects a slot, sees the fee (~€30/40 min illustrative default, from live pricing config) and cancellation policy, clicks "Book & Pay."
4. **System:** attempts to reserve the slot and create a payment intent together; the slot is provisionally locked during checkout.
   - **Decision point — race condition:** if another student confirms the same slot first, this student's checkout fails immediately with "This slot was just taken — please choose another," before any charge is attempted.
5. Payment succeeds. **System:** confirms the booking, generates a session link, adds it to both parties' schedules. **[LOG]** booking created, payment recorded. **[NOTIFY]** confirmation to student (with calendar-add option) and to consultant.
   - **Failure path — payment succeeds but booking write fails:** system reconciles automatically (creates the booking from the confirmed payment record) or auto-refunds; the student is never left paid-with-no-booking.
6. Reminder notifications fire at configured intervals before the session (e.g., 24h and 1h prior), computed against the session's absolute UTC time so they remain correct even if the student's device timezone changes in the interim.
7. **Decision point — reschedule/cancel:**
   - Student cancels within the allowed policy window: automatic refund per policy, slot released back to availability. **[LOG]** cancellation + refund. **[NOTIFY]** both parties.
   - Consultant cancels: student is notified immediately, automatically refunded (or offered rebooking), slot released. **[LOG]** consultant-initiated cancellation.
8. At session time, both parties join via the provided link (external video tool in v1 — see charter's Out of Scope).
9. After the session, consultant may leave session notes visible to the student who booked it. Consultant's access to the student's shared data expires after a defined post-session window (see `02-personas-and-roles.md` §3).

---

## 6. Journey E: Admin Verifying a Document / Overriding an Entitlement

### E1 — Document Verification (concurrent-admin edge case)

1. Admin A opens the pending-documents queue, filters to oldest-first.
2. Admin A opens Student X's transcript (signed URL generated, access logged). **[LOG]** admin viewed document.
3. Simultaneously, Admin B opens the same document from a different queue view.
4. Admin A marks the document `Verified`. **System:** applies the transition with an optimistic-concurrency version check, succeeds, increments the document's version/state. **[LOG]** document verified by Admin A.
5. Admin B, unaware, attempts to mark the same document `Rejected` moments later. **System:** detects the version mismatch (already actioned) and rejects Admin B's action with "This document was already verified by Admin A at [timestamp]" rather than silently overwriting Admin A's decision or producing an inconsistent state. **[LOG]** conflicting action attempt recorded (rejected, not applied).
6. Student sees `Verified` status; no trace of the conflicting attempt is shown to the student (internal-only).

### E2 — Entitlement Override

1. Student contacts support: paid for a TARGET/SAFE unlock, payment succeeded on their bank statement, but the platform shows it as locked (e.g., a webhook was missed).
2. Admin opens the student's payment history (access logged as a support action), locates the payment record, confirms with the payment processor's dashboard/reference that the charge succeeded.
3. Admin manually grants the entitlement for the specific assessment run, **required to enter a reason** (e.g., "Webhook missed — payment confirmed via processor ref #12345"). **System:** creates the `Entitlement` record with `grantedBy: admin`, `reason`, timestamp. **[LOG]** manual entitlement grant, full detail retained (actor, reason, reference).
4. Student's TARGET/SAFE matches unlock immediately without requiring a fresh login. **[NOTIFY]** student informed the issue was resolved and access restored.
5. **Reverse scenario — revocation:** finance later determines a charge was fraudulent/charged-back. Admin (or future FINANCE_MANAGER) revokes the entitlement with a mandatory reason. **[LOG]** entitlement revoked. **[NOTIFY]** student informed of the revocation and the reason, per the no-dark-patterns/transparency principle — access is never silently removed without explanation.

---

## 7. Cross-Journey Notes

- Every **[LOG]** entry in this document must include: actor (user id + role), action, target resource id, timestamp (UTC), and — for admin/override actions — a reason string. This is the minimum audit schema; see `14-security-architecture.md` for full audit log design.
- Every **[NOTIFY]** must be idempotent per logical event (no duplicate sends from retried background jobs).
- No journey step above should ever require the student or consultant to know or guess another user's internal ID to complete their task — all navigation is scoped to resources the acting user is authorized to see, enforced server-side.

## 8. Related Documents

- `01-product-requirements.md` — the requirements these journeys implement
- `02-personas-and-roles.md` — actor capabilities referenced throughout
- `04-functional-requirements.md` — testable FRs derived from these journeys
