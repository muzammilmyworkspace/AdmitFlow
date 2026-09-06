# 30 — Validation Rules

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering
**Depends on:** `29-error-handling.md` (`VALIDATION_ERROR` shape), `15-document-vault-security.md` (file content validation detail — referenced, not duplicated), `09-database-architecture.md` (Product/Price as source of truth for pricing)
**Applies to:** Every `/api/v1/*` route handler's input handling

---

## 1. Core Rule

**Every API input — request body, path/query params, relevant headers, and file metadata — is validated against an explicit schema before it touches any business logic, on every request, with no exceptions for "trusted" internal callers.** Frontend validation exists purely for UX responsiveness (instant feedback, fewer round-trips) and is never relied upon for correctness or security — the server re-validates everything from zero, because a request can originate from a modified client, a replayed request, a script, or a bug in the frontend itself.

**Implementation convention:** each route handler defines (or imports) a schema (Zod or equivalent) for its body/params/query, runs it as the very first step, and returns `VALIDATION_ERROR` (400, per `29-error-handling.md` §3) with a `details: [{ field, issue }]` array on failure — before any database call, any authorization check that depends on the input's shape, or any side effect.

**Order of operations in a handler:** (1) authenticate → (2) validate input shape/values → (3) authorize the specific action against the specific resource → (4) execute business logic. Validation happens before authorization only insofar as it's needed to know *which* resource is being addressed (e.g. parsing a UUID path param); it never substitutes for authorization, and authorization failures are never disclosed via validation error wording (see `29-error-handling.md` §5 on IDOR).

## 2. Identity and Credentials

| Rule | Detail |
|---|---|
| **Email format** | RFC 5322-conformant format check, normalized to lowercase and trimmed before comparison/storage. |
| **Email uniqueness** | Enforced by a case-insensitive unique constraint at the database level (not just an application-level pre-check, which is a race condition per `09-database-architecture.md` §7.2) — a duplicate signup attempt returns `CONFLICT` (409), not `VALIDATION_ERROR`, since the input is well-formed but the state (an account with this email already exists) conflicts. |
| **Password strength** | **Decision:** minimum **12 characters**, must include at least **3 of the 4** character classes (uppercase, lowercase, digit, symbol), checked against a breached-password list (k-anonymity range query against a service such as Have I Been Pwned's Pwned Passwords API — only a hash prefix is ever transmitted, never the password itself) and rejected if found. **No forced periodic rotation.** Rationale: this follows current NIST 800-63B guidance — length and breach-checking meaningfully reduce credential-stuffing and brute-force risk, while forced rotation is well-documented to push users toward predictable, weaker password patterns (e.g. incrementing a suffix) and is no longer recommended practice. Password strength requirements are always shown to the student *before* they submit the signup form (per `01-product-requirements.md` §"Auth" — "must show: clear password strength/requirements at signup"), never discovered only after a rejected submission. |
| **Current-password confirmation** | Required on password change and on email change, per `01-product-requirements.md` §"Auth." |
| **Session/OAuth tokens** | Never accepted as free-form client input beyond the standard cookie/header transport — no endpoint accepts a session or reset token as a body field that gets echoed into logs. |

## 3. Academic Data: GPA / Percentage / Grading Scale

Because AdmitFlow serves students from many countries' education systems, a single "GPA out of 4.0" field is insufficient and would silently misvalidate (or misrepresent) a student on a percentage or CGPA-out-of-10 system.

**Decision:** the profile captures an explicit `gradingScale` enum alongside the raw `score`, validated per scale, plus a server-computed `percentageEquivalent` used internally by the matching engine for cross-scale comparison:

| `gradingScale` | Valid `score` range | Conversion to `percentageEquivalent` |
|---|---|---|
| `GPA_4_0` | `0.0`–`4.0` | `score / 4.0 * 100` (documented approximation; matching engine treats this as an approximation, not an exact equivalence, and this caveat is surfaced in assessment explanation copy per the charter's transparency principle) |
| `GPA_5_0` | `0.0`–`5.0` | `score / 5.0 * 100` |
| `CGPA_10` | `0.0`–`10.0` | `score / 10.0 * 100` |
| `PERCENTAGE_100` | `0`–`100` | `score` (identity) |
| `UK_HONOURS` | Enum: `FIRST`, `UPPER_SECOND`, `LOWER_SECOND`, `THIRD`, `PASS` | Fixed lookup table (e.g. First ≈ 90, Upper Second ≈ 75 — exact bands owned by the matching-rules configuration, not hardcoded in validation logic) |
| `OTHER` | Free-text `score` label, no numeric validation | Excluded from percentage-based matching factors; flagged for manual admin classification if it materially affects a match |

Validation rejects (`VALIDATION_ERROR`) any `score` outside the bound for the declared `gradingScale`, and rejects a `score` submitted without a `gradingScale`. The conversion table is versioned configuration (consistent with `09-database-architecture.md` §4's treatment of `AssessmentRule.config`), not inline validation-layer logic, so an admin can add a new national grading scale without a deploy.

## 4. File Metadata Validation

File metadata (declared filename, declared content-type, file size, document category) is validated at the API layer **before** a signed upload URL is issued — rejecting an obviously-invalid request (disallowed extension, size already over the category limit per the client's own reported size, missing required `documentCategory`) without ever touching S3. This is necessarily a first, client-declared-metadata pass only, because uploads go directly from the browser to S3 via the signed URL (never proxied through the Next.js API), so the API layer cannot itself inspect file bytes at request time.

**The authoritative content check happens after upload**, in the worker (`documents.malware-scan` → `documents.process` → `documents.verify` pipeline, `24-background-jobs.md` §2.1–2.3): true MIME/magic-byte sniffing of the actual object bytes, re-verification of file size against the category limit, and extension-vs-content-type consistency checks. A file that passes the pre-upload metadata check but fails the post-upload authoritative check is rejected (`Document` → `REJECTED`, `FILE_INVALID`) even though the signed URL already permitted the upload — the signed URL only grants *permission to attempt* an upload, never a guarantee of acceptance.

**Full specification of the MIME/magic-byte rules, per-category size limits, and the extension allow-list lives in `15-document-vault-security.md`** — this document does not duplicate that table; it states only the two-layer validation sequencing above and the corresponding error codes (`FILE_INVALID` 400, `FILE_TOO_LARGE` 413, per `29-error-handling.md` §3).

## 5. Dates and Deadlines

| Rule | Detail |
|---|---|
| **No past deadlines from admin input** | Creating or updating a `Program`'s application deadline, or an `Intake`'s key dates, rejects (`VALIDATION_ERROR`) any deadline value earlier than the current UTC instant at the time of the write. |
| **Historical data correction is a distinct, narrower path** | Backfilling/correcting a *past* intake's dates for record-accuracy (e.g. fixing a typo'd historical deadline after the fact) is permitted only through an explicitly separate "historical correction" action, gated to `SUPER_ADMIN`, always producing an `AuditLog` entry — never the same code path used to create a new, student-facing open intake. This prevents the common bug pattern of a generic "edit intake" form silently allowing an accidental past-dated deadline to be saved as if it were a new, real deadline. |
| **Internal date consistency** | For a given `Intake`: `applicationOpenDate <= applicationDeadline <= intakeStartDate` is enforced as a single cross-field check, not three independent field validators — a request that fails this ordering returns one `VALIDATION_ERROR` naming which two fields are inconsistent, not three unrelated field errors. |
| **New intakes require a future deadline** | A newly created `Intake` intended to be open for applications must have `applicationDeadline` in the future at creation time (see "no past deadlines" above) — an intake cannot be published already-closed. |
| **Storage and comparison** | All deadline/date fields are stored as UTC `timestamptz` (per `09-database-architecture.md` §6.1) and every comparison in validation logic is performed in UTC — never against a server-local or client-local time — consistent with the platform-wide timezone rule restated in `21-application-management.md` §6 and `23-notification-system.md` §2. |

## 6. Currency and Payment Amounts

| Rule | Detail |
|---|---|
| **Amount must be positive** | Any client-supplied amount field (e.g. in a checkout-initiation request) must be a positive number; zero or negative amounts are rejected at the schema layer before any business logic runs. |
| **Currency must be a valid ISO 4217 code** | Validated against an allow-list matching the currencies actually configured on `Product`/`Price` records — an unsupported or malformed currency code is rejected, not passed through to the payment provider. |
| **The server never trusts a client-supplied amount as the amount to charge.** | **Decision, restated as a hard rule:** a checkout/payment-initiation request's `amount`/`currency` fields (if accepted at all) are used **only** to select which `Price` row the client believes it is quoting — the actual amount charged is always re-derived server-side from the matching `Product`/`Price` record (by `productId` + `currency` + effective date), inside the same request that creates the payment intent. If the client-supplied amount does not match the server-derived amount for that `Price` row, the request is rejected (`CONFLICT` or `VALIDATION_ERROR` depending on whether the mismatch indicates a stale quote or a malformed request — see `29-error-handling.md`), never silently corrected and charged at the server's number without informing the client, and never charged at the client's number. |
| **Stale-quote handling** | Per `01-product-requirements.md` §"Payments," a price is locked at the start of checkout as a short-lived quote and honored through that specific transaction's completion; a quote older than its defined validity window is refreshed (student sees the current price) rather than silently charged at a changed rate. |
| **Idempotency key required** | Every payment-initiating request must carry a client-generated idempotency key tied to the specific student action (unlock purchase, application fee, booking) — enforced at the database layer per `09-database-architecture.md` §7.2, not merely checked-then-written in application code. |

## 7. General Schema Validation Conventions

- **Reject unknown fields** on request bodies by default (strict schema mode) — an unexpected field is more often a client bug or a probing request than a legitimate need, and silently ignoring it hides both.
- **Path/query params are validated with the same rigor as body fields** — a malformed UUID in a path segment returns `VALIDATION_ERROR`, not a 500 from a failed database cast.
- **Enums are validated against the exact canonical values defined in `31-state-machines.md`** where a field represents a state (e.g. filtering applications by `status=SUBMITTED`) — a request using a stale or incorrectly-cased state name (e.g. `submitted` or `Submitted`) is rejected, not coerced.
- **File/text length limits** are enforced on every free-text field (e.g. personal statement, admin rejection reason) to prevent unbounded payloads reaching the database or downstream template rendering.
- **Validation errors are batched, not fail-fast on the first field**, wherever practical — the client receives the full `details` array of every failing field in one response, not one error per round-trip.

## 8. What This Document Does Not Cover

- The full MIME/magic-byte/extension/size-limit table — see `15-document-vault-security.md`.
- Rate limiting (a distinct control from input validation) — see `14-security-architecture.md`.
- The error envelope and code taxonomy that validation failures use — see `29-error-handling.md`.
