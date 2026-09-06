# 11 — API Architecture

**Document status:** Foundational — v1.0
**Depends on:** `00-project-charter.md`, `02-personas-and-roles.md`
**Read alongside:** `12-api-contracts.md`, `13-authentication-authorization.md`, `14-security-architecture.md`, `47-rate-limiting.md`, `48-idempotency.md`

---

## 1. Purpose

This document defines the conventions every AdmitFlow API endpoint must follow: base path and versioning, module boundaries, request/response envelope, pagination, filtering/sorting, error handling, and request correlation. `12-api-contracts.md` applies these conventions to concrete endpoints; this document is the rulebook those contracts must obey. Any endpoint that deviates from this document without a documented, reviewed exception is a bug, not a style choice.

## 2. Design Principles

- **REST over HTTP/JSON**, resource-oriented, versioned at the URI root: `https://api.admitflow.app/api/v1/...`.
- **Stateless request handling, stateful sessions.** No request-scoped server affinity is required; session state lives in Postgres + Redis (see `13-authentication-authorization.md`), not in server memory, so any API instance can serve any request.
- **Server is the source of truth for authorization and business rules.** The client (web, and eventually mobile) never receives data it is not entitled to "for the frontend to hide" — see §10 and `14-security-architecture.md`.
- **Every module owns its own data and business rules.** Cross-module reads happen through the owning module's service layer, not by another module querying its tables directly, so module boundaries stay real as the codebase grows.
- **JSON in, JSON out.** `Content-Type: application/json` for all bodies except file bytes, which never transit the API directly (see the vault upload flow in `12-api-contracts.md` §Vault and `15-document-vault-security.md`).
- **Backend never sends locked data for the frontend to blur/hide.** This is restated in §10 because it is the platform's most load-bearing API rule, not a nice-to-have.

## 3. Module Boundaries

| Module | Base path | Owns |
|---|---|---|
| Auth | `/api/v1/auth` | Credentials, sessions, OAuth linking, email verification, password reset. Does **not** own profile data. |
| Users | `/api/v1/users` | Core account record (email, role, lifecycle state, account settings). Does **not** own onboarding/profile content. |
| Profiles | `/api/v1/profiles` | Student academic/personal profile data used as assessment input (education history, test scores, target countries, budget, etc.). |
| Onboarding | `/api/v1/onboarding` | The guided, resumable onboarding wizard state machine that populates Profiles. Owns onboarding progress/step data, not the profile fields themselves once committed. |
| Questionnaires | `/api/v1/questionnaires` | Versioned questionnaire schemas and a student's responses to a given version. |
| Assessment | `/api/v1/assessment` | The matching/scoring engine: assessment runs, versioned rule snapshots, and results (Reach/Target/Safe). Reads Profiles, Questionnaire responses, and the University/Program catalog; owns none of them. |
| Universities | `/api/v1/universities` | The university catalog (read-mostly for students; write access is Admin/future University Manager territory). |
| Programs | `/api/v1/programs` | Program-level data nested under universities (degree, discipline, tuition, requirements, deadlines). |
| Vault | `/api/v1/vault` | Document metadata, upload authorization, signed URL issuance, verification status. Never owns file bytes (S3 does) or malware/verification logic (the worker service does). |
| Applications | `/api/v1/applications` | A student's application packages, their state machine, and links to the documents/programs used in each. |
| Consultation | `/api/v1/consultation` | Consultant availability, slots, and bookings. Does not own payment processing. |
| Billing | `/api/v1/billing` | Products, Prices, Entitlements, Subscriptions, Purchases, checkout session creation, and provider webhooks. The only module allowed to talk to Stripe/PayPal. |
| Payments | `/api/v1/payments` | Payment-method-adjacent, provider-agnostic read views (payment history/receipts) built from Billing's records — kept as a distinct read surface so Billing's write/webhook internals aren't exposed 1:1 to the frontend. |
| Notifications | `/api/v1/notifications` | In-app/email/push notification records and read state. Consumes events from every other module; owns none of their data. |
| Admin | `/api/v1/admin` | Cross-module privileged operations (verification, overrides, entitlement grants, catalog management). Every Admin endpoint delegates to the owning module's service layer — Admin does not re-implement business logic, it adds a permission gate + audit log in front of it. |

**Decision:** A module's HTTP layer (controllers/routers) may only call its own service layer directly. Cross-module data needs go through the other module's public service interface (in-process function call in the monolith, not a raw repository/DB query). Rationale: this is what makes module boundaries enforceable in code review even before/if the codebase is ever split into separate deployables, and it's what keeps object-level authorization checks (§10) from being bypassed by a "shortcut" query.

## 4. Versioning Strategy

- The version is in the URI path (`/api/v1`), not a header, so it is visible in logs, browser network tabs, and API docs without extra tooling.
- **Additive, backward-compatible changes ship into `/api/v1` directly**: new optional request fields, new response fields, new endpoints, new enum values consumers are contractually required to handle as "unknown → ignore." Clients must be built to tolerate unknown fields and unknown enum values without breaking (a validation-schema requirement called out in `12-api-contracts.md`).
- **Breaking changes require `/api/v2`**: removing/renaming a field, changing a field's type or semantics, changing required-ness, changing an error code's meaning, or changing an endpoint's authorization behavior in a way old clients would silently misuse.
- **`/api/v2` is introduced module-by-module, not as a platform-wide cutover.** A given resource's v2 controller and serializer sit alongside its v1 counterpart in the same service, both calling the same underlying service-layer functions (the service layer is version-agnostic; only the HTTP-facing controller/DTO layer forks). This avoids duplicating business logic and avoids a big-bang rewrite.
- **Deprecation policy:** a v1 endpoint being superseded gets a `Deprecation: true` and `Sunset: <date>` response header (RFC 8594) the day v2 ships, a minimum 6-month overlap window before v1 removal, and an entry in the API changelog. v1 is never removed silently mid-window.
- **Decision:** we do not support header-based or query-param-based versioning (`Accept: application/vnd.admitflow.v2+json`, `?version=2`). Rationale: URI versioning is the most operationally simple to route, cache, log, and rate-limit per-version, and this platform has no requirement (yet) for the flexibility header-versioning buys at the cost of debuggability.

## 5. Response Envelope

Every response — success or error, every module, every status code — uses exactly one of these two shapes. No endpoint returns a bare array or a bare object.

**Success:**

```json
{
  "success": true,
  "data": { "...endpoint-specific payload..." : "..." },
  "meta": {
    "requestId": "req_01J8X7ZC2K3QK5R6P8N9T4M2AF",
    "pagination": {
      "nextCursor": "eyJpZCI6IjAxSjhYN1pDMksifQ",
      "hasMore": true,
      "pageSize": 20
    }
  }
}
```

`meta.pagination` is present only on list endpoints (§7). `meta.requestId` is present on **every** response, success or error (§9).

**Error:**

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "email must be a valid email address",
    "requestId": "req_01J8X7ZC2K3QK5R6P8N9T4M2AF",
    "details": [
      { "field": "email", "issue": "invalid_format" }
    ]
  }
}
```

- `error.details` is optional and only used for structured, field-level validation failures. It never contains a stack trace, SQL fragment, internal file path, or any other implementation detail.
- `error.message` is a stable, human-readable, non-localized string safe to log and safe to show in a generic form; it is not necessarily the exact copy the frontend renders (frontend copy is looked up from `error.code`, with `message` as a fallback/debug aid).
- **Decision:** stack traces and internal exception messages are never serialized into an HTTP response, in any environment, including staging. They go to server-side logs (correlated by `requestId`) only. Rationale: this is a common accidental-disclosure vector, and "we'll remember to strip it in prod" is not a control — building only one code path (never serialize it) is.

### 5.1 Standard Error Codes

| Code | HTTP status | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request body/query/params failed schema validation. |
| `UNAUTHENTICATED` | 401 | No valid session/credential presented. |
| `INVALID_CREDENTIALS` | 401 | Login attempted with a wrong email/password combination. |
| `EMAIL_NOT_VERIFIED` | 403 | Action requires `VERIFIED`+ lifecycle state; account is still `EMAIL_UNVERIFIED`. |
| `FORBIDDEN` | 403 | Authenticated, but lacks the permission or object-level ownership required. |
| `ENTITLEMENT_REQUIRED` | 403 | Authenticated and authorized to know the resource exists, but lacks the entitlement to view/act on its locked content. |
| `NOT_FOUND` | 404 | Resource does not exist, **or** exists but the actor has no right to know it exists (see §10 — a 404 is returned in both cases so existence isn't leaked). |
| `CONFLICT` | 409 | State-machine conflict (e.g., submitting an already-submitted application), unique-constraint violation, or double-booking a slot. |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Same `Idempotency-Key` replayed with a different request body (see `48-idempotency.md`). |
| `RATE_LIMITED` | 429 | Request exceeded a rate limit (see `47-rate-limiting.md`). |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Declared/detected file type not allowed for the upload context. |
| `PAYLOAD_TOO_LARGE` | 413 | File or request body exceeds the configured size limit. |
| `WEBHOOK_SIGNATURE_INVALID` | 400 | Stripe/PayPal webhook signature failed verification (request is rejected before any processing). |
| `INTERNAL_ERROR` | 500 | Unhandled server fault. Never carries implementation detail. |
| `SERVICE_UNAVAILABLE` | 503 | A required downstream dependency (DB, Redis, S3, payment provider) is degraded. |

This table is the canonical list; `12-api-contracts.md` references these codes per-endpoint rather than redefining them.

## 6. HTTP Status Code Usage

| Status | Used for |
|---|---|
| 200 | Successful GET/PATCH/DELETE, or POST that doesn't create a new resource (e.g., login). |
| 201 | POST that creates a new resource (`Location` header set to the new resource's canonical GET URL). |
| 202 | POST that was accepted for asynchronous processing (e.g., a document verification job, an async assessment run) — response includes the tracking resource id and a `status` field. |
| 204 | Successful request with no response body (rare; AdmitFlow prefers 200 with `data: null` so the envelope+`requestId` is always present — see Decision below). |
| 400 / 401 / 403 / 404 / 409 / 413 / 415 / 429 | Per §5.1. |
| 500 / 503 | Per §5.1. |

**Decision:** AdmitFlow does not use bare `204 No Content` for successful mutations that would otherwise return one — it returns `200` with `data: null` (or the updated resource) instead. Rationale: `204` responses have no body, which means no envelope and no `meta.requestId`, breaking the "every response carries a requestId" guarantee in §9. The one exception is `OPTIONS` preflight responses, which are infrastructure-level, not application responses.

## 7. Pagination

**Decision:** All list endpoints use **cursor-based pagination**, not offset/limit. Rationale: offset pagination degrades in performance and correctness (skipped/duplicated rows) under concurrent writes, which is guaranteed on high-traffic lists like `universities`, `applications`, and `audit-logs`.

Applies to: `GET /universities`, `GET /programs`, `GET /applications`, `GET /vault/documents`, `GET /admin/audit-logs`, `GET /admin/users`, `GET /payments` (and any future list endpoint).

**Request convention:**

```
GET /api/v1/universities?limit=20&cursor=eyJpZCI6IjAxSjhYN1pDMksifQ
```

- `limit` — default `20`, max `100`. A request for `limit > 100` is clamped to `100`, not rejected (never fail a request over a client asking for "too much," just cap it).
- `cursor` — an opaque, base64-encoded, server-signed token (encodes the last-seen sort key, e.g., `{id, createdAt}`). Clients must treat it as opaque and never construct or decode it themselves; doing so is not a supported integration pattern and the encoding may change between releases.

**Response convention:**

```json
{
  "success": true,
  "data": [ { "...": "..." } ],
  "meta": {
    "requestId": "req_...",
    "pagination": {
      "nextCursor": "eyJpZCI6IjAxSjhYN1pDMksifQ",
      "hasMore": true,
      "pageSize": 20
    }
  }
}
```

`nextCursor` is `null` and `hasMore` is `false` on the last page. There is no `previousCursor`/backward pagination in v1 (no current UI need); if added later it is additive (new optional field), not a breaking change.

## 8. Filtering and Sorting Conventions

- **Filtering:** `filter[<field>]=<value>` for exact-match/enum filters (e.g., `filter[status]=SUBMITTED`), and dedicated named query params for ranged/full-text filters that aren't simple equality (e.g., `GET /universities?country=CA&maxTuitionUsd=40000&q=computer+science`). A module's contract in `12-api-contracts.md` documents its exact supported filters — this convention fixes the *shape*, not which fields every endpoint must expose.
- **Sorting:** `sort=<field>` ascending, `sort=-<field>` descending (leading `-` = descending), e.g. `sort=-createdAt`. Multi-key sort is a comma-separated list evaluated left to right: `sort=-matchScore,name`. An unrecognized sort field returns `VALIDATION_ERROR`, not a silent ignore — silently ignoring a bad sort param produces confusing "why isn't this sorted" bugs.
- Every list endpoint documents its default sort (never "unspecified") so pagination cursors are stable — pagination and sorting are coupled; changing `sort` mid-pagination invalidates the cursor (returns `VALIDATION_ERROR` with a clear message if a cursor from a different sort is replayed).

## 9. Request Correlation (`requestId`)

- A `requestId` is generated at the edge — the first point a request hits AdmitFlow infrastructure (load balancer/API gateway middleware), before routing or authentication — for every inbound request, whether it succeeds, fails validation, fails auth, or crashes.
- Format: `req_` + ULID (sortable, timestamp-embedded, safe to log and display).
- It is echoed back to the client two ways: the `X-Request-Id` response header (present on literally every response, including ones that fail before reaching the envelope-building code) and `meta.requestId` / `error.requestId` in the JSON body.
- If a client supplies its own `X-Request-Id` on the request, the server generates its own anyway and does not trust the client-supplied value for correlation (a client value is never treated as authoritative for log correlation — only the server-generated one is used internally); the client-supplied value, if present, is stored alongside as `clientRequestId` for the client's own debugging convenience only.
- Every server-side log line for the lifetime of that request (auth middleware, service-layer logic, DB query logs, worker jobs triggered by it) is tagged with the same `requestId`, making "give me every log line for this failed request" a single query — this is the primary incident-response and support-ticket-triage tool, and it must never be optional/best-effort logging.

## 10. Authorization Is Always Server-Side and Object-Level

Restated here because every endpoint contract in `12-api-contracts.md` depends on it:

- **A valid session plus a guessed/enumerated/known-valid UUID is never sufficient to access another actor's resource.** Every protected read or write performs an explicit ownership/permission check against the specific resource instance being accessed — not just "does this role generally have access to this resource type."
- The correct failure mode for "resource exists but you're not allowed to know that" is `404 NOT_FOUND`, not `403 FORBIDDEN` — a 403 confirms existence to an attacker; a 404 does not. Endpoints where the actor is allowed to know a resource exists but not its content (e.g., a locked TARGET/SAFE match) use `ENTITLEMENT_REQUIRED` (403) deliberately, since existence-of-a-match-slot is not sensitive but its content is — see `12-api-contracts.md` for the exact shape.
- **Locked content is never serialized into a response for the frontend to hide.** If an actor is not entitled to see a field, that field (and any of its identifying siblings — name, id, fee, metadata) is omitted from the JSON entirely at the point the response is built server-side. There is no code path where locked university/program identity data leaves the API layer for a non-entitled student under any query shape, filter, sort, or admin-debug flag. See `12-api-contracts.md` §Universities/§Assessment for worked examples, and `14-security-architecture.md` for why this is treated as the platform's single most critical data-leakage control.
- This rule is uniform across roles: it applies to STUDENT-to-STUDENT isolation, CONSULTANT's booking-scoped access, and ADMIN/SUPER_ADMIN's audited broad access alike — "elevated role" changes *what* a check is allowed to authorize, it never removes the requirement that a check happens. See `13-authentication-authorization.md` §Object-Level Authorization for the implementation pattern (service-layer scoped fetches, never a bare `findById`).

## 11. Related Documents

- `12-api-contracts.md` — concrete endpoint-by-endpoint contracts built on these conventions
- `13-authentication-authorization.md` — session model, RBAC, object-level authorization implementation
- `14-security-architecture.md` — full security architecture
- `47-rate-limiting.md` — per-endpoint-class rate limits
- `48-idempotency.md` — idempotency key handling and webhook dedup
- `15-document-vault-security.md` (referenced, authored separately) — vault upload/storage security detail
