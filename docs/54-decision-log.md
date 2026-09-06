# 54 — Decision Log

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Living — updated as new decisions are made
**Owner:** SNZ Ventures Engineering

---

This log records every architecturally significant decision made during Phase 0 discovery and since, in the format the master spec requires: Decision / Context / Options / Chosen / Why / Tradeoffs / Future implications. Entries are grouped by theme and numbered `D-<n>`. Any doc that states a "Decision:" inline should trace back to (or be added to) this log — this file is the index of record when priorities conflict per the Source-of-Truth Priority order (Security → Data Integrity → Legal/Privacy → Approved Architecture → Business Requirements → Scalability → Maintainability → UX → Visual Preference).

---

## D-1. Document storage: AWS S3 only, not Supabase Storage

**Context:** The original brief proposed AWS S3 for documents in one place and a Supabase-Storage-based Prisma blueprint in another — an explicit contradiction the spec required be resolved, not ignored.
**Options:** (a) Supabase Storage only, (b) AWS S3 only, (c) both, split by document sensitivity.
**Chosen:** (b) AWS S3, private buckets, no public ACLs, signed URLs only, for every document.
**Why:** One clear source of truth for the platform's most sensitive data (passports, financial documents) is safer than two storage systems with different default-public assumptions. S3 + IAM gives the tightest, most auditable access-control primitives for this use case.
**Tradeoffs:** Loses Supabase's "one vendor for DB+storage+auth" convenience; adds one more provider/credential set to manage.
**Future implications:** `15-document-vault-security.md` and `32-file-storage-strategy.md` are the binding specs. Do not reintroduce Supabase Storage for any document type without updating this entry.
**Superseded consideration (2026-09-06 build-authorization message):** that message's stack list mentions "Supabase" generally and says storage defaults to "Private Supabase Storage unless the approved architecture documentation explicitly selects another provider" — our documentation *does* explicitly select S3 with stated rationale, so per the message's own rule and the Security > Approved Architecture priority ordering, **S3 stands.** See D-11 for how Supabase is still used (as a Postgres host only).

## D-2. Authentication: custom auth, not Supabase Auth

**Context:** RBAC/entitlements/audit need deep integration with our own domain model; a third-party auth service's role system doesn't map cleanly onto our permission-bundle RBAC or account-lifecycle state machine.
**Chosen:** Own `User`/`Session`/`Role`/`Permission`/`OAuthAccount` tables, argon2id hashing, OAuth (Google/Apple) linked via our own adapter layer, server-side session records (Postgres + Redis) so "logout everywhere" is a real operation, not a client-side token discard.
**Why:** Full control over the account lifecycle state machine, permission model, and audit trail; avoids a second source of truth for "who is this user" that would need constant reconciliation with our RBAC.
**Tradeoffs:** More auth code to build and secure ourselves versus a managed service; must implement password reset/verification/session rotation correctly.
**Future implications:** `13-authentication-authorization.md` is binding. Supabase (per D-11) is never used for auth, even though it's in the same project.

## D-3. Runtime split: Next.js request/response + separate always-on worker

**Context:** Long-running work (malware scanning, webhook post-processing, email delivery, reminders, analytics) cannot safely live inside serverless API routes (cold starts, execution time limits, no durable in-process queue).
**Chosen:** Next.js 15 App Router handles request/response only; a separate Node.js service running BullMQ against Redis handles everything asynchronous, with retries/backoff/dead-letter handling per job type.
**Why:** Keeps webhook handlers and API routes fast and reliable; makes background work independently scalable, retryable, and observable.
**Tradeoffs:** Two deployable services instead of one; needs an always-on host for the worker, which is in tension with the $0-infra goal (see D-12).
**Future implications:** `06-system-architecture.md`, `08-backend-architecture.md`, `24-background-jobs.md`, `39-deployment-architecture.md` are binding.

## D-4. Entitlements: generic Product/Price/Entitlement model, never boolean flags

**Chosen:** `Product`/`Price`/`Purchase`/`Subscription`/`Entitlement`/`Customer`, with `Entitlement.scope` (JSON, e.g. `{assessmentId}`) rather than a scope-type FK column or per-feature booleans on `User`/`Profile`.
**Why:** `isTargetUnlocked`-style flags don't survive a second pricing model, a refund, an admin override, or a future subscription without a schema migration and scattered call-site changes. A generic ledger does.
**Default scoping decision:** `TARGET_RESULTS`/`SAFE_RESULTS` entitlements are scoped **per-`AssessmentResult`**, not account-wide — re-running the assessment after a profile change requires its own unlock unless a future subscription-type Product grants blanket `ACCOUNT`-scoped access. This was an explicit judgment call (see `16-assessment-engine.md`/`18-paywall-and-entitlements.md`) to keep v1 simple while leaving room for a bundle/subscription product later.
**Future implications:** `18-paywall-and-entitlements.md`, `19-payment-architecture.md`, `10-database-schema.md` §8 are binding.

## D-5. Locked content is omitted from API responses, never sent-then-blurred

**Chosen:** A non-entitled user's API response for assessment/university results **omits** locked university identity/name/program/fee/metadata fields entirely (replaced by `{"locked": true}` plus aggregate counts), rather than sending full data for the frontend to visually hide.
**Why:** This is the platform's single most important security invariant, called out explicitly and repeatedly in the source spec as non-negotiable. Frontend-only locking is not a security control at all — anyone can read the network tab.
**Future implications:** Every endpoint that could leak paywalled data must be covered by the `SEC-LEAK-*` test class in `36-security-testing.md`. This is a blocking release gate, not a nice-to-have (see `53-acceptance-criteria.md`).

## D-6. Assessment engine: versioned, configurable, snapshot-based — never hardcoded

**Chosen:** Weighted scoring engine with admin-editable `AssessmentRule` weights/thresholds, versioned; every `AssessmentResult` freezes a full snapshot (profile, questionnaire answers, rules version, university-data version) so historical results never silently change when rules are edited later.
**Default v1 weights (from `16-assessment-engine.md`):** Academic 25%, English 20%, Budget 15%, Program/Field Fit 15%, Country/Preference 10%, Risk 10%, Deadline 3%, Document Readiness 2% (sum 100%).
**Default zone thresholds (rounded Overall Match Score):** EXCLUDED < 20, REACH 20–57 (free), TARGET 58–77 (paywalled), SAFE ≥ 78 **and** must pass SAFE-only guardrails (Academic ≥ 70, English ≥ 70 and not an estimate, Deadline ≥ 40, Risk ≥ 50) or it is demoted to TARGET even at a high raw score.
**Why:** Protects the "no fake guarantees" brand rule (a SAFE zone that isn't gated by real academic/English/deadline floors would misrepresent confidence) and keeps historical assessments legally/operationally defensible.
**Future implications:** `16-assessment-engine.md`, `17-university-matching-engine.md` are binding on exact formulas; changing default weights/thresholds requires a new `AssessmentRule` version, not an edit in place.

## D-7. University data staleness and versioning

**Chosen:** Catalog-wide monotonic `universityDataVersion` (not per-row versions); staleness thresholds — 6 months for GPA/English/fee/deadline fields, 9 months for document/scholarship criteria, 12 months for rankings/descriptive metadata. Stale data is flagged and used only for tie-breaking, never as a numeric penalty to `matchScore`.
**Future implications:** `26-university-data-management.md` is binding.

## D-8. Canonical state machines (single source of truth)

**Chosen:** `31-state-machines.md` is the single canonical reference for the Account, Document, Application, Booking, and Subscription state machines; every other document must reproduce these exactly, not invent variants.
**Canonical values:**
- **Account:** `REGISTERED → EMAIL_UNVERIFIED → VERIFIED → ONBOARDING → ACTIVE → SUSPENDED → DEACTIVATED → DELETED`
- **Document:** `REQUIRED → MISSING → UPLOAD_INITIATED → UPLOADED → PROCESSING → PENDING_REVIEW → VERIFIED / REJECTED → EXPIRED → REPLACED → DELETED`
- **Application:** `DRAFT → READY_FOR_REVIEW → READY_TO_SUBMIT → SUBMITTED → UNDER_REVIEW → ADDITIONAL_INFORMATION_REQUIRED → OFFER_RECEIVED / REJECTED / WAITLISTED → OFFER_ACCEPTED / OFFER_DECLINED`, with `WITHDRAWN` reachable from any non-terminal state.
- **Booking:** `AVAILABLE → RESERVED → CONFIRMED → COMPLETED / CANCELLED / EXPIRED / NO_SHOW`
- **Subscription:** `TRIALING → ACTIVE → PAST_DUE → CANCELED / EXPIRED` (designed for the future — v1 entitlements are per-assessment purchases, not recurring, per D-4).
**Corrections made during synthesis:** `10-database-schema.md` §2.1 originally modeled `User.status` as a 3-value enum — corrected to the 8-state machine above. `10-database-schema.md` §9.1 (`Application.status`) also originally used a shorter, differently-named list (`DRAFT, DOCUMENTS_PENDING, READY_TO_SUBMIT, SUBMITTED, UNDER_UNIVERSITY_REVIEW, OFFER_RECEIVED, CONDITIONAL_OFFER, REJECTED, WITHDRAWN, ENROLLED`), written before the canonical `31-state-machines.md` existed — corrected to the canonical list. `35-testing-strategy.md`, `36-security-testing.md`, and `49-threat-model.md` initially drafted their own divergent Application/Booking state names (e.g. `DECISION_PENDING`, `PENDING_PAYMENT`) before this canonical doc existed — reconciled to the values above; `WebhookEvent`'s field was inconsistently called `webhookProvider` in three files (`09-database-architecture.md`, `49-threat-model.md`, `35-testing-strategy.md`) versus the correct `provider` used in `10-database-schema.md`/`48-idempotency.md` — all three fixed to `provider`.
**Note:** the 2026-09-06 build-authorization message's own §26 lists a simpler, slightly different Application status list (`DRAFT/READY/READY_FOR_SUBMISSION/SUBMITTED/...`). Per D-8 and the priority order (approved architecture over restated business requirements), the canonical list above governs; the message's list is treated as an illustrative restatement, not a new instruction to diverge.

## D-9. Webhook idempotency and payment transaction boundary

**Chosen:** `WebhookEvent` unique on `(provider, providerEventId)`, claimed via `INSERT ... ON CONFLICT DO NOTHING` inside the *same* transaction as the `Payment`/`Purchase` update and `Entitlement` grant — row existence alone means "fully processed." A webhook success arriving after our local checkout/reservation expiry still grants/confirms (money was actually captured) rather than being rejected, logged as a warning.
**Future implications:** `19-payment-architecture.md`, `48-idempotency.md`, `09-database-architecture.md` §7 are binding and mutually consistent on this point.

## D-10. Key durations (all explicit judgment calls, documented so they're not re-litigated ad hoc)

| Duration | Value | Rationale source |
|---|---|---|
| Checkout session expiry | 30 min (5-min sweep) | `19-payment-architecture.md` |
| Consultation slot reservation expiry | 12 min (1-min sweep) | `22-consultation-booking.md` |
| Subscription `PAST_DUE` grace period | 3 days | `20-subscription-billing.md` |
| Consultation free-cancellation cutoff | 12 hours before session | `22-consultation-booking.md` |
| Consultation no-show grace | 10 minutes | `22-consultation-booking.md` |
| S3 signed URL TTL | 60–120s upload (PUT), 60s download (GET) | `15-document-vault-security.md` |
| Feature-flag stale-flag removal | within 90 days of reaching 100% rollout | `46-feature-flags.md` |
| Audit log retention | 7 years, uniform across all event types | `27-audit-logging.md` |
| Analytics event retention | 25 months, then deleted/aggregated | `45-analytics-and-events.md` |
| Support impersonation session cap | 15 minutes, reason-required, fully audited | `25-admin-platform.md` |
| Postgres RPO / RTO | ≤ 15 min / ≤ 4 hours | `41-backup-and-disaster-recovery.md` |

## D-11. $0-infrastructure reconciliation (introduced 2026-09-06, build-authorization message §38)

**Context:** The build-authorization message adds a constraint not present in the original discovery brief: keep infrastructure cost at or near zero during early development/controlled launch, without weakening security to do so. Taken literally, this is in tension with D-3 (a separate always-on worker service, which free serverless tiers don't naturally provide) and with using a dedicated managed Postgres provider alongside a separate object store and cache provider (more vendor accounts to keep at $0).
**Options considered:** (a) ignore the $0 goal and keep the originally documented topology, (b) fold Supabase in only as a free-tier Postgres host (keeping D-1/D-2 intact), (c) replace the dedicated worker with serverless-friendly scheduling primitives during the $0 phase.
**Chosen:** (b) + (c) — a documented "$0-phase deployment profile" layered on top of the already-approved architecture, not a replacement for it:
- **Postgres:** Supabase's free-tier Postgres, used *only* as a Postgres connection string for Prisma — Supabase Auth and Supabase Storage remain unused (D-1, D-2 stand). This is exactly what the build-authorization message's own rule permits ("use Supabase" is satisfied; "unless the approved architecture documentation explicitly selects another storage/auth provider" is respected because it does).
- **Redis / queue:** Upstash Redis (serverless-friendly, free tier, HTTP-based so it doesn't need a persistent connection) backing BullMQ; where a persistent worker isn't available in the free tier, time-driven jobs (reminders, deadline alerts, reconciliation sweeps) are triggered via scheduled HTTP calls (e.g. Vercel Cron or an equivalent scheduler) into API routes that enqueue/process a bounded batch per invocation, with the full always-on BullMQ worker (D-3) as the documented upgrade path once volume or job complexity requires it.
- **Object storage:** AWS S3 stands (D-1) — S3's free tier plus pay-as-you-go at near-zero volume is compatible with the $0 goal without compromising the storage decision; this is the one place cost and security point the same direction, so there is no real tension to resolve here.
- **Email/notifications:** use a provider with a genuine free tier (e.g. Resend/SendGrid free tier) for the $0 phase; documented as swappable behind the notification service's existing template abstraction (`23-notification-system.md`), so upgrading providers later is a config change, not a rewrite.
**Why:** Satisfies the literal $0 instruction without touching D-1/D-2/D-5 (the security-load-bearing decisions), and gives an explicit, honest description of what changes about the background-job story at low volume (batch-on-schedule rather than a persistent worker) instead of silently pretending a persistent worker exists when it doesn't.
**Tradeoffs:** Scheduled-batch processing has coarser latency than a real always-on worker (e.g. a reminder might fire up to one schedule interval late); Supabase free-tier Postgres has connection-pooling and storage-size limits that will require an upgrade path before real scale.
**Future implications:** This is the deployment profile for early development/staging and a low-volume initial launch only. `39-deployment-architecture.md`'s original always-on-worker topology remains the documented target architecture for when volume justifies the added cost — this decision does not retroactively change that document, it adds a bridge profile in front of it. Flagged as **IMPORTANT** (not blocking) in `55-known-risks-and-open-questions.md` to revisit once real usage data exists.

## D-12. Logo-derived brand palette (2026-09-06)

**Context:** The build-authorization message supplied the actual SnZ Ventures logo and explicitly instructed deriving the design-token system from it rather than forcing the placeholder palette given earlier in the same message.
**Observation:** The logo is a navy-ringed circular badge on white with the "SnZ" wordmark split diagonally — a mid-tone green upper-left, deep navy (`#0A2540`-consistent) lower-right — and "VENTURES" in muted gray beneath. This is a **Green → Navy** brand relationship, not the Navy → Mint → Indigo relationship in the original placeholder brief.
**Chosen:** Keep `#0A2540` as `color-primary` (already an exact match). Introduce `#3DA35D` ("SnZ Green," an approximation pending exact-hex sampling from the source logo file) as `color-secondary`, replacing Electric Mint entirely. Retain Vibrant Indigo `#635BFF` only as a sparingly-used tertiary accent for premium moments, since it doesn't appear in the logo and should never carry primary/secondary visual weight. The brand gradient becomes Green → Navy, matching the logo's own diagonal split.
**Why:** Section 4 of the build-authorization message is explicit: "Do NOT simply force the entire application to use arbitrary colors. Instead derive a professional design-token system from the logo." Electric Mint has no basis in the actual logo; Green does.
**Open question (see `55-known-risks-and-open-questions.md`):** `#3DA35D` is a reasonable professional-green approximation, not a pixel-sampled value — confirm the exact hex against the source vector/high-res logo file before final brand sign-off, and run the AA contrast check called for in `43-accessibility.md` before using it for any text smaller than "large text" size.
**Future implications:** `07-frontend-architecture.md` §7 is now binding on this point and supersedes the placeholder table originally given in the discovery brief.

## D-17. The free tier is a preview, not a zone

**Context:** The paywall was specified as zone-based — REACH free, TARGET and SAFE paid
(D-5). That reads sensibly and was implemented that way. A Playwright test then drove the
real UI with a strong profile (GPA 3.6, IELTS 7.5) and exposed the flaw: that student
matched 15 SAFE and 33 TARGET programmes and **zero** REACH ones, so the "free assessment"
showed them nothing whatsoever — an empty page behind a paywall, with copy that read
"beyond the ambitious options shown above" when nothing was shown above.

This is not an edge case. REACH means "a stretch on some requirement", so a strong
applicant having none of them is the normal outcome, and the rule therefore withheld
everything from precisely the students the product serves best. It is also the dark
pattern `00-project-charter.md` explicitly forbids.

**Options:** (a) accept it and reword the copy, (b) always unlock a fixed number of top
matches in addition to REACH, (c) unlock the top N only when the free tier would otherwise
be empty.

**Chosen:** (b). Every REACH match stays free, plus the three highest-scoring matches
regardless of zone (`FREE_PREVIEW_COUNT` in `result-projection.ts`).

**Why not (c):** a rule that only fires sometimes is harder to reason about, harder to
test, and produces an inconsistent product — two students would get materially different
free experiences for reasons neither could see. A rule that always applies is explicable in
one sentence.

**Why not (a):** the honest version of that copy is "pay to see any of your results",
which is the thing the charter rules out.

**Tradeoffs:** three strong matches are given away that were previously paid. In exchange
the paywall still gates the large majority (45 of 48 in the case that exposed this) and
gains an honest, concrete pitch — *here are your three best, here is everything else* —
rather than asking for money sight-unseen. The preview is deterministic (score, then id)
so the same assessment always previews the same programmes.

**Security note:** the locked payload is unchanged. Locked entries still carry only
`locked`, `placeholderId` and `zone`, verified by the `SEC-LEAK` checks after the change.
The preview widens *who is visible*, never *what a locked entry reveals*.

## D-15. `VerificationToken` table added (gap in the original ERD)

**Context:** `12-api-contracts.md` §2 and `13-authentication-authorization.md` §3 both specify token-based email verification (single-use 256-bit link token, 24h) plus a 6-digit OTP (10 min, max 5 attempts), and a password-reset token (30 min) — but `10-database-schema.md`'s ERD has no table to store any of them. `Session` is the wrong home: these are pre-authentication, single-use, and have different lifetimes and attempt-counting semantics.
**Chosen:** A single `VerificationToken` table with a `VerificationTokenType` enum (`EMAIL_VERIFICATION`, `PASSWORD_RESET`), storing `tokenHash`/`otpHash` (SHA-256, never raw values), `expiresAt`, `otpExpiresAt`, `otpAttempts`, and `consumedAt` for single-use enforcement.
**Why:** One table rather than two near-identical ones — the flows differ only in TTL and whether an OTP applies, and a shared table keeps consumption/expiry logic in one place. SHA-256 rather than argon2 is deliberate: these are 256-bit random values with no guessable structure, so argon2's slow-hash property (which exists to defend human-chosen passwords) buys nothing while costing latency on a request path.
**Tradeoffs:** A nullable `otpHash`/`otpExpiresAt` on rows that never use an OTP (password reset). Acceptable versus a second table.
**Future implications:** `10-database-schema.md` should be updated to include this entity the next time that document is revised — it is currently the one place where the schema is ahead of the ERD doc, and this entry is the record of why.

## D-16. Local embedded Postgres for development in this environment

**Context:** Phase 3 auth cannot be verified as working without a real database, and this machine has no Docker, no local Postgres install, and no provisioned managed instance (the $0-phase profile in D-11 assumes a Supabase account that does not exist yet).
**Chosen:** `embedded-postgres` (real Postgres 18 binaries, not a mock) as a devDependency, driven by `scripts/dev-db.mjs` (`npm run devdb:start` / `devdb:stop`), with data in the gitignored `.dev-postgres/`.
**Why:** It makes the auth flow genuinely testable end-to-end against real Postgres semantics (transactions, unique constraints, enums) rather than shipping code that has only been typechecked. Being real Postgres, behavior matches the deployment target rather than diverging like an in-memory mock would.
**Two bugs worth recording, because both cost real time and both will recur for anyone else on Windows:** (1) the library's own `start()`/`createDatabase()` hang forever — `pg_ctl` daemonizes the server, which inherits Node's stdio pipe and holds it open, so `spawnSync` waits on a stream that never closes; the fix is `stdio: "ignore"`. (2) Connecting to `localhost` fails (hang, then `ECONNRESET`) because it resolves to `::1` while Postgres listens only on `127.0.0.1` — the fix is binding explicitly with `-h 127.0.0.1` and using that address in `DATABASE_URL`.
**Future implications:** Dev-only, never a deployment artifact. It does not replace D-11's Supabase-hosted Postgres for staging/production; it removes the "no database available locally" blocker only.

## D-14. Windows dev-build workaround for Next.js's home-directory file-tracing bug

**Context:** During Phase 1, `next build`/`next dev` failed on this Windows development machine with `EPERM: operation not permitted, scandir 'C:\Users\<user>\Application Data'`. Root-caused (via instrumenting `fs.readdir` and Next's bundled `@vercel/nft` module directly) to a built-in Prisma-detection heuristic in Next's output-file-tracer: in addition to globbing the project root for `schema.prisma`, it also performs a recursive glob rooted at `os.homedir()` as a broad fallback (most likely triggered by static analysis of a `~`-path-expansion helper bundled inside Prisma's generated client runtime, which itself vendors `dotenv`). Every Windows user profile contains several restricted, SYSTEM-only folders (legacy pre-Vista junctions like "Application Data", plus modern ones like `AppData\Local\ElevatedDiagnostics`) with no fixed, enumerable list — so allow-listing individual folder names is not viable, and a full real scan of a home directory is also slow (browser caches, sync-client state, etc.).
**Options considered:** (a) find and pass an official Next.js config flag to disable this specific fallback, (b) avoid Prisma detection entirely by not using `@prisma/client` (not viable — it's the approved ORM per D-1's supporting architecture), (c) a small preload shim that intercepts Node's `fs.readdir`/`readdirSync`/`promises.readdir` and short-circuits to an empty result for any path under the user's home directory, loaded only for the `dev`/`build` npm scripts.
**Chosen:** (c). No documented, stable Next.js 15.3 config option was found to disable this fallback directly (`outputFileTracing: false` is not a recognized top-level key in this version). The shim (`scripts/win-legacy-junction-shim.cjs`) is a no-op on non-Windows platforms, is scoped to paths under `os.homedir()` only (never the project directory, asserted defensively in the shim itself), and only affects the local dev/build tooling process — it ships in the repo (not machine-specific config) so any Windows contributor gets a working build without individually discovering this issue.
**Why:** This is the smallest, most robust fix available without patching Next.js itself or ejecting Prisma's generated client (which regenerates on every `prisma generate` and would silently lose any patch). It doesn't weaken any security control — nothing under a developer's home directory is ever relevant to tracing this project's serverless output.
**Tradeoffs:** A workaround around unreleased/unfixed upstream behavior rather than a fix at the source; should be revisited (and likely removable) on future Next.js/Prisma upgrades — check first whether the upstream issue has been fixed before assuming this shim is still needed.
**Future implications:** Keep this shim in the repo as long as the project builds on Windows with this Next.js/Prisma combination. `next/font/google` is avoided for the same underlying reason (see `52-implementation-roadmap.md` Phase 1 known issues) until it's replaced with `next/font/local` in Phase 2.

## D-13. Application state-machine naming reconciliation with the build-authorization message

**Context:** The 2026-09-06 build-authorization message's §26 gives a shorter Application status list that both omits states already decided as necessary (`WAITLISTED`, `OFFER_ACCEPTED`, `OFFER_DECLINED` — needed to support the future `APPLICATION_REVIEWER` role and post-offer flows already described in `01-product-requirements.md`/`02-personas-and-roles.md`) and uses slightly different names for existing ones (`READY_FOR_SUBMISSION` vs. canonical `READY_TO_SUBMIT`).
**Chosen:** Canonical list from D-8/`31-state-machines.md` governs. The build-authorization message's list is treated as a plain-language restatement of intent, not a contradiction requiring a new decision — the message's own priority order (security/data-integrity/approved-architecture above restated business requirements) supports keeping one canonical source rather than forking it.
**Future implications:** No document should introduce a third variant of this state machine. If a future requirement genuinely needs a different lifecycle, it must be proposed as an update to `31-state-machines.md` directly, with this log updated accordingly.
