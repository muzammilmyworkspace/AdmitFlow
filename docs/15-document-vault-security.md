# 15 — Document Vault Security Architecture

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering
**Depends on:** `00-project-charter.md`, `02-personas-and-roles.md`, `06-system-architecture.md`
**Read alongside:** `32-file-storage-strategy.md` (where the bytes physically live), `42-gdpr-and-data-privacy.md` (retention/export/deletion), `14-security-architecture.md` (general auth/session model), `35-testing-strategy.md`
**Applies to:** Every code path that creates, reads, verifies, or removes a student document

---

## 1. Purpose and Scope

The Document Vault stores the most sensitive artifacts on the platform: passports, transcripts, degree certificates, language test reports (IELTS/TOEFL/PTE/Duolingo), statements of purpose, CVs, recommendation letters, financial documents (bank statements, sponsorship letters, scholarship award letters), and other supporting documents a university may request. This document is the single source of truth for how a document moves from "required" to "verified" (or "rejected"/"deleted"), who is allowed to touch it at each step, and what gets logged along the way.

This document does **not** cover:
- Where the bytes physically live, bucket/key conventions, lifecycle tiers, or backup mechanics — see `32-file-storage-strategy.md`.
- Retention *durations* per document category and data-subject export/deletion mechanics — see `42-gdpr-and-data-privacy.md`. This document only defines the state-machine *hooks* retention policy drives.
- General session/auth mechanics (how a user gets an authenticated request in the first place) — see `14-security-architecture.md`.

**Non-negotiable, restated from the charter:** No document is ever reachable by a permanent public URL. No authorization decision is ever made by the obscurity of an S3 key. Every access is authorized server-side, per request, against the specific document's ownership/scope — never by role name alone (see `02-personas-and-roles.md` §7, Object-Level Isolation).

**Where audit entries in this document are persisted:** every "AUDIT LOG" reference below is written to the domain-specific, append-only `DocumentAuditLog` table (`10-database-schema.md` §5.4 — high-volume, per-document history: `documentId`, `actorId`/`actorType`, `action`, `fromStatus`/`toStatus`, `metadata`, `createdAt`), using `action = STATUS_CHANGED` for state-machine transitions (with `fromStatus`/`toStatus` populated) and `action = SIGNED_URL_ISSUED` / `REVIEW_RECORDED` for access and review events specifically. The "headline" security- and compliance-relevant events — upload, view, download, verify, reject — **also** produce an entry in the platform-wide `AuditLog` using the canonical event catalog owned by `27-audit-logging.md` §4 (`DOCUMENT_UPLOADED`, `DOCUMENT_VIEWED`, `DOCUMENT_DOWNLOADED`, `DOCUMENT_VERIFIED`, `DOCUMENT_REJECTED`); the finer-grained intermediate transitions this document's state machine requires (e.g. `UPLOAD_INITIATED -> UPLOADED`, `PROCESSING` sub-steps, `malware_detected`, `EXPIRED`, `REPLACED`, `DELETED`) are recorded in `DocumentAuditLog` only, since duplicating every intermediate step into the lower-volume platform `AuditLog` would dilute its signal-to-noise for the ADMIN/SUPER_ADMIN/COMPLIANCE_ADMIN readers `27-audit-logging.md` §5 defines. Any place below that names an event as `document.<something>` is describing the `DocumentAuditLog.action`/`metadata` shape at the level of detail relevant to this document, not inventing a parallel logging table.

## 2. Upload / Download Flow

Every hop below has an explicit authorization check called out. A missing check at any hop is a shipped vulnerability, not a style nit.

```
┌────────────┐
│  Browser    │  Student (or Consultant/Admin acting within a scoped review context)
└─────┬──────┘
      │ (1) POST /api/v1/documents/upload-authorization
      │     { documentCategory, fileName, declaredContentType, declaredSizeBytes }
      ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Authenticated API — Next.js route handler                              │
│                                                                          │
│  AUTH CHECK #1 (identity):        valid session required                │
│  AUTH CHECK #2 (authorization):   does this actor have permission to    │
│     create/replace a document of this category for this student's      │
│     record right now? (owner student; or an ADMIN acting on a support/  │
│     verification ticket, logged; consultants NEVER upload on a         │
│     student's behalf)                                                  │
│  VALIDATION (pre-flight, declared values only — not yet trusted):       │
│     - documentCategory is a known enum value                           │
│     - declaredSizeBytes <= category max (see §4) -- reject early,       │
│       cheap check before we even mint a URL                            │
│     - declaredContentType is in the category's allow-list (advisory    │
│       only at this stage — real enforcement happens server-side on     │
│       the confirmed object, see §4)                                    │
│                                                                          │
│  On success:                                                            │
│     - generate documentId (UUIDv7 or ULID — sortable, non-guessable)   │
│     - compute object key: vault/{userId}/{documentId}/{version}         │
│       (see §7 — never derived from original filename)                  │
│     - create a Document / DocumentVersion row in state                  │
│       UPLOAD_INITIATED (see §3)                                         │
│     - mint a short-lived, single-use S3 pre-signed PUT URL scoped to    │
│       exactly that key, with a content-length range and (where the     │
│       storage provider supports it) a content-type condition            │
│     - AUDIT LOG: document.upload_initiated (actor, documentId, ip, ua)  │
└─────┬────────────────────────────────────────────────────────────────┘
      │ (2) 200 OK { uploadUrl, documentId, expiresInSeconds }
      ▼
┌────────────┐
│  Browser    │  PUT file bytes directly to the pre-signed URL
└─────┬──────┘  Decision: direct-to-S3 upload, never proxied through the
      │         app server's memory/CPU. Rationale: large financial-doc/
      │         transcript PDFs and scanned passports must not consume
      │         serverless function memory or execution time (see
      │         `06-system-architecture.md` §5) and must not transit a
      │         code path that could accidentally log or cache raw bytes.
      ▼
┌────────────┐
│  AWS S3     │  Private bucket. Object written under the pre-authorized
│  (private)  │  key only. Bucket policy denies all public access; SSE
└─────┬──────┘  applied at write time (see §6).
      │ (3) Browser receives S3's 200/ETag on successful PUT
      ▼
┌──────────────────────────────────────────────────────────────────────┐
│ (4) POST /api/v1/documents/{documentId}/upload-confirmation             │
│     { eTag (optional, for provider-side integrity cross-check) }       │
│                                                                          │
│  AUTH CHECK #3: same actor+ownership check as #2, re-verified against   │
│     documentId (never assume the session from step 1 is still the      │
│     same authorized actor — re-check on every hop)                     │
│  - Server performs a HEAD on the object: confirms it exists, reads      │
│    actual size from S3 metadata (never trusts the browser's declared    │
│    size for the state transition)                                      │
│  - Document/DocumentVersion row: UPLOAD_INITIATED -> UPLOADED           │
│  - AUDIT LOG: document.uploaded (actor, documentId, ip, ua, sizeBytes,  │
│    from S3 metadata, not client input)                                 │
│  - Enqueue BullMQ job `documents.process` (documentId, version) —       │
│    the confirmation request returns immediately; nothing below this    │
│    line runs inline in the request (see `06-system-architecture.md`)   │
└─────┬────────────────────────────────────────────────────────────────┘
      │ (5) 202 Accepted { documentId, status: "PROCESSING" }
      ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Background Worker (BullMQ consumer, always-on Node.js service)         │
│                                                                          │
│  Document/DocumentVersion row: UPLOADED -> PROCESSING                  │
│  Step A — Magic-byte / real file-type validation (see §4)              │
│  Step B — Checksum computation (SHA-256) and dedupe check (see §4)      │
│  Step C — Malware scan (see §5)                                        │
│  Step D — (category-specific, optional) derived-asset generation,       │
│           e.g. a thumbnail/preview for image-type uploads, always      │
│           written back to S3 as a new private object, never inline     │
│                                                                          │
│  On all steps passing: PROCESSING -> PENDING_REVIEW                    │
│     AUDIT LOG: document.processing_passed                              │
│     Notification enqueued to the assigned reviewer's queue              │
│  On any step failing (bad type, oversized on real bytes, malware hit,   │
│  corrupt/unreadable file): PROCESSING -> REJECTED                       │
│     AUDIT LOG: document.processing_failed (includes failure reason      │
│     code, never the file content)                                      │
│     Notification enqueued to the student ("re-upload needed")          │
└──────────────────────────────────────────────────────────────────────┘

...separately, on demand...

┌────────────┐
│  Browser    │  Student viewing own vault, or Consultant/Admin reviewing
└─────┬──────┘
      │ (1) GET /api/v1/documents/{documentId}/download-authorization
      ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Authenticated API                                                       │
│  AUTH CHECK: identity valid; requesting actor is (a) the owning         │
│  student, or (b) an ADMIN/reviewer with an active, legitimate scope     │
│  over this document (verification queue assignment, or a consultant     │
│  with booking-scoped share — see `02-personas-and-roles.md` §3)         │
│  Document must be in a state where content is legitimately viewable     │
│  (not, e.g., a soft-deleted/expired document with only metadata          │
│  retained — see §3 state machine)                                      │
│  - Mint a short-lived, single-use S3 pre-signed GET URL scoped to        │
│    exactly this object version's key                                    │
│  - AUDIT LOG: document.download_authorized (actor, documentId,          │
│    ip, ua) — logged at authorization time, not merely on S3 access,     │
│    because S3 access itself is invisible to the app                    │
└─────┬────────────────────────────────────────────────────────────────┘
      │ (2) 200 OK { downloadUrl, expiresInSeconds }
      ▼
┌────────────┐
│  Browser    │  GETs directly from S3 using the signed URL
└────────────┘
```

**Decision:** Signed URLs (both upload PUT and download GET) expire in a short, fixed window — **60–120 seconds for upload PUT URLs, 60 seconds for download GET URLs**. Rationale: the URL is the only thing standing between "authorized" and "anyone with the link"; a short TTL bounds the replay/leak window to something operationally irrelevant (a URL pasted into a chat log or browser history is worthless a minute later) while remaining long enough for normal network conditions.

**Decision:** The download-authorization endpoint is called fresh every time a document is viewed (e.g., every time a preview panel opens), never cached client-side beyond the single signed URL's own TTL. Rationale: this keeps every view attributable to a specific authorization decision and audit entry, and means revoking a user's access (role change, booking expiry, account suspension) takes effect on the very next view attempt with no separate URL-revocation mechanism needed.

## 3. Document State Machine

A document's lifecycle is not a 3-value enum (`pending`/`approved`/`rejected`). It is modeled as an explicit state machine on `DocumentVersion` (a `Document` is the logical slot — e.g., "Passport" — and has one or more `DocumentVersion` rows, one of which is `currentVersion`; see `32-file-storage-strategy.md` §4 for the versioning rationale).

### 3.1 States

| State | Meaning |
|---|---|
| `REQUIRED` | The application/journey stage requires this document category; no version has ever been uploaded. Not a row in `DocumentVersion` — it's the absence of one, surfaced by the requirements engine. |
| `MISSING` | Synonym-state surfaced to the UI for a required-but-absent document past an expected point in the journey (e.g., flagged at application-submission time). Distinguished from `REQUIRED` only by journey-stage context, not a separate DB column — included here because product copy treats them as visibly different states. |
| `UPLOAD_INITIATED` | Upload authorized, signed PUT URL issued, object not yet confirmed present in S3. Transient; if no confirmation arrives within the URL's TTL + a grace window, the row is garbage-collected (see §3.3). |
| `UPLOADED` | Object confirmed present in S3 (via server-side HEAD), raw bytes not yet validated. Transient — a scheduled sweep also catches any row stuck here past a timeout and re-enqueues processing. |
| `PROCESSING` | Background worker actively running magic-byte validation, checksum/dedupe, and malware scan. |
| `PENDING_REVIEW` | Passed all automated checks (real file type valid, size within limit on real bytes, checksum recorded, malware-clean). Waiting on a human reviewer (Admin, or an Application Reviewer in future roles) to verify content correctness (right document, legible, matches the student's declared category, not obviously fraudulent). |
| `VERIFIED` | A reviewer has approved the document as fit for the application(s) it's attached to. |
| `REJECTED` | Either an automated check failed (Step failure in §2/§5) or a human reviewer rejected it with a reason. A rejected document is never silently replaced — see §8. |
| `EXPIRED` | The document (commonly a language test report or a financial statement) has passed a validity window defined by retention/business policy (e.g., a bank statement older than N months is no longer acceptable evidence) — driven by policy, not manual judgment (see §9, and `42-gdpr-and-data-privacy.md`). |
| `REPLACED` | A newer `DocumentVersion` for the same `Document` slot has become `currentVersion`; this version is retained for audit/history but is no longer the active one. |
| `DELETED` | Soft-deleted: object bytes removed from S3 (or scheduled for removal per retention policy), metadata row retained with a tombstone marker for audit continuity. Never a hard SQL `DELETE` of the metadata row while any audit log entry still references it. |

### 3.2 Transition Table

| From | Event / Trigger | To | Who can trigger | Side effects |
|---|---|---|---|---|
| *(none)* | Requirement attached to student's journey/application, no upload yet | `REQUIRED` | System (requirements engine) | None (no audit entry — no document row exists yet) |
| `REQUIRED` | Journey checkpoint reached (e.g., application submission attempted) with document still absent | `MISSING` | System | Notification to student: "document missing" |
| `REQUIRED` / `MISSING` | Student initiates upload, passes upload-authorization checks | `UPLOAD_INITIATED` | Student (owner only) | Signed PUT URL issued; audit log `document.upload_initiated` |
| `UPLOAD_INITIATED` | Upload-confirmation call succeeds, S3 HEAD confirms object exists | `UPLOADED` | System (triggered by student's confirmation call) | Audit log `document.uploaded`; `documents.process` job enqueued |
| `UPLOAD_INITIATED` | Signed URL TTL expires with no confirmation | *(row garbage-collected — no state, see §3.3)* | System (scheduled sweep) | Audit log `document.upload_abandoned`; no notification (nothing happened from the student's perspective) |
| `UPLOADED` | Worker picks up `documents.process` job | `PROCESSING` | System (worker) | Audit log `document.processing_started` |
| `PROCESSING` | Magic-byte check fails, size-on-real-bytes exceeds category max, or file unreadable/corrupt | `REJECTED` | System (worker) | Audit log `document.processing_failed` (reason code, no file content); notification to student: re-upload needed with a specific reason |
| `PROCESSING` | Malware scan flags the object | `REJECTED` | System (worker) | Object moved to quarantine prefix (never deleted silently, see §5); audit log `document.malware_detected` (reason code + scan-engine signature name only, never file content); notification to student (generic "file could not be accepted") and to Admin (specific — security-relevant) |
| `PROCESSING` | All automated checks pass | `PENDING_REVIEW` | System (worker) | Checksum + detected-type recorded; audit log `document.processing_passed`; reviewer-queue notification |
| `PENDING_REVIEW` | Reviewer approves | `VERIFIED` | ADMIN (or future `APPLICATION_REVIEWER`) — never the student, never a consultant | Audit log `document.verified` (actor = reviewer identity); notification to student |
| `PENDING_REVIEW` | Reviewer rejects | `REJECTED` | ADMIN (or future `APPLICATION_REVIEWER`) | **Rejection reason is a required field, not optional** — enforced server-side, not just a UI hint; audit log `document.rejected` (actor, reason); notification to student including the reason |
| `VERIFIED` / `REJECTED` / `PENDING_REVIEW` | Student uploads a new file for the same document slot | *(new `DocumentVersion` created, enters `UPLOAD_INITIATED` on its own; the prior version transitions)* `-> REPLACED` | Student (owner only) | See §8 — a new version is created; the previous version is never overwritten in place; audit log `document.version_replaced` referencing both version ids |
| `VERIFIED` | Validity window elapses per retention/business policy (e.g., test-report validity period) | `EXPIRED` | System (scheduled policy job — see §9) | Notification to student: "document has expired, re-upload required"; audit log `document.expired` |
| `VERIFIED` / `REJECTED` / `EXPIRED` / `REPLACED` | Retention policy deletion window reached, or a lawful data-subject deletion request is fulfilled | `DELETED` | System (retention job) or ADMIN executing a data-subject request (`42-gdpr-and-data-privacy.md`) | S3 object removed (or removal scheduled); metadata tombstoned, not hard-deleted; audit log `document.deleted` (actor = system/admin, reason = policy code or DSR reference) |
| any transient state (`UPLOAD_INITIATED`, `UPLOADED`, `PROCESSING`) | Stuck past an operational timeout (worker crash, stalled job) | re-enters `PROCESSING` (re-enqueued) or is marked `REJECTED` after N automatic retries | System (scheduled reconciliation sweep) | Audit log `document.reprocessed` or `document.processing_failed` (reason: `timeout_exhausted`) |

### 3.3 Notes on the Table

- **No transition skips a state.** A document cannot go from `UPLOADED` directly to `VERIFIED` — it must pass through `PROCESSING` and `PENDING_REVIEW` even if a future "trusted auto-approve" rule is introduced for a specific category; that rule would be implemented as an automatic reviewer-actor transition `PENDING_REVIEW -> VERIFIED`, not a skipped state, so the audit trail and notification behavior stay uniform.
- **Every transition writes an audit log entry.** There is no "quiet" transition in production, including system-triggered ones like `EXPIRED` — the only exception is the pre-row `REQUIRED`/`MISSING` surfacing, which has no document row to log against yet.
- **`REJECTED` is a terminal state for that version, not for the slot.** The document *slot* (e.g., "Passport") remains actionable — the student re-uploads, creating a new version per §8.
- **Quarantine, never silent deletion, on malware detection.** See §5 — a malware hit must leave a forensic trail.

## 4. File Validation Rules

Client-declared `fileName`, extension, and `Content-Type` are advisory only and are **never** trusted for any security or business decision. All enforcement below happens server-side, in the worker, against the actual bytes retrieved from S3.

### 4.1 Allowed Types and Size Limits per Document Category

| Document category | Allowed real types (magic-byte verified) | Max size |
|---|---|---|
| Passport / national ID | PDF, JPEG, PNG | 10 MB |
| Academic transcript | PDF, JPEG, PNG | 20 MB |
| Degree / diploma certificate | PDF, JPEG, PNG | 15 MB |
| Language test report (IELTS/TOEFL/PTE/Duolingo) | PDF, JPEG, PNG | 10 MB |
| Statement of Purpose (SOP) | PDF, DOCX | 10 MB |
| CV / Resume | PDF, DOCX | 5 MB |
| Recommendation letter | PDF | 10 MB |
| Financial document (bank statement, sponsorship letter, scholarship letter) | PDF, JPEG, PNG | 20 MB |
| Other supporting document | PDF, JPEG, PNG | 20 MB |

**Decision:** DOCX is allowed only for SOP and CV, not for any identity/financial/official category. Rationale: official documents (passports, transcripts, certificates, financial statements) are near-universally distributed as PDFs or scans in real-world usage; allowing DOCX there would only widen attack surface (macro-capable format) for no genuine user benefit. DOCX itself is treated as a zipped OOXML container — magic-byte validation confirms the ZIP/OOXML signature, and the malware scan step (§5) inspects it as a compound document, not merely a renamed archive.

**Decision:** Size limits above are defaults expressed as configuration (a `DocumentCategoryConfig` table/config object), not hardcoded per the charter's "configuration over hardcoded" principle (`00-project-charter.md` §7) — an operator can raise the financial-document limit for a multi-page bank statement scan without a deploy.

### 4.2 Magic-Byte Validation

- The worker reads the first N bytes of the object (sufficient to cover the signature length of the widest supported format; PDF is trivially the `%PDF-` header, JPEG/PNG have well-known binary signatures, DOCX/ZIP-based formats require reading the ZIP central directory / OOXML content-type manifest, not just the local file header, to rule out a renamed non-Office ZIP).
- A well-maintained file-type-sniffing library (e.g., a `file-type`/libmagic-equivalent, chosen at implementation time) is the pluggable component here — this document specifies the *contract* (detect real type from bytes, return a canonical MIME/type identifier, fail closed on anything unrecognized), not a specific library version.
- **Detected type must be in the category's allow-list from §4.1.** A mismatch between the client's declared `Content-Type`/extension and the detected real type is itself logged (`document.type_mismatch_detected`) even when the detected type happens to also be allowed, because a mismatch is a signal worth having in the audit trail even when it isn't independently blocking.
- A detected type of "unknown"/unrecognized, or a file that fails to parse as a well-formed instance of its claimed format (e.g., a truncated or structurally corrupt PDF), fails validation outright — `PROCESSING -> REJECTED`, reason `invalid_or_unrecognized_file_type`.

### 4.3 Size Enforcement

Enforced at three points, in increasing order of trust:
1. **Pre-flight (upload-authorization call):** declared size checked against the category max before a signed URL is even issued — cheap, rejects obvious abuse early, but based on an untrusted client value.
2. **At the storage layer:** the pre-signed PUT URL is scoped with a content-length-range condition where the storage provider supports it, so S3 itself refuses an oversized PUT.
3. **Authoritative (worker, on confirmed bytes):** the worker reads the actual object size from S3 metadata (never the client's declared value) and re-checks against the category max. This is the check that actually gates the state transition — a file that somehow bypassed steps 1–2 (e.g., a raised limit mid-flight) is still caught here before `PENDING_REVIEW`.

### 4.4 Checksum / Hash

- On confirmed upload, the worker computes a **SHA-256** hash of the full object content and stores it on the `DocumentVersion` row (`contentHash`).
- **Integrity:** the stored hash lets any later re-fetch (e.g., before serving to a reviewer, or during a retention-policy job) be verified against tampering or storage-layer corruption.
- **Dedupe detection:** a hash index (`contentHash`, scoped per student — never a global cross-student dedupe, which would leak information about whether two students uploaded byte-identical files) lets the system flag "you already uploaded this exact file as your Passport — did you mean to upload it as your Financial Document too?" as a UX nicety, and lets an Admin/reviewer see when a rejected-then-reuploaded file is byte-identical to the rejected one (a signal the student may not have understood the rejection reason).
- **Decision:** dedupe detection is informational only — it never blocks or auto-approves an upload. Rationale: a byte-identical re-upload might legitimately be correct (student re-submitting after confirming with the university it was fine) and must still go through the same review path; silently trusting a hash match would create a bypass of human review.

## 5. Malware Scanning Integration Point

- A document in `PROCESSING` is not eligible to reach `PENDING_REVIEW` until it has cleared a malware scan step. This is architecture-only here: the scan is performed by a pluggable external service or library (e.g., a cloud AV API, or a self-hosted ClamAV-compatible daemon the worker calls over an internal network) invoked by the worker against the object fetched (or streamed) from S3.
- **Contract the scanning integration must satisfy**, regardless of which concrete provider is chosen at implementation time:
  - Given an object reference (bucket/key/version), return a verdict: `clean`, `infected` (with an engine-provided signature/threat name where available), or `scan_error` (the engine itself failed — treated as **fail closed**, i.e. the document does *not* advance to `PENDING_REVIEW`; it is retried a bounded number of times, then marked `REJECTED` with reason `scan_unavailable` rather than left in limbo indefinitely).
  - The scan must run against the object's real, confirmed bytes in S3 — never against a client-supplied hash or client-asserted "this is clean" claim.
- **On an `infected` verdict:**
  - The object is moved (not copied-and-left) to a restricted **quarantine prefix** within the same private bucket (e.g., `quarantine/{userId}/{documentId}/{version}`), with a bucket policy/IAM boundary that denies read access to the normal document-serving code path entirely — only a narrow security/ops tooling role can retrieve a quarantined object, and doing so is itself audit-logged.
  - `DocumentVersion` transitions `PROCESSING -> REJECTED` with reason `malware_detected`.
  - **The infected file is never silently deleted.** Silent deletion would destroy forensic evidence (was this a targeted attack, a compromised student device, a false positive worth appeal?) and is explicitly disallowed — quarantine-with-audit-trail is the only disposal path immediately after detection. Quarantined objects are still subject to their own, shorter retention window (see `42-gdpr-and-data-privacy.md`) after which they are permanently purged, again with an audit entry.
  - Audit log entry (`document.malware_detected`) records actor=system, documentId, scan-engine name, threat signature name/id (if provided by the engine), timestamp, and the student's originating IP/user-agent from the *upload* — never any content of the file itself.
  - Notification to the student is deliberately generic ("this file could not be processed, please try a different file") — it must not reveal precise malware-detection detail to the uploader, both to avoid tipping off a deliberate attacker and to avoid alarming a student whose device was unknowingly compromised before they have any actionable next step. Admins/security see the specific reason via the audit log and an internal alert.
- **Decision:** the malware scan runs on every uploaded object, including formats sometimes assumed "safe" (PDF, JPEG, PNG) — not just DOCX/ZIP-based formats. Rationale: PDF and image parsers have a long history of exploitable vulnerabilities (embedded scripts, crafted metadata, polyglot files); "it's just an image" is not a security boundary.

## 6. Encryption

| Layer | Mechanism |
|---|---|
| At rest (S3) | Server-side encryption enabled on the bucket by default (SSE-S3 or SSE-KMS — **Decision: SSE-KMS with a customer-managed key**, rationale: KMS gives per-key access logging via CloudTrail and the ability to revoke/rotate the encryption key independently of bucket policy, which matters for a bucket holding passports and financial documents specifically, not just "encryption checkbox" compliance). Applies to every object, including quarantined and derived-asset objects — no exception path writes an unencrypted object. |
| In transit (browser ↔ S3, browser ↔ API, API ↔ worker ↔ S3) | TLS 1.2+ enforced everywhere; the bucket policy denies any non-TLS (`aws:SecureTransport: false`) request outright, so a misconfigured client cannot accidentally fall back to plaintext. |
| In transit (internal, API ↔ worker via Redis/BullMQ) | Job payloads reference `documentId`/S3 keys, never raw file bytes or signed URLs with any meaningful remaining TTL beyond what's needed for the immediate operation — see §7 on why keys, not content, flow through Redis. |

## 7. Secure Object Naming

**Decision:** Object keys follow the pattern `vault/{userId}/{documentId}/{version}` (e.g., `vault/9f2c.../7a41.../3`), where `userId` and `documentId` are non-guessable identifiers (UUIDv7/ULID) and `version` is a monotonically increasing integer per document slot. Original filenames are **never** used in the key, and are stored only as a display-only metadata field on the `DocumentVersion` row (itself sanitized — see below).

Rationale:
- A key derived from the original filename (or containing it) leaks information (a filename like `John_Smith_Passport_Copy.pdf` is itself sensitive) into infrastructure logs, S3 access logs, and CDN/edge logs that are operated under different retention and access rules than the application's own audit log.
- Prefixing by `userId` gives a natural, coarse IAM/bucket-policy partition boundary as a defense-in-depth layer, even though — per the charter — the actual authorization decision is never allowed to rely on this structure alone (an attacker who somehow obtained a valid key for another user's prefix must still be stopped by the server-side ownership check on every signed-URL-issuing endpoint; the key structure is operational hygiene, not a security control by itself).
- Versioning in the key (rather than only relying on S3's own object-versioning feature) keeps the mapping from `DocumentVersion` rows to concrete objects explicit and independent of whether S3 bucket versioning is enabled, and keeps §3's `REPLACED` state trivially mappable to "an older key under the same document slot."

The original filename, once accepted, is sanitized before storage as display metadata (strip path separators/control characters, cap length, strip anything not in an allow-listed character class) — it is *display data*, never used to construct a path, a shell command, or any other injectable context.

## 8. Access Control Rules

- **Owner student:** full read access to their own document's metadata and content (via the download-authorization flow), full write access to create new versions, no ability to directly transition a document to `VERIFIED`/`REJECTED` (that's a reviewer action) and no ability to hard-delete (deletion is a retention/DSR-driven system action, not a self-service "delete forever" button — a student-initiated removal request is modeled as a data-subject request per `42-gdpr-and-data-privacy.md`, not a raw DELETE call against the vault API).
- **Assigned reviewer (ADMIN, future `APPLICATION_REVIEWER`):** read access to documents that are in `PENDING_REVIEW` (or any state, for support/verification purposes) for students within their assigned queue/scope; write access limited to the `PENDING_REVIEW -> VERIFIED`/`REJECTED` transition with a reason. A reviewer does not get blanket "read every student's vault" access baked into the role — access is still logged per-document per §2, and bulk/unscoped browsing of documents outside an active queue assignment is itself a signal worth alerting on (see `35-testing-strategy.md` for the corresponding test, and `28-observability.md` for anomaly alerting, out of scope here).
- **Consultant:** read access **only** to documents a student has explicitly shared for a specific booking, for the duration of that booking's access window (`02-personas-and-roles.md` §3) — never blanket vault access, never write access of any kind.
- **Enforcement point:** every rule above is enforced in the server-side authorization check at the upload-authorization and download-authorization endpoints (§2) — never by the S3 key being "hard to guess," since the key is never exposed to a client except as a short-lived signed URL scoped to one object.

### 8.1 Review Workflow Detail

- Only ADMIN (or a future `APPLICATION_REVIEWER`) can move a document from `PENDING_REVIEW` to `VERIFIED` or `REJECTED`. Students and consultants cannot self-verify or verify on another party's behalf under any circumstance.
- **Rejection reason is mandatory** and constrained to a reviewer-facing enum (e.g., `illegible_scan`, `wrong_document_type`, `expired_validity`, `incomplete_pages`, `mismatched_name`, `suspected_fraud`, `other` with a required free-text note when `other` is selected) plus an optional free-text elaboration always shown to the student. This is enforced at the API layer (400 if missing), not merely a required field in the admin UI.
- **Re-upload never overwrites a version in place.** A student re-uploading after a rejection (or to update an expired document) always creates a **new** `DocumentVersion` at the next version number under the same `Document` slot; the previous version transitions to `REPLACED` (§3.2) and is retained, not deleted, so the full history of what was submitted, when, and why it was or wasn't accepted survives — this matters both for internal audit and because a university or immigration authority may later ask "what exactly did this student submit and when."
- `currentVersion` on the `Document` row always points at the latest non-`DELETED` version; UI surfaces only `currentVersion` by default, with reviewer/admin tooling able to view prior versions' full history.

## 9. Retention Integration (Hook Only)

`EXPIRED` and `DELETED` transitions are **driven by retention/business policy, executed by a scheduled system job, never by manual ad hoc admin action** (an admin can trigger an *early*, lawful deletion only through the data-subject-request path, which is itself logged and policy-governed — see `42-gdpr-and-data-privacy.md`). This document defines the state-machine hook; it does not define *how long* each category lives — those durations, their legal rationale, and the data-subject export/deletion mechanics are owned by `42-gdpr-and-data-privacy.md` §4, and this document must not be read as independently authoritative on retention windows if the two ever appear to disagree (treat that as a bug to reconcile, not a choice between them).

## 10. Required Security Tests for This Subsystem

These are mandatory, not exploratory nice-to-haves — see `35-testing-strategy.md` for how they're wired into CI/QA gating. At minimum:

1. **Unauthorized download by a non-owner** — a second authenticated student (or an unauthenticated request) attempts `download-authorization` against another student's `documentId`; must be rejected (403/404, not information-leaking about existence) and must produce no signed URL.
2. **IDOR via guessed/enumerated `documentId`** — sequential or randomly sampled UUIDs against the download/upload-authorization endpoints must never succeed for a non-owned document, and repeated attempts should be visible in rate-limiting/anomaly logging.
3. **Oversized file** — a PUT that exceeds the category's real byte-size max (bypassing the pre-flight declared-size check, e.g. by lying about size then sending more) must be rejected at the storage-layer condition and/or the worker's authoritative check, never allowed to reach `PENDING_REVIEW`.
4. **Malicious / mismatched extension** — a file renamed with an allowed extension but a disallowed or unrecognizable real type (magic bytes) must be rejected with `invalid_or_unrecognized_file_type`, never accepted based on extension or declared `Content-Type` alone.
5. **EICAR-style malware test file** — the standard EICAR test string, uploaded under every document category, must be caught by the scan step, quarantined per §5, and produce the `document.malware_detected` audit entry — never silently deleted, never allowed to reach `PENDING_REVIEW`.
6. **Signed URL replay after expiry** — a captured pre-signed upload or download URL, replayed after its TTL has elapsed, must fail at the storage layer (S3 itself rejects an expired signature) — verify this is actually enforced and not merely assumed.
7. **Signed URL used by a different user** — a signed URL legitimately issued to user A, if somehow obtained by user B before expiry, is scoped to a specific object key under A's prefix; confirm B cannot parlay possession of that URL into access to any of B's own or a third user's documents (the URL is object-scoped, not session-scoped — this test exists to catch any accidental over-broad signing, e.g. a signed prefix instead of a signed single-key).
8. **Quarantine isolation** — confirm the normal document-serving code path (download-authorization) cannot produce a signed URL for an object under the `quarantine/` prefix under any role, including ADMIN, without going through the separate, more restricted security-tooling path.

## 11. Related Documents

- `32-file-storage-strategy.md` — bucket/key conventions, lifecycle tiers, versioning mechanics, environment separation, backup/replication
- `42-gdpr-and-data-privacy.md` — retention durations, data export/deletion, subprocessor awareness
- `02-personas-and-roles.md` — role definitions referenced throughout (§7 object-level isolation is load-bearing here)
- `06-system-architecture.md` — why processing/scanning is a worker job, never inline in a request
- `35-testing-strategy.md` — how §10's required tests are gated in CI
- `10-database-schema.md` §5 — `Document`/`DocumentReview`/`DocumentAuditLog` schema this document's state machine and review workflow are implemented against; that document defers to this one for the authoritative state list and transition table
- `27-audit-logging.md` — canonical platform `AuditLog` event catalog for the headline document events (upload/view/download/verify/reject) that also propagate beyond `DocumentAuditLog`
