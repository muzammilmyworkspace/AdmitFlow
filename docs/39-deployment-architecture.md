# 39 — Deployment Architecture

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering
**Applies to:** All infrastructure/hosting decisions

---

## 1. Deployment Topology (Locked)

| Component | Host | Notes |
|---|---|---|
| Next.js app (pages + `/api/v1/*`) | Serverless-friendly host (e.g. Vercel) | Auto-scaling, per-request billing, CDN/edge built in |
| Worker service (BullMQ consumers) | Long-running container host (e.g. Fly.io / Railway / ECS) | Always-on process(es), never scales to zero, no public HTTP listener for end-user traffic |
| PostgreSQL | Managed provider (e.g. Neon or RDS) | Pooled connection endpoint used by the serverless app; direct endpoint usable by the worker |
| Redis | Managed provider (e.g. Upstash / Redis Cloud) | Shared by BullMQ (app enqueues, worker consumes) and cache-aside reads/writes |
| AWS S3 | AWS, private buckets | Sole object storage; no public ACLs; accessed only via signed URLs |

This mirrors `06-system-architecture.md` exactly — this document adds hosting-provider-level detail; it does not redefine the architecture.

## 2. Deployment Diagram

```
                         ┌───────────────┐
                         │      User       │
                         └───────┬───────┘
                                 │ HTTPS
                                 ▼
                  ┌─────────────────────────────┐
                  │   CDN / Edge Network            │
                  │  (static assets, TLS, edge      │
                  │   caching of public pages)       │
                  └───────────────┬─────────────────┘
                                  ▼
                  ┌─────────────────────────────────────┐
                  │     Next.js App (serverless host)      │
                  │  ┌───────────┐    ┌──────────────────┐│
                  │  │  Pages/SSR  │    │ /api/v1/* routes  ││
                  │  └───────────┘    └──────────────────┘│
                  └───────┬──────────────┬──────────┬───────┘
                          │              │          │
             ┌────────────┘              │          └────────────┐
             ▼                           ▼                       ▼
    ┌─────────────────┐        ┌─────────────────┐      ┌───────────────────┐
    │   PostgreSQL       │        │      Redis        │      │      AWS S3          │
    │  (managed, pooled   │        │  (managed:         │      │  (private buckets,    │
    │   endpoint for app)  │◄──────┤   Upstash/Redis     │      │   signed URLs only)   │
    │                      │       │   Cloud)             │      └───────────────────┘
    └─────────┬────────────┘       └─────────┬───────────┘
              │ (shared DB)                  │ (shared queues/cache)
              ▼                              ▼
    ┌───────────────────────────────────────────────────┐
    │            Worker Service (long-running host)        │
    │        e.g. Fly.io / Railway / ECS container(s)        │
    │   BullMQ consumers: scanning, verification, webhook     │
    │   reconciliation, email/SMS send, reminders, analytics,  │
    │   university data sync                                    │
    └───────────┬─────────────────┬──────────────────┬──────────┘
                ▼                 ▼                  ▼
      ┌─────────────────┐ ┌────────────────┐ ┌──────────────────────┐
      │  AWS S3            │ │ Email/SMS        │ │ Stripe / PayPal /      │
      │ (scan/derived       │ │ provider          │ │ University data APIs   │
      │  assets)            │ └────────────────┘ └──────────────────────┘
      └─────────────────┘

  Webhook path (separate from the diagram above's top-down flow):

  Stripe/PayPal ──POST──▶ CDN/Edge ──▶ Next.js /api/v1/payments/webhooks/*
                                             │
                                             │ verify signature, persist event, enqueue job
                                             ▼
                                          Redis (queue) ──▶ Worker Service (reconciliation)
```

## 3. Why Webhooks Land on the API Layer, Not the Worker

Stripe and PayPal only know how to call a stable, publicly reachable HTTPS endpoint they can retry against with their own timeout/retry semantics — the worker service is deliberately not internet-facing (`06-system-architecture.md` §3), so it cannot be the webhook target even in principle. The flow is therefore always:

1. **Provider → Next.js route handler** (public, versioned URL, e.g. `/api/v1/payments/webhooks/stripe`). This is the only part of the payment flow exposed to the internet as an inbound target from Stripe/PayPal.
2. **Route handler does only:** signature verification (rejecting anything not provably from the provider), an idempotency check against the provider's `event.id`, persistence of the raw verified event to Postgres, and enqueueing a job onto the Redis-backed BullMQ queue.
3. **Route handler returns 2xx quickly** — within the provider's expected response window — regardless of whether the *business* effect (entitlement grant, invoice update) has happened yet.
4. **Worker consumes the queued job** and performs the actual reconciliation (§4 of `06-system-architecture.md`): re-reading the persisted event (not trusting the in-flight HTTP body a second time), applying the state change inside a transaction, and retrying with backoff if a downstream call (e.g. Stripe API lookup for additional detail) fails transiently.

**Decision:** the heavy/uncertain part of webhook handling (business-rule application, any downstream API calls back to Stripe/PayPal for reconciliation detail, retries) always happens in the worker, never in the route handler, even though the route handler technically could attempt it inline. Rationale: a payment provider's retry policy assumes your endpoint responds fast and reliably; doing slow or retry-prone work inline risks the provider timing out and re-delivering the same webhook, which is exactly the duplicate-delivery scenario idempotency handling exists for — better to acknowledge fast and let the durable queue own retries than to conflate "did we receive the webhook" with "did we finish acting on it."

## 4. Environment-to-Infrastructure Mapping

| Environment | Next.js host target | Worker host target | Postgres | Redis | S3 bucket |
|---|---|---|---|---|---|
| development | Local dev server | Local worker process | Dev-tier managed instance (or local Postgres) | Dev-tier managed instance (or local Redis) | Dev bucket, test-mode credentials |
| staging | Staging deployment (preview/staging environment on the serverless host) | Staging container deployment | Staging Postgres instance, isolated from prod | Staging Redis instance, isolated from prod | Staging bucket, test-mode payment keys |
| production | Production deployment | Production container deployment (health-checked, auto-restarted) | Production Postgres instance | Production Redis instance | Production bucket, live payment keys |

No environment shares a database, Redis instance, or S3 bucket with another (`38-environment-configuration.md` §1). Promotion between environments is a deploy of the same build artifact with different environment configuration — never a manual code change per environment.

## 5. Worker Service Operational Requirements

- **Always-on, not scale-to-zero:** the worker must be running continuously to process time-sensitive jobs (deadline reminders, webhook reconciliation) — it is provisioned as a persistent service (minimum one always-running instance), not an on-demand/cron-only invocation model.
- **Horizontal scale:** additional worker instances/concurrency are added as queue depth or job latency grows (BullMQ supports multiple consumers safely); this is the scale-out lever for background load as student count grows toward 10,000+, independent of the Next.js app's own serverless auto-scaling.
- **Health checks:** the worker exposes a private health/readiness check for its host's orchestration (process alive, Redis reachable, Postgres reachable) — this is operational plumbing, not a public API, and carries no application data.
- **Graceful shutdown:** on deploy/restart, the worker stops accepting new jobs, allows in-flight jobs to finish or checkpoint, and only then exits — a job must not be silently dropped mid-processing by a routine deploy.

## 6. DEMO_MODE in Deployment

Per `38-environment-configuration.md` §5, `DEMO_MODE=true` is rejected by startup config validation whenever `APP_ENV=production`. At the deployment-topology level this means: the production deployment pipeline (`40-ci-cd.md`) never sets `DEMO_MODE=true` in the production environment's secret/config store, and if it were ever set there by mistake, the production Next.js app and worker would both refuse to start rather than silently serving demo behavior to real students. Staging may run with `DEMO_MODE=true` for demo/sales purposes, and its live status is visibly surfaced in the admin UI so no one mistakes a demo deployment for production.

## 7. What This Document Does Not Cover

- CI/CD pipeline stages and gates — see `40-ci-cd.md`.
- The exact environment variable list — see `38-environment-configuration.md`.
- Rollback/incident procedures — see the operations runbook docs (referenced separately).
- Feature-flag-based rollout mechanics — see `46-feature-flags.md`.
