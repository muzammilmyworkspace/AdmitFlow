# 33 — Caching Strategy

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering (Backend)
**Applies to:** Next.js API layer and worker service

---

## 1. Purpose and Guiding Rule

Redis is AdmitFlow's single caching layer (it also backs BullMQ — see `06-system-architecture.md`). The guiding rule, restated from `00-project-charter.md` non-negotiable #4 (object-level data isolation): **caching must never become a data-isolation bug.** A cache key namespace is chosen so that it is structurally impossible for one student's private data to be served from a cache entry another user's request could hit.

## 2. Classification: What Is Cached, What Is Not

| Category | Examples | Caching policy |
|---|---|---|
| **Public catalog/reference data** | University list, program list, program requirements, intake dates, country/city facets, ranking data | Cached, shared key (no user in the key), moderate TTL |
| **Public marketing/config content** | Marketing page content blocks, static FAQ content, pricing display copy | Cached, shared key, longer TTL |
| **Feature flags / config values** | `FeatureFlag` states, global app config (fee display defaults, non-secret runtime config) | Cached, shared key, short TTL + explicit invalidation on admin change |
| **Per-user derived data, safe to cache briefly** | A student's own assessment result/match summary, a student's own entitlement state | Cached **only** under a key namespaced by `userId`, short TTL (see §4) |
| **Private student data** | Documents (metadata and content), profile PII, questionnaire answers, application content, payment/invoice records | **Never cached.** Always read from Postgres/S3 on demand. |
| **Payment records** | `Payment`, `Invoice`, `PaymentWebhookEvent` rows | **Never cached.** These are read-consistency-critical and low-volume-per-user; caching them risks serving stale entitlement-adjacent state. |

**Decision:** the default for any new data type is "not cached" unless it is explicitly classified above or added to this table with the same public/private/per-user reasoning applied. Rationale: an opt-in cache policy fails safe (worst case: unnecessary DB load); an opt-out policy fails unsafe (worst case: a privacy leak).

## 3. Cache-Aside Pattern

All caching uses cache-aside (lazy population), never write-through, and never as the system of record:

```
Read path:
  1. Compute cache key (see §4 for key shape).
  2. GET key from Redis.
  3. If HIT: return cached value (already the API-shaped payload or a DB-row projection).
  4. If MISS: query Postgres (via the module's repository.ts), SET key in Redis with TTL,
     return the value.

Write path (admin edit to a cached entity, e.g. a university/program record):
  1. Write to Postgres (source of truth) inside the normal service-layer transaction.
  2. Explicitly DELETE the affected cache key(s) (or bump the relevant data-version — see §5).
  3. Never write the new value directly into the cache from the write path — the next read
     repopulates it. This avoids the write path needing to know every derived cache shape
     a reader might want.
```

Postgres is always authoritative. Redis is a lossy accelerator: if the cache is flushed entirely (e.g. Redis restart/failover), the system must continue to function correctly, only slower, until the cache warms back up. Any design where correctness depends on a cache entry existing is rejected.

## 4. Cache Key Conventions

```
catalog:universities:list:{filterHash}          # public, shared
catalog:universities:{universityId}              # public, shared
catalog:programs:{programId}                      # public, shared
config:featureFlags:{environment}                  # public-ish (config, not secret), shared
config:app:{key}                                    # shared

user:{userId}:assessment:latest                      # per-user, strictly namespaced
user:{userId}:entitlements                            # per-user, strictly namespaced
```

**Decision:** every per-user cache key is prefixed `user:{userId}:...` and the service-layer helper that builds these keys takes the authenticated `userId` from the request's resolved session (never from a client-supplied parameter), so a client cannot construct a request that reads another user's cache entry by passing someone else's ID into a key-building function. Rationale: this makes the isolation property enforced by code shape, not by developer discipline alone.

TTLs:

| Key family | TTL | Rationale |
|---|---|---|
| `catalog:*` | 15 minutes | Catalog changes are admin-driven and infrequent; short enough that a stale price/requirement isn't visible for long, long enough to meaningfully cut DB load at scale. |
| `config:featureFlags:*` / `config:app:*` | 60 seconds, plus explicit invalidation on change | Flags must propagate fast when an admin flips one (e.g. a kill switch), so TTL is a safety net, not the primary invalidation path. |
| `user:{userId}:assessment:latest` | 5 minutes | Reduces re-scoring load for a student re-visiting their dashboard; short enough that a newly completed re-assessment shows up promptly, and the write path explicitly invalidates it anyway (§5). |
| `user:{userId}:entitlements` | 60 seconds | Entitlement state gates paid content; short TTL bounds the worst-case staleness window between a webhook-driven grant and it reflecting everywhere, and the payment-reconciliation job explicitly invalidates it on grant (§5) so the TTL is a backstop, not the mechanism. |

## 5. Invalidation Strategy

Two mechanisms, used together:

1. **Explicit invalidation on write** (primary mechanism): the service function that performs an admin edit (university/program update), a payment-driven entitlement grant, or a re-assessment run explicitly deletes or overwrites the specific cache key(s) it affects, in the same service call as the write, after the DB transaction commits.
2. **Data-version keys** (for data that many derived caches/snapshots depend on): a `catalog:dataVersion` integer key in Redis is incremented on any university/program admin write. This version is:
   - embedded in the `filterHash` used for `catalog:universities:list:{filterHash}` keys indirectly by being part of what a full cache-flush-on-mismatch check compares against, and
   - **stamped into every new `AssessmentSnapshot`** at creation time (alongside the questionnaire/scoring-rule version already required by `00-project-charter.md` non-negotiable #5), so a snapshot always records which catalog version it matched against — this is what allows the reproducibility guarantee to hold even though catalog data is cached and mutable going forward.

**Decision:** catalog admin writes bump `catalog:dataVersion` unconditionally (even for a single-university edit), rather than trying to compute precise per-entity invalidation across every derived cache shape. Rationale: catalog writes are low-frequency (admin-driven), so the minor extra cache-miss cost of a coarse version bump is negligible next to the correctness value of not having to enumerate every place a university's data might be cached.

## 6. Explicitly Not Cached — Restated

To close the loop with §2: documents (vault content and metadata), profile PII, questionnaire raw answers, application content, and all payment/invoice/webhook-event records are read from Postgres/S3 on every request, with performance handled instead through indexing, pagination, and `select`/`include` discipline (`34-performance-strategy.md`), not through caching. This is a deliberate trade of a small amount of read latency for the elimination of an entire class of cache-based data leakage risk on the platform's most sensitive data.
