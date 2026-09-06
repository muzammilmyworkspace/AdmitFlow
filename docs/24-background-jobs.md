# 24 — Background Jobs

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering
**Depends on:** `06-system-architecture.md` (why the worker split is mandatory), `09-database-architecture.md` (idempotency via DB constraints), `23-notification-system.md` (notification delivery jobs), `31-state-machines.md` (states these jobs drive)
**Applies to:** The always-on worker service (BullMQ + Redis) and every job type it runs

---

## 1. Scope and General Policy

Every job type below runs exclusively in the worker service defined in `06-system-architecture.md` §3–5 — never inside a Next.js route handler. This document is the catalog: for each job, its purpose, what triggers it, its retry/backoff/dead-letter policy, and its idempotency contract.

### 1.1 Naming and Queue Convention

Jobs are named `<domain>.<action>` and grouped into queues by domain so queue-level concurrency/rate limits can be tuned independently (e.g. the `payments` queue can run at low concurrency with strict ordering guarantees while `notifications` runs at high concurrency). Queues: `documents`, `assessments`, `notifications`, `payments`, `bookings`, `applications`, `catalog`, `analytics`.

### 1.2 Retry and Backoff — General Rule

**Decision:** every job type uses BullMQ's exponential backoff (`backoff: { type: 'exponential', delay: <base> }`) with a **finite, job-type-specific `attempts` cap** — there is no job type that retries forever. On exhausting `attempts`, BullMQ moves the job to that queue's **dead-letter queue (DLQ)** (implemented as a separate BullMQ queue, `<queue>.dlq`, that the failed job is explicitly moved to via an `onFailed` handler once `attemptsMade >= attempts`, since BullMQ's native "failed" set is not itself alerted-on). Every DLQ has:
- A **PagerDuty/Slack-style alert** (exact tool set in `28-observability.md`) fired on any DLQ insert for `payments`, `documents`, and `notifications` queues (financial/user-facing correctness risk) — immediate, on-call visibility.
- A lower-urgency (dashboard + daily digest) alert for `catalog` and `analytics` DLQ inserts — not user-facing-correctness-critical, but must not silently rot.
- A required admin/engineering action: inspect, fix root cause if systemic, and either manually re-enqueue (after a fix) or explicitly discard (with a logged reason) — a DLQ item is never auto-purged.

### 1.3 Idempotent Handlers — General Rule

**Every job handler must be safe to run twice with the same payload** (a re-delivered job after a worker crash mid-execution, a manual DLQ re-enqueue, or a duplicate enqueue from an upstream retry). This is enforced by:

1. **A natural idempotency key per job**, derived from the source entity + action (e.g. `documentId:scan`, `paymentWebhookEventId:reconcile`, `applicationId:submitted-notification:v1`), passed as BullMQ's `jobId` where feasible — BullMQ refuses to enqueue a second job with the same `jobId` while one is pending/active, which prevents duplicate *enqueue*.
2. **A DB-level guard for duplicate *effect*, not just duplicate enqueue** — because `jobId` dedup does not protect against a job that completed its side effect, then crashed before marking itself done, then got redelivered. The handler itself checks/writes idempotency at the database layer: a unique constraint on `(entityId, jobType)` in the relevant table (e.g. `NotificationDelivery` unique on `(notificationId, channel)`), or a status-guarded conditional update (e.g. "only decrement/charge if `status != PROCESSED`") inside a transaction. This is the same principle as `09-database-architecture.md` §7.2 ("idempotency enforced via DB unique constraints, not app-level checks alone") applied to jobs.
3. Concretely: re-running `document-processing` never double-extracts-and-bills (there is no per-run cost recorded twice); re-running `payment-reconciliation` never double-grants an entitlement (`WebhookEvent`/`PaymentWebhookEvent.providerEventId` uniqueness, per `06-system-architecture.md` §4); re-running `notification-send`/`email-send` never double-sends the same notification (`NotificationDelivery` uniqueness, per `23-notification-system.md`).

### 1.4 Observability

Every job type emits, at minimum (detailed metric names/dashboards in `28-observability.md`):
- **Duration** (histogram, per job type) — start-to-finish wall time.
- **Success/failure counters** (per job type, per failure reason where classifiable — e.g. `malware_detected` vs `provider_timeout` for `malware-scan`).
- **Queue depth** (waiting, active, delayed, failed counts) per queue, polled/exported continuously — a growing `waiting` count on `payments` or `notifications` is a leading indicator of an outage before anything actually fails.
- **DLQ size** per queue, alarmed per §1.2.

## 2. Job Catalog

### 2.1 `documents.malware-scan`

| | |
|---|---|
| **Purpose** | Scan a newly uploaded document object for malware/malicious content before any further processing touches it. |
| **Trigger** | Document state transition `UPLOADED` (D5 in `31-state-machines.md` §4) — enqueued immediately after the server confirms the S3 object exists. |
| **Retry policy** | Exponential backoff, base delay **15s**, factor 2, **5 attempts** (15s, 30s, 60s, 120s, 240s) — scan-service transient failures (engine restart, timeout) are expected to clear quickly; this is the fastest-retrying job in the catalog because it blocks the rest of the document pipeline and the student is actively waiting on it. |
| **Dead-letter** | After 5 attempts, DLQ + immediate alert (documents are user-blocking). Document remains in `PROCESSING`; student sees "still processing" rather than a false rejection. |
| **Idempotency** | `jobId = documentId:scan:v{documentVersionId}`. Handler checks `Document.status` before acting — a redelivered scan on an already-`REJECTED`-for-malware or already-`PROCESSING`-completed document is a no-op. |

### 2.2 `documents.process`

| | |
|---|---|
| **Purpose** | Post-scan processing: metadata extraction, thumbnail/preview generation, OCR/text extraction where applicable (e.g. to support future automated field cross-checks). |
| **Trigger** | Successful completion of `documents.malware-scan` for the same document. |
| **Retry policy** | Exponential backoff, base delay **30s**, factor 2, **5 attempts** (30s, 60s, 120s, 240s, 480s). |
| **Dead-letter** | DLQ + immediate alert. Document stays `PROCESSING`; admin verification queue does not receive it until processing succeeds or an admin is alerted to intervene manually. |
| **Idempotency** | `jobId = documentId:process:v{documentVersionId}`. Re-running overwrites the same derived-asset keys in S3 (deterministic naming) rather than creating duplicates. |

### 2.3 `documents.verify` (automated pre-checks)

| | |
|---|---|
| **Purpose** | Automated sanity checks after processing (file integrity/readability, expected-format heuristics — e.g. flag a document uploaded as a "transcript" that OCR suggests is a blank page) before the item is queued for human review. Hard failures auto-reject; soft passes move to `PENDING_REVIEW`. |
| **Trigger** | Successful completion of `documents.process`. |
| **Retry policy** | Exponential backoff, base delay **30s**, factor 2, **3 attempts** — less transient-failure-prone than scanning (mostly CPU-bound heuristics against an already-fetched object), so a shorter retry budget is appropriate; a failure here is more likely a bug than a flaky dependency. |
| **Dead-letter** | DLQ + immediate alert. Document held at `PROCESSING`. |
| **Idempotency** | `jobId = documentId:verify:v{documentVersionId}`. Transition to `PENDING_REVIEW`/`REJECTED` is a guarded conditional update (only fires from `PROCESSING`). |

### 2.4 `assessments.process`

| | |
|---|---|
| **Purpose** | Run the matching/scoring engine against a student's completed questionnaire + profile, producing a versioned `AssessmentResult` + `AssessmentSnapshot`. |
| **Trigger** | Questionnaire submission completed, or a re-run explicitly requested after a profile update. |
| **Retry policy** | Exponential backoff, base delay **30s**, factor 2, **5 attempts**. Computational and CPU-bound against already-persisted input; failures here are expected to be rare and usually indicate a bug rather than a transient dependency, but external calls (e.g. fetching current catalog data) can still be transient. |
| **Dead-letter** | DLQ + immediate alert (student is actively waiting on their results). |
| **Idempotency** | `jobId = questionnaireResponseId:assess:v{rulesVersion}`. Handler writes `AssessmentResult`+`AssessmentSnapshot` inside one transaction guarded by a unique constraint on `(questionnaireResponseId, rulesVersion)` — a re-run never produces a second result for the same input+rules combination; it either no-ops or (if explicitly a "re-run after profile change") targets a new `questionnaireResponseId`. |

### 2.5 `notifications.email-send`

| | |
|---|---|
| **Purpose** | Call the transactional email provider to deliver one rendered `NotificationTemplate` instance to one recipient. |
| **Trigger** | Enqueued by the notification service (`23-notification-system.md` §1) for every event whose channel mapping includes Email. |
| **Retry policy** | Exponential backoff, base delay **10s**, factor 2, capped at **1 hour** per retry interval, **8 attempts** (10s, 20s, 40s, 80s, 160s, 320s, 640s, capped 1h) — email providers have transient rate limits and brief outages; a wider retry budget than most jobs is justified because email is often the *only* durable channel (§1 of `23`), but it is still capped so a permanently-bad address or a provider outage surfaces as a DLQ alert within a bounded, still-timely window (target: under ~2 hours total). |
| **Dead-letter** | DLQ + immediate alert on `notifications` queue. `NotificationDelivery.status = FAILED` recorded so the in-app notification (delivered independently, see `notifications.send` below) at least reaches the student even if email did not. |
| **Idempotency** | `jobId` derived from `NotificationDelivery.id` (created before enqueue, unique per `(notificationId, channel)`). Handler checks `NotificationDelivery.status` before calling the provider — a redelivered job on an already-`SENT` delivery is a no-op. |

### 2.6 `notifications.send`

| | |
|---|---|
| **Purpose** | Orchestrate delivery for one notification event: write the in-app `Notification` row, resolve which channels apply per the student's `NotificationPreference` (`23-notification-system.md` §4), and enqueue `notifications.email-send` (and, when built, push/SMS jobs) for the resolved channels. |
| **Trigger** | Any domain event listed in `23-notification-system.md` §2. |
| **Retry policy** | Exponential backoff, base delay **10s**, factor 2, **5 attempts**. |
| **Dead-letter** | DLQ + immediate alert. |
| **Idempotency** | `jobId = eventId:notify` (the domain event carries its own unique `eventId`). The in-app `Notification` insert is guarded by a unique constraint on `(userId, eventId)` so a redelivered job never creates a duplicate in-app notification or double-enqueues `email-send`. |

### 2.7 `payments.reconcile`

| | |
|---|---|
| **Purpose** | Authoritative processing of a payment provider webhook event: verify the event is already persisted (route handler already did signature verification + persistence per `06-system-architecture.md` §4), then apply business rules — grant/adjust an `Entitlement`, mark an application fee paid, update a `Subscription` — inside a DB transaction. |
| **Trigger** | Enqueued by the webhook route handler immediately after persisting the raw event. |
| **Retry policy** | Exponential backoff, base delay **60s**, factor 2, capped at **30 minutes** per interval, **10 attempts** — the highest retry budget in the catalog (financial correctness matters more than fast failure; total window spans several hours, mirroring the tolerance payment providers themselves build into their own webhook-retry schedules). |
| **Dead-letter** | DLQ + **immediate, paged** alert (never just a dashboard) — an exhausted payment reconciliation is a financial-correctness incident, not a routine failure, and requires manual reconciliation against the provider's dashboard. |
| **Idempotency** | `jobId = providerEventId:reconcile`. Handler is guarded by the unique constraint on `WebhookEvent.providerEventId`/`PaymentWebhookEvent.providerEventId` (`09-database-architecture.md` §7.2, §9 item 3) — reprocessing the same provider event is a guaranteed no-op after the first successful commit, never a double-grant or double-charge-record. |

### 2.8 `bookings.reminders`

| | |
|---|---|
| **Purpose** | Scan `CONFIRMED` bookings for upcoming sessions and enqueue `BOOKING_REMINDER` notification events at fixed offsets (24h and 1h before session start). |
| **Trigger** | Repeatable BullMQ job, scheduled every 15 minutes (fine enough granularity that no booking's 24h/1h window is missed by more than 15 minutes). |
| **Retry policy** | Exponential backoff, base delay **30s**, factor 2, **5 attempts** for the scan job itself; each individual per-booking reminder it enqueues is a separate `notifications.send` job with its own policy (§2.6). |
| **Dead-letter** | DLQ + dashboard alert (not paged — a missed 15-minute scan cycle self-heals on the next run, since the window check is "has this offset already been sent," not "did the scan run exactly on time"). |
| **Idempotency** | The scan does not directly send; it enqueues `notifications.send` with `eventId = bookingId:reminder:{offset}` (e.g. `...:reminder:24h`), so re-scanning the same booking within the same offset window is deduplicated by `notifications.send`'s own uniqueness guard (§2.6), not by the scan job itself. |

### 2.9 `applications.reminders`

| | |
|---|---|
| **Purpose** | Nudge students who have started but not progressed an application (`DRAFT`/`READY_FOR_REVIEW` with no update in N days) to finish it — distinct from deadline-driven alerts (§2.10). |
| **Trigger** | Repeatable BullMQ job, scheduled daily. |
| **Retry policy** | Exponential backoff, base delay **30s**, factor 2, **5 attempts**. |
| **Dead-letter** | DLQ + dashboard alert. |
| **Idempotency** | Enqueues `notifications.send` with `eventId = applicationId:inactivity-nudge:{date}` — at most one nudge per application per calendar day, deduplicated the same way as §2.8. |

### 2.10 `applications.deadline-alerts`

| | |
|---|---|
| **Purpose** | Fire `DEADLINE_APPROACHING` notifications at T-30/T-14/T-7/T-1 days relative to a program's application deadline, for any application belonging to that program not yet `SUBMITTED`. |
| **Trigger** | Repeatable BullMQ job, scheduled daily (once per day is sufficient granularity for day-level thresholds; deadlines are dates, not instants finer than a day in the UI). |
| **Retry policy** | Exponential backoff, base delay **30s**, factor 2, **5 attempts**. |
| **Dead-letter** | DLQ + dashboard alert (immediate alert if the DLQ rate spikes near a widely-shared deadline, since that indicates many students are affected at once — escalation is by impact, not by job type alone). |
| **Idempotency** | Enqueues `notifications.send` with `eventId = applicationId:deadline-alert:{thresholdDays}` — each threshold fires at most once per application, deduplicated the same way as §2.8. Deadline comparison is always done in UTC against the stored UTC deadline instant; only rendering is timezone-local (per `21-application-management.md` §6). |

### 2.11 `catalog.university-data-sync`

| | |
|---|---|
| **Purpose** | Refresh university/program/intake/requirement catalog data from external sources (partner feeds, scraped sources, manual admin-triggered re-imports). |
| **Trigger** | Scheduled (e.g. nightly) plus an admin-triggered manual "sync now" action for a specific university. |
| **Retry policy** | Exponential backoff, base delay **5 minutes**, factor 2, **3 attempts** — deliberately slower/fewer than most jobs: this is a large external fetch against sources not owned by AdmitFlow, and hammering a slow/rate-limited external source with fast retries risks getting rate-limited or blocked entirely. |
| **Dead-letter** | DLQ + dashboard alert to the data/admin team (not paged — a delayed catalog refresh does not affect any in-flight student action immediately, but must not go unnoticed for days). |
| **Idempotency** | `jobId = universityId:sync:{scheduledDate}`. The import itself is an upsert keyed by the external source's stable identifiers — re-running the same day's sync is safe and produces the same end state (no duplicate `Program`/`Intake` rows), and never silently overwrites a `ProgramSnapshot`/`RequirementSnapshot` already frozen into a submitted application (§4 of `21-application-management.md`). |

### 2.12 `analytics.process`

| | |
|---|---|
| **Purpose** | Batch aggregation for internal reporting/dashboards (funnel metrics, assessment accuracy tracking, conversion analytics) — never on the request-serving path. |
| **Trigger** | Scheduled (e.g. hourly/daily rollups depending on the metric). |
| **Retry policy** | Exponential backoff, base delay **5 minutes**, factor 2, **3 attempts** — lowest urgency job type in the catalog. |
| **Dead-letter** | DLQ + dashboard/warning-level alert only — a missed analytics rollup is not user-facing and does not block any other subsystem; it self-heals on the next scheduled run if the underlying data is still queryable historically. |
| **Idempotency** | Aggregation jobs are pure re-computation over a fixed historical window (`jobId = metricName:{windowStart}:{windowEnd}`) — re-running overwrites the same rollup row, never accumulates. |

## 3. Summary Table

| Job | Queue | Base backoff | Attempts | Alert on DLQ |
|---|---|---|---|---|
| `documents.malware-scan` | `documents` | 15s | 5 | Immediate |
| `documents.process` | `documents` | 30s | 5 | Immediate |
| `documents.verify` | `documents` | 30s | 3 | Immediate |
| `assessments.process` | `assessments` | 30s | 5 | Immediate |
| `notifications.email-send` | `notifications` | 10s (cap 1h) | 8 | Immediate |
| `notifications.send` | `notifications` | 10s | 5 | Immediate |
| `payments.reconcile` | `payments` | 60s (cap 30m) | 10 | Immediate + paged |
| `bookings.reminders` | `bookings` | 30s | 5 | Dashboard |
| `applications.reminders` | `applications` | 30s | 5 | Dashboard |
| `applications.deadline-alerts` | `applications` | 30s | 5 | Dashboard (escalates on volume) |
| `catalog.university-data-sync` | `catalog` | 5m | 3 | Dashboard |
| `analytics.process` | `analytics` | 5m | 3 | Dashboard (warning) |

## 4. What This Document Does Not Cover

- Exact Prometheus/Grafana (or equivalent) metric names and dashboard layout — see `28-observability.md`.
- BullMQ cluster/deployment topology (Redis sizing, worker process count/scaling) — see `39-deployment-architecture.md`.
- The full webhook signature-verification and persistence contract that precedes `payments.reconcile` — see `06-system-architecture.md` §4 and `48-idempotency.md`.
