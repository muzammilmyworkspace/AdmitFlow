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

## Phase 4 — Onboarding

Profile wizard (education, destination, budget, English tests, academic risk, preferences) with autosave/resume — per `01-product-requirements.md`, `04-functional-requirements.md`.

## Phase 5 — Questionnaire Engine

Configurable Questionnaire/Section/Question/Option model, versioning, conditional logic, response persistence — per the questionnaire-engine sections of `01-product-requirements.md` and `10-database-schema.md` §3.

## Phase 6 — University Engine

University/Campus/Program/Intake/Requirement/Scholarship catalog CRUD, admin management, search/filter/pagination, data-freshness metadata and versioning — per `26-university-data-management.md`.

## Phase 7 — Assessment Engine

Weighted scoring engine with the D-6 default weights/thresholds, snapshot-based `AssessmentResult`, explainable per-university output — per `16-assessment-engine.md`, `17-university-matching-engine.md`.

## Phase 8 — Document Vault

Signed-upload/signed-download flow against S3, document state machine (`31-state-machines.md` §2), malware-scan integration point (pending B-3 vendor choice), review workflow — per `15-document-vault-security.md`.

## Phase 9 — Paywall / Entitlements

Product/Price/Entitlement/Customer model, server-side omission of locked fields (D-5), admin grant/revoke with audit — per `18-paywall-and-entitlements.md`.

## Phase 10 — Stripe

Checkout Session flow, signature-verified webhook, `WebhookEvent` idempotency (D-9), refund handling — per `19-payment-architecture.md`.

## Phase 11 — PayPal

Orders API equivalent behind the same payment-abstraction layer as Stripe — per `19-payment-architecture.md`.

## Phase 12 — Consultation

Slot/reservation/checkout/payment/confirmation/meeting-link/reminder flow, booking state machine (`31-state-machines.md` §4), double-booking prevention via DB constraint — per `22-consultation-booking.md`.

## Phase 13 — Application System

Readiness-gated submission, application state machine (`31-state-machines.md` §3), submission snapshots — per `21-application-management.md`.

## Phase 14 — Dashboard

Journey progress, next-best-action, assessment/document/application/deadline/notification/payment summaries — per `01-product-requirements.md` §"dashboard", `03-user-journeys.md`.

## Phase 15 — Admin Platform

All modules in `25-admin-platform.md`; pending confirmation of I-4 (impersonation) before that specific feature is enabled.

## Phase 16 — Notifications

Event→channel→template architecture, preference model (essential vs. marketing consent) — per `23-notification-system.md`.

## Phase 17 — Background Jobs

Full BullMQ job catalog (`24-background-jobs.md`), delivered via the $0-phase scheduled-batch profile initially (D-11) with a documented upgrade path to the always-on worker.

## Phase 18 — Error Handling & Validation Hardening

Full error taxonomy (`29-error-handling.md`), server-side validation conventions (`30-validation-rules.md`) applied consistently across all routes built in prior phases.

## Phase 19 — Testing

Unit/integration/E2E per `35-testing-strategy.md`; security test catalog per `36-security-testing.md`, with the `SEC-LEAK-*` (paywall) and `SEC-WEBHOOK-*`/`SEC-BOOK-*` (idempotency/concurrency) classes treated as release-blocking.

## Phase 20 — Production Readiness

The checklist in `35-testing-strategy.md`/the build-authorization message §71, run against whichever deployment profile ($0-phase or full target architecture) is live at that point.

---

**Status legend used in phase reports:** ✅ complete · 🚧 in progress · ⏸ blocked (state on what) · ⬜ not started.
