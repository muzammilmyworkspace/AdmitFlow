# 41 — Backup and Disaster Recovery

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering
**Applies to:** Postgres, S3, Redis, and the recovery runbooks that depend on them

---

## 1. Purpose

Defines what is backed up, how, how fast AdmitFlow must be able to recover (RPO/RTO), and the high-level runbooks for the failure modes that matter most given the architecture locked in `09-database-architecture.md`: a single Postgres system of record, S3 as the only file store, and Redis as a strictly ephemeral cache/queue layer that is never a system of record.

## 2. RPO / RTO Targets

**Decision:** the following targets are adopted as v1 defaults. Rationale for each is given inline; revisit only with an explicit business case (e.g. a compliance requirement or an incident post-mortem), not as an ad hoc engineering preference.

| System | RPO (max acceptable data loss) | RTO (max acceptable downtime) | Rationale |
|---|---|---|---|
| PostgreSQL (primary DB) | **≤ 15 minutes** | **≤ 4 hours** for a full restore-from-backup scenario; **≤ 15 minutes** for a managed-provider failover (Multi-AZ/standby promotion) | PITR-capable managed Postgres (§3) makes 15-minute RPO achievable via continuous WAL archiving without exotic engineering; 4-hour RTO is generous enough to cover a full point-in-time restore of a database at AdmitFlow's target scale (100–10,000+ students, §6 of `00-project-charter.md`) without requiring a hot standby for the worst-case scenario, while a routine AZ failure is expected to resolve in minutes via the provider's built-in failover, not a manual restore. |
| S3 (documents, generated files) | **Effectively zero** for anything successfully uploaded (versioning + cross-region replication, §4) | **≤ 4 hours** to restore access if a bucket-level incident occurs (misconfiguration, accidental bulk delete) | S3's own durability (11 nines) makes data-loss-from-S3-itself a non-scenario; the real risk is *application-caused* deletion/overwrite, which versioning directly solves (§4). |
| Redis (cache/queue) | **N/A — no durability guarantee, by design** | **≤ 30 minutes** to restore a working queue (fresh empty instance; jobs recovered per §5.3, not restored from a Redis-level backup) | Redis holds no data that must survive a restart intact; the target is "how fast can we stand up a new empty instance and reconcile job state," not "how fast can we restore its contents" (§5). |
| Webhook event history (provider-side) | Bounded by the provider's own retention window (Stripe: 30 days event log via Dashboard/API replay; PayPal: per its webhook simulator/retention) | **≤ 4 hours** to detect and begin replay after an incident is identified | See §5.4 — this is a compensating control for any `WebhookEvent` gap, not a primary backup mechanism. |

Overall platform RTO for a full-region disaster (all systems down) is **≤ 8 hours**, sequenced as: Postgres restore (§3) in parallel with confirming S3 accessibility (§4) → application redeploy pointed at restored DB → Redis fresh instance + queue reconciliation (§5.3) → webhook replay pass (§5.4) → verification (§6) before reopening to traffic.

## 3. PostgreSQL Backup Strategy

### 3.1 Point-in-Time Recovery (primary mechanism)

**Decision:** the managed Postgres provider's built-in continuous backup (WAL archiving) + PITR feature is the primary backup mechanism — AdmitFlow does not run custom `pg_dump` cron jobs as its primary backup path. Rationale: a managed provider's PITR is battle-tested, gives sub-15-minute recovery granularity "for free," and avoids the operational burden and failure modes (a cron job silently failing, dump files not verified restorable) of a hand-rolled dump pipeline.

- Continuous WAL archiving enabled at the provider level, with a minimum **35-day** retention window for point-in-time restore targets (covers the "we didn't notice the data corruption for three weeks" scenario, a realistic risk for slow-burn issues like a buggy backfill migration).
- Automated **daily full snapshots**, retained on a tiered schedule: daily snapshots for 35 days, weekly snapshots for 6 months, monthly snapshots for 3 years — the extended monthly retention aligns with the financial-record retention stance in `09-database-architecture.md` §8 (payments/audit logs must survive for years, so the backup substrate they depend on must too).
- Snapshots and WAL archives are stored **cross-region** from the primary database region (not merely cross-AZ), so a full primary-region outage does not also take out the backups.

### 3.2 Restore Verification

**Decision:** an automated monthly restore drill spins up a snapshot into an isolated, non-production database, runs a schema-and-row-count sanity check plus a small set of application-level smoke queries (can a seeded/known reference row be read back correctly), and tears the instance down. Rationale: an untested backup is not a backup — it's an assumption. This closes the single most common disaster-recovery failure mode (backups existed but had never actually been restored, and turned out to be corrupt/incomplete when finally needed).

### 3.3 Logical Backups (supplementary)

A weekly `pg_dump` (schema + data, custom format) is additionally retained for 90 days as a provider-independent fallback and as the mechanism used for anonymized staging-refresh clones (§2.1 of `51-seed-and-migration-plan.md`'s staging dry-run requirement) — this is a supplementary safety net, not the primary recovery path, since PITR restore is faster and more granular.

## 4. S3 Backup Strategy

### 4.1 Versioning (primary protection against overwrite/delete)

**Decision:** S3 bucket versioning is enabled on every bucket holding student documents, generated PDFs, and application-package exports, with a lifecycle rule that retains prior versions for a minimum of **90 days** after being superseded/deleted before transitioning to a cheaper storage class and eventually expiring per the document-category retention schedule (see `09-database-architecture.md` §8 and privacy/security docs for the authoritative per-category retention periods — this document only sets the *backup* floor, not the product retention policy). Rationale: the dominant S3 risk is not AWS losing data (11-nines durability) but an application bug or a compromised credential issuing an unintended `DeleteObject`/`PutObject` overwrite — versioning makes that recoverable rather than catastrophic.
- MFA Delete is enabled on the production document bucket to prevent a compromised application credential (which the app itself doesn't need MFA-delete rights for) from permanently purging version history.
- The application-layer "delete a document" flow (student- or admin-initiated) issues a soft-delete at the `Document.deletedAt` level (§6.3 of `09-database-architecture.md`) and only removes the S3 object version after the retention/legal-hold window closes via a scheduled cleanup job — so accidental student-initiated deletion is recoverable within that window through the same admin support flow used for any other soft-delete reversal.

### 4.2 Cross-Region Replication

**Decision:** Cross-Region Replication (CRR) is enabled from the primary document bucket to a bucket in a secondary region, asynchronous (standard S3 CRR latency, typically sub-15-minutes, satisfying the same RPO posture as Postgres). Rationale: protects against a full primary-region S3 disruption (rare, but not impossible) independently of Postgres failover, since the two systems have independent failure domains and DR for one must not silently assume the other is healthy.

### 4.3 Signed-URL and Access-Log Retention

S3 server access logs (or CloudTrail data events, whichever the provider setup uses) are retained for 1 year, giving a forensic trail of every object access independent of the application-level `DocumentAuditLog` (§5.4 of `10-database-schema.md`) — a second, infrastructure-level record in case the application's own audit logging is ever the thing under investigation.

## 5. Redis: Ephemeral by Design

### 5.1 What Redis Holds

Per `09-database-architecture.md` §2, Redis is used only for (a) response/query caching and (b) BullMQ job queues (email/notification dispatch, document virus-scan triggering, webhook-processing retries, scheduled reminder jobs). **No data in Redis is ever the sole copy of anything that matters** — this is a design invariant, not an operational accident, and any future use of Redis that would violate it (e.g. storing a booking hold's authoritative state only in Redis) must be rejected at design review.

### 5.2 Backup Stance

**Decision:** Redis is explicitly **not backed up** in the traditional sense (no RDB/AOF-based disaster-recovery snapshot restore procedure) — because a lost Redis instance is handled by *reconciliation from the durable systems of record* (Postgres, S3), not by restoring Redis's own contents. AOF persistence may still be enabled at the infrastructure level purely to reduce the number of in-flight jobs lost on a routine restart (a performance/UX nicety), but no runbook in this document depends on an AOF/RDB file surviving a disaster.

### 5.3 In-Flight BullMQ Job Recovery

**What happens on Redis loss:** any job that was enqueued but not yet completed at the moment Redis is lost (a queued notification, a pending virus-scan trigger, a scheduled booking-reminder, a webhook-processing retry) disappears with the queue. This is a real, accepted gap — mitigated as follows:

| Job type | Recovery mechanism |
|---|---|
| Transactional notifications (email/SMS tied to a state change, e.g. `PAYMENT_SUCCEEDED`, `DOCUMENT_REJECTED`) | The triggering database write (per the transactional-outbox-adjacent pattern) is the source of truth: a reconciliation job, run on Redis/worker restart, scans for `Notification` rows in `status = QUEUED` older than a threshold (e.g. 5 minutes) with no corresponding processed job, and re-enqueues them. This works because `Notification` rows are written to Postgres *before* the BullMQ job is enqueued (write-then-enqueue, never enqueue-then-write), so the durable record of "this needed to be sent" always exists independent of the queue. |
| Scheduled/recurring jobs (booking reminders, entitlement-expiry warnings) | Regenerated from source data on worker restart — a scheduler bootstrap step re-derives "what reminders are due in the next N hours" directly from `Booking`/`Entitlement` tables rather than trusting that previously-scheduled BullMQ delayed jobs survived, so a Redis loss simply means the reminder scheduler recomputes its work list, not that reminders are permanently lost. |
| Document virus-scan triggers | The `Document.status` state machine (`15-document-vault-security.md` §3; §5.1.1 of `10-database-schema.md`) has a `PROCESSING` state covering magic-byte validation and the malware scan; a reconciliation sweep on worker restart re-triggers processing for any document stuck in `PROCESSING` (or an unconfirmed `UPLOADED`) beyond an expected SLA window, rather than assuming the original trigger job's survival. |
| Webhook-processing retry jobs | Superseded by the `WebhookEvent` table itself (§5.4 below) — the queue job is only ever a *dispatch mechanism* for processing an event already durably recorded with `processingStatus`; a reconciliation sweep re-enqueues any `WebhookEvent` row stuck in `RECEIVED`/`PROCESSING` beyond an SLA window. |
| Cache entries (non-queue Redis use) | No recovery needed — caches are rebuilt lazily on next read (cache-aside pattern), by definition. |

**Decision:** the unifying mitigation pattern is *"durable write before enqueue, reconciliation sweep on restart re-derives queue state from Postgres rather than trusting Redis survived."* This is the reason Redis loss is an operational inconvenience (some latency in notification delivery, a worker restart) rather than a data-loss incident — it is a direct consequence of never treating Redis as a system of record (§5.1).

## 6. Recovery Runbooks (high level)

Each runbook below is a sequenced outline for the on-call engineer/incident lead; detailed step-by-step scripts/commands live in the operational runbook repository (out of scope for this document) and must stay consistent with the sequencing and checks stated here.

### 6.1 Database Restore

1. **Declare the incident and freeze writes** where feasible (put the API into read-only/maintenance mode) to stop compounding the problem while the scope is assessed.
2. **Choose the recovery point**: identify the target timestamp (point-in-time restore) or the most recent good snapshot, based on when the corruption/loss is believed to have started.
3. **Restore into a new instance** (never restore in place over the live primary) — PITR-restore a fresh instance from the provider's backup system to the chosen point.
4. **Validate** the restored instance: row counts on key tables (`User`, `Payment`, `Application`, `AuditLog`) compared against the last known-good monitoring snapshot; spot-check the most recent `WebhookEvent`/`Payment` rows against the payment provider's own records for consistency.
5. **Cut over**: repoint the application's database connection to the restored instance (via connection-string/config change, not a DNS-level trick that risks stale connections), run `prisma migrate deploy` if any migrations landed between the restore point and now (they wouldn't be present in the restored data but the schema needs to be current), then lift maintenance mode.
6. **Reconcile the gap**: any writes that happened between the restore point and the incident are, by definition, lost (bounded by the 15-minute RPO target, §2) — reconcile via the compensating controls in §5.4 (webhook replay) for payment-adjacent state, and via user-facing communication/support workflow for anything else (e.g. a student who submitted a document in the lost window is asked to re-confirm/re-upload).
7. **Post-incident**: run the restore-verification checklist (§3.2) against the *actual* incident restore (not just the monthly drill) and document findings.

### 6.2 Storage (S3) Restore

1. **Scope the incident**: which bucket/prefix/object range was affected (accidental bulk delete, unintended overwrite, or a full-bucket/region issue).
2. **For object-level loss/overwrite**: restore the prior object version via versioning (§4.1) — this is the common case and requires no cross-region failover.
3. **For bucket-level or region-level loss**: fail application reads/writes over to the cross-region replica bucket (§4.2), updating the application's configured bucket/region, and validate signed-URL generation works against the replica before lifting maintenance mode.
4. **Reconcile metadata**: cross-check `Document.s3Key`/`checksumSha256` rows in Postgres against what's actually retrievable from the (restored or replica) bucket; any mismatch is flagged for manual student/admin follow-up (re-upload) rather than silently presented as available.

### 6.3 Queue / Job Recovery

1. **Stand up a fresh Redis instance** (no restore-from-backup step needed, per §5.2).
2. **Point BullMQ workers at the new instance** and let each worker's startup reconciliation sweep run (§5.3 table) — this is designed to be automatic, not a manual per-job replay.
3. **Manually verify** the reconciliation swept the expected volume (compare `Notification.status = QUEUED` count before/after, `WebhookEvent` stuck-count before/after) rather than assuming the sweep silently worked.
4. **Monitor for duplicate side effects**: because reconciliation may re-enqueue a job that had actually already completed just before Redis was lost (the completion acknowledgment was in Redis, not Postgres), all job handlers in this system are required to be idempotent (e.g. sending the same `Notification` twice is prevented by checking `status` transitions server-side before dispatch, not by trusting the queue delivered exactly once) — this requirement is stated here because it is the reason §5.3's sweep-based recovery is safe to run.

### 6.4 Webhook Recovery (Replay from Provider)

1. **Identify the gap window** — the time range during which `WebhookEvent` rows may be missing or stuck unprocessed (derived from the incident timeline, e.g. the database-restore gap in §6.1 step 6, or a period the webhook endpoint itself was down/erroring).
2. **Replay from the provider within its retention window**: Stripe supports replaying events from the Dashboard or via the Events API for the account's retention period; PayPal's webhook simulator/history serves the equivalent role. Re-deliver every event in the gap window to the (now healthy) webhook endpoint.
3. **Rely on the idempotency constraint, not manual dedup**: replayed events that were, in fact, already processed before the incident hit the `WebhookEvent` unique constraint on `(provider, providerEventId)` (§8.8 of `10-database-schema.md`) and are safely ignored — this is precisely why that constraint exists, and this runbook is the primary reason it must never be relaxed.
4. **Reconcile any event outside the provider's retention window**: if the gap exceeds what the provider can replay (rare, since provider retention windows typically exceed AdmitFlow's own RPO targets by a wide margin), fall back to comparing the provider's transaction/settlement report (a manually exportable reconciliation report both Stripe and PayPal provide) against local `Payment` rows and manually creating/correcting the affected `Payment`/`Entitlement` rows through an audited admin action (never a direct DB edit, per `09-database-architecture.md` §7's transaction-boundary rule — even a manual reconciliation goes through the payment→entitlement transactional path and produces an `AuditLog` entry).

## 7. Summary of Decisions in This Document

| # | Decision | Rationale (short) |
|---|---|---|
| D1 | RPO ≤ 15 min / RTO ≤ 4 hr for Postgres; RTO ≤ 8 hr platform-wide for a full-region disaster | Achievable with managed PITR without a hot-standby-everywhere architecture; matches AdmitFlow's target scale |
| D2 | Managed-provider PITR is the primary DB backup mechanism; `pg_dump` is supplementary only | Avoids hand-rolled backup pipeline failure modes |
| D3 | Monthly automated restore-drill requirement | An untested backup is not a backup |
| D4 | S3 versioning + 90-day prior-version retention + MFA Delete + cross-region replication | Protects against the dominant real risk (app-caused delete/overwrite), not just AWS-side loss |
| D5 | Redis explicitly not backed up; recovery is reconciliation-from-Postgres on restart, not restore-from-snapshot | Consistent with Redis being strictly ephemeral, never a system of record |
| D6 | Write-then-enqueue pattern + idempotent job handlers as the mechanism that makes queue reconciliation safe | Makes Redis loss an inconvenience, not a data-loss incident |
| D7 | Webhook replay relies on the `WebhookEvent` unique constraint for safe re-processing, with a manual reconciliation-report fallback outside provider retention windows | Reuses the idempotency guarantee already mandated in `10-database-schema.md` rather than inventing a parallel mechanism |
