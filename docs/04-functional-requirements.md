# 04 — Functional Requirements

**Document status:** Foundational — v1.0
**Depends on:** `00-project-charter.md`, `01-product-requirements.md`, `02-personas-and-roles.md`, `03-user-journeys.md`

---

## 1. Purpose and Conventions

Each requirement is stated as **FR-\<MODULE\>-\<n\>: The system shall …**, phrased to be testable (a QA engineer or another agent should be able to write a pass/fail test directly from the statement). Requirements are grounded in `01-product-requirements.md` and `03-user-journeys.md` and must not contradict them. Where a requirement depends on configuration (pricing, scoring weights, questionnaire content) rather than a hardcoded value, that is stated explicitly.

Module list: Auth, Onboarding, Questionnaire, Assessment/Matching, Universities, Document Vault, Applications, Consultation, Billing/Payments, Notifications, Admin.

---

## 2. Auth

- **FR-AUTH-1:** The system shall allow account creation with email and password, storing passwords using a memory-hard hash (e.g., Argon2id or bcrypt with a modern cost factor) — never plaintext or a fast general-purpose hash.
- **FR-AUTH-2:** The system shall require email verification via a single-use, time-limited token before allowing document upload, payment, or application submission.
- **FR-AUTH-3:** The system shall allow a resend of the verification email, rate-limited per account (e.g., max 1 per 60 seconds, max 5 per hour) to prevent abuse.
- **FR-AUTH-4:** The system shall issue a server-side session (own Session table, not a third-party auth provider) on successful login, with a defined expiry and sliding or fixed renewal policy.
- **FR-AUTH-5:** The system shall allow a user to view all active sessions (device, approximate location, last-active timestamp) and revoke any session individually, or all sessions at once ("log out everywhere").
- **FR-AUTH-6:** The system shall immediately invalidate all server-side sessions for a user upon password change.
- **FR-AUTH-7:** The system shall respond identically to a password-reset request regardless of whether the submitted email is registered, to prevent account enumeration.
- **FR-AUTH-8:** The system shall invalidate a password-reset token after a single successful use and after a configured expiry window, whichever comes first.
- **FR-AUTH-9:** The system shall reject login attempts after a configurable number of consecutive failures per account/IP combination for a cooldown period (brute-force protection), without permanently locking the account without recovery.
- **FR-AUTH-10:** The system shall enforce server-side role/permission checks on every authenticated API route, independent of any frontend route protection.
- **FR-AUTH-11:** The system shall support account self-deletion, initiating the data-deletion workflow while retaining only records required by legal/financial retention rules (e.g., payment records), which shall be disclosed to the user before confirmation.
- **FR-AUTH-12:** The system shall log authentication security events (login, logout, password change, failed login threshold reached, session revocation) to the audit log with actor, timestamp, and IP/device metadata.
- **FR-AUTH-13:** The system shall prevent reuse of a session token after logout or after that session has been explicitly revoked.
- **FR-AUTH-14:** The system shall treat idempotent double-submission of signup or login forms (e.g., double-click) as a single logical request, never creating duplicate accounts or duplicate sessions from one user action.

---

## 3. Onboarding

- **FR-ONB-1:** The system shall present onboarding as a progressive, multi-section wizard (Education, Destination, Budget, English, Academic Risk, Preferences) with a visible progress indicator.
- **FR-ONB-2:** The system shall persist each section's answers to the server upon section completion (autosave), without requiring the entire wizard to be completed in one session.
- **FR-ONB-3:** The system shall allow a student to resume onboarding from their last saved section after logging in from any device.
- **FR-ONB-4:** The system shall allow a student to navigate backward to any previously completed section and edit prior answers before running an assessment.
- **FR-ONB-5:** The system shall validate required fields server-side before permitting an assessment run, independent of any frontend validation.
- **FR-ONB-6:** The system shall clearly distinguish required vs. optional fields in the UI copy and in server validation rules.
- **FR-ONB-7:** The system shall store onboarding answers against the versioned Questionnaire schema (see Questionnaire module) rather than fixed database columns per question, so new fields can be added without a destructive schema migration.
- **FR-ONB-8:** The system shall detect and flag (in-app indicator) when a student's profile has changed since their most recent assessment run, without automatically invalidating that prior assessment result.
- **FR-ONB-9:** The system shall support conditional field logic (e.g., "study gap duration" only appears if "has study gap" = yes) driven by the Questionnaire engine's configured conditional rules, not hardcoded UI branching.
- **FR-ONB-10:** The system shall reject a save operation that would leave a section's data in a partially invalid state (e.g., a numeric field with non-numeric input), returning a field-level error rather than silently discarding the entire section's data.

---

## 4. Questionnaire (Engine Integration Requirements)

*Note: the full questionnaire engine data model (Questionnaire → Sections → Questions → Options/Validation/Conditional Logic/Scoring Rules, versioned) is specified in a separate architecture document. These FRs describe how the product must use that engine.*

- **FR-QST-1:** The system shall render onboarding and any future assessment-input forms entirely from the active, published Questionnaire configuration (sections, questions, options, validation, conditional logic), not from hardcoded form markup describing question content.
- **FR-QST-2:** The system shall version the Questionnaire schema such that a new version can be published without altering the meaning of previously submitted answers tied to an older version.
- **FR-QST-3:** The system shall record, for every submitted answer set, which Questionnaire version was in effect at submission time.
- **FR-QST-4:** The system shall support adding new questions, sections, or options to a future Questionnaire version without requiring destructive changes to previously stored answer data.
- **FR-QST-5:** The system shall support per-question validation rules (required/optional, numeric ranges, enumerated options, format patterns) defined in configuration, evaluated identically client-side (fast feedback) and server-side (authoritative).
- **FR-QST-6:** The system shall support conditional visibility/requirement rules between questions (e.g., show question B only if question A = X), defined in configuration.
- **FR-QST-7:** The system shall support mapping select questionnaire answers to scoring-engine inputs via a configured scoring-rules linkage, without requiring code changes when new scored fields are added.
- **FR-QST-8:** The system shall prevent publishing a new Questionnaire version that breaks required mappings relied upon by the currently active scoring-rules version (a compatibility check at publish time).
- **FR-QST-9:** The system shall allow an admin/super-admin to preview a draft Questionnaire version before publishing it, without affecting any student's live onboarding experience.

---

## 5. Assessment / Matching

- **FR-ASM-1:** The system shall compute eligibility/matching results using a versioned, configurable weighted scoring engine, never hardcoded conditional logic embedded in application code.
- **FR-ASM-2:** The system shall classify each candidate university/program match into exactly one zone: REACH, TARGET, or SAFE, per the active scoring-rules version's thresholds.
- **FR-ASM-3:** The system shall persist, for every assessment run, an immutable snapshot containing: the student's profile/questionnaire answers as submitted, the scoring-rules version applied, and the university-dataset version applied.
- **FR-ASM-4:** The system shall allow a student to view REACH-zone match results at no cost, immediately after an assessment run completes.
- **FR-ASM-5:** The system shall omit TARGET and SAFE zone match details entirely from any API response to a student who does not hold a valid entitlement for that assessment run, returning only an aggregate count/teaser.
- **FR-ASM-6:** The system shall return TARGET/SAFE match details in full once a valid entitlement exists for that specific assessment run, without requiring a new assessment run.
- **FR-ASM-7:** The system shall allow a student to re-run an assessment, creating a new, separately versioned `AssessmentResult` record, never overwriting or mutating a prior result.
- **FR-ASM-8:** The system shall render historical assessment results exactly as originally computed from their stored snapshot, even if scoring rules or university data have since changed.
- **FR-ASM-9:** The system shall provide a plain-language rationale for each match's zone classification, derived from the scoring engine's factor weights (e.g., which inputs contributed most).
- **FR-ASM-10:** The system shall never render copy implying guaranteed admission or visa outcomes anywhere in assessment results, using only the approved terms (Strong Match, High Confidence, Safer Options, Strong Eligibility).
- **FR-ASM-11:** The system shall reject and cleanly report an assessment run that fails/times out, without persisting a partial result marked as complete.
- **FR-ASM-12:** The system shall deduplicate rapid repeated "run assessment" submissions (idempotency), processing only one run per logical request.
- **FR-ASM-13:** The system shall allow an authorized admin/super-admin to publish a new scoring-rules version without retroactively altering any already-computed `AssessmentResult` snapshot.
- **FR-ASM-14:** The system shall record which scoring-rules version is "active" at any point in time, with a full history of prior versions retained for audit and reproducibility.

---

## 6. Universities (Discovery & Paywall)

- **FR-UNI-1:** The system shall maintain a versioned university/program dataset (name, location, tuition, requirements, intake dates, program metadata) used as scoring engine input.
- **FR-UNI-2:** The system shall allow students to browse and filter free (REACH) matches by criteria such as country, field of study, tuition range, and intake.
- **FR-UNI-3:** The system shall display, for any locked TARGET/SAFE match set, only an aggregate teaser (e.g., count per zone) and the unlock price, with zero identifying program/university detail exposed pre-purchase.
- **FR-UNI-4:** The system shall source the unlock price for a given assessment run from the live Product/Price configuration at the moment of purchase, never from a hardcoded or previously cached value beyond a defined short-lived quote window.
- **FR-UNI-5:** The system shall grant an `Entitlement` scoped to the specific `AssessmentResult.id` upon confirmed payment for an unlock.
- **FR-UNI-6:** The system shall process unlock purchase requests idempotently, keyed to (student, assessment run, product), such that duplicate submission never results in duplicate charges or duplicate entitlements.
- **FR-UNI-7:** The system shall reflect a newly granted entitlement in the student's next API read without requiring a manual cache-bust or re-login.
- **FR-UNI-8:** The system shall allow a student to view their full purchase/entitlement history at any time, including which assessment run each entitlement covers.
- **FR-UNI-9:** The system shall support revoking an entitlement (e.g., due to a refund) with a mandatory reason, notifying the affected student.
- **FR-UNI-10:** The system shall indicate, on a university/program detail view, if underlying data has changed materially since a historical assessment referencing it was computed (without altering the historical assessment record itself).
- **FR-UNI-11:** The system shall allow admin/super-admin roles to manage university/program catalog data through an authenticated interface, with all changes attributable and audit-logged.

---

## 7. Document Vault

- **FR-DOC-1:** The system shall allow a student to upload documents against a configurable set of required/optional document types determined by the student's selected destination(s)/program(s).
- **FR-DOC-2:** The system shall store all uploaded documents exclusively in private AWS S3 buckets, never in a publicly accessible bucket or path.
- **FR-DOC-3:** The system shall generate short-lived, signed URLs for any document read/write operation, scoped to the specific authorized requester and resource, with no persistent public URL ever issued.
- **FR-DOC-4:** The system shall validate uploaded file type and size against a configured allowlist both client-side (fast feedback) and server-side (authoritative), rejecting non-conforming files with a specific error.
- **FR-DOC-5:** The system shall track document state as one of: Pending Review, Verified, Rejected, Expired, and (for withdrawn documents referenced by a submitted application) Withdrawn.
- **FR-DOC-6:** The system shall require a specific, non-empty reason whenever an admin rejects a document, and shall surface that reason to the student.
- **FR-DOC-7:** The system shall preserve full version history for a document slot across re-uploads, retaining prior versions and their associated rejection reasons.
- **FR-DOC-8:** The system shall prevent hard deletion of any document referenced by a submitted (non-draft) application, offering re-upload/replacement instead.
- **FR-DOC-9:** The system shall detect and prevent duplicate "pending review" entries for the same document slot arising from a double-submitted upload.
- **FR-DOC-10:** The system shall track expiry for time-bound documents (e.g., language test validity) and surface an expiry countdown/warning to the student before expiry.
- **FR-DOC-11:** The system shall log every admin access to a specific student document (view, verify, reject) with actor, timestamp, and resource id.
- **FR-DOC-12:** The system shall enforce object-level authorization on every document read/write request, verifying the requester owns or is explicitly, currently authorized to access that specific document (never role-only checks).

---

## 8. Applications

- **FR-APP-1:** The system shall allow a student to create a Draft application for a specific university/program from an unlocked or free match.
- **FR-APP-2:** The system shall present a live completeness checklist for a Draft application, reflecting missing documents and missing required fields.
- **FR-APP-3:** The system shall prevent submission of an application server-side until all required documents are attached and verified (or explicitly marked optional-but-missing per program rules), regardless of frontend button state.
- **FR-APP-4:** The system shall couple application submission with application-fee payment such that a failed payment leaves the application in a `Draft — Payment Failed` state, never a false `Submitted` state.
- **FR-APP-5:** The system shall process application submission idempotently (idempotency key per application), ensuring a double-click never produces two submissions or two fee charges.
- **FR-APP-6:** The system shall track application status through a defined state machine (Draft → Ready for Submission → Submitting → Submitted → [Under Review] → Offer/Rejected/Waitlisted → Accepted/Declined; Draft → Withdrawn), recording a timestamp for every transition.
- **FR-APP-7:** The system shall allow a student to withdraw a Draft (pre-submission) application at no cost.
- **FR-APP-8:** The system shall render a submitted application's content as read-only to the student, with any subsequent amendment following a defined, logged amendment path rather than silent in-place edits.
- **FR-APP-9:** The system shall store application deadlines in UTC and render them in the student's currently active locale/timezone consistently across sessions and devices.
- **FR-APP-10:** The system shall enforce object-level authorization such that a student can only read/modify their own applications, regardless of ID guessing.
- **FR-APP-11:** The system shall notify a student immediately upon any status transition initiated by an admin or automated process (e.g., Offer, Rejected, Waitlisted).
- **FR-APP-12:** The system shall autosave Draft application form progress server-side as the student fills it in, so a session expiry or device change does not lose entered data.
- **FR-APP-13:** The system shall permit reuse of already-verified Vault documents in an application without requiring redundant re-upload.
- **FR-APP-14:** The system shall log every state transition on an application with actor (student/admin/system), timestamp, and (for admin-initiated transitions) a reason where the transition is not a straightforward automated data import.

---

## 9. Consultation

- **FR-CON-1:** The system shall display consultant availability slots converted to the viewing student's local timezone, with the consultant's timezone shown for context.
- **FR-CON-2:** The system shall enforce authoritative, server-side slot availability at booking confirmation time, independent of what was shown when the student began checkout.
- **FR-CON-3:** The system shall prevent two students from successfully booking the same slot; the second concurrent attempt shall fail immediately with a clear "slot no longer available" response before any charge is attempted.
- **FR-CON-4:** The system shall process booking-and-payment as a coupled, idempotent operation such that a captured payment always results in exactly one confirmed booking, or is automatically refunded if the booking cannot be completed.
- **FR-CON-5:** The system shall present the cancellation/reschedule policy (including any minimum notice window) before booking confirmation.
- **FR-CON-6:** The system shall automatically process a refund per policy when a student cancels within the allowed window, and unconditionally when a consultant cancels.
- **FR-CON-7:** The system shall scope a consultant's access to a specific student's profile/documents to bookings that consultant holds with that student, expiring that access after a configured post-session window.
- **FR-CON-8:** The system shall allow a consultant to record session notes tied to a specific booking, visible only to the student who made that booking and to the authoring consultant.
- **FR-CON-9:** The system shall compute and display session reminder times against the session's stored UTC instant, remaining correct if the student's device timezone changes after booking.
- **FR-CON-10:** The system shall maintain a bookable-session price sourced from the live Product/Price configuration, not hardcoded in application code.
- **FR-CON-11:** The system shall log booking creation, cancellation, and rescheduling events with actor, timestamp, and reason (for cancellations).

---

## 10. Billing / Payments

- **FR-BIL-1:** The system shall model all purchasable offerings (unlocks, application fees, consultations, and future subscriptions) via a generic Product/Price/Entitlement/Subscription schema, never as boolean flags on the user record.
- **FR-BIL-2:** The system shall require an idempotency key on every payment-initiating request, tied to the specific logical action (unlock purchase, application submission, booking).
- **FR-BIL-3:** The system shall process payment-provider webhooks idempotently, keyed by the provider's unique event ID, such that redelivery never results in duplicate entitlement grants, duplicate charge records, or duplicate notifications.
- **FR-BIL-4:** The system shall never persist raw payment card data on AdmitFlow-controlled infrastructure; only processor-issued tokens/references are stored.
- **FR-BIL-5:** The system shall display the exact price, in the student's configured currency, before any payment is confirmed, sourced from live pricing configuration.
- **FR-BIL-6:** The system shall lock a price quote for a short, defined window at the start of checkout and honor that locked price through completion of that specific transaction.
- **FR-BIL-7:** The system shall provide students a complete, filterable history of their charges, each linked to the specific resource it paid for (assessment run, application, booking).
- **FR-BIL-8:** The system shall support admin-initiated manual entitlement grants and revocations, each requiring a mandatory reason and producing an audit log entry.
- **FR-BIL-9:** The system shall notify a student whenever an entitlement is revoked, including the reason.
- **FR-BIL-10:** The system shall reconcile a payment that succeeded at the provider but failed to produce a corresponding local entitlement/booking record, either by compensating (creating the record) or by triggering an automatic refund.
- **FR-BIL-11:** The system shall support multiple currencies for display without altering the underlying stored price basis, converting for display per the student's configured currency/locale.

---

## 11. Notifications

- **FR-NOT-1:** The system shall send a notification (email at minimum) for each of: email verification, password reset, document verified/rejected, assessment complete, purchase confirmation, application status change, consultation booking confirmation/reminder/cancellation, and account security events.
- **FR-NOT-2:** The system shall process notification-sending background jobs idempotently, keyed per logical event, so that job retries never produce duplicate sends.
- **FR-NOT-3:** The system shall maintain an in-app notification center per student with read/unread state, linking each notification directly to its relevant resource.
- **FR-NOT-4:** The system shall allow a student to opt out of non-critical (e.g., marketing/tips) notifications while security and transactional notifications (verification, receipts, password changes) remain mandatory.
- **FR-NOT-5:** The system shall never include another user's data in a notification payload rendered for a given recipient (per-recipient scoped templating, validated at send time).
- **FR-NOT-6:** The system shall compute time-sensitive notification content (e.g., "your session starts in 1 hour") against the underlying UTC event time at send time, not a pre-rendered timezone-specific string created earlier.
- **FR-NOT-7:** The system shall retry a failed notification send with backoff, and mark it permanently failed after a configured retry limit, surfacing failed critical notifications (e.g., receipts) to an admin-visible delivery-failure queue.
- **FR-NOT-8:** The system shall log the delivery status (sent/failed/bounced) of every transactional notification for support and audit purposes.

---

## 12. Admin

- **FR-ADM-1:** The system shall provide a document review queue showing pending documents ordered oldest-first with visible age/SLA indicators.
- **FR-ADM-2:** The system shall require every admin action that changes state (verify/reject document, change application status, grant/revoke entitlement) to be attributed (actor, timestamp) and, where the action is a manual override, accompanied by a mandatory reason.
- **FR-ADM-3:** The system shall apply optimistic-concurrency checks on admin state-changing actions, rejecting a conflicting second action with a clear message identifying who already acted and when.
- **FR-ADM-4:** The system shall restrict scoring-rules publication and pricing configuration changes to the SUPER_ADMIN permission set, distinct from general ADMIN permissions.
- **FR-ADM-5:** The system shall log every instance of an admin viewing a specific student's document, application, or payment record for support/verification purposes.
- **FR-ADM-6:** The system shall require a separate, explicitly granted permission (distinct from standard admin access) to perform bulk export of student PII.
- **FR-ADM-7:** The system shall prevent permanent deletion of audit log entries by any role, including SUPER_ADMIN.
- **FR-ADM-8:** The system shall support an explicit, time-boxed, audit-logged "support impersonation" mode for admins troubleshooting a student issue, distinct from silently acting as the student without a record.
- **FR-ADM-9:** The system shall enforce that all admin-facing API routes independently verify the caller's role/permission server-side, never relying on frontend route restriction alone.
- **FR-ADM-10:** The system shall allow SUPER_ADMIN to create, deactivate, and reassign roles for ADMIN and CONSULTANT accounts, with every such change audit-logged.
- **FR-ADM-11:** The system shall support paginated, filterable views of students, applications, documents, and payments for admin search, never loading an unbounded full table into a single response.
- **FR-ADM-12:** The system shall allow admin/super-admin to manage university/program catalog and questionnaire content through the same authenticated, audit-logged interface used for other administrative changes.

---

## 13. Related Documents

- `01-product-requirements.md` — the module-level product requirements these FRs formalize
- `03-user-journeys.md` — the journeys these FRs are testable against
- `05-non-functional-requirements.md` — the quality bar (performance, security, accessibility) these FRs must be delivered within
