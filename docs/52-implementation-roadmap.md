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

## Phase 2 — Design System

Primitive components (Button, Input, Select, Checkbox, Radio, Switch, Modal, Drawer, Toast, Badge, Card, Table, Tabs, Progress, Stepper, Timeline, UploadZone, EmptyState, ErrorState, Skeleton) per `07-frontend-architecture.md` §6, built on the logo-derived tokens (`54-decision-log.md` D-12).

## Phase 3 — Authentication

Signup, email verification, login, logout/logout-all, password reset, OAuth (Google/Apple) linking, session issuance/rotation, account lifecycle state machine enforcement (`31-state-machines.md` §1) — per `13-authentication-authorization.md`.

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
