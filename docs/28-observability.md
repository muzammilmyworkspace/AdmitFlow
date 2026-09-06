# 28 — Observability

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering
**Depends on:** `06-system-architecture.md` (Next.js API + worker split), `09-database-architecture.md`
**Read alongside:** `27-audit-logging.md` (the separate compliance-grade log — see §1 for how the two differ), `25-admin-platform.md` §12.4 (System Health Dashboard consumes the metrics defined here), `34-performance-strategy.md` (latency budgets this document measures against)

---

## 1. Purpose and Scope

This document defines how AdmitFlow observes its own runtime health across both deployed services — the Next.js application (API routes + SSR/SSG pages) and the always-on BullMQ worker (per the locked runtime split) — via four pillars: structured logs, metrics, tracing/correlation, and error monitoring, plus the liveness/readiness health endpoints that tie them together operationally. It is scoped to **operational** telemetry; the immutable compliance audit trail is a separate system defined in `27-audit-logging.md`, and the two must never be merged into one table or one log stream — they have different retention, different readers, and different content rules.

## 2. Structured Logging

**Decision:** All application logs (both services) are structured JSON, one object per line, never freeform `console.log` string interpolation in production code paths. Rationale: freeform logs are unqueryable at scale and force painful regex-based incident response; structured logs are filterable/aggregable in whatever log platform ingests them from day one.

### 2.1 Required Fields

| Field | Type | Notes |
|---|---|---|
| `timestamp` | ISO-8601 UTC | Always UTC, consistent with `09-database-architecture.md` §6.1. |
| `level` | `debug` \| `info` \| `warn` \| `error` \| `fatal` | Standard severity levels; `fatal` reserved for process-crashing conditions. |
| `requestId` | UUID | Generated at the edge (or by the entrypoint handler) for every inbound request; the backbone of correlation (§5). |
| `userId` | UUID, nullable | Included **only** where safe and useful for support/debugging (e.g. "which user hit this 500") — omitted entirely from logs for unauthenticated requests and never populated with anything beyond the user's ID (no email/name inlined into a log line just because it was convenient at the call site). |
| `service` | `web` \| `worker` | Which of the two deployed services emitted the line — mandatory given the runtime split, since logs from both are likely to land in one aggregator. |
| `operation` | string | A stable, human-readable operation name (e.g. `application.submit`, `payment.webhook.process`, `queue.analytics-processing.job`) — not a raw file path or line number. |
| `duration` | number (ms) | Present on completion-of-operation log lines (request handlers, job processors); omitted on intra-operation progress lines. |
| `errorCode` | string, nullable | A stable internal error code (not a raw stack trace dumped into a single field) when `level` is `warn`/`error`/`fatal`. The stack trace itself goes to the error-monitoring tool (§6), not duplicated wholesale into the structured log line. |

Additional contextual fields (e.g. `route`, `method`, `statusCode`, `queueName`, `jobId`) are added per log site as needed, but the seven above are the non-negotiable baseline every log line carries so cross-cutting queries ("all errors for `requestId` X across both services") always work.

### 2.2 What Must Never Be Logged

This is a hard rule, enforced by code review and, where practical, by a lint rule / log-sanitization wrapper that redacts known-sensitive key names before a line is emitted:

- Passwords, password hashes, or password-reset tokens, in any form (even "for debugging").
- Session tokens, JWTs, API keys, OAuth client secrets, webhook signing secrets.
- Full contents of uploaded documents (passport numbers, transcript contents, financial statements) — logs may reference a document by `documentId`, never by dumping parsed/extracted field values.
- Full payment card numbers, CVV, or any other PCI-scoped cardholder data — the payment provider's client-side tokenization means AdmitFlow's own services should never see raw card data to begin with; if a provider ever returns anything card-shaped in an error payload, it is stripped before logging, not passed through.
- Full free-text personal data dumps (e.g. an entire profile object serialized into a log line "just in case") — log the ID, look the record up through its own access-controlled path if more detail is genuinely needed.

This mirrors — and is enforced independently of — the equivalent rule for `AuditLog.metadata` in `27-audit-logging.md` §3.1; the two systems have different readers and different retention, so each must independently uphold the rule rather than relying on the other.

## 3. Health Endpoints

Both services expose the same two-endpoint convention, because they are operated by different orchestration concerns (a load balancer routing traffic to the Next.js app; a process supervisor/orchestrator restarting the worker) that need different signals:

| Endpoint | Purpose | Behavior |
|---|---|---|
| `GET /health` | **Liveness** — "is the process up and able to respond at all." | Returns `200` as long as the process is running and its event loop/request-handling path is responsive. Does **not** check downstream dependencies — a liveness check that fails because the database is briefly slow causes an orchestrator to kill and restart a perfectly healthy process, which makes an outage worse, not better. |
| `GET /ready` | **Readiness** — "is this instance able to actually serve real work right now." | Checks Postgres connectivity (a lightweight `SELECT 1`-equivalent) and Redis connectivity (a lightweight `PING`-equivalent). Returns `200` only if both succeed within a short timeout; returns `503` with a JSON body naming which dependency failed otherwise. Used by the load balancer/orchestrator to decide whether to route traffic to (web) or keep dispatching jobs to (worker) this instance. |

**Worker-specific readiness:** the worker's `/ready` additionally reports whether it is actively connected to the BullMQ/Redis queues it is supposed to be consuming from (not just "can I reach Redis," but "am I registered as a consumer") — a worker that can ping Redis but has silently dropped its queue subscription is not actually ready to do its job.

Neither endpoint requires authentication (they carry no sensitive data — status + which dependency failed, nothing about specific users/records) but both are excluded from the structured request-logging path's `info`-level noise by default (logged only on state transition or at `debug` level) since they are polled frequently by infrastructure.

## 4. Metrics

Metrics are numeric, aggregable time series (counters, histograms, gauges) — distinct from logs (discrete structured events) and used for dashboards/alerting rather than line-by-line investigation. The following are the concrete, required metrics; new features extend this list rather than inventing untracked ad hoc metrics for anything customer-facing.

| Metric | Type | Cut by | Why it matters |
|---|---|---|---|
| API latency | Histogram (p50/p95/p99) | Route group (e.g. `auth`, `applications`, `documents`, `payments`, `admin`) | Route-group granularity (not per-exact-path, which would explode cardinality on dynamic segments) surfaces which area of the product is degrading; ties to the latency budgets in `34-performance-strategy.md`. |
| Error rate | Counter → rate | Route group, status code class (4xx vs 5xx) | 5xx-rate spikes are the primary reliability alert signal; 4xx-rate spikes on auth routes double as a security signal (see authentication failure rate below). |
| DB query latency | Histogram (p50/p95/p99) | Query/operation name | Distinguishes "the app is slow" from "the database is slow" — critical for triaging whether an incident is code, an index gap (`09-database-architecture.md` §9), or infrastructure. |
| BullMQ queue depth | Gauge | Job type (e.g. `analytics-processing`, `document-scan`, `notification-send`, `webhook-retry`) | A growing queue depth for a specific job type is the earliest signal of a stuck/slow worker before anything else notices. |
| BullMQ job failure rate | Counter → rate | Job type | Distinguishes transient retryable failures from a systemic problem with one job processor. |
| Payment webhook failure rate | Counter → rate | Provider, event type | A failed payment webhook is a direct risk to the payment→entitlement atomicity guarantee in `09-database-architecture.md` §7 — this metric is treated as a reliability *and* revenue-integrity signal, alertable at a low threshold. |
| Document-upload failure rate | Counter → rate | Failure stage (client upload, virus/format scan, S3 write, DB metadata write) | Staged so an incident immediately narrows to "uploads are failing at the scan step" rather than a single opaque "uploads are broken" alert. |
| Authentication failure rate | Counter → rate | Failure reason (bad password, unknown email, MFA failure, rate-limited) | Dual-purpose: a reliability signal (is auth infrastructure healthy) **and** a security signal — a spike concentrated on many distinct emails from a narrow IP range is a credential-stuffing indicator worth its own alert threshold distinct from the general error-rate alert. |

**Decision:** all rate-type metrics (error rate, job failure rate, webhook failure rate, upload failure rate, auth failure rate) are tracked as **rates over a rolling window** (e.g. failures per 5 minutes), not raw cumulative counters, because raw counters make "is this getting worse right now" require mental math that a rate metric gives for free — this is the form every alert rule in §4.1 is written against.

### 4.1 Alerting Posture

Alerting thresholds/routing are an operational runbook concern outside this document's scope, but the binding rule is: every metric in the table above has at least one configured alert (not just a dashboard nobody watches), and the payment-webhook-failure and authentication-failure metrics specifically page a human rather than only logging to a dashboard, given their direct revenue-integrity and security implications respectively.

## 5. Tracing and Correlation

**Decision:** AdmitFlow uses **correlation-ID-based tracing** (a `requestId` propagated end-to-end) rather than standing up a full distributed-tracing backend (e.g. OpenTelemetry collector + Jaeger/Tempo) at v1. Rationale: at the target scale (`00-project-charter.md` §6), a well-propagated correlation ID reconstructed via structured log queries answers the same "what happened to this one request across services" question a tracing backend would, at a fraction of the operational overhead — full distributed tracing is a reasonable later upgrade (the `requestId` field is deliberately trace-ID-shaped so migrating to OpenTelemetry later is additive, not a rework) but is not justified as v1 infrastructure.

**Propagation path, concretely:**
1. A `requestId` (UUID v4) is generated at the earliest point a request is handled (edge middleware / the Next.js request entrypoint) if one isn't already present on an inbound header (allowing a future CDN/edge layer to originate it instead).
2. Every structured log line emitted while handling that request includes `requestId` (§2.1).
3. When a request enqueues background work (e.g. submitting an application enqueues a notification job; a payment webhook enqueues analytics processing), the **same `requestId`** is passed into the BullMQ job payload as a `correlationId` field — this is the specific mechanism that lets a single user action be reconstructed across the API → worker boundary, which is otherwise the hardest gap to debug in a queue-based architecture.
4. The worker's job processor includes that `correlationId` in every log line it emits while processing the job, with `service: "worker"`.
5. As a result, filtering the aggregated log stream by one `requestId`/`correlationId` value reconstructs the full path of one user action — the original HTTP request, the DB queries it made, the job(s) it enqueued, and the worker's processing of them — without needing a tracing UI, just a log query.

`requestId` is also returned to the client in an error response body (never in a success response, to avoid noise) so that a user-reported issue ("I got an error") can be tied directly to its full server-side trace from a support ticket.

## 6. Error Monitoring

- Unhandled exceptions (both services) are captured by an error-monitoring tool (e.g. Sentry-equivalent) with `requestId`/`correlationId` attached as tagged context, so an error captured by the tool can be cross-referenced back into the structured log stream for the full surrounding context (request params shape, prior log lines) — the error tool holds the stack trace and grouping/deduplication; the log stream holds the situational narrative; neither replaces the other.
- Error capture respects the same never-log list as §2.2 — error-monitoring SDKs are configured to scrub known-sensitive field names from captured request/context data before transmission, not just from the message string.
- **Alerting:** the error-monitoring tool alerts on error-rate spikes (a sudden increase in a specific error group's occurrence rate, not just "any error occurred," which would be too noisy to act on) and on any **new** error group appearing in production for the first time (a strong signal of a just-shipped regression).
- Every admin-facing "something went wrong" surface in the product includes the `requestId` in the user-visible copy (e.g. "Reference: `a1b2c3d4`") specifically so a support ticket referencing it is immediately actionable via §5's correlation mechanism.

## 7. Summary of Decisions in This Document

| # | Decision | Rationale (short) |
|---|---|---|
| D1 | Structured JSON logging only, no freeform `console.log` in production paths | Queryable at scale; consistent baseline fields across both services |
| D2 | Hard never-log list (secrets, tokens, document contents, card data), enforced independently of the audit log's own rule | Two systems, two readers, each must independently uphold the rule |
| D3 | `/health` (liveness, no dependency checks) and `/ready` (readiness, checks DB + Redis, and queue subscription for the worker) on both services | Prevents an orchestrator from restarting healthy processes over transient downstream slowness |
| D4 | Fixed metrics list (latency, error rate, DB latency, queue depth/failure, webhook failure, upload failure, auth failure), all rate-type metrics as rolling-window rates | Concrete, alertable signals rather than ad hoc per-feature metrics |
| D5 | Correlation-ID-based tracing (`requestId`/`correlationId` propagated into BullMQ job payloads) instead of a full distributed-tracing backend at v1 | Answers the cross-service reconstruction question at the target scale without the operational cost of a tracing backend; additive to upgrade later |
| D6 | Error monitoring tagged with `requestId`, scrubbed of sensitive fields, alerting on rate-spikes and first-seen errors | Actionable alerting instead of raw exception firehose |

## 8. Related Documents

- `27-audit-logging.md` — the separate, compliance-grade immutable log system
- `25-admin-platform.md` §12.4 — System Health Dashboard, the internal UI consuming these metrics
- `34-performance-strategy.md` — latency budgets the API-latency metric is measured against
- `06-system-architecture.md` — the Next.js/worker runtime split this document's service labels (`web`/`worker`) refer to
