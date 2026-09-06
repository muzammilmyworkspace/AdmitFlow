# 08 — Backend Architecture

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering (Backend)
**Applies to:** All Next.js API route handlers, service-layer code, and the worker service

---

## 1. Two Runtimes, One Codebase Convention

AdmitFlow's backend is deliberately split across two runtimes (rationale in `06-system-architecture.md` §5), but both share the same service-layer code where possible via a shared package/module boundary — a route handler and a worker job are both thin callers of the same service functions wherever the underlying logic is identical (e.g. "grant entitlement" is one function, called by the payment-reconciliation job, not duplicated).

| | Next.js API route handlers | Worker service |
|---|---|---|
| **Runs** | On request, serverless-friendly host | Always-on Node.js process(es), separate deployment |
| **Handles** | Every synchronous request/response: reads, writes that complete in well under a second, issuing signed URLs, enqueuing jobs, webhook ingestion (verify+persist+enqueue only) | Malware/document scanning, document verification pipeline steps, webhook reconciliation (the actual entitlement/state changes), transactional email/notification delivery, deadline/booking reminders, analytics batch processing, university data sync |
| **May call out to** | Postgres (pooled), Redis (cache reads/writes, job enqueue), S3 (issue signed URLs only, never proxy file bytes) | Postgres (pooled), Redis (BullMQ), S3 (read/write objects, scanning), email/SMS providers, Stripe/PayPal APIs, university data source APIs |
| **Must never** | Perform unbounded-duration work, hold a job in memory waiting on an external system, send transactional email directly, run a multi-minute sync | Serve end-user HTTP traffic; it has no public route |

**Rule:** if you're not sure which side a piece of logic belongs on, apply the test in `06-system-architecture.md` §5 (can it exceed a few seconds / must it retry / does it run on a schedule / does it depend on unpredictable external latency). If yes to any: worker.

## 2. Module Boundaries

Backend modules mirror the API base path list exactly — one service module per bounded context, each owning its own Prisma queries for its own tables (cross-module reads happen through the other module's service functions, not by reaching into its tables directly):

```
/api/v1/auth            → services/auth            (signup, login, OAuth callback, logout, session revoke)
/api/v1/users            → services/users            (user profile CRUD, role assignment — admin-gated)
/api/v1/profiles          → services/profiles          (student profile data feeding onboarding/assessment)
/api/v1/onboarding         → services/onboarding         (onboarding step state, draft save/resume)
/api/v1/questionnaires      → services/questionnaires      (versioned questionnaire defs + responses)
/api/v1/assessment           → services/assessment           (scoring engine, snapshot creation/read)
/api/v1/universities          → services/universities          (catalog read, admin write)
/api/v1/programs               → services/programs               (catalog read, admin write)
/api/v1/vault                    → services/vault                    (document metadata, signed URL issuance)
/api/v1/applications               → services/applications               (application lifecycle, submission)
/api/v1/consultation                 → services/consultation                 (consultant availability, booking)
/api/v1/billing                        → services/billing                        (products/prices/invoices read)
/api/v1/payments                         → services/payments                         (checkout session creation, webhook ingestion)
/api/v1/notifications                      → services/notifications                      (in-app read/mark-read; send is worker-only)
/api/v1/admin                                → services/admin (cross-module, elevated permission, always via other modules' services)
```

Each module's internal shape:

```
services/<module>/
├── handlers/            # thin per-route functions called by app/api/v1/<module>/route.ts
├── logic/               # pure business logic (scoring rules, eligibility checks, pricing calc)
├── repository.ts        # Prisma queries scoped to this module's tables
├── schemas.ts           # input/output validation schemas (shared with frontend where applicable)
└── types.ts
```

## 3. Request Lifecycle

Every `/api/v1/*` route handler follows the same fixed pipeline — no shortcuts, no business logic embedded in the handler itself:

```
Incoming request
     │
     ▼
1. Validation        — parse & validate request body/query against the module's schema.
                        Malformed input is rejected here with 400 before touching auth or the DB.
     │
     ▼
2. Authentication     — resolve session from cookie/token (server-persisted session lookup,
                        Postgres + Redis cache of session validity). Missing/invalid → 401.
     │
     ▼
3. Authorization      — RBAC permission check for this route + resource (and, where applicable,
                        object-level ownership check — a student can only touch their own
                        Application/Document/Assessment rows). Missing permission → 403.
                        Entitlement check (paywall) happens here too, where relevant → filters
                        response shape rather than blocking the request outright (see 07 §9).
     │
     ▼
4. Business logic      — delegated entirely to the module's service-layer function
   (service layer)       (services/<module>/logic/*). The route handler calls exactly one
                          service function and does nothing else business-relevant.
     │
     ▼
5. Data layer           — Prisma queries via the module's repository.ts; transactions opened
                          here when the operation spans multiple writes (see §5).
     │
     ▼
6. Response              — typed, normalized envelope (success payload or ApiError shape per
                            07-frontend-architecture.md §4); paywalled fields omitted rather
                            than nulled/blurred (07 §9); structured log emitted with requestId
                            (see §7).
```

**Binding rule:** business logic never lives in a route handler (`app/api/v1/**/route.ts`) or in a UI component. Route handlers only orchestrate steps 1–3 and 6 and call into step 4; UI components only render what a query/mutation hook returns. A route handler file that contains an `if` statement encoding a business rule (eligibility logic, pricing logic, entitlement logic) beyond "is this input valid / is this user allowed" is a defect. This is what keeps the same logic usable from both the Next.js route handler and a worker job without duplication (§1).

## 4. Config Validation at Startup

Both the Next.js app and the worker service validate their required environment variables against a schema at process startup, before accepting any request or picking up any job.

- **Decision:** if any required variable is missing or malformed, the process fails fast and refuses to start (or, for the worker, refuses to begin consuming jobs) — it never "half-starts" and fails on first use of the missing config. Rationale: a payment or document-handling code path silently failing at 2am because `S3_BUCKET` was unset is a worse incident than a deploy that never goes live. The failure message lists every missing/invalid variable in one shot, not just the first one encountered, so a misconfiguration is fixed in one pass.
- The full variable list and `.env.example` contract lives in `38-environment-configuration.md` — this section only establishes the enforcement point (a single config-validation module imported at the top of the app's entrypoint and the worker's entrypoint, both failing the same way).

## 5. Transaction Boundaries (architecture-level; detailed rules in `48-idempotency.md`)

AdmitFlow uses database transactions at specific, well-known seams where partial application of a multi-step write would corrupt state or money. This document names where they apply; the exact idempotency-key and retry contract for each is specified in `48-idempotency.md` and must not be duplicated here.

| Seam | Why a transaction is required |
|---|---|
| **Payment → Entitlement** | Marking an invoice/payment as settled and granting the corresponding `Entitlement` row must be atomic — a crash between the two would either charge without unlocking, or unlock without a recorded charge. |
| **Booking → Reservation** | Reserving a consultant's time slot and creating the `Booking` record must be atomic and guarded against double-booking the same slot (row lock / unique constraint inside the transaction). |
| **Application → Submission** | Marking an `Application` as submitted, snapshotting the documents/answers used, and recording the submission event must be atomic — a partial submission must never appear as "submitted" without its snapshot. |
| **Admin action → Audit log** | Any admin write (override, manual entitlement grant, verification decision) and its corresponding `AuditLogEntry` are written in the same transaction — an admin action that "succeeded" with no audit trail is treated as a bug, not an edge case. |

All four seams run inside the Next.js route handler's data-layer step when the operation is fast and synchronous (e.g. booking a slot), or inside a worker job when the triggering event is asynchronous by nature (e.g. payment webhook reconciliation) — the transaction itself is always local to one Postgres connection/service call, never spread across the HTTP boundary.

## 6. Idempotency Hooks (pointer only)

Route handlers that accept client-supplied mutation requests capable of being retried (booking creation, application submission, checkout session creation) accept and honor an `Idempotency-Key` header, per the contract in `48-idempotency.md`. Webhook ingestion (§4 of `06-system-architecture.md`) is idempotent on the provider's `event.id`. This document only flags which route groups must implement the pattern; it does not restate the mechanism.

## 7. Structured Logging Hook Points (pointer only; full spec in `28-observability.md`)

- Every request is assigned/propagates a `requestId` (from the client's `x-request-id` header if present and well-formed, otherwise generated at the edge of the route handler).
- The `requestId` is attached to: the structured log line for every pipeline step (§3), any enqueued BullMQ job's payload metadata (so worker-side logs for that job carry the same ID), and the response envelope (for client-side error correlation).
- Service-layer functions accept a logging/context object rather than reaching for a global logger, so the same function logs correctly whether invoked from a route handler or a worker job.
- This document only establishes *where* the ID is created and threaded through; log field names, levels, and destinations are specified in `28-observability.md`.

## 8. Worker Service Internal Structure

```
worker/
├── src/
│   ├── queues/            # queue name constants + BullMQ Queue instances (shared with API side for enqueue)
│   ├── processors/        # one processor module per job type, thin — calls into services/<module>/logic
│   │   ├── documents/     # scan, verify pipeline steps
│   │   ├── payments/      # webhook reconciliation
│   │   ├── notifications/ # email/SMS send
│   │   ├── reminders/     # deadline/booking reminders (scheduled jobs)
│   │   ├── analytics/     # batch processing
│   │   └── universityData/# catalog sync
│   ├── config.ts          # startup config validation (§4), shared schema with the Next.js app's config
│   └── index.ts           # process entrypoint: validate config, connect Redis/Postgres, start consumers
```

The worker imports the same `services/<module>/logic` functions the API route handlers use wherever the underlying business rule is shared (e.g. entitlement-granting logic), so there is exactly one implementation of each business rule regardless of which runtime triggers it.

## 9. What This Document Does Not Cover

- Prisma schema details — see the data-model docs.
- Exact idempotency-key mechanics and retry/backoff numbers — see `48-idempotency.md`.
- Logging field names/levels/destinations — see `28-observability.md`.
- Cache-aside implementation and TTLs — see `33-caching-strategy.md`.
- Deployment topology for the worker vs. the Next.js app — see `39-deployment-architecture.md`.
