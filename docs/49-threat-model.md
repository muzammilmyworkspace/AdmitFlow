# 49 — Threat Model

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering / Security
**Depends on:** `00-project-charter.md`, `02-personas-and-roles.md`, `09-database-architecture.md`, `11-api-architecture.md`, `15-document-vault-security.md`
**Read alongside:** `36-security-testing.md` (the test catalog that operationalizes the mitigations mapped here), `13-authentication-authorization.md`, `14-security-architecture.md`, `42-gdpr-and-data-privacy.md`, `47-rate-limiting.md`, `48-idempotency.md`
**Applies to:** All product, engineering, and security-review decision-making for AdmitFlow

---

## 1. Purpose and Method

This document maps **who could attack AdmitFlow, what they'd be after, how they'd get it, and what already stops them** — a risk-to-mitigation mapping, not a re-derivation of the architecture. Every mitigation cited here is a pointer to the document that actually specifies it (the "how"); this document's job is the "why it matters" and "is it actually covered." Where a cited mitigation doesn't yet exist in an authored document, it is marked `(pending: <doc>)` rather than described in full here, so this document never drifts out of sync with the real architecture by re-explaining it independently.

Method: asset-centric threat mapping (per-asset threat enumeration, similar in spirit to STRIDE but organized by *what an attacker wants* rather than by attack technique category, since that maps more directly to how AdmitFlow's engineers reason about the product). Section 2 defines actors, Section 3 defines assets, Section 4 is the actor/threat/mitigation matrix organized per asset, Section 5 restates the two platform-critical invariants explicitly, Section 6 is residual risk.

## 2. Threat Actors

| Actor | Capability / access | Primary motivation | Notes |
|---|---|---|---|
| **Anonymous, unauthenticated attacker** | No account; internet access to public endpoints only (signup, login, marketing pages, public catalog browse if any is unauthenticated) | Credential harvesting, account creation abuse, reconnaissance, exploiting any unauthenticated endpoint | The largest-volume, lowest-sophistication actor; most defenses against this actor are structural (rate limiting, input validation, no unauthenticated access to any student data) |
| **Malicious or curious student** | A real, valid STUDENT account and session | Curiosity (wanting to see another student's results/documents), competitive intent (a rival applicant), or opportunistic fraud (getting paid content without paying) | The most important actor for IDOR and paywall-bypass threats — has legitimate platform access, which is exactly why object-level checks (not just role checks) matter |
| **Compromised student account** (credential stuffing / phishing) | A real, valid STUDENT session obtained by an attacker who is not the legitimate account owner, via reused/leaked credentials or a phishing page | Identity theft, document theft (a passport/financial-document trove is valuable), payment-method abuse if a saved method exists | Distinct from "malicious student" because the account owner's own behavior/authorization is not the failure mode here — authentication strength (§Account Takeover below) is the relevant control, not authorization logic |
| **Malicious consultant** | A real, valid CONSULTANT account and session, plus legitimate booking-scoped access to some students' data | Scraping/retaining student data beyond the booking window, attempting to access students they were never booked with, undercutting the platform (e.g., soliciting off-platform payment) | The booking-scope-and-time-bound access model (`02-personas-and-roles.md` §3) exists specifically because this actor's legitimate access is itself a risk surface |
| **Malicious or rogue admin (insider threat)** | A real, valid ADMIN or SUPER_ADMIN account — the platform's own staff | Unauthorized bulk data export, browsing student files without a legitimate support reason, entitlement fraud (self-granting or granting to an accomplice), tampering with application/document status | The highest-privilege actor; cannot be fully prevented by authorization alone (an Admin's job *is* broad access) — the control is audit logging + review, per §6 |
| **Automated bot / scraper** | No account, or a cheaply-created throwaway STUDENT account | Bulk-harvesting the university catalog (competitive intelligence, a rival product scraping AdmitFlow's curated data), profile/email enumeration for spam or credential-stuffing target lists | Distinguished from the anonymous attacker by *scale and automation* rather than a different access level — the relevant controls are rate limiting, CAPTCHA/bot-detection on high-value endpoints, and anomaly detection, not authorization changes |

## 3. Assets

| Asset | Why it matters | Primary sensitivity driver |
|---|---|---|
| **Passports and identity documents** | Directly enables identity theft, visa fraud, or targeted phishing/social engineering against the student if leaked | Regulatory (data protection law) + irreversible personal harm if exposed |
| **Academic transcripts / certificates** | Sensitive academic history; forgeable/valuable to a third party wanting to misrepresent credentials | Reputational/fraud risk to the student and to universities relying on AdmitFlow-submitted documents |
| **Financial documents** (bank statements, sponsorship/scholarship letters) | Reveals a student's or their sponsor's financial position; a prime phishing/fraud target | High sensitivity; often the most reluctant category for a student to upload, so a breach here has outsized trust impact |
| **Payment / transaction records** | Card-brand/last-4, billing details, transaction history | PCI-adjacent sensitivity even though AdmitFlow itself is not meant to store raw card numbers (tokenized via Stripe/PayPal) |
| **Student profile PII** | Name, DOB, contact info, education/target-country/budget details | Base-layer PII; also the input to the assessment engine, so its integrity matters as much as its confidentiality |
| **Application data** | The submitted application package and its immutable snapshots | Legal/audit significance (what was submitted, when) plus competitive sensitivity (a rival applicant seeing another's application strategy) |
| **University catalog data / integrity** | The curated, differentiator dataset the whole matching engine depends on | Threat here is less "confidentiality" (much of it is intentionally shown to students) and more *integrity* (tampering with requirements/fees) and *bulk exfiltration* (a scraper cloning the catalog) |
| **Authentication credentials and sessions** | Password hashes, session tokens, OAuth linkage | Compromise here cascades into every other asset — the highest-leverage single target on the platform |

## 4. Threats Mapped to Assets, Actors, and Mitigations

### 4.1 Passports and Identity Documents

| Threat | Relevant actor(s) | Mitigation (reference) |
|---|---|---|
| IDOR / broken object-level authorization on document read/download | Malicious/curious student, compromised account | Object-level ownership check on every document fetch, `02-personas-and-roles.md` §7; enforced server-side on every hop of the upload/download flow, `15-document-vault-security.md` §2, §8 |
| Signed-URL misuse (leaked URL reused by a different user, replayed after expiry, guessed S3 key) | Any authenticated actor, or an anonymous attacker who obtains a leaked URL | Short-lived, single-object-scoped signed URLs (60–120s TTL) minted fresh per view, never cached client-side beyond their own TTL, per `15-document-vault-security.md` §2, §7; private-bucket-only policy denying all unsigned access |
| Bulk exfiltration by a rogue admin | Malicious/rogue admin | Per-document access logging (`document.download_authorized` audit entry on every authorization, not just on verification actions) plus the anomaly-worthy signal called out for unscoped/bulk browsing, `15-document-vault-security.md` §8; full remediation is audit review, §6 below — this threat is not eliminable by an authorization control alone since Admin access to documents is the legitimate job function |
| Malicious file upload disguised as an identity document (used as a vector to attack the review pipeline, not to steal data) | Malicious/curious student, compromised account | Magic-byte validation, mandatory malware scan on every category including images/PDFs, quarantine-not-delete on detection, `15-document-vault-security.md` §4, §5 |

### 4.2 Academic Transcripts / Certificates and Financial Documents

Threats and mitigations are structurally identical to §4.1 (same vault, same state machine, same access-control model) — called out separately only because the residual-risk conversation (§6) treats financial documents as the single highest-stakes category if a mitigation ever fails, given their direct usability for financial fraud.

| Threat | Relevant actor(s) | Mitigation (reference) |
|---|---|---|
| IDOR / signed-URL misuse | Same as §4.1 | Same as §4.1 |
| Document tampering claims (a student disputes what they submitted, or a university disputes what was received) | N/A (integrity/dispute threat, not an attacker per se) | Immutable version history — a re-upload never overwrites in place, prior versions retained as `REPLACED`, checksum (SHA-256) recorded per version, `15-document-vault-security.md` §4.4, §8.1 |
| Malicious consultant retaining financial-document access past a legitimate need | Malicious consultant | Booking-scoped, time-bound access window, `02-personas-and-roles.md` §3 |

### 4.3 Payment and Transaction Records

| Threat | Relevant actor(s) | Mitigation (reference) |
|---|---|---|
| Client-supplied amount/currency tampering | Malicious/curious student, compromised account, automated bot | Server-side re-derivation of price from the authoritative `Price` record, mismatch rejected outright; tested exhaustively in `36-security-testing.md` §6 |
| Client-reported payment success trusted instead of provider confirmation | Malicious/curious student | Entitlement/booking-confirmation grant is reachable only from the signature-verified webhook-reconciliation path, never a student-facing endpoint, `09-database-architecture.md` §7 (Payment→Entitlement transaction boundary); `06-system-architecture.md` §4 |
| Webhook forgery (a request shaped like a provider webhook but not actually from the provider) | Anonymous attacker | Signature verification against the raw request body before any processing; invalid signature rejected pre-persistence, `06-system-architecture.md` §4; `36-security-testing.md` §7 |
| Webhook replay (same event delivered twice, or delivered out of order) | Not adversarial in the typical case (providers legitimately retry) but must not be exploitable if an attacker *could* replay a captured webhook | DB-level unique constraint on `(provider, providerEventId)` — idempotency enforced at the database, not application-level check-then-write, `09-database-architecture.md` §7.2, §9.3; `36-security-testing.md` §7 |
| IDOR on payment/receipt records | Malicious/curious student | Object-level ownership check on `GET /api/v1/payments/{id}`, `11-api-architecture.md` §10 |
| Financial fraud via refund/entitlement-override abuse | Malicious/rogue admin | Mandatory reason field on every entitlement grant/revoke, enforced server-side not just in the UI; every override is a transaction with its `AuditLog` insert, `09-database-architecture.md` §7 (Admin action → Audit log transaction boundary), `02-personas-and-roles.md` §4 |

### 4.4 Student Profile PII

| Threat | Relevant actor(s) | Mitigation (reference) |
|---|---|---|
| IDOR on profile read/write | Malicious/curious student, compromised account | Object-level ownership check, `02-personas-and-roles.md` §7 |
| Bulk profile enumeration / scraping | Automated bot/scraper | Rate limiting per session/IP composite key, `47-rate-limiting.md` (pending: full spec); cursor-based pagination preventing bulk offset-walking of list endpoints, `11-api-architecture.md` §7; account-level anomaly detection for high-volume access patterns, `36-security-testing.md` §10 |
| PII exposure via a role-escalation bug (e.g., a Consultant seeing a non-booked student's profile) | Malicious consultant | Booking-scoped access enforced server-side, never derived from role name alone, `02-personas-and-roles.md` §3, §7 |
| Insider (Admin) browsing PII with no legitimate support/verification reason | Malicious/rogue admin | Access is logged per §4.1's pattern; unscoped bulk browsing outside an active queue assignment is itself an alertable anomaly, `15-document-vault-security.md` §8; residual risk, §6 |

### 4.5 Application Data

| Threat | Relevant actor(s) | Mitigation (reference) |
|---|---|---|
| IDOR on application read/write/withdraw | Malicious/curious student, compromised account | Object-level ownership check; `PATCH`/withdraw actions additionally gated by the application state machine (pre-submission-only withdrawal), `35-testing-strategy.md` §4.4.2 |
| Double submission (double-click, two-tab) causing duplicate fee charge or inconsistent state | Not adversarial in the typical case, but must not be exploitable as a free-retry or double-charge vector by a malicious actor either | DB-level idempotency-key uniqueness constraint plus independent state-machine guard (`SUBMITTED` not re-enterable), `09-database-architecture.md` §7.2; `36-security-testing.md` §9 |
| "Results drift" — an application's recorded snapshot silently changing because it was derived from live, mutable tables instead of a frozen copy | N/A (integrity threat from architecture, not an attacker) | Immutable submission snapshots (`ApplicationProfileSnapshot`, `ApplicationDocumentSnapshot`, `ProgramSnapshot`, `RequirementSnapshot`) written atomically with the state transition, `09-database-architecture.md` §4, §7 |
| Rogue admin altering application status without cause | Malicious/rogue admin | Every status update is a transaction with its `ApplicationStatusHistory` insert and, where it's an override, its `AuditLog` insert, `09-database-architecture.md` §7; residual risk, §6 |

### 4.6 University Catalog Data / Integrity

| Threat | Relevant actor(s) | Mitigation (reference) |
|---|---|---|
| **Locked TARGET/SAFE content leakage — the platform's most critical data-leakage class** | Malicious/curious student (the paywall-bypass motive is specific to this actor; a fully unauthenticated attacker has no assessment result to query in the first place) | Locked university/program identity/name/program/fee/metadata is **omitted from the API response entirely**, never sent-then-hidden — architectural rule in `01-product-requirements.md` §6, `11-api-architecture.md` §10; named, explicit test coverage in `36-security-testing.md` §4 (`SEC-LEAK-01` through `06`) |
| Bulk scraping of the catalog by a competitor | Automated bot/scraper | Rate limiting on catalog endpoints, cursor-based pagination (no cheap full-dump via offset-walking), `11-api-architecture.md` §7; (pending: `47-rate-limiting.md` for the specific per-endpoint threshold) |
| Catalog data tampering (a compromised Admin or Data-Manager-future-role account altering requirements/fees) | Malicious/rogue admin | Write access to catalog data is a distinct, audited permission (`02-personas-and-roles.md` §6's `DATA_MANAGER` design intent already separates data-ingestion permission from scoring-policy permission); every catalog write attributable via `createdBy`/`updatedBy`, `09-database-architecture.md` §6.2 |
| API over-fetching exposing more catalog detail than intended for a given entitlement state | Malicious/curious student | Same mitigation as the leakage threat above — response shaping happens once, server-side, applied uniformly regardless of query/filter/sort shape, `36-security-testing.md` §4 (`SEC-LEAK-03`) |

### 4.7 Authentication Credentials and Sessions

| Threat | Relevant actor(s) | Mitigation (reference) |
|---|---|---|
| Credential stuffing / brute force | Compromised-account attacker, anonymous attacker | argon2id password hashing (expensive to brute-force offline even if a hash were exfiltrated), per-account and per-source rate limiting on login attempts, `13-authentication-authorization.md` (pending detail), `36-security-testing.md` §10 |
| Phishing leading to account takeover | Compromised-account attacker | Session-based (not long-lived token) auth with short session lifetimes and revoke-all-on-password-reset, `13-authentication-authorization.md`; out-of-band notification of new-device/new-location login (pending: `14-security-architecture.md`) |
| Session fixation / hijacking | Anonymous attacker, compromised-account attacker | `HttpOnly`, `Secure`, `SameSite` session cookie attributes; server-side session validity lookup (not a self-verifying stateless token that can't be revoked), `09-database-architecture.md` §2; `36-security-testing.md` §13 |
| Privilege escalation via tampered request payload (injecting a `role` field) | Malicious/curious student, anonymous attacker (against signup) | Strict schema validation stripping/rejecting unknown fields before business logic executes, `08-backend-architecture.md` §3 (validation is step 1 of the pipeline, before auth/authorization even run); `36-security-testing.md` §3 (`SEC-ROLE-06`) |
| Role-cache staleness after revocation (a de-privileged Admin retaining access) | Malicious/rogue admin (post-termination scenario) | Short, documented TTL on any Redis-cached role/session data; authorization re-checked server-side on every request, never trusted from a long-lived client claim, `11-api-architecture.md` §2; `36-security-testing.md` §3 (`SEC-ROLE-07`) |

## 5. The Two Platform-Critical Invariants (Restated)

Every threat in this document ultimately rolls up into engineering priority via these two, and both have dedicated, named automated test coverage rather than relying on this document or code review alone:

1. **Locked-content omission.** If a student lacks a TARGET/SAFE entitlement, the API response must omit locked university identity/name/program/fee/metadata entirely — never send-then-blur client-side. This is a data-leakage class bug, not a UX bug, if it regresses. Test coverage: `36-security-testing.md` §4.
2. **Server-authoritative, idempotent payment/entitlement grants.** Payment and entitlement grants happen only via signature-verified, idempotent server-side webhook processing. Client-reported success is never trusted. The same webhook event delivered twice must never double-grant. Test coverage: `36-security-testing.md` §6, §7.

Any code change touching the response-shaping logic for assessment/university/program data, or touching the webhook-ingestion/reconciliation path, is treated as security-review-required regardless of how small the diff looks (a one-line change to a serializer or a webhook handler is exactly where these two invariants have historically regressed on comparable platforms).

## 6. Residual Risk

No mitigation set eliminates risk entirely; this section names what remains even with every control in Section 4 correctly implemented, and how AdmitFlow handles what's left rather than claiming it away.

- **Sophisticated account takeover via a fully compromised email account.** If a student's or admin's email account itself is compromised (not just their AdmitFlow password), an attacker can complete password-reset flows that AdmitFlow has no way to distinguish from a legitimate request — the email provider is a trust boundary AdmitFlow does not control. **Handling:** session revocation on password reset limits the blast radius to "from this point forward," notification-on-security-event (password change, new device) gives the legitimate owner a chance to notice and react, and for Admin/Super-Admin accounts specifically, a higher-assurance step (a second factor, out of scope for v1 per the charter but flagged here as the direct mitigation for this exact residual risk on the highest-privilege accounts) is the recommended follow-up hardening, not a v1 blocker.
- **Insider threat from a legitimate Admin or Super-Admin.** An Admin's job requires broad access; no authorization control can distinguish a legitimate verification action from the same action taken in bad faith by the same authorized person. **Handling:** this is accepted as a residual risk managed by detection and accountability, not prevention — comprehensive, non-repudiable audit logging (`09-database-architecture.md` §4, §7's Admin action → Audit log atomicity) of every sensitive action with actor identity, reason, and before/after state; periodic audit-log review (owned by `COMPLIANCE_ADMIN` once that role exists, by Super-Admin in v1); anomaly alerting on unusual access patterns (bulk document access outside an assigned queue, off-hours entitlement grants) as a detection layer, not a prevention layer.
- **Distributed, low-and-slow abuse that individually stays under rate-limit thresholds.** A sufficiently patient or distributed attacker (many source IPs, low request rate per IP) can evade per-IP rate limiting by design — no rate-limiting scheme alone solves this. **Handling:** named explicitly in `36-security-testing.md` §10 (`SEC-RATE-03`) as a documented follow-up defense, not a solved problem — account-level and behavioral anomaly detection (unusual pattern regardless of source diversity) is the complementary control, and this residual risk is accepted at v1 scale (100–10,000+ students, per `00-project-charter.md` §6) with monitoring rather than a heavier bot-mitigation investment that scale doesn't yet justify.
- **A genuine zero-day in a third-party dependency** (Prisma, the Next.js framework, the malware-scan engine, a payment SDK). No amount of AdmitFlow-authored testing catches a vulnerability in code AdmitFlow didn't write. **Handling:** dependency update cadence and vulnerability scanning are an operational practice (owned by CI/CD and infra docs, not re-derived here), and the defense-in-depth posture throughout this document (e.g., fail-closed on malware-scan errors, narrow IAM scoping on S3, parameterized queries structurally preventing a whole vulnerability class regardless of ORM bugs) is deliberately layered so a single dependency flaw is less likely to be a full-platform compromise on its own.
- **A convincing phishing page that harvests credentials AdmitFlow never sees.** No server-side control stops a student from typing their real password into a lookalike site. **Handling:** this is a user-education and brand-protection problem (consistent sending domains, DMARC/SPF/DKIM on outbound email so spoofed AdmitFlow emails are harder to send convincingly, in-app security messaging) rather than an authorization-architecture one; once compromised via this vector, the account falls under the "compromised student account" actor's mitigations in §4, not a distinct control.

None of these residual risks are treated as acceptable to ignore — they are the explicit reason `36-security-testing.md` includes detection-oriented tests (anomaly-signal assertions, not just block/allow assertions) alongside pure prevention tests, and the reason audit logging is treated as a first-class, transactionally-guaranteed feature (`09-database-architecture.md` §7) rather than a nice-to-have.

## 7. Related Documents

- `36-security-testing.md` — the test catalog operationalizing every mitigation cited above
- `53-acceptance-criteria.md` — Given/When/Then criteria for the two critical invariants and the surrounding workflows
- `02-personas-and-roles.md` — role/permission model and object-level isolation rule referenced throughout
- `09-database-architecture.md` — transactional and constraint-level mitigations (idempotency, audit atomicity, soft delete)
- `15-document-vault-security.md` — full document-threat mitigation detail
- `11-api-architecture.md` — response-shaping and 404-vs-403 object-existence rules
- `42-gdpr-and-data-privacy.md` — data-subject rights and retention, relevant to the PII/document assets above
- `13-authentication-authorization.md`, `14-security-architecture.md`, `47-rate-limiting.md`, `48-idempotency.md` — implementation-level detail behind several mitigations cited by reference above
