# 12 — API Contracts

**Document status:** Foundational — v1.0
**Depends on:** `11-api-architecture.md` (envelope, pagination, error codes, requestId — not repeated per-endpoint here)
**Read alongside:** `13-authentication-authorization.md`, `14-security-architecture.md`, `47-rate-limiting.md`, `48-idempotency.md`

---

## 1. How to Read This Document

Every endpoint entry lists: **Method & Path**, **Auth**, **Permission**, **Request**, **Response**, **Key errors**. Unless stated otherwise:

- `Auth: session` means a valid session cookie (see `13-authentication-authorization.md`) is required; `Auth: none` means the endpoint is public.
- All request bodies are validated server-side against a schema before any business logic runs (`VALIDATION_ERROR` on failure) — this is universal and not re-stated per endpoint.
- All responses use the envelope defined in `11-api-architecture.md` §5 — examples below show only the `data`/`error` payload unless the full envelope is illustrative.
- "Key errors" lists errors specific/notable to that endpoint on top of the universal set (`VALIDATION_ERROR`, `UNAUTHENTICATED`, `RATE_LIMITED`, `INTERNAL_ERROR`).
- Endpoints marked **Idempotency-Key: required/supported** are covered in `48-idempotency.md`.
- Endpoints marked **Rate-limited** have concrete limits in `47-rate-limiting.md` — this document doesn't restate the numbers.

---

## 2. Auth Module — `/api/v1/auth`

### POST `/api/v1/auth/signup`

- **Auth:** none · **Rate-limited**
- **Request:**
```json
{ "email": "student@example.com", "password": "correct-horse-battery-staple", "firstName": "Amina", "lastName": "Yusuf", "acceptedTermsVersion": "2026-01-01" }
```
- **Response (201):**
```json
{ "success": true, "data": { "userId": "usr_01J...", "email": "student@example.com", "status": "EMAIL_UNVERIFIED", "verificationMethod": "LINK_AND_OTP" }, "meta": { "requestId": "req_..." } }
```
- **Behavior:** creates the User record (state `REGISTERED` → `EMAIL_UNVERIFIED` in the same transaction, see `13-authentication-authorization.md`), hashes password with argon2id, enqueues a verification email containing both a secure single-use link and a 6-digit OTP (decision: support both — see `13-authentication-authorization.md` §3.1). Does **not** issue a full session; a short-lived, narrowly-scoped "pending verification" session may be issued so the client can call `verify-email` and `resend-verification` without re-authenticating, but this session cannot access any endpoint outside the Auth module.
- **Key errors:** `409 CONFLICT` (`EMAIL_ALREADY_REGISTERED`) — **Decision:** signup does *not* obscure "email already registered" behind a generic success (unlike login, which never reveals whether an email exists — see below). Rationale: signup-enumeration risk is lower value to an attacker than login-enumeration, and a confusing "check your email" response for an already-registered address materially hurts legitimate users who forgot they signed up; this is a deliberate, documented trade-off, not an oversight.

### POST `/api/v1/auth/verify-email`

- **Auth:** pending-verification session or none (token-based) · **Rate-limited**
- **Request (link-based):** `{ "token": "opaque-single-use-token" }`
- **Request (OTP-based):** `{ "userId": "usr_01J...", "otp": "482913" }`
- **Response (200):** `{ "success": true, "data": { "status": "VERIFIED" } }` — full session issued/upgraded on success.
- **Key errors:** `400 VALIDATION_ERROR` (`TOKEN_INVALID_OR_EXPIRED`, `OTP_INCORRECT`), `409 CONFLICT` (`ALREADY_VERIFIED`). OTP attempts are counted and the code is invalidated after 5 wrong tries, forcing a resend (see `47-rate-limiting.md`).

### POST `/api/v1/auth/login`

- **Auth:** none · **Rate-limited**
- **Request:** `{ "email": "student@example.com", "password": "correct-horse-battery-staple" }`
- **Response (200):**
```json
{ "success": true, "data": { "userId": "usr_01J...", "role": "STUDENT", "status": "ACTIVE" }, "meta": { "requestId": "req_..." } }
```
Session cookie set via `Set-Cookie` (httpOnly, secure, see `14-security-architecture.md`); no token is ever returned in the JSON body.
- **Key errors:** `401 INVALID_CREDENTIALS` — returned identically whether the email doesn't exist or the password is wrong (never `USER_NOT_FOUND`). `403 EMAIL_NOT_VERIFIED` if lifecycle state is still `EMAIL_UNVERIFIED`. `423 ACCOUNT_LOCKED`-equivalent via `RATE_LIMITED` after repeated failures (see `47-rate-limiting.md`) — a temporary lockout, not a silent ban, and it does not reveal whether the account exists.

### POST `/api/v1/auth/logout`

- **Auth:** session
- **Response (200):** `{ "success": true, "data": null }`. Revokes the **current** server-side session record only (Postgres row deleted/marked revoked + Redis cache entry evicted) and clears the cookie.

### POST `/api/v1/auth/logout-all`

- **Auth:** session
- **Response (200):** `{ "success": true, "data": { "sessionsRevoked": 4 } }`. Revokes **every** server-side session record for the user (all devices/browsers), including the current one — client must treat itself as logged out immediately after. See `13-authentication-authorization.md` §Session Model for how this is implemented (a `sessionVersion`/direct row-deletion mechanism, not just cookie clearing on one device).

### POST `/api/v1/auth/forgot-password`

- **Auth:** none · **Rate-limited**
- **Request:** `{ "email": "student@example.com" }`
- **Response (200, always):** `{ "success": true, "data": { "message": "If an account exists for this email, a reset link has been sent." } }` — **always** 200 regardless of whether the email exists, to prevent account enumeration. If it exists, a single-use, time-limited (30 min) reset token is emailed.

### POST `/api/v1/auth/reset-password`

- **Auth:** none (token-based) · **Rate-limited**
- **Request:** `{ "token": "opaque-single-use-token", "newPassword": "new-correct-horse-battery" }`
- **Response (200):** `{ "success": true, "data": null }`. On success: password re-hashed (argon2id), **every existing session for the user is revoked** (a password reset is a strong signal the old sessions may be compromised — treat it like `logout-all`), and a confirmation email is sent (not the reset link itself, so a compromised inbox after the fact can't replay it).
- **Key errors:** `400 VALIDATION_ERROR` (`TOKEN_INVALID_OR_EXPIRED`, weak password per policy).

---

## 3. Users Module — `/api/v1/users`

### GET `/api/v1/users/me`

- **Auth:** session
- **Response (200):**
```json
{ "success": true, "data": { "id": "usr_01J...", "email": "student@example.com", "role": "STUDENT", "status": "ACTIVE", "emailVerifiedAt": "2026-01-15T10:00:00Z", "createdAt": "2026-01-15T09:55:00Z", "oauthProviders": ["google"] } }
```
Never includes `passwordHash`, session tokens, OTP codes, or any other sensitive auth field — the serializer for this endpoint is allow-listed field-by-field, not "the User row minus a blocklist" (a blocklist is one accidental new-column away from a leak; an allowlist fails closed).

### PATCH `/api/v1/users/me`

- **Auth:** session
- **Request:** `{ "firstName": "Amina" }` (partial; only account-level fields — name, locale, notification preferences, not profile/onboarding content, which belongs to `/profiles`).
- **Response (200):** updated user object (same shape as GET).
- **Key errors:** `400 VALIDATION_ERROR`. Email changes are **not** handled by this endpoint (a distinct, verification-gated `POST /users/me/change-email` flow, out of scope for this baseline list, re-runs email verification before the change takes effect).

---

## 4. Profiles & Onboarding — `/api/v1/profiles`, `/api/v1/onboarding`

### POST `/api/v1/onboarding` (start/advance a step)

- **Auth:** session, `EMAIL_VERIFIED`+ lifecycle state
- **Request:** `{ "step": "ACADEMIC_HISTORY", "data": { "highestDegree": "BACHELORS", "gpa": 3.6, "gpaScale": 4.0 } }`
- **Response (200):** `{ "success": true, "data": { "currentStep": "ACADEMIC_HISTORY", "completedSteps": ["BASIC_INFO"], "nextStep": "TEST_SCORES", "onboardingComplete": false } }`
- **Behavior:** validates the step payload against that step's schema, upserts into the underlying Profile fields it owns, and advances onboarding progress. Steps can be submitted out of order (resumable, not strictly linear) but `onboardingComplete` only flips true once every required step is present.

### PATCH `/api/v1/onboarding`

- **Auth:** session
- **Request:** `{ "step": "ACADEMIC_HISTORY", "data": { "gpa": 3.7 } }` — same shape as POST, used to edit an already-submitted step without re-walking the wizard.
- **Response (200):** same shape as POST.

### GET `/api/v1/profiles/me` *(baseline addition — not in the original list but required for the onboarding/assessment flow to be coherent)*

- **Auth:** session
- **Response (200):** the assembled Profile record (academic history, test scores, target countries, budget band, etc.) used as assessment input.

**Key errors (both onboarding endpoints):** `400 VALIDATION_ERROR` (per-step schema), `409 CONFLICT` (`STEP_OUT_OF_SEQUENCE`) only for steps that are genuinely dependent (e.g., "target country" before "highest degree" if the questionnaire branches on it) — most steps are order-independent by design.

---

## 5. Questionnaires — `/api/v1/questionnaires`

### GET `/api/v1/questionnaires/:id`

- **Auth:** session
- **Response (200):**
```json
{ "success": true, "data": { "id": "qst_v3", "version": 3, "title": "Eligibility Questionnaire", "questions": [ { "id": "q1", "type": "SINGLE_SELECT", "prompt": "What is your target degree level?", "options": ["UNDERGRADUATE", "MASTERS", "PHD"] } ] } }
```
- **Behavior:** `:id` may be a specific version id (`qst_v3`) or the literal `current` to always fetch the active published version. Once a student has responses recorded against a version, that version is never mutated in place (see `04-functional-requirements.md` reproducibility requirement) — a new version is published instead.
- **Key errors:** `404 NOT_FOUND` (unpublished/unknown version).

### POST `/api/v1/questionnaires/:id/responses`

- **Auth:** session
- **Request:** `{ "responses": [ { "questionId": "q1", "value": "MASTERS" } ] }`
- **Response (201):** `{ "success": true, "data": { "responseSetId": "qr_01J...", "questionnaireVersion": 3, "submittedAt": "2026-02-01T12:00:00Z" } }`
- **Behavior:** stores the response set immutably, tagged with the exact questionnaire version answered — this is part of the assessment reproducibility snapshot (`00-project-charter.md` §10.5). Resubmitting creates a new response set version rather than mutating the prior one, so a past assessment run can still be explained against the answers that produced it.
- **Key errors:** `400 VALIDATION_ERROR` (unknown `questionId`, answer doesn't match the question's declared type/options).

---

## 6. Assessment — `/api/v1/assessment`

### POST `/api/v1/assessment/run`

- **Auth:** session, requires a completed onboarding + at least one questionnaire response set · **Rate-limited** · **Idempotency-Key: supported**
- **Decision:** this is a `POST`, not a `GET`, and it is the action that creates a new resource (an `AssessmentRun`) — not a passive read. **Rationale:** running the matching engine is a computation with side effects worth persisting (a reproducible, versioned snapshot per `00-project-charter.md` §10.5) and worth rate-limiting/idempotency-protecting against duplicate submission; `GET` must be side-effect-free and cacheable, neither of which holds here. Retrieving a run's output is a separate, cacheable `GET` (§`assessment/results` below).
- **Decision:** the run executes **synchronously** in v1 and the response includes the completed result — rule evaluation against the catalog is a deterministic, non-ML rule engine, not a heavy async job, so a worker hand-off (as used for document verification) isn't justified yet. If matching becomes computationally heavier later, this endpoint can return `202 Accepted` with `status: "PENDING"` instead of `200`/`status: "COMPLETED"` **without changing its contract shape** — clients must already handle both statuses (built for the upgrade path, not just the current behavior).
- **Request:** `{}` (no body needed — the engine reads the student's current committed Profile + latest response set) or optionally `{ "questionnaireResponseSetId": "qr_01J..." }` to pin a specific response set explicitly.
- **Response (201):** `{ "success": true, "data": { "runId": "run_01J...", "status": "COMPLETED", "profileVersion": "prf_v7", "questionnaireVersion": 3, "scoringRulesVersion": "sr_2026_02", "createdAt": "2026-02-01T12:05:00Z" } }`. The run's full match results are fetched via `GET /assessment/results` (kept separate so re-fetching results doesn't re-run/re-charge compute and so results can be cached/paginated independently).
- **Key errors:** `403 EMAIL_NOT_VERIFIED`/`ONBOARDING_INCOMPLETE`-style `FORBIDDEN` if prerequisites aren't met, `409 CONFLICT` (`RUN_ALREADY_IN_PROGRESS`) if a prior run for this user is still `PENDING`.

### GET `/api/v1/assessment/results`

- **Auth:** session
- **Query:** `?runId=run_01J...` (defaults to the student's latest completed run if omitted)
- **Response — non-entitled student (entitlement scope: none purchased):**
```json
{
  "success": true,
  "data": {
    "runId": "run_01J...",
    "status": "COMPLETED",
    "reach": [
      {
        "universityId": "uni_042",
        "programId": "prg_118",
        "universityName": "University of Toronto",
        "programName": "MSc Computer Science",
        "country": "Canada",
        "matchScore": 78,
        "matchZone": "REACH",
        "tuitionFeeUsd": 42000,
        "applicationDeadline": "2026-12-01"
      }
    ],
    "target": { "locked": true },
    "safe": { "locked": true }
  },
  "meta": {
    "requestId": "req_...",
    "lockedCounts": { "target": 6, "safe": 4 }
  }
}
```
- **Response — entitled student (TARGET+SAFE unlocked for this run):**
```json
{
  "success": true,
  "data": {
    "runId": "run_01J...",
    "status": "COMPLETED",
    "reach": [ { "universityId": "uni_042", "...": "..." } ],
    "target": [
      { "universityId": "uni_099", "programId": "prg_204", "universityName": "McMaster University", "programName": "MSc Computer Science", "country": "Canada", "matchScore": 61, "matchZone": "TARGET", "tuitionFeeUsd": 31000, "applicationDeadline": "2026-11-15" }
    ],
    "safe": [
      { "universityId": "uni_301", "programId": "prg_500", "universityName": "University of Windsor", "programName": "MSc Computer Science", "country": "Canada", "matchScore": 40, "matchZone": "SAFE", "tuitionFeeUsd": 24000, "applicationDeadline": "2026-10-01" }
    ]
  },
  "meta": { "requestId": "req_..." }
}
```
- **Critical rule (see `11-api-architecture.md` §10 and `14-security-architecture.md`):** for a non-entitled student, `target` and `safe` contain **only** `{ "locked": true }` — no `universityId`, no `universityName`, no `programName`, no fee, no deadline, no `matchScore`, nothing that identifies or partially describes the locked institution. `meta.lockedCounts` conveys *how many* matches exist per zone (legitimate upsell/UX signal — "6 Target matches are waiting") without conveying *which* universities they are. This is computed and enforced in the assessment service's response-serialization layer, gated on the entitlement check, before the payload ever reaches the HTTP layer — there is no query path, admin flag, or debug mode that returns full locked objects to a non-entitled student session.
- **Key errors:** `404 NOT_FOUND` (`runId` doesn't exist or doesn't belong to the caller — see §10 object-level rule, never a 403 that would confirm another user's run exists).

---

## 7. Universities & Programs — `/api/v1/universities`, `/api/v1/programs`

### GET `/api/v1/universities`

- **Auth:** session (entitlement filtering is per-student; there is no anonymous/public catalog browse in v1 — **Decision:** requiring auth even for REACH-only browsing keeps a single authorization code path rather than a public path plus an authenticated path that must independently be kept leak-free)
- **Query:** `?limit=20&cursor=...&country=CA&maxTuitionUsd=40000&q=computer+science&sort=-matchScore`
- **Response:** same locked-field-omission pattern as `assessment/results` — a university's identity/program/fee/metadata is included only if the requesting student is entitled to see that university's match zone for their current assessment run; otherwise the list entry is `{ "locked": true, "zone": "TARGET" }` (or `"SAFE"`) and nothing else. Non-matched-catalog general browsing (a student exploring outside their own assessment) is always REACH-zone-equivalent and fully visible — locking is tied to *the student's own match zone for that university*, not to the catalog itself being secret.
- **Response envelope:** standard cursor pagination per `11-api-architecture.md` §7.
- **Key errors:** `400 VALIDATION_ERROR` (unrecognized `sort` field).

### GET `/api/v1/universities/:id`

- **Auth:** session
- **Response (200, entitled/REACH):** full university + nested program summaries.
- **Response (200, locked):** `{ "success": true, "data": { "locked": true, "zone": "TARGET" } }` — **Decision:** this is `200`, not `403`/`404`. Rationale: the student is allowed to know *that this catalog entry exists in their result set* (it's how the "unlock to see 6 more Target matches" UX works) — what's forbidden is its identifying content, which is why the payload still contains no name/fee/metadata even at `200`. This is distinct from the `404`-for-another-user's-resource rule in §10, which is about *object ownership*, not entitlement-gated content within an object the actor does legitimately know about.

---

## 8. Vault — `/api/v1/vault`

### POST `/api/v1/vault/upload-url`

- **Auth:** session · **Rate-limited**
- **Request:** `{ "documentType": "TRANSCRIPT", "declaredFileName": "transcript.pdf", "declaredContentType": "application/pdf", "declaredSizeBytes": 2400000 }`
- **Response (201):** `{ "success": true, "data": { "documentId": "doc_01J...", "uploadUrl": "https://s3.../...&X-Amz-Signature=...", "uploadMethod": "PUT", "expiresAt": "2026-02-01T12:10:00Z" } }`
- **Behavior:** performs an upload-authorization check (is this student allowed to upload this document type right now, within size/quota limits), creates/updates the `Document` record to status `UPLOAD_INITIATED` (per the canonical Document state machine, `31-state-machines.md` §4, transition D3), and returns a short-lived (10 min), single-use, scoped S3 pre-signed PUT URL. The declared filename/content-type/size are **advisory only for UX** (e.g., picking an icon) — they are never trusted for the actual security decision, which happens server-side after upload (see below and `14-security-architecture.md`/`15-document-vault-security.md`).
- **Key errors:** `413 PAYLOAD_TOO_LARGE` (declared size over limit — a fast client-side rejection; the real limit is still enforced again on the actual bytes), `415 UNSUPPORTED_MEDIA_TYPE` (document type doesn't accept this declared content type).

### POST `/api/v1/vault/verify-upload`

- **Auth:** session
- **Request:** `{ "documentId": "doc_01J..." }`
- **Response (202):** `{ "success": true, "data": { "documentId": "doc_01J...", "status": "UPLOADED" } }`
- **Behavior:** confirms the object landed in S3 (`UPLOAD_INITIATED` → `UPLOADED`, transition D5), and enqueues the async malware-scan/document-processing job (`UPLOADED` → `PROCESSING`, D6: magic-byte file-type check, malware scan, thumbnail/metadata extraction) on the **worker service** — never inline in this request/response cycle. Automated checks resolve to either `REJECTED` (D7 — hard failure/malware hit) or `PENDING_REVIEW` (D8 — queued for human verification). The document is not usable in an application submission until it reaches `VERIFIED` (D9). Admin document verification is the separate, later human step on top of this automated pipeline (see `admin/verify-document` below).
- **Key errors:** `404 NOT_FOUND` (unknown/not-owned `documentId`), `409 CONFLICT` (`UPLOAD_NOT_FOUND_IN_STORAGE` if S3 confirms nothing was actually uploaded to that key).

### GET `/api/v1/vault/documents`

- **Auth:** session · cursor-paginated
- **Response:** list of the caller's own documents with metadata and status — one of the canonical Document states (`31-state-machines.md` §4): `MISSING` / `UPLOAD_INITIATED` / `UPLOADED` / `PROCESSING` / `PENDING_REVIEW` / `VERIFIED` / `REJECTED` / `EXPIRED` / `REPLACED` / `DELETED`. **Never** includes a raw S3 URL — only a `documentId`, used to request a signed *view* URL via a separate, explicitly-scoped `GET /vault/documents/:id/view-url` endpoint (baseline addition, short-lived signed GET URL, same authorization check as any other document read) when the document actually needs to be displayed/downloaded.

### DELETE `/api/v1/vault/documents/:id`

- **Auth:** session
- **Response (200):** `{ "success": true, "data": null }`. Transitions the document to `DELETED` (D13) and enqueues async S3 object deletion via the worker; per D13, this transition is **blocked** (`409 CONFLICT`, `DOCUMENT_IN_USE`) if the document is referenced by an `ApplicationDocumentSnapshot` belonging to a non-`WITHDRAWN`, non-terminal application — it must be superseded by a new upload instead (D12, `REPLACED`), preserving the submitted application's historical snapshot untouched.
- **Key errors:** `404 NOT_FOUND` (not found or not owned — see §10), `409 CONFLICT`.

---

## 9. Billing & Payments — `/api/v1/billing`, `/api/v1/payments`

### POST `/api/v1/billing/checkout-session`

- **Auth:** session · **Rate-limited** · **Idempotency-Key: required**
- **Request:** `{ "priceId": "price_target_safe_unlock", "provider": "STRIPE", "context": { "assessmentRunId": "run_01J..." } }`
- **Response (201):** `{ "success": true, "data": { "purchaseId": "pur_01J...", "provider": "STRIPE", "checkoutUrl": "https://checkout.stripe.com/...", "expiresAt": "2026-02-01T12:30:00Z" } }`
- **Behavior:** creates a `Purchase` record in status `PENDING`, calls the provider's Checkout Session API server-side, returns the redirect URL. **No entitlement is granted here** — entitlement grant happens exclusively in the webhook handler (§below), never in this request/response path, regardless of what the client claims afterward. See `48-idempotency.md` for the double-click-Pay guarantee this endpoint provides via `Idempotency-Key`.
- **Key errors:** `404 NOT_FOUND` (`priceId` unknown/inactive), `409 CONFLICT` (`ALREADY_ENTITLED` if the student already holds this entitlement).

### POST `/api/v1/billing/webhook` (Stripe)

- **Auth:** none (provider-to-server; authenticated instead by cryptographic signature)
- **Request:** raw Stripe event payload; **Stripe-Signature** header is verified against the endpoint's webhook signing secret **before any parsing of business content** — an invalid/missing signature is rejected `400 WEBHOOK_SIGNATURE_INVALID` and nothing is written to the database, not even to `WebhookEvent`.
- **Response (200):** `{ "success": true, "data": { "received": true } }` — returned quickly; heavy post-processing (notifications, etc.) is deferred to async jobs, but the entitlement grant itself happens synchronously in the same DB transaction as the webhook-dedup insert (see `48-idempotency.md`).
- **Behavior (non-negotiable, restated from the platform brief):** on a verified `checkout.session.completed`/`payment_intent.succeeded` event, the handler: (1) begins a DB transaction, (2) inserts into `WebhookEvent` keyed on `(provider='STRIPE', providerEventId=event.id)` under a unique constraint — a duplicate delivery hits the constraint and the handler no-ops and returns `200` immediately without re-granting anything, (3) if newly inserted, updates the matching `Purchase` to `COMPLETED` and grants the `Entitlement` row(s) in the **same transaction**, (4) commits. Client-reported payment success (e.g., a "thank you" redirect page hitting some `/confirm` endpoint) is **never** a trigger for entitlement grant — full stop.
- **Key errors:** `400 WEBHOOK_SIGNATURE_INVALID`.

### POST `/api/v1/billing/webhook-paypal`

- Same contract shape and non-negotiable rules as the Stripe webhook, adapted to PayPal's mechanism: verifies the transmission signature via PayPal's webhook-signature verification API (or cached certificate verification) before processing, dedups on `WebhookEvent (provider='PAYPAL', providerEventId=resource.id)`, grants entitlement transactionally alongside the dedup insert. See `48-idempotency.md` for the shared `WebhookEvent` model across both providers.

### GET `/api/v1/billing/entitlements`

- **Auth:** session
- **Response (200):**
```json
{ "success": true, "data": [ { "id": "ent_01J...", "type": "ASSESSMENT_UNLOCK", "scope": { "assessmentRunId": "run_01J..." }, "status": "ACTIVE", "grantedAt": "2026-02-01T12:31:00Z", "source": "PURCHASE" } ] }
```
`source` is `PURCHASE`, `ADMIN_GRANT`, or `SUBSCRIPTION` (future) — every entitlement is traceable to why it exists, which is what makes admin manual grants (§Admin below) auditable against the same model rather than a side-channel boolean flip.

### GET `/api/v1/payments` *(read-only receipt/history view, distinct from Billing's write/webhook internals — see `11-api-architecture.md` §3)*

- **Auth:** session · cursor-paginated
- **Response:** list of the caller's own completed/failed purchase records with provider-agnostic fields (amount, currency, status, description, timestamp) — no provider API keys, raw webhook payloads, or internal `WebhookEvent` rows are ever exposed through this or any student-facing endpoint.

---

## 10. Consultation — `/api/v1/consultation`

### GET `/api/v1/consultation/slots`

- **Auth:** session
- **Query:** `?consultantId=con_01J...&from=2026-02-10&to=2026-02-17`
- **Response:** list of slots (`slotId`, `consultantId`, `startAt`, `endAt`, `priceId`) in status `AVAILABLE` (per the canonical Booking state machine, `31-state-machines.md` §5). Only `AVAILABLE` slots are returned to students; a slot already `RESERVED` or `CONFIRMED` by another student is not listed (not merely marked unavailable client-side — it is absent from the list, consistent with the platform's "don't ship data to hide" posture).

### POST `/api/v1/consultation/bookings`

- **Auth:** session · **Rate-limited** · **Idempotency-Key: required**
- **Request:** `{ "slotId": "slt_01J...", "priceId": "price_consult_40min" }`
- **Response (201):** `{ "success": true, "data": { "bookingId": "bkg_01J...", "status": "RESERVED", "checkoutUrl": "https://checkout.stripe.com/..." } }`
- **Behavior:** attempts to claim the slot per transition B2 (`31-state-machines.md` §5): `SELECT ... FOR UPDATE` row-locks the target slot inside a transaction, verifies it is still `AVAILABLE`, and inserts the `Booking` in status `RESERVED` with a 10-minute hold TTL — this row-locked transaction is the **primary** concurrency guard; a DB-level unique constraint on `(consultantId, startsAt)` (or `slotId`, where slots are pre-materialized) is the backstop that still holds even if the transactional lock path has a bug (`09-database-architecture.md` §7.3). If the hold TTL expires without payment, the slot reverts to `AVAILABLE` (B3). On payment webhook confirmation, the booking flips `RESERVED` → `CONFIRMED` (B5) — never on client-reported success, same rule as any other entitlement grant.
- **Key errors:** `409 CONFLICT` (`SLOT_ALREADY_TAKEN`).

---

## 11. Applications — `/api/v1/applications`

### POST `/api/v1/applications`

- **Auth:** session · **Rate-limited** · **Idempotency-Key: supported**
- **Request:** `{ "universityId": "uni_099", "programId": "prg_204" }`
- **Response (201):** `{ "success": true, "data": { "applicationId": "app_01J...", "status": "DRAFT", "universityId": "uni_099", "programId": "prg_204" } }`
- **Key errors:** `403 ENTITLEMENT_REQUIRED` (creating an application against a TARGET/SAFE program the student hasn't unlocked), `409 CONFLICT` (`APPLICATION_ALREADY_EXISTS` for this student+program).

### POST `/api/v1/applications/:id/submit`

- **Auth:** session · **Rate-limited** · **Idempotency-Key: required**
- **Request:** `{}` (no body needed beyond the idempotency key — by the time an application is submittable it has already progressed through the canonical Application state machine's pre-submission states; see below)
- **Response (200):** `{ "success": true, "data": { "applicationId": "app_01J...", "status": "SUBMITTED", "submittedAt": "2026-02-05T09:00:00Z" } }`
- **Behavior:** this endpoint implements transition **P6** of the canonical Application state machine (`31-state-machines.md` §3): an application only becomes submittable once system-driven transitions have already carried it `DRAFT → READY_FOR_REVIEW → READY_TO_SUBMIT` (P2/P4) as its required documents are linked/verified and its application fee is paid — this endpoint does not accept documents or take a payment itself, it performs the final, explicit `READY_TO_SUBMIT → SUBMITTED` confirmation. The transition is a single conditional DB update (`WHERE id=? AND status='READY_TO_SUBMIT'`) executed inside a transaction that also creates the `ApplicationProfileSnapshot`, `ApplicationDocumentSnapshot`, `ProgramSnapshot`, and `RequirementSnapshot` rows — see `48-idempotency.md` §Two-Tab Double Submit for why this conditional update, not the idempotency key alone, is the real guard against duplicate submission from two tabs/devices; full readiness-predicate detail lives in `21-application-management.md`.
- **Key errors:** `409 CONFLICT` (`ALREADY_SUBMITTED`, or `NOT_READY_TO_SUBMIT` if called before P4 has fired).

### GET `/api/v1/applications`

- **Auth:** session · cursor-paginated, filterable by `status`, sortable by `-createdAt`/`-updatedAt`
- **Response:** list of the caller's own applications only — scoped at the query layer to `WHERE studentId = :actorId`, never filtered client-side.

### GET `/api/v1/applications/:id`

- **Auth:** session
- **Response:** full application detail including status history.
- **Key errors:** `404 NOT_FOUND` for any application not owned by the caller (see §10 — never `403`).

---

## 12. Notifications — `/api/v1/notifications`

### GET `/api/v1/notifications`

- **Auth:** session · cursor-paginated, filterable by `read` (`true`/`false`)
- **Response:** list of the caller's own notifications (`id`, `type`, `title`, `body`, `read`, `createdAt`, optional `link`).

### PATCH `/api/v1/notifications/:id/read`

- **Auth:** session
- **Response (200):** `{ "success": true, "data": { "id": "ntf_01J...", "read": true } }`
- **Key errors:** `404 NOT_FOUND` if not owned by caller.

---

## 13. Admin — `/api/v1/admin/*` (representative slice)

Every Admin endpoint requires the specific granular permission named (not just "role = ADMIN" — see `13-authentication-authorization.md` §RBAC) and **always** writes an `AuditLog` entry (`actorId`, `action`, `targetType`, `targetId`, `reason`, `requestId`, `timestamp`) in the same transaction as the effect — an admin action that succeeds on the resource but fails to log is treated as a bug, not an acceptable race (the write is wrapped so both commit together or neither does).

### POST `/api/v1/admin/entitlements/grant`

- **Auth:** session · **Permission:** `entitlement:grant`
- **Request:** `{ "userId": "usr_01J...", "entitlementType": "ASSESSMENT_UNLOCK", "scope": { "assessmentRunId": "run_01J..." }, "reason": "Goodwill unlock — duplicate charge per ticket #4821" }`
- **Response (201):** `{ "success": true, "data": { "entitlementId": "ent_02K...", "source": "ADMIN_GRANT", "grantedBy": "usr_admin_01", "reason": "Goodwill unlock — duplicate charge per ticket #4821" } }`
- **Key errors:** `400 VALIDATION_ERROR` (`reason` is mandatory and non-empty — this is enforced at the schema level, not by convention), `403 FORBIDDEN` (lacks `entitlement:grant`).

### POST `/api/v1/admin/documents/:id/verify`

- **Auth:** session · **Permission:** `document:verify`
- **Request:** `{ "decision": "APPROVED" }` or `{ "decision": "REJECTED", "reason": "Transcript is missing an official seal/signature." }`
- **Response (200):** `{ "success": true, "data": { "documentId": "doc_01J...", "status": "VERIFIED", "verifiedBy": "usr_admin_01" } }`
- **Behavior:** this implements transitions D9/D10 of the canonical Document state machine (`31-state-machines.md` §4) — a document must already be in `PENDING_REVIEW` (i.e., past automated `PROCESSING` with no malware/wrong-type hit, D8) before it's eligible for human verification. `reason` is required on `REJECTED`, optional on `APPROVED`.
- **Key errors:** `400 VALIDATION_ERROR` (`reason` required for rejection), `409 CONFLICT` (`DOCUMENT_NOT_ELIGIBLE` if not currently `PENDING_REVIEW`, e.g. still `PROCESSING` or already `REJECTED`).

### POST `/api/v1/admin/applications/:id/override-status`

- **Auth:** session · **Permission:** `application:override_status`
- **Request:** `{ "newStatus": "OFFER_RECEIVED", "reason": "University portal confirmation received via email, ref #INT-2291" }`
- **Response (200):** `{ "success": true, "data": { "applicationId": "app_01J...", "status": "OFFER_RECEIVED", "overriddenBy": "usr_admin_01" } }`
- **Key errors:** `400 VALIDATION_ERROR` (`reason` required; `newStatus` must be a valid state per the application state machine — not an arbitrary string), `409 CONFLICT` (`INVALID_TRANSITION` if `newStatus` isn't reachable from the current state).

Every one of the three actions above is a concrete instance of the general Admin pattern in `11-api-architecture.md` §3: the Admin controller adds the permission check + mandatory-reason validation + audit log write, then calls straight into the same Documents/Applications/Billing service-layer function a non-admin-facing internal caller would use — it does not reimplement verification or state-transition logic.

## 14. Related Documents

- `11-api-architecture.md` — envelope, pagination, versioning, requestId, error code table these contracts build on
- `13-authentication-authorization.md` — session/RBAC mechanics behind `Auth`/`Permission` fields above
- `14-security-architecture.md` — why locked-field omission and webhook trust rules are non-negotiable
- `47-rate-limiting.md` — concrete limits for every endpoint marked **Rate-limited**
- `48-idempotency.md` — `Idempotency-Key` mechanics and webhook dedup detail
- `15-document-vault-security.md` (referenced, authored separately) — vault upload/verification detail
