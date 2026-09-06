# 32 — File Storage Strategy

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering
**Depends on:** `00-project-charter.md`, `06-system-architecture.md`
**Read alongside:** `15-document-vault-security.md` (security architecture built on top of this storage layer), `42-gdpr-and-data-privacy.md` (retention durations), `41-backup-and-disaster-recovery.md` (platform-wide backup/DR — referenced, not duplicated here)
**Applies to:** Any code or infrastructure that reads or writes object storage on AdmitFlow

---

## 1. Purpose

This document is the concrete storage decision write-up: **where document bytes physically live, how they're organized, and how they're protected against loss or unbounded growth.** It resolves a specific contradiction that existed in an earlier architecture draft and is the binding reference for that decision going forward.

## 2. The Decision: AWS S3, and Only AWS S3

**Decision:** AWS S3 (private buckets, no public ACLs, no public bucket policies of any kind) is the **sole** object storage system for every file AdmitFlow stores — student documents, derived assets (thumbnails/previews), quarantined malware-flagged files, and any future non-document binary asset (e.g., generated PDF exports). Supabase Storage is explicitly and permanently rejected as a storage backend for this platform.

### 2.1 The Contradiction This Resolves

An earlier architecture blueprint proposed Postgres (via Supabase) as the relational database *and* left the door open to using Supabase Storage for document files, on the reasoning that "it's already in the stack, one less vendor." That draft never reconciled this against the platform's own non-negotiable that student documents (passports, financial records) are high-sensitivity by default (`00-project-charter.md` §7, §10) and must never be reachable except via short-lived, server-authorized signed URLs. Having two plausible storage backends in circulation is itself a risk: it invites an engineer or agent to reach for whichever is more convenient in the moment, resulting in a codebase where sensitive files are inconsistently protected depending on which subsystem wrote them. This document closes that door: **there is one storage backend, full stop.**

### 2.2 Why S3 Wins

| Reason | Detail |
|---|---|
| **Single source of truth** | One storage system means one place to audit, one place to apply encryption/retention policy, one IAM model to reason about. Splitting "some files in S3, some in Supabase Storage" doubles the security review surface for zero functional benefit and creates exactly the kind of drift a future incident review would flag as a root cause. |
| **Tighter, more mature IAM-based access control** | S3 bucket policies, IAM roles/conditions, and (per `15-document-vault-security.md` §6) SSE-KMS give fine-grained, independently auditable control over who/what can read or write objects, entirely separate from the application database's own auth model. This defense-in-depth layering — app-level authorization *and* infrastructure-level IAM boundary — is materially harder to replicate to the same maturity level on Supabase Storage, which is designed around a simpler bucket+RLS-policy model tied to the Supabase Postgres instance. |
| **Avoids "public-by-default" storage assumptions** | Supabase Storage buckets are commonly configured public-by-default in tutorials and even in Supabase's own quickstart flows, and its access model leans on Postgres Row Level Security policies evaluated per-request — a good fit for, e.g., user avatars or public marketing assets, but a mismatch for a platform whose primary storage tenant is passports and bank statements. Choosing S3 removes an entire category of "did someone leave a bucket/policy public by accident" risk that is more idiomatic to introduce with Supabase Storage's tooling and defaults. AdmitFlow's buckets are private with no public ACL or public bucket policy, period — see §3. |
| **Decouples object storage from the relational database vendor** | Postgres is accessed via Prisma per `06-system-architecture.md` and may be a managed provider (Neon/RDS) independent of Supabase entirely. Tying file storage to a specific Postgres vendor's bundled storage product would create unnecessary vendor lock-in and complicate a future database migration. |
| **Operational maturity for compliance-adjacent needs** | Cross-region replication, object versioning, lifecycle rules, CloudTrail-based access logging, and KMS integration are all first-class, long-established S3 features this platform needs for the security and retention posture described in `15-document-vault-security.md` and `42-gdpr-and-data-privacy.md`. |

**Binding rule:** Postgres never stores file bytes under any circumstance — not as a `bytea` column, not as a base64 string, not "just for small files." Postgres stores only metadata: keys, checksums, sizes, detected types, state, timestamps, actor references. Any code review that finds file content flowing into a SQL column is a blocking finding, not a style comment.

## 3. Bucket and Key Structure

### 3.1 Buckets

**Decision:** One S3 bucket per environment per logical concern, not one giant bucket for everything:

| Bucket (illustrative naming) | Contents |
|---|---|
| `admitflow-{env}-vault` | Student documents and their versions (the Document Vault — `15-document-vault-security.md`) |
| `admitflow-{env}-vault-quarantine` | Malware-flagged objects moved out of the normal serving path (a **separate bucket**, not merely a prefix, so IAM policy can deny it independently of the main vault bucket's policy — belt-and-suspenders beyond the prefix-level isolation described in the security doc) |
| `admitflow-{env}-derived` | Non-authoritative derived assets (thumbnails/previews generated from documents) — kept separate from the authoritative vault bucket so a bug in derived-asset generation/cleanup can never touch source-of-truth documents |
| `admitflow-{env}-static` | Non-sensitive public assets (marketing images, public catalog imagery) — the **only** bucket in this platform that may ever have any public-read configuration, and even then only via CloudFront/CDN origin access control, never a raw public bucket policy |

`{env}` is one of `dev`, `staging`, `prod` — see §5. Every bucket other than `admitflow-{env}-static` has "Block all public access" enabled at the bucket level as an account-level guardrail, not merely relying on the absence of a public policy.

### 3.2 Key Structure

As specified in `15-document-vault-security.md` §7:

```
vault/{userId}/{documentId}/{version}
```

Applied consistently across buckets with a bucket-appropriate prefix, e.g.:
- Vault: `vault/{userId}/{documentId}/{version}`
- Quarantine: `quarantine/{userId}/{documentId}/{version}` (mirrors the original key path, in the quarantine bucket)
- Derived: `derived/{userId}/{documentId}/{version}/{derivedAssetType}` (e.g., `.../thumbnail`)

**Decision:** No key, in any bucket, is ever derived from a user-supplied filename, and no key ever contains data that would leak information about document category or content type through the path alone beyond what's already implied by which bucket it's in — `documentId` is opaque. Rationale: infrastructure-layer logs (S3 access logs, CDN logs) are not held to the same access-control discipline as the application's own audit log, so keys must be safe to appear in those logs.

## 4. Versioning Strategy

**Decision:** AdmitFlow uses **application-level versioning** (the `{version}` integer segment in the key, backed by a `DocumentVersion` row per version) as the primary versioning mechanism, **plus** S3 bucket versioning enabled as a secondary, storage-layer safety net — not as a substitute for the application-level model.

Rationale for layering both:
- Application-level versioning is what the product and the review workflow actually reason about (`15-document-vault-security.md` §3 and §8) — "version 3 of this student's Passport, currently `REPLACED` because version 4 is `VERIFIED`." This must be explicit and queryable, not inferred from S3 object-version metadata, which the application layer should never need to introspect for ordinary reads.
- S3 bucket versioning is a safety net against operational mistakes (an accidental overwrite at the same key, a bad deploy of the worker's write path) and is what makes S3-side "soft delete" behavior possible (a `DeleteObject` call creates a delete marker rather than immediately destroying the underlying data, within the bucket's configured retention). It is not exposed to or relied upon by application logic for the normal re-upload flow — a re-upload always mints a **new key** (new `{version}` segment) rather than overwriting an existing key, so in practice S3-level versioning of a single key is rarely exercised by normal traffic and exists purely as defense-in-depth.

A re-uploaded document (student replaces a rejected or expired document) always creates a new `DocumentVersion` row and a new object key — it never performs an S3 `PUT` to an existing key. This is what makes the `REPLACED` state in the vault security doc meaningful: the old object is untouched and still retrievable by an authorized party who needs to see prior history (e.g., reviewing what was previously submitted).

## 5. Lifecycle Rules

S3 Lifecycle configuration is the mechanism that executes the retention *policy* whose durations are owned by `42-gdpr-and-data-privacy.md` §4 — this section defines the mechanism, not the durations.

| Rule | Trigger | Action |
|---|---|---|
| Cold-storage transition for superseded versions | A `DocumentVersion` transitions to `REPLACED` or `EXPIRED` | After a policy-defined delay (see `42-gdpr-and-data-privacy.md`), the object transitions from S3 Standard to S3 Glacier Instant Retrieval (or an equivalent infrequent-access tier) rather than immediate deletion — because a `REPLACED`/`EXPIRED` version may still be needed for audit, dispute resolution, or a data-subject export request, but no longer needs hot-tier availability/cost. |
| Scheduled deletion | Retention window (per category, per `42-gdpr-and-data-privacy.md` §4) elapses for a `REPLACED`/`EXPIRED`/`REJECTED` version, or a lawful data-subject deletion request is fulfilled | Lifecycle rule (or, where a request-driven deletion must happen *before* the general lifecycle window, an explicit worker-triggered delete) permanently removes the object. The corresponding `DocumentVersion` row transitions to `DELETED` (metadata tombstone retained — see `15-document-vault-security.md` §3.1) in the same operation, never one without the other. |
| Quarantine purge | A quarantined (malware-flagged) object reaches its own, shorter retention window | Permanent deletion from the quarantine bucket, with an audit entry — see `15-document-vault-security.md` §5. |
| Incomplete multipart upload cleanup | Any abandoned multipart upload older than 24 hours (relevant for large financial-document scans) | Automatic abort/cleanup — standard S3 hygiene rule, prevents orphaned storage cost. |
| Abandoned `UPLOAD_INITIATED` cleanup | An object was never confirmed (signed PUT URL expired, browser never completed the upload) | Not an S3 lifecycle rule — handled by the scheduled reconciliation sweep referenced in `15-document-vault-security.md` §3.3, since there may be no object in S3 at all to apply a lifecycle rule to; this row is cleaned up at the metadata layer. |

**Decision:** Lifecycle transitions and deletions are driven by tags/prefixes set by the application at write time (e.g., a `retention-class` object tag written alongside the upload), not by trying to infer intent purely from object age. Rationale: age alone can't distinguish "this document is old but still the active `VERIFIED` version" from "this document is old and was `REPLACED` three years ago" — the application's state machine is the source of truth for *why* an object should transition or delete, and the tag is how that intent reaches the storage layer's lifecycle engine without requiring a bespoke deletion job to scan the entire bucket.

## 6. Environment Separation

**Decision:** Dev, staging, and production use **entirely separate buckets**, not shared buckets with prefix-based separation. No IAM credential used by dev or staging tooling has any permission — read or write — on a production bucket, under any circumstance, including for debugging.

Rationale: prefix-based separation within one bucket is a common shortcut that inevitably leaks — a misconfigured test script, a copy-pasted bucket name in a `.env.staging` file, or an overly broad IAM policy written "temporarily" for debugging can expose or corrupt real student documents. Full bucket separation makes the blast radius of any lower-environment mistake structurally incapable of touching production data. This also means production document data is never copied into staging/dev for testing purposes in raw form — testing uses synthetic/seeded documents (see `35-testing-strategy.md`), never real student uploads, which is itself a `42-gdpr-and-data-privacy.md`-relevant guarantee (student data does not proliferate into lower-trust environments).

## 7. Backup and Replication

Full backup/DR runbooks, RPO/RTO targets, and restoration procedures for the platform as a whole live in `41-backup-and-disaster-recovery.md` and are not duplicated here. The storage-layer mechanisms this document commits to, which that plan builds on:

- **S3 bucket versioning** (§4) provides point-in-time recoverability against accidental overwrite/delete at the object level within the configured retention of delete markers/prior versions.
- **Cross-region replication (CRR)** is enabled on the production vault and quarantine buckets to a second AWS region, providing resilience against a regional S3 outage or a regional data-loss event. Replicated copies inherit the same encryption-at-rest and access-restriction posture as the source (replication configuration must not relax encryption or public-access settings in the destination region — this is a standing configuration-review item, not a one-time setup step).
- **Non-production buckets are not cross-region replicated** — only production data carries that operational cost, consistent with §6's environment separation.
- This document's job is to guarantee the *storage layer* gives DR tooling something durable and versioned to work with; the actual recovery runbook, backup verification cadence, and RPO/RTO commitments are `41-backup-and-disaster-recovery.md`'s responsibility.

## 8. Related Documents

- `15-document-vault-security.md` — the security architecture (upload/download flow, state machine, validation, malware scanning, access control) built on top of this storage layer
- `42-gdpr-and-data-privacy.md` — retention durations per data category, which this document's lifecycle rules execute
- `41-backup-and-disaster-recovery.md` — platform-wide DR runbook, RPO/RTO targets
- `06-system-architecture.md` — where S3 sits in the overall system diagram
- `35-testing-strategy.md` — why non-production environments never receive real student documents
