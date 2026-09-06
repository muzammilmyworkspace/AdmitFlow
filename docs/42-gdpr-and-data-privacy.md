# 42 — GDPR and Data Privacy Architecture

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering
**Depends on:** `00-project-charter.md`, `02-personas-and-roles.md`, `15-document-vault-security.md`, `32-file-storage-strategy.md`
**Read alongside:** `45-analytics-and-events.md` (event-level privacy rules), `41-backup-and-disaster-recovery.md` (how retained/deleted data interacts with backups)
**Applies to:** Every subsystem that stores, processes, or exposes personal data

---

## 1. Purpose and a Direct Statement of Scope

This document is the **engineering architecture that supports GDPR-equivalent compliance** — consent capture, data subject rights (export/deletion), retention policy, and subprocessor awareness — for a platform serving an international audience including EU/UK data subjects.

**This document does not, by itself, make AdmitFlow "GDPR compliant."** Compliance is a legal determination that depends on facts outside engineering's control or knowledge — the specific legal entity structure, the finalized subprocessor list and signed Data Processing Agreements (DPAs), the lawful basis analysis for each processing activity, breach-notification procedures, and a Data Protection Officer or equivalent role's sign-off where required. **No public-facing compliance claim (a footer badge, a sales statement, a privacy-policy assertion of "GDPR compliant") may be made on the strength of this document alone.** Every place this document flags **OPEN QUESTION / BLOCKING** requires legal review before that claim is safe to make. Engineering's job, discharged by this document, is to make compliance *achievable and demonstrable* — not to declare it.

## 2. Consent Record Model

### 2.1 What Consent Is Captured

AdmitFlow captures consent as **versioned, timestamped, explicit records**, the same pattern the platform already uses for other legal-content versioning (questionnaire schemas, scoring rules — see `06-system-architecture.md`), not as a single boolean flag on the `User` row.

| Consent type | When captured | Notes |
|---|---|---|
| Terms of Service acceptance | Account creation (signup) | Blocking — account creation cannot complete without it. |
| Privacy Policy acceptance | Account creation (signup), and again whenever the policy version changes and the user next logs in | Re-acceptance on material policy changes is required before the user can continue using the product past a blocking interstitial — **Decision:** "material" is determined by a manual legal/product flag on the policy version record, not an automated diff heuristic, because not every wording change is materially different and an automated diff would over-trigger re-consent fatigue. |
| Marketing communications consent | Explicit opt-in at signup or in account settings — **never pre-checked** (per `00-project-charter.md` §7, no dark patterns) | Fully separable from Terms/Privacy acceptance; withdrawing marketing consent must never affect core account function. |
| Document processing consent | Implicit in, and bundled with, Privacy Policy acceptance for v1 — students necessarily consent to their documents being processed (scanned, verified) as a condition of using the vault, since it's core to the product's function | **Decision:** not modeled as a separate consent record from Privacy Policy acceptance in v1. Rationale: uploading a document is itself an unambiguous affirmative act; a separate checkbox per upload would be consent-fatigue theater rather than a meaningful additional safeguard. Flagged for legal review (§7) in case a specific jurisdiction requires document-processing consent to be separately recorded. |
| Cookie/analytics consent (where a jurisdiction requires opt-in, e.g. non-essential cookies under ePrivacy rules) | First visit, via a consent banner, before any non-essential cookie/tracking script fires | See `45-analytics-and-events.md` for what "essential vs. non-essential" means for AdmitFlow's own event tracking; third-party marketing/ad pixels (if ever added) are explicitly non-essential and gated by this consent. |

### 2.2 Consent Record Shape

Each consent record stores, at minimum: `userId`, `consentType`, `policyVersion` (or `documentVersion` for ToS/Privacy Policy — a foreign key to a versioned legal-document table, not a free-text string), `granted` (boolean — a withdrawal is a **new record** with `granted: false`, not a mutation of the original grant record), `timestamp`, `capturedVia` (e.g., `signup_flow`, `account_settings`, `reconsent_interstitial`), and `ipAddress`/`userAgent` at time of capture (for evidentiary purposes — "we can show exactly what version of the policy this user agreed to and when").

**Decision:** Consent records are **append-only** — granting, withdrawing, and re-granting consent each create a new row rather than updating a single row in place. Rationale: a full, tamper-evident consent history is itself often a regulatory expectation ("show us proof of consent as it stood on date X"), and an append-only model makes that trivial to produce; it also gives the audit logging system (`15-document-vault-security.md`'s pattern, applied platform-wide) a natural home for consent-related audit entries.

## 3. Data Subject Rights Support

### 3.1 Data Export ("Right to Access" / "Right to Portability")

A student-initiated data export request produces a bundle containing:

| Section | Contents |
|---|---|
| Profile | Account details, onboarding profile, contact info, consent record history (§2) |
| Questionnaire responses | All versions of questionnaire answers the student has submitted, with the questionnaire schema version each was answered against |
| Assessment history | Every `Assessment`/`AssessmentSnapshot` the student has ever generated, in full, including the input snapshot that produced it (per `00-project-charter.md` §10.5, reproducibility) |
| Documents | Metadata for every `Document`/`DocumentVersion` (category, state, timestamps, version history) **and** access to the underlying files themselves — delivered as a set of short-lived signed download URLs (or a generated archive bundling the files) rather than raw S3 keys, consistent with `15-document-vault-security.md`'s rule that documents are never exposed except via authorized signed access, even to the owning student's own export request |
| Applications | All `Application` records, their status history, and which documents/versions were attached to each submission |
| Payments | Payment/invoice history (amounts, dates, status) — **not** raw processor secrets or full card data, which AdmitFlow never stores directly (Stripe/PayPal are the systems of record for card data — see `06-system-architecture.md`) |
| Bookings | Consultation booking history, session notes the student has access to view under normal product rules |

**Decision:** Export requests are fulfilled as an **asynchronous background job** (BullMQ, consistent with `06-system-architecture.md`'s rule that anything non-trivial in duration is a queued job), producing a downloadable archive whose availability is itself a short-lived, signed, audit-logged link — not an inline API response. Rationale: assembling a full export (including regenerating signed URLs for potentially dozens of documents) can exceed a request/response time budget, and the resulting bundle is itself sensitive enough to warrant the same signed-URL discipline as any other document access.

**Decision:** Export requests are rate-limited per student (e.g., a cooldown between requests) and always audit-logged (actor = the student themself, or an Admin/Compliance role fulfilling a manual request channel) with the same actor/timestamp/IP/user-agent shape used elsewhere. Rationale: prevents the export pipeline itself from becoming an enumeration/scraping vector and keeps a record of who accessed a full personal-data bundle and when, independent of the normal per-document audit trail.

### 3.2 Data Deletion / Account Deletion Requests

**This must be explicit, never silent:** account deletion does **not** mean every row referencing the student is hard-deleted from every table. AdmitFlow has independent legal/accounting obligations to retain certain records (payment/invoice records for tax and financial audit purposes, and the platform's own audit log of actions taken) that survive a user's deletion request. The deletion flow must make this tension visible to the user requesting deletion, not paper over it with a UI that implies total erasure.

**Decision:** Account deletion is modeled as a two-tier outcome, disclosed to the student at request time (in plain language, not legalese, per the charter's voice principle):

| Category | Deletion behavior on account-deletion request |
|---|---|
| Profile, onboarding answers, questionnaire responses | Hard-deleted (or irreversibly anonymized where a referential integrity need exists — e.g., an `AssessmentSnapshot` an Admin still needs to explain a past support ticket, in which case the profile fields inside the snapshot are scrubbed to a generic placeholder rather than the whole snapshot being destroyed) |
| Documents (vault) | S3 objects deleted per `15-document-vault-security.md`'s `DELETED` state transition, executed promptly (not waiting for the general retention window) when the deletion request is the trigger; metadata rows tombstoned (retained in anonymized form: category, state history, timestamps — with any personally-identifying display metadata such as the sanitized original filename scrubbed) |
| Applications | Anonymized, not hard-deleted, if the application record intersects with a payment or a university-facing submission that may need to be referenced for dispute/compliance reasons; otherwise hard-deleted |
| Payments / invoices | **Retained** for the legally required financial-record retention period (see §4) — never deleted early on user request, because this is a legal retention obligation that overrides a deletion request under GDPR's own "compliance with a legal obligation" exception. The student-facing profile linkage is anonymized (name/contact fields nulled or replaced with a placeholder) while the transaction record itself (amount, date, tax-relevant fields) is retained. |
| Audit log entries referencing this student | **Retained** for the audit retention period (see §4) — an audit log that could be erased on request would defeat its own purpose (it exists partly to prove what happened even in disputes the deleted user might raise). Personally-identifying fields within old audit entries are not scrubbed retroactively (the entry is a historical record of what was true at the time), but the entries are not surfaced in any student-facing export or profile after deletion. |
| Consent records | Retained (per §2, append-only) — the record that consent was withdrawn/account deleted is itself evidence of compliant handling and must survive. |
| Consultant session notes | Anonymized reference retained if tied to a payment record for the same legal reason as Payments above; otherwise deleted. |

**Decision:** A deletion request is itself a first-class, tracked entity (`DataSubjectRequest` with type `deletion`, status, requestedAt, fulfilledAt, a system-generated summary of what was hard-deleted vs. anonymized vs. retained-with-justification) rather than an immediate, untracked cascade delete triggered directly from an account-settings button. Rationale: the student is entitled to confirmation of what actually happened to their data, and Compliance/legal needs an auditable record that the request was received and handled within whatever regulatory response-time window applies (commonly referenced as "without undue delay," typically operationalized as within one month under GDPR — **OPEN QUESTION for legal** to confirm the exact SLA AdmitFlow commits to publicly).

**Decision:** Deletion is processed as a background job (same rationale as export — non-trivial work, must not run inline) that moves the account to a `PENDING_DELETION` intermediate state with a short grace period (e.g., a few days) during which the student can cancel the request, before the irreversible steps execute. Rationale: protects against accidental or coerced deletion requests (e.g., a student panicking, or a compromised account triggering self-destructive actions) without meaningfully weakening the user's actual right to deletion — the grace period is short and disclosed up front, not a hidden delay tactic.

## 4. Retention Policy Pointers Per Data Category

Concrete default retention durations. Engineering (this document and `32-file-storage-strategy.md`'s lifecycle rules) implements these; legal must confirm each is defensible for AdmitFlow's actual operating jurisdictions before public commitment (§7).

| Data category | Default retention | Decision / rationale |
|---|---|---|
| Active account data (profile, onboarding, questionnaire, assessments) | Retained for the life of the account, plus **24 months** after account deletion/last activity for accounts that go dormant without an explicit deletion request | **Decision:** a dormant (never explicitly deleted) account is not kept forever by default. Rationale: "we'll just keep it in case they come back" is exactly the kind of unbounded retention that fails a data-minimization review; 24 months balances giving a returning student their history back against not accumulating stale sensitive data indefinitely. A dormancy-triggered soft-delete flow follows the same anonymize/retain split as §3.2. |
| Documents (vault) | `VERIFIED`/active version: retained for the life of the account. `REPLACED`/`REJECTED`/`EXPIRED` versions: **12 months** after superseded, then deleted per `32-file-storage-strategy.md` §5 lifecycle rules | **Decision:** 12 months for superseded versions. Rationale: long enough to cover a plausible dispute or re-review window (a university asking "what exactly was submitted six months ago"), short enough that stale passport/financial scans don't accumulate indefinitely once they're no longer the active version. |
| Quarantined (malware-flagged) objects | **90 days**, then permanently purged | **Decision:** short window. Rationale: quarantine exists for forensic/security review, not long-term storage — 90 days is ample for a security review to complete; retaining flagged malicious content longer than necessary is itself a liability with no compliance upside. |
| Applications | Retained for the life of the account; anonymized (not hard-deleted) after account deletion if linked to a payment (§3.2) | Consistent with the payments retention rule below — an application tied to a paid submission fee inherits the financial record's retention need. |
| Payments / invoices / audit trail of financial transactions | **7 years** from the transaction date | **Decision:** 7 years. Rationale: this is the commonly applied floor for financial/tax record retention across many jurisdictions AdmitFlow may operate in or serve students from; engineering treats this as the working default pending jurisdiction-specific legal confirmation (a specific market may require longer — this is a floor, not a ceiling, and legal must confirm per §7). Financial records are retained materially longer than raw analytics events specifically because they carry a distinct legal-obligation basis for retention that survives a deletion request (§3.2), whereas analytics events carry no such obligation. |
| Platform audit log (`AuditLog`) | **Uniform 7 years** from each entry's timestamp, for every entry regardless of event type — no per-event-type exception | This number is fixed and owned by `27-audit-logging.md` §6, restated here only so this cross-category table doesn't drift out of sync with it. **Decision (there, restated here):** a single uniform floor was chosen over a tiered duration (e.g., a shorter window for routine, non-financial entries) because a per-event-type retention matrix is materially harder to implement and prove correct during a compliance review than one number, and because the audit log contains no raw sensitive document content in the first place (`27-audit-logging.md` §3.1) — the cost of over-retaining a routine entry is low, unlike over-retaining a document or an analytics event. Rows are eligible for archival to cold, immutable storage after 7 years, not automatic deletion. Audit log entries are never deleted early by a data-subject deletion request (§3.2); this is the same "legal-obligation basis" reasoning that keeps financial/audit records outliving raw analytics events in this table. |
| Consent records | Retained for the life of the account **plus 7 years** after account deletion/last relevant action | **Decision:** align consent-record retention to the audit log's uniform 7-year floor (`27-audit-logging.md` §6), rather than a shorter fixed duration. Rationale: a consent record's only purpose is to prove authorization existed for some action, and it must outlive that action's own retention window — since audit log entries (which may reference the same action) are retained uniformly for 7 years, a consent record retained for less than that could leave a gap where the audit trail survives but the proof of consent behind it does not. |
| Analytics events (product usage, funnel events) | **25 months**, raw, then deleted or rolled up to aggregated non-identifiable metrics | This number is fixed and owned by `45-analytics-and-events.md` §5, restated here only so this cross-category table doesn't drift out of sync with it. Short relative to every other category above by design: analytics events carry no legal retention obligation and are the least sensitive category by design (per §6 below, they must never carry document content or sensitive field values) — the classic contrast this table is meant to surface: financial/audit records (7 years) are retained far longer because they carry a legal-obligation basis that survives a deletion request; analytics events carry no such obligation, so a right-to-erasure request purges a specific user's identifiable analytics events immediately regardless of the general 25-month window (`45-analytics-and-events.md` §5). |
| Error monitoring / crash reports | **90 days** | **Decision:** short window, and scrubbed of personal data at capture time wherever the error-monitoring tool supports PII scrubbing rules (never log full request bodies containing document content, passwords, or payment details into an error-monitoring provider). |

**OPEN QUESTION for legal review:** every duration above is an engineering-proposed default. Legal must confirm (a) these durations are defensible in every jurisdiction AdmitFlow actually serves, (b) whether any jurisdiction requires a *shorter* maximum for a category listed here, and (c) the exact SLA for responding to a data-subject request (commonly ~1 month under GDPR, but this must be confirmed, not assumed, for AdmitFlow's specific legal posture).

## 5. Processor / Subprocessor Awareness

The architecture implies the following categories of subprocessors (third parties that process personal data on AdmitFlow's behalf). This is an engineering-visibility list, not a legal subprocessor register:

| Category | Example role in this architecture |
|---|---|
| Cloud hosting / compute | Hosts the Next.js application and the always-on worker service (`06-system-architecture.md`) |
| Object storage | AWS S3 — stores all document files (`32-file-storage-strategy.md`) |
| Managed database | Hosts Postgres (Neon/RDS) and Redis (Upstash/Redis Cloud) — hold all relational/queue data |
| Payment processors | Stripe (primary), PayPal (secondary) — process card/payment data; AdmitFlow never stores raw card numbers |
| Email delivery provider | Sends transactional email (verification, notifications, password reset) — processes student email addresses and message content |
| Error monitoring / observability | Receives crash reports, logs, performance traces — must be configured to scrub PII per §4's error-monitoring row |
| Malware scanning service | If a cloud-based scanning API (rather than a self-hosted engine) is chosen per `15-document-vault-security.md` §5, this provider receives document bytes for scanning — a subprocessor relationship of real weight given the sensitivity of what it's scanning, and a strong argument for preferring a self-hosted/in-VPC scanning engine where the tradeoff is close, so as to minimize the number of third parties that ever see raw document bytes |

**OPEN QUESTION / OUT OF ENGINEERING SCOPE:** a real, legally sufficient subprocessor list (with each vendor's actual legal entity, data-processing location, and a signed DPA on file) and the public subprocessor disclosure AdmitFlow's privacy policy commits to is a **legal/procurement task**, not something this architecture document can complete. Engineering's obligation is to keep this category list current as new third parties are integrated (any new integration touching personal data must be added here and flagged to legal before launch) — not to draft or execute DPAs.

## 6. Privacy-Safe Analytics

- **Decision:** analytics events (see `45-analytics-and-events.md` for the full event catalog and schema conventions) never carry full document contents, raw sensitive field values (passport numbers, financial figures, free-text SOP/CV content), or unhashed identifiers beyond what's needed for the product's own operational use. An event like `document.uploaded` carries `documentCategory`, `userId`, `timestamp` — never the file itself, never extracted text from it, never even the original filename.
- **Decision:** event names and event property schemas are an explicit, reviewed, enumerable list — not "whatever the frontend developer decided to pass this sprint." Adding a new analytics event or a new property on an existing event is a reviewed change (the same review lens: "does this property leak something that shouldn't leave the app," not just "is this useful data"), consistent with `45-analytics-and-events.md`'s ownership of the actual catalog.
- Aggregate/derived analytics (funnel conversion rates, cohort retention) are computed from these minimized events, so even internal dashboards never require re-exposing raw sensitive fields to generate business metrics.

## 7. Open Questions Requiring Legal Sign-Off (BLOCKING for any compliance claim)

Consolidated from throughout this document — nothing below should be treated as resolved by engineering alone:

1. Confirmation that AdmitFlow's actual operating entity/entities and target markets make GDPR (and any UK-GDPR / other regional equivalent) the correct compliance framework to design against, and whether additional frameworks apply (e.g., other jurisdictions' student-data-protection rules).
2. The exact data-subject-request response SLA to commit to publicly (§3.2, §4).
3. Confirmation or revision of every default retention duration in §4 per actual applicable jurisdictions.
4. Whether document-processing consent needs to be a separate, explicit consent record distinct from Privacy Policy acceptance (§2.1).
5. A real subprocessor register with signed DPAs, and the corresponding public subprocessor disclosure (§5).
6. Any jurisdiction-specific cookie/tracking consent requirements beyond the baseline opt-in banner assumed in §2.1.
7. Whether a Data Protection Officer (or equivalent) designation is required given AdmitFlow's scale and the sensitivity of data processed (passports, financial documents).

**Until these are resolved, no public claim of "GDPR compliant" (or equivalent) should be made in product copy, marketing, or sales material.** This document may be shared with legal counsel as the engineering architecture supporting that eventual determination.

## 8. Related Documents

- `15-document-vault-security.md` — vault state machine, whose `DELETED`/`EXPIRED` transitions this document's retention policy drives
- `32-file-storage-strategy.md` — lifecycle rules that mechanically execute §4's retention durations
- `45-analytics-and-events.md` — full analytics event catalog and schema, governed by §6's minimization rule
- `41-backup-and-disaster-recovery.md` — how backups interact with a deletion request (a deleted record does not necessarily vanish from a backup snapshot immediately — that reconciliation is owned there, flagged here as a dependency)
- `02-personas-and-roles.md` — the (future) `COMPLIANCE_ADMIN` role anticipated for operating the data-subject-request workflow at scale
