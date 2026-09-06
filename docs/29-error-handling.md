# 29 — Error Handling

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering
**Depends on:** `30-validation-rules.md` (what produces `VALIDATION_ERROR`), `02-personas-and-roles.md` (authorization errors), `28-observability.md` (log correlation)
**Applies to:** Every `/api/v1/*` route handler and every worker job that surfaces a failure to a human (support ticket, admin UI, student-facing error)

---

## 1. Principles

1. **Every API response, success or failure, carries a `requestId`.** It is generated once per inbound request (middleware, before any business logic runs), attached to every log line produced while handling that request, returned in the response body and as an `X-Request-Id` response header, and is the single string a student or admin gives support to have an issue looked up in logs.
2. **Stack traces and internal error detail are never sent to a client, under any circumstance** — not in a "debug mode" toggle reachable in production, not for admin users, not for 5xx responses. Full detail (stack trace, offending query, request payload with secrets redacted, user/session context) goes to server-side structured logs only, correlated by `requestId`.
3. **One error envelope shape, everywhere.** No endpoint invents its own error body format.
4. **Client-facing messages are written for the person reading them** — clear, actionable, free of internal jargon (no table names, no stack frames, no raw provider error strings passed through verbatim). Internal logs carry the full unfiltered detail a debugging engineer needs.

## 2. Response Envelope

**Success:**
```json
{
  "success": true,
  "data": { }
}
```

**Failure (binding shape for every error response, every endpoint):**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The email address format is invalid.",
    "requestId": "5f2b9e1a-3c4d-4e8a-9b2f-1a2b3c4d5e6f"
  }
}
```

- `code` is always one of the taxonomy values in §3 (a fixed, versioned enum — never a free-form string), so client code can branch on it reliably instead of string-matching `message`.
- `message` is the client-safe, human-readable explanation (§4) — it may vary in wording (e.g. field-specific validation detail) but never leaks internal detail.
- `requestId` is always present, even on errors that occur before any business logic runs (e.g. malformed JSON body) — the request-scoped ID is minted by middleware ahead of routing.
- An error response optionally carries a `details` array for `VALIDATION_ERROR` only (§3, field-level breakdown) — no other error code uses `details`, keeping the envelope predictable.

## 3. Error Code Taxonomy

| Code | HTTP status | Meaning | Typical trigger |
|---|---|---|---|
| `AUTH_REQUIRED` | 401 | No valid session/credential was presented. | Missing/expired session cookie or bearer token on a protected route. |
| `FORBIDDEN` | 403 | The caller is authenticated but not authorized for this action/resource. | A `STUDENT` calling an admin-only endpoint; a consultant requesting a student's data outside an active booking scope (`02-personas-and-roles.md` §3). |
| `VALIDATION_ERROR` | 400 | Request input failed schema validation before touching business logic. | Missing required field, wrong type, out-of-range value (see `30-validation-rules.md`). Carries a `details: [{ field, issue }]` array. |
| `RESOURCE_NOT_FOUND` | 404 | The requested resource does not exist **or** the caller is not authorized to know it exists. | Fetching a document/application/booking by an ID that doesn't resolve to a resource the caller owns — see §5, IDOR handling. |
| `CONFLICT` | 409 | The request is well-formed but cannot be applied given the resource's current state. | Double-submitting an application already `SUBMITTED`; deleting a document still referenced by an active application snapshot (`21-application-management.md` §6); two admins racing on the same optimistic-concurrency `version`. |
| `RATE_LIMITED` | 429 | The caller has exceeded a rate limit. | Excessive login attempts, excessive password-reset requests, API abuse patterns. |
| `PAYMENT_REQUIRED` | 402 | The action requires a payment/entitlement that has not been satisfied. | Attempting to view locked Target/Safe match detail without the corresponding `Entitlement`; attempting to submit an application whose fee is unpaid. |
| `PAYMENT_FAILED` | 402 or 422 | A payment attempt was made and did not succeed. | Card declined, provider-reported failure. `402` when no charge attempt could even be authorized; `422` when the request was well-formed but the payment provider rejected the specific attempt (distinguishes "you can't do this yet" from "you tried and it didn't work"). |
| `WEBHOOK_INVALID` | 400 | An inbound webhook failed signature/authenticity verification. | Stripe/PayPal signature header missing or invalid (`06-system-architecture.md` §4) — always logged and alerted, since a legitimate provider should never send an invalid signature. |
| `FILE_INVALID` | 400 | Uploaded file metadata or content failed validation. | Extension not on the allow-list, magic-byte content-type mismatch (`30-validation-rules.md` §5, `15-document-vault-security.md`). |
| `FILE_TOO_LARGE` | 413 | Uploaded file exceeds the size limit for its document category. | Per-category size limits defined in `15-document-vault-security.md`. |
| `DOCUMENT_ACCESS_DENIED` | 403 | Caller lacks permission to view/download a specific document. | A student requesting another student's document by ID; a consultant requesting a document outside their booking scope. Distinct from generic `FORBIDDEN` so document-access denials are separately auditable/alertable (document privacy is a charter non-negotiable). |
| `ASSESSMENT_NOT_READY` | 409 | An assessment result was requested before processing completed. | Client polls the assessment result endpoint while the `assessments.process` job (`24-background-jobs.md`) is still running. |
| `INTERNAL_ERROR` | 500 | An unexpected server-side failure. | Anything not otherwise classified — unhandled exception, dependency outage not mapped to a more specific code. Always logged with full stack trace server-side; client sees only the generic message in §4. |

**Rule:** a new error condition is always mapped to one of these codes, or the taxonomy is deliberately extended here first — handlers never invent an ad hoc string in the `code` field.

## 4. Client-Facing Message Guidelines vs. Internal Logging Detail

| | Client-facing `message` | Server-side log entry |
|---|---|---|
| **Content** | Plain language, states what happened and (where applicable) what the user can do next. No table/column/service names, no raw exception text, no stack trace, no internal identifiers beyond the `requestId` (which is intentionally opaque). | Full context: stack trace, `requestId`, `userId`/`sessionId` (if authenticated), route + method, sanitized request payload (secrets/PII fields redacted per `14-security-architecture.md`), the specific internal exception/error class, timing. |
| **Example — payment decline** | "Your card was declined. Please check your card details or try a different payment method." | Raw provider decline code (`card_declined` / `insufficient_funds` / etc.), provider request ID, `Payment.id`, full webhook/API response body. |
| **Example — internal error** | "Something went wrong on our end. Please try again, and if the problem continues contact support with reference `{requestId}`." | Full stack trace, the unhandled exception's message/type, request payload, upstream dependency involved. |
| **Example — validation error** | Field-specific: "Password must be at least 12 characters and include a number." | Same message (validation errors are inherently safe to show verbatim — see `30-validation-rules.md`), plus the schema/rule that failed for internal metrics on which validations trip most often. |
| **Never** | Never echo a raw exception message, a SQL error, a third-party SDK error string, or an internal file path back to the client — even for admin-role callers. | Never omit the `requestId` from a log line for a request that returned an error — every error must be findable by the ID given to the user. |

**Rationale for the split:** a clear, non-technical message reduces support burden and avoids leaking implementation detail useful to an attacker (schema names, internal service names, library versions via stack traces); full server-side detail is what actually gets an engineer to a fix quickly. Optimizing only one side of this (e.g. showing raw errors "to save engineering time") fails both goals at once — it neither helps the user nor produces structured, queryable logs.

## 5. Interaction with Object-Level Isolation (IDOR)

Per `02-personas-and-roles.md` §7: when a caller requests a resource by ID that exists but does not belong to them (or is outside their permitted scope), the response is `RESOURCE_NOT_FOUND` (404), **not** `FORBIDDEN` (403) — confirming a resource's existence to an unauthorized caller is itself a data leak (e.g., an attacker enumerating application IDs could learn which ones are valid via a 403-vs-404 timing/response difference). `FORBIDDEN` is reserved for cases where the caller is unambiguously identified and known to lack permission for an action on a resource whose existence is already legitimately known to them (e.g., a `STUDENT` hitting an admin-only endpoint path — the *endpoint's* existence isn't secret, only the *data* is).

## 6. Request Correlation

- `requestId` is a UUID v4, generated per inbound request by the earliest possible middleware layer (before auth, before routing).
- It is propagated into every log line for that request's lifetime, including any downstream calls to the database, S3, or third-party providers made while handling it, and into any BullMQ job enqueued as a direct consequence of that request (as a `causationId`/`requestId` field on the job payload), so a support investigation can trace "the API call that triggered this job" even after the response has long since returned.
- It is never treated as a secret (safe to show to the user, safe to put in a URL for a support link) — it identifies a request for correlation, it does not grant access to anything.

## 7. What This Document Does Not Cover

- The specific Zod/schema-validation rules that produce `VALIDATION_ERROR` — see `30-validation-rules.md`.
- Structured logging field names and log aggregation tooling — see `28-observability.md`.
- Rate-limiting thresholds and algorithm — see `14-security-architecture.md`.
