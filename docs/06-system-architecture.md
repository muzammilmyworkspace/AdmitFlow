# 06 — System Architecture

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering
**Applies to:** All engineering work; binding on any future refactor

---

## 1. Purpose

This document is the single source of truth for how AdmitFlow's runtime pieces fit together: what runs where, what talks to what, and — critically — why long-running work is never allowed inside the serverless request path. Downstream docs (`07-frontend-architecture.md`, `08-backend-architecture.md`, `33-caching-strategy.md`, `39-deployment-architecture.md`) refine pieces of this diagram; they must not contradict it.

## 2. Locked Architecture Decisions (context for everything below)

These are final. They are restated here only as context; rationale for each lives in its own section further down.

| Concern | Decision |
|---|---|
| Relational data | PostgreSQL (managed — Neon or RDS), accessed exclusively via Prisma ORM |
| Object storage | AWS S3, private buckets only, no public ACLs, accessed only via short-lived server-generated signed URLs. Supabase Storage is rejected. |
| Auth | Custom auth service on our own `User`/`Session`/`Role`/`Permission` tables, argon2id password hashing, OAuth (Google, Apple) wired to our own user model, server-persisted sessions (Postgres + Redis). Supabase Auth is rejected. |
| Request/response runtime | Next.js 15+ App Router (TypeScript, Tailwind) on a serverless-friendly host, covering all pages and `/api/v1/*` route handlers |
| Long-running / durable work | A separate always-on Node.js worker service running BullMQ against Redis — never inside a serverless function |
| Payments | Stripe (primary) + PayPal (secondary); entitlements granted only after signature-verified, idempotent webhook processing |
| Cache + queue substrate | Redis, used both for BullMQ queues and for caching public/reference data, never for private per-student data without strict per-user key isolation |
| API surface | Base path `/api/v1`, organized by bounded module |

## 3. High-Level System Diagram

```
                                  ┌─────────────────────────┐
                                  │        Browser            │
                                  │  (Student / Consultant /  │
                                  │   Admin — Next.js client) │
                                  └────────────┬─────────────┘
                                               │ HTTPS
                                               ▼
                                  ┌─────────────────────────┐
                                  │     CDN / Edge Network    │
                                  │ (static assets, images,   │
                                  │  edge caching, TLS term.) │
                                  └────────────┬─────────────┘
                                               │
                                               ▼
                        ┌──────────────────────────────────────────┐
                        │           Next.js Application               │
                        │        (serverless functions/host)          │
                        │                                              │
                        │  ┌────────────────┐   ┌────────────────┐   │
                        │  │  App Router      │   │ /api/v1/* route │   │
                        │  │  pages (SSR/     │   │ handlers        │   │
                        │  │  streaming)      │   │ (see 08-backend)│   │
                        │  └────────────────┘   └────────────────┘   │
                        │           │                      │           │
                        └───────────┼──────────────────────┼───────────┘
                                    │                      │
              ┌─────────────────────┤                      ├─────────────────────┐
              ▼                     ▼                      ▼                     ▼
     ┌─────────────────┐  ┌─────────────────┐   ┌──────────────────┐  ┌──────────────────┐
     │   PostgreSQL       │  │      Redis        │   │   AWS S3           │  │  Stripe / PayPal   │
     │  (managed: Neon/    │  │  (managed: Upstash │   │ (private buckets,  │  │  webhook + API      │
     │   RDS) via Prisma   │  │  / Redis Cloud)     │   │  signed URLs only) │  │  endpoints          │
     │                     │  │  - BullMQ queues    │   └────────┬──────────┘  └────────┬───────────┘
     │  Users, Sessions,   │  │  - cache-aside       │            │                      │
     │  Roles, Profiles,   │  │    (catalog, config) │            │                      │ webhook POST
     │  Assessments,       │  └─────────┬───────────┘            │                      │ (signed, verified
     │  Applications,      │            │                        │                      │  in route handler)
     │  Payments, Audit    │            │ enqueue jobs           │                      │
     └─────────────────────┘            ▼                        │                      │
                                ┌─────────────────────┐          │                      │
                                │   Worker Service      │◄─────────┴──────────────────────┘
                                │ (always-on Node.js,   │   (webhook route handler verifies
                                │  BullMQ consumers)    │    signature, persists event,
                                │                        │    enqueues reconciliation job —
                                │  - malware/doc scan    │    worker does the heavy lifting)
                                │  - document verify     │
                                │    pipeline steps      │
                                │  - webhook             │
                                │    reconciliation      │
                                │  - transactional email/ │
                                │    notification send    │
                                │  - deadline/booking      │
                                │    reminders             │
                                │  - analytics batch       │
                                │    processing            │
                                │  - university data sync  │
                                └──────────┬───────────────┘
                                           │
                          ┌────────────────┼─────────────────┬───────────────────┐
                          ▼                ▼                 ▼                   ▼
                  ┌───────────────┐ ┌─────────────┐  ┌───────────────┐  ┌──────────────────┐
                  │  AWS S3         │ │ Email/SMS    │  │ Stripe/PayPal  │  │ University data    │
                  │ (scan results,  │ │ provider     │  │ APIs (refunds, │  │ sources (feeds/    │
                  │  derived assets)│ │ (transactional│  │  reconciliation)│  │  scraped/partner    │
                  │                 │ │  send)        │  │                │  │  APIs)              │
                  └───────────────┘ └─────────────┘  └───────────────┘  └──────────────────┘
```

Notes on the diagram:

- The **worker service shares the same Postgres and Redis instances** as the Next.js app (same Prisma schema, same connection conventions) — it is a second compute surface, not a second data model.
- **Nothing in the worker is reachable from the public internet.** It only pulls jobs from Redis/BullMQ and calls out to S3, email, payment, and university-data providers. It has no HTTP listener for end-user traffic (it may expose a private health-check port for its own host's orchestration).
- The Next.js app never talks to email providers, never runs malware scans, and never performs long external syncs directly — it enqueues a job and returns.

## 4. Webhook Entry Path (Stripe / PayPal)

Webhooks are external, adversarial-by-default input and must land in the request/response layer, not the worker, because only the request layer has a public HTTPS endpoint and can synchronously return the fast 2xx/4xx a payment provider retries on.

```
Stripe/PayPal ──POST──▶ /api/v1/payments/webhooks/stripe   (Next.js route handler)
Stripe/PayPal ──POST──▶ /api/v1/payments/webhooks/paypal   (Next.js route handler)
                              │
                              │ 1. Verify signature (Stripe-Signature / PayPal transmission headers)
                              │    using raw request body — reject if invalid (see 14-security-architecture.md)
                              │ 2. Idempotency check: has this event.id been recorded before?
                              │    - if yes: return 200 immediately, no reprocessing
                              │    - if no: persist raw event to `PaymentWebhookEvent` table (Postgres)
                              │ 3. Enqueue a BullMQ job (`payments.reconcile`) referencing the event id
                              │ 4. Return 2xx to the provider within its timeout window
                              ▼
                    Redis (BullMQ queue: payments)
                              │
                              ▼
                    Worker service consumer
                              │  - re-fetches event from Postgres (source of truth, not the HTTP body)
                              │  - applies business rules: grant entitlement, mark invoice paid,
                              │    update subscription/application fee status
                              │  - all of this inside a DB transaction (see §7)
                              │  - retries with backoff on transient failure; dead-letters after N attempts
                              ▼
                    Postgres (Entitlement, Payment, Invoice tables updated)
```

**Decision:** the route handler does the minimum possible work (verify, persist, enqueue, return) and never performs entitlement-granting logic itself, even though it technically could run synchronously within a serverless function's time limit. Rationale: keeping *all* payment business logic in one place (the worker's reconciliation job) means there is exactly one code path that grants entitlements, which is what makes idempotency and auditability tractable — see `48-idempotency.md` for the exact dedup/retry contract. This also means a webhook burst (e.g. Stripe retrying a backlog after an outage) degrades to queue depth, not to serverless concurrency limits or Postgres connection exhaustion.

Client-reported payment success (e.g. a return-URL redirect after checkout) **never** grants entitlement by itself — the UI may show an optimistic "processing" state, but the authoritative unlock only happens once the webhook-driven reconciliation job commits.

## 5. Next.js Serverless Considerations (why the worker split is mandatory, not stylistic)

This section is the canonical rationale referenced by `07-frontend-architecture.md`, `08-backend-architecture.md`, and `39-deployment-architecture.md`. Do not re-litigate it in those docs — link back here.

| Serverless constraint | Why it breaks long-running work | AdmitFlow's rule |
|---|---|---|
| **Cold starts** | Each serverless invocation may spin up a fresh execution environment; unpredictable latency (hundreds of ms to seconds) is acceptable for a page/API response but compounds badly across a multi-step pipeline (e.g. scan → extract → verify → notify) run as a chain of invocations. | Multi-step pipelines run as BullMQ job chains inside one long-lived worker process, not as sequential serverless invocations. |
| **Execution time limits** | Serverless functions on hosts like Vercel have hard wall-clock ceilings per invocation (seconds to a few minutes depending on plan/runtime). Malware scanning a large PDF, transcoding, or re-syncing a university catalog with thousands of rows can exceed this. | Anything whose duration is not bounded and small (target: sub-second to low-single-digit seconds) does not run in a route handler. |
| **No persistent connections** | Serverless functions do not keep long-lived sockets/processes alive between invocations; you cannot "wait" for a slow external system (e.g. a virus-scan engine, a flaky university data source) inside a request without tying up billed execution time and risking timeout. | Anything that waits on a slow external system runs in the worker, which can hold connections, poll, and retry without an inbound request pending. |
| **Connection pooling** | Every serverless invocation potentially opens its own Postgres connection; at 10,000+ students and bursty traffic this can exhaust Postgres's max connections. | The Next.js app uses a pooled/serverless-aware Postgres driver path (e.g. Prisma with a connection pooler such as PgBouncer/Neon's pooled endpoint) and keeps queries short. The worker, being a small fixed number of long-lived processes, holds a small stable connection pool of its own — it does not scale connections with request volume. |
| **No guaranteed "after response" execution** | Code cannot reliably keep running once the HTTP response is sent in a serverless function; a "fire and forget" background call from inside a route handler is not a durable job. | Anything that must survive past the response (retries, delayed execution, guaranteed-once delivery) is a BullMQ job with persistence in Redis, consumed by the worker — never a bare `void someAsyncCall()` inside a route handler. |

**Rule of thumb used across all module design:** if a task (a) can exceed a few seconds, (b) must retry on failure, (c) must run on a schedule/delay, or (d) depends on an external system with unpredictable latency — it is a queued job, full stop. This governs: malware/document scanning, the multi-step document verification pipeline, webhook reconciliation, transactional email/notification delivery, deadline and booking reminders, analytics batch processing, and university data sync.

## 6. Major Subsystems

| Subsystem | Responsibility | Primary data owned |
|---|---|---|
| **Auth** | Signup, login, OAuth (Google/Apple), session issuance/revocation, password reset, email verification | `User`, `Session`, `Credential` |
| **RBAC** | Roles, permissions, permission checks used by every authorized route/service | `Role`, `Permission`, `RolePermission`, `UserRole` |
| **Onboarding/Questionnaire engine** | Profile completion flow, versioned questionnaire definitions, answer capture | `OnboardingProfile`, `Questionnaire`, `QuestionnaireResponse` |
| **Assessment/Matching engine** | Scores a student's profile against eligibility rules and the university catalog; produces versioned, reproducible snapshots | `Assessment`, `AssessmentSnapshot`, `MatchResult` |
| **Document Vault** | Private per-student document storage, metadata, verification status; issues signed upload/download URLs | `Document`, `DocumentVersion` |
| **University Catalog** | Universities, programs, requirements, intakes; public reference data | `University`, `Program`, `Intake`, `Requirement` |
| **Entitlements/Paywall** | Tracks what a student has unlocked (Target/Safe zones, specific unlocks) and gates API responses accordingly | `Product`, `Price`, `Entitlement` |
| **Payments/Billing** | Stripe/PayPal checkout sessions, webhook ingestion, invoices | `Payment`, `Invoice`, `PaymentWebhookEvent` |
| **Applications** | Application packages per student per program, submission state, tracking | `Application`, `ApplicationDocument`, `ApplicationStatusEvent` |
| **Consultation/Booking** | Consultant availability, bookings, paid session reservations | `ConsultantProfile`, `Booking`, `BookingSlot` |
| **Notifications** | In-app + email/SMS delivery, templates, delivery status | `Notification`, `NotificationTemplate` |
| **Admin** | Back-office operations: verification queues, entitlement overrides, content management | (cross-cutting; reads/writes other subsystems' tables under elevated permission) |
| **Audit Logging** | Immutable record of every state-changing action with actor, timestamp, reason | `AuditLogEntry` |
| **Feature Flags** | Gates risky/rolling-out functionality per environment/user segment | `FeatureFlag`, `FeatureFlagOverride` |

## 7. Subsystem Dependency Diagram

```
Auth ─────────────┬─▶ RBAC ─────────────────────────────────────────┐
  │                │                                                 │
  │                └─▶ Audit Logging  ◀───────────────────────────────┼── every subsystem writes here
  ▼                                                                   │
Onboarding/Questionnaire ──▶ Assessment/Matching ──▶ University Catalog
  │                                 │                        ▲
  │                                 ▼                        │
  │                          Entitlements/Paywall ◀── Payments/Billing ◀── Stripe/PayPal webhooks
  │                                 │                        │
  │                                 ▼                        │
  │                          Applications ──▶ Document Vault │
  │                                 │             (S3, signed URLs)
  │                                 ▼
  │                          Consultation/Booking ──▶ Payments/Billing (session fee)
  │
  └────────────────────────────────────────────▶ Notifications ◀── Applications, Consultation,
                                                                     Payments, Admin (all emit events)

Feature Flags — read by: Onboarding, Assessment, Applications, Consultation, Admin (cross-cutting, no owner dependency)
Admin — reads/writes: Auth (user mgmt), Document Vault (verification), University Catalog (content),
        Entitlements (manual grants), Applications (status overrides) — always through service-layer
        functions, never direct table writes, so every admin action still produces an Audit Logging entry.
```

Reading order for dependencies: an arrow means "depends on" / "calls into." Notably:

- **Assessment/Matching** depends on **University Catalog** data *at the version current when the snapshot was taken* — it stores a copy of the relevant catalog version reference, so later catalog edits never retroactively change a past assessment result (see §5 of `00-project-charter.md`, non-negotiable #5).
- **Entitlements/Paywall** is the only subsystem allowed to decide whether Target/Safe match data is included in an Assessment API response; Applications and Document Vault both check entitlement state before allowing submission-related actions that require a paid unlock.
- **Payments/Billing** never calls Entitlements directly from a webhook route handler — it enqueues a worker job, which then calls the Entitlements service inside a transaction (§4, §7 of this doc; detail in `48-idempotency.md`).
- **Notifications** is a sink, not a dependency — no subsystem depends on Notifications succeeding to complete its own transaction; notification delivery is always decoupled via a queued job so a slow/broken email provider never blocks a core write path.

## 8. What This Document Does Not Cover

- Exact Prisma schema / table columns — see the data-model docs.
- Full RBAC permission matrix — see `02-personas-and-roles.md` and the security architecture doc.
- Detailed idempotency/transaction rules — see `48-idempotency.md`.
- Structured logging fields and correlation IDs — see `28-observability.md`.
- Feature flag mechanics — see `46-feature-flags.md`.
- Deployment topology and hosting specifics — see `39-deployment-architecture.md`.
