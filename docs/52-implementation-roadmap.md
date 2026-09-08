# 52 — Implementation Roadmap

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Living — checked off as phases complete
**Owner:** SNZ Ventures Engineering

---

This roadmap merges the discovery brief's Phase 0–11 structure with the build-authorization message's more granular Phase 1–20 build order, using canonical naming from `31-state-machines.md`/`54-decision-log.md` throughout. Each phase ends with the checkpoint the build-authorization message requires: lint, typecheck, test, build, then a short status report (Implemented / Database / API / Frontend / Security / Tests / Build / Documentation / Known Issues / Next Phase).

## Phase 0 — Discovery & Documentation ✅ complete

All 56 files under `/docs`, this roadmap, the decision log, and the risks register. Two cross-file inconsistencies found during synthesis were corrected (`User.status` enum in `10-database-schema.md`; `WebhookEvent.provider` naming) — see `54-decision-log.md` D-8.

## Phase 1 — Foundation ✅ complete

Project scaffold (Next.js 15 App Router, TypeScript strict, Tailwind, ESLint, Prettier), design tokens from `07-frontend-architecture.md` §7, Prisma schema from `10-database-schema.md`, environment validation (`38-environment-configuration.md`), base error-handling/response-envelope utilities (`29-error-handling.md`), structured logging scaffold (`28-observability.md`), security headers + request-ID middleware, RBAC primitives (`Role`/`Permission` seed data + a permission-check helper), a reference-data seed script (roles, permissions, products/prices, feature flags), and a `/api/health` endpoint.

**Report:**
- **Implemented:** full `prisma/schema.prisma` (45+ models transcribed from `10-database-schema.md`, two further state-machine inconsistencies found and fixed along the way — `Application.status` had never been reconciled to the canonical list either, see `54-decision-log.md` D-8); `src/lib/{env,logger,errors,response,rbac,db}.ts`; `src/middleware.ts`; `prisma/seed.ts`; base Next.js app shell with logo-derived design tokens.
- **Database:** schema validates and generates cleanly against Postgres; no migration created yet (no live database provisioned in this environment — `prisma migrate dev` is the next actor-driven step once `DATABASE_URL` points at a real instance, per the $0-phase profile in `54-decision-log.md` D-11).
- **API:** `GET /api/health` — verified working end-to-end, including the failure path (returns a clean `INTERNAL_ERROR` envelope with no stack trace leaked, correctly logs the Prisma connection failure server-side, when no database is reachable).
- **Frontend:** minimal home page on the corrected logo-derived palette; `next/font/google` intentionally avoided for now (see Known Issues).
- **Security:** baseline HTTP security headers (`next.config.ts`), request-ID propagation, RBAC permission-check primitives with unit tests, env validation that hard-fails `DEMO_MODE=true` under `APP_ENV=production`.
- **Tests:** 6/6 passing (`errors.test.ts`, `rbac.test.ts`).
- **Build:** `typecheck`, `lint`, `test`, and `build` all pass clean; dev server smoke-tested manually (home page 200, `/api/health` correctly surfaces a DB-unreachable error).
- **Documentation:** this roadmap and `54-decision-log.md` updated with every fix made during implementation.
- **Known issues:**
  - Next.js's file tracer (`@vercel/nft`) has a built-in Prisma-detection fallback that globs the OS home directory, which crashes on Windows dev machines due to restricted profile folders. Worked around with `scripts/win-legacy-junction-shim.cjs`, loaded via `NODE_OPTIONS` in the `dev`/`build` scripts — Windows-only, a no-op elsewhere, documented in the shim itself.
  - `next/font/google` (Inter) is not wired up yet — pulling it in on this machine triggers the same class of home-directory scan. `font-sans` falls back to the system font stack for now; revisit with `next/font/local` (vendored font files) in Phase 2.
  - No native `argon2` usage yet (Phase 3), so its native-binary build/tracing behavior is untested end-to-end.
  - No real Postgres/Redis/S3 credentials in this environment — `.env` holds placeholder values from `.env.example` for tooling to run against; a real `DATABASE_URL` is needed before `prisma migrate dev` or the seed script can actually run.
- **Next phase:** Phase 2 — Design System.

## Phase 2 — Design System 🚧 partial

Built so far, on the logo-derived tokens (`54-decision-log.md` D-12): `Button` (4 variants, 3 sizes, loading state), `Input`, `FormField` (label association + `aria-describedby` error wiring, so accessible error states are structural rather than per-form), `Card`, `Alert` (tone-driven `role="alert"`/`"status"`), `Spinner`, and the `cn()` class-composition helper.

The remaining primitives from `07-frontend-architecture.md` §6 (Select, Checkbox, Radio, Switch, Modal, Drawer, Toast, Badge, Table, Tabs, Progress, Stepper, Timeline, UploadZone, EmptyState, ErrorState, Skeleton) and the domain components (UniversityCard, DocumentCard, ApplicationCard, ProgressRoadmap, LockedContent, EntitlementBanner) are deliberately **not** built ahead of their first real use — each arrives with the phase that needs it, so its API is shaped by an actual caller rather than guessed.

## Phase 3 — Authentication ✅ complete (except OAuth)

Signup, email verification (single-use link **and** 6-digit OTP), login, logout, logout-all, forgot/reset password, session issuance, and account lifecycle enforcement per `31-state-machines.md` §1 — all verified end-to-end against a real Postgres instance (`54-decision-log.md` D-16).

**Report:**
- **Implemented:** `src/services/auth-service.ts` (all business logic), `src/lib/auth/{password,password-policy,tokens,session}.ts`, `src/lib/{audit,api-route,api-client}.ts`, 8 API routes under `/api/v1/auth/*` + `/api/v1/users/me`, and 6 pages (`/signup`, `/login`, `/verify-email`, `/forgot-password`, `/reset-password`, `/dashboard`).
- **Database:** added `VerificationToken` + `Session.absoluteExpiresAt` (`54-decision-log.md` D-15); two migrations applied; reference-data seed run.
- **Security verified by live test, not just by reading the code:** identical `AUTH_INVALID_CREDENTIALS` for wrong-password vs. nonexistent-email (with a dummy-hash verify so timing doesn't leak existence either); `forgot-password` returns an identical response for both cases; verification and reset tokens are single-use (reuse rejected); a wrong OTP increments `otpAttempts` (observed 1 in the DB) and is capped at 5; password reset revokes **all** sessions (pre-reset cookie went dead immediately); `logout-all` revoked 2 sessions across "devices"; `/dashboard` 307-redirects server-side when unauthenticated; `/users/me` returns only the caller's own record with no id parameter to tamper with.
- **Audit trail:** `user.registered`, `user.email_verified`, `user.login`, `user.password_changed` rows all written, actor-attributed, and confirmed in the database.
- **Tests:** 18/18 passing (password policy, token/OTP generation + hashing + constant-time compare + the documented TTL windows, RBAC, error taxonomy).
- **Build:** typecheck, lint, tests, and production build all clean — 19 routes.
- **Known gaps (deliberate, not overlooked):**
  - **OAuth (Google/Apple) not built** — needs real client credentials that don't exist in this environment. The `OAuthAccount` table and its unique `(provider, providerAccountId)` constraint are already in place for it.
  - **No real email delivery.** `src/lib/notifications/dev-mailer.ts` logs the verification link/OTP to the server log so the flow is exercisable; it *throws* rather than silently no-ops if `APP_ENV=production`, so this cannot ship unnoticed. Real templated delivery is Phase 16 (`23-notification-system.md`), pending a provider choice (`55-known-risks-and-open-questions.md` I-3).
  - **Breached-password check not implemented** (`30-validation-rules.md` §2 specifies a Pwned Passwords k-anonymity query) — it needs an outbound HTTP call that belongs behind the worker boundary.
  - **Rate limiting not yet applied** to these endpoints; `47-rate-limiting.md` specifies concrete limits for login/signup/OTP and it needs Redis, which is not provisioned locally. This is the most important Phase 3 follow-up — the endpoints are currently brute-forceable.
  - Session rotation on privilege change (`13-authentication-authorization.md` §2.2) is specified but not yet triggered anywhere, since no flow changes roles yet.

## Phase 4 — Onboarding ✅ complete

Six-step wizard with autosave and resume-where-you-left-off. Step completion is **derived
from the data**, not stored as a pointer: a stored "current step" goes stale the moment a
student edits an earlier section from settings, and then the wizard misreports what's
missing. `completeOnboarding` enforces the A5 transition to `ACTIVE` and refuses while any
section is outstanding, since the assessment is only as honest as its inputs.

## Phase 5 — Questionnaire Engine 🚧 schema only

The versioned `Questionnaire`/`Section`/`Question`/`QuestionOption`/`AnswerSnapshot` model
exists and `AssessmentSnapshot` already links to `AnswerSnapshot`. The admin-authored
question UI and conditional-logic evaluation are not built: onboarding currently captures
the structured profile the engine actually scores, and adding a second, parallel
question-capture surface before there are real questions to ask would be building for a
requirement nobody has yet.

## Phase 6 — University Engine ✅ complete

Catalog with cursor pagination (never an unbounded result set), structured filters, and
per-record freshness flagging. Seeded with 48 programmes across 12 **deliberately
fictional** universities — rule #64 forbids presenting fabricated requirements as
authoritative, so every record carries `source: "DEMO DATA — not a real institution"` and
`confidence: LOW`. Admin CRUD for catalog editing is not built (read + seed only).

## Phase 7 — Assessment Engine ✅ complete

Pure, database-free scoring functions (`scoring.ts`) with the D-6 weights and thresholds,
tolerance bands rather than hard cutoffs, proportional weight redistribution when the
catalog lacks a field, and SAFE guardrails that demote a high average built on weak
fundamentals. Results are immutable and snapshot-backed. 20 unit tests, including one
asserting the reasoning copy never uses guarantee language.

## Phase 8 — Document Vault ✅ complete

Authorize → signed PUT → server-side confirm, with magic-byte verification (the browser's
claimed type is never trusted), quarantine-not-delete on a malware hit, and a
`DocumentAuditLog` row per transition. Malware scanning is still the integration point
rather than an implementation — no vendor chosen (`55` B-3) — and it reports
`NOT_SCANNED` rather than `CLEAN`, because a false assurance is worse than a known gap.

## Phase 9 — Paywall / Entitlements ✅ complete

Generic `Product`/`Price`/`Entitlement` ledger. The projection layer omits locked entries
entirely rather than flagging them. **Amended during testing:** zone-based gating alone
left strong students with an empty free tier, so every REACH match plus the three
highest-scoring matches are now always free — see `54-decision-log.md` D-17.

## Phase 10 — Stripe ✅ complete (unverified against live Stripe)

Checkout Session flow, raw-body signature verification, `WebhookEvent` idempotency, plus a
second purchase-level guard because providers legitimately emit several events per
payment. The Stripe driver is written and typechecked but has never run against real
Stripe credentials; the dev driver exercises the identical server-side path.

## Phase 11 — PayPal ⬜ not started

The provider interface is in place and `PaymentProvider` already includes `PAYPAL`; only
the driver implementation is missing.

## Phase 12 — Consultation ✅ complete

Slot → 12-minute hold → checkout → webhook → confirmation, with double-booking prevented
by the DB unique constraint (a P2002 catch outside the transaction, since Postgres aborts
a transaction on constraint violation). Expired holds are released both by a sweep
function and opportunistically on the next booking attempt, so an abandoned checkout can't
wedge a slot even with the job runner down.

## Phase 13 — Application System ✅ complete

Readiness predicate re-checked server-side at submission, then an atomic snapshot freeze
(profile, programme, documents by checksum, requirements). A repeat submit returns success
rather than an error — the user double-clicked, and one submission is the correct outcome.

## Phase 14 — Dashboard ✅ complete

Journey stages and next-best-action are computed per request. The next action is ordered by
what actually blocks progress, not by position in the flow: a rejected document outranks an
unstarted application because everything downstream waits on it.

## Phase 15 — Admin Platform ✅ complete (core)

Overview, user management with reason-required audited overrides, the document review
queue, application list, and the audit log — whose own reads are audited. Access is decided
by **permission**, not role name, so the seven future roles need no change here. University
catalog editing and consultant management UIs are not built.

## Phase 16 — Notifications ✅ complete (in-app + logged email)

Templated, versioned, HTML-escaped interpolation with essential-vs-marketing
classification. Delivery never throws into the caller's transaction — a booking must not
fail because an email bounced. Real provider delivery is pending a vendor (`55` I-3).

## Phase 17 — Background Jobs ⬜ not started

`releaseExpiredHolds()` and the notification dispatch are written as callable functions
with no scheduler attached, so the work is done but nothing runs it on a timer yet. This is
the largest genuine gap: booking-hold expiry and deadline reminders currently only advance
when a related request happens to trigger them.

## Phase 18 — Error Handling & Validation ✅ complete

Full error taxonomy with a consistent envelope and `requestId` on every response; stack
traces never reach the client. Every endpoint validates its input with a schema.

## Phase 19 — Testing ✅ complete

108 unit tests, a 67-check API suite, a 27-check consultant-review suite, and 12 Playwright
browser specs. The browser suite caught the empty-free-tier bug that the API suite had
missed, and three of my own test bugs were found and fixed — two of which meant IDOR and
double-booking were passing on a guard that fired before the check they existed to test.

Unit tests run sequentially (fileParallelism: false): in parallel, several workers each
transform the Prisma client at once and time out fetching their own module graph, which
is reported as failed files with zero failed assertions — a thoroughly misleading way to
learn the machine is busy.

## Phase 20 — Production Readiness 🚧 partial

Green: typecheck, lint, unit/API/browser suites, production build, secrets excluded from
git, security headers, rate limiting, audit logging, migrations.

Outstanding before real users: the blocking items in `55-known-risks-and-open-questions.md`
(legal review of compliance and outcome-language claims, a malware-scanning vendor, exact
brand-colour sampling, subprocessor list), plus real Redis, real S3, real payment
credentials, a job scheduler, and an accessibility pass with actual screen readers.

---

## Post-Phase-20 work

### Input validation hardened

A student typing a five-digit year into the date-of-birth picker had it accepted by the
browser, accepted by the schema, and rejected only where something downstream called
`.getTime()` on it — so the answer was a 500. `src/lib/validation.ts` is now the single
home for these rules: exact `YYYY-MM-DD` parsing that rejects impossible calendar dates
and out-of-century years, age-bounded dates of birth, past-only test dates, a study-date
horizon, a typo-catching budget ceiling, and trimmed, bounded free text. The wizard's
inputs carry matching `min`/`max` attributes computed from the same constants, so the two
cannot drift. `scripts/e2e.sh` §13 asserts each case returns 400, never 500.

### Matches redesigned as a comparison grid — D-19

Three cards across on desktop, with locked matches rendered as cards in the same grid, so
a student can see the shape of what they are missing beside what they can already read.
The locked cards are drawn from `{ locked, placeholderId, zone }` and nothing else — D-19
records why a blur over real data was rejected. `e2e/matches.spec.ts` asserts both the
grid and the invariant, checking every programme id in the delivered document against the
set the viewer is entitled to.

### Consultant assessment review — D-20

A €10 written review of one assessment: sold as a product granting a scoped entitlement,
requested by the student, and delivered by a consultant through a work queue.
`scripts/review-e2e.sh` walks the whole path — the offer, the 402 for an unpaid request,
purchase, request, claim, delivery, and the boundaries around who may read the result.

Building it surfaced a gap in checkout that was not specific to this product: `scope` was
stored exactly as the client sent it, unvalidated. A client bug sending a well-formed but
wrong id — which happened during this work — produces an entitlement that no check will
ever match, so the student pays and receives nothing, with a successful payment on record.
`createCheckout` now verifies that a supplied `assessmentId`, `applicationId` or
`bookingId` belongs to the caller.

**Still outstanding:** consultants have no UI of their own. The queue is API-only
(`GET`/`PATCH /api/v1/admin/assessment-reviews`), so a review is delivered today by an
admin or consultant calling that endpoint directly. A queue screen is the obvious next
piece of work.

### Account self-service and the scheduler — D-22, D-23

The gaps a full walk-through of the signed-in product turned up, in the order they were
found:

**Identity.** No `public/` directory, so no favicon and no share card; `Inter` named in the
Tailwind token since Phase 2 but never actually loaded; no `error.tsx`, `not-found.tsx` or
`loading.tsx` anywhere; onboarding — the first screen after sign-up — sitting outside the
dashboard shell and therefore the plainest surface in the product.

**Security.** No `Content-Security-Policy`, despite `next.config.ts` claiming a stricter one
lived in middleware. The consultant-review endpoints were the only mutating routes without
a rate limit.

**Missing surfaces.** The notification API had been complete since Phase 16 and nothing in
the interface ever called it. There was no settings page, so no way to change a password,
review sessions, export data, or delete an account. The consultant review queue was
API-only — the paid human review was delivered by someone running `curl`.

**Operations.** Nothing ran on a timer at all.

All are now built. What remains outstanding is the risk register's own list
(`55-known-risks-and-open-questions.md`): the legal reviews (B-1, B-2), a malware-scanning
vendor (B-3), exact brand-colour sampling (B-4), subprocessor DPAs (B-5), and the
production infrastructure — real Redis, real S3, real payment credentials, and a scheduler
actually calling `/api/v1/internal/cron` on a timer.

**A note on running the suites back to back:** signup is rate-limited to 5/hour against an
in-memory store, so a second full run inside the hour is refused. Both API suites now
detect the 429 and abort with an explanation rather than reporting the cascade of
`AUTH_REQUIRED` failures that follows. Restart the dev server to reset the bucket.
