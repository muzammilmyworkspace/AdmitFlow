# 00 — Architecture Gate

**Product:** AdmitFlow by SNZ Ventures ("Say No to Consultants")
**Document status:** Phase 0 discovery complete — this file is the gate between discovery and implementation
**Owner:** SNZ Ventures Engineering

---

## 1. What has been decided

The full 56-file documentation set under `/docs` is complete, covering product/requirements, system/frontend/backend/deployment architecture, database schema, API contracts, authentication/RBAC/core security, document vault security, GDPR/accessibility, the assessment/matching engine, university data model, paywall/entitlements, payments/billing/consultation, applications/notifications/background jobs/state machines, admin/audit/observability/analytics, and testing/threat-model/acceptance-criteria. Five cross-cutting architecture decisions were locked before any of that content was written, and held throughout: AWS S3 as the sole document store (no Supabase Storage), custom auth (no Supabase Auth), a Next.js-request/response-plus-separate-worker runtime split, a generic Product/Price/Entitlement model instead of boolean flags, and a versioned/snapshot-based assessment engine. See `54-decision-log.md` for the full record, including everything decided during the synthesis pass (default scoring weights, zone thresholds, state-machine names, key durations, the $0-infrastructure profile, and the logo-derived brand palette).

## 2. What has been improved over the original brief

- **Storage contradiction resolved** (D-1): the brief proposed both S3 and Supabase Storage; S3 was chosen with stated rationale rather than silently picking one.
- **Boolean-flag paywall replaced** with a real entitlement ledger (D-4), and the locked-content-leakage rule was made a first-class, testable security invariant (D-5) rather than a UX guideline.
- **Simplistic eligibility logic replaced** with a versioned, weighted, explainable scoring engine with concrete default weights/thresholds and SAFE-zone guardrails, so "Strong Match" language can never quietly mean "we didn't check anything" (D-6).
- **A single canonical state-machine reference** (`31-state-machines.md`) was established after multiple parallel-authored docs began drifting into their own variants — this was caught and corrected during synthesis (D-8), not left as a latent inconsistency.
- **The $0-infrastructure instruction** (added later, in the build-authorization message) was reconciled with the already-approved security architecture rather than either ignored or allowed to silently weaken it: Supabase is adopted, but scoped to Postgres hosting only, leaving the S3/custom-auth decisions untouched (D-11).
- **The brand palette was re-derived from the actual supplied logo** rather than kept as an arbitrary placeholder once the logo was available (D-12).

## 3. What remains ambiguous / requires future configuration

See `55-known-risks-and-open-questions.md` for the full triaged list. In summary: legal review of compliance and outcome-language claims (B-1, B-2), a malware-scanning vendor choice (B-3), exact brand-color hex sampling and contrast verification (B-4), and a subprocessor/DPA list (B-5) are **blocking** for real-user launch but not for beginning implementation. Video-conferencing vendor, email-provider choice for the $0 phase, support impersonation sign-off, exact password/MFA policy, and real (non-demo) university catalog sourcing are **important** but have documented defaults that unblock work now.

## 4. Assumptions made

- Stripe Checkout Sessions (not raw PaymentIntents) and PayPal Orders API, behind a shared payment-abstraction layer.
- Argon2id password hashing, UUID primary keys, UTC timestamps throughout.
- Illustrative default pricing (€9.99 unlock, €15 application fee, €30/40-min consultation) as seed `Product`/`Price` data, not hardcoded values.
- A 3-country (UK/Canada/Germany) seed catalog for development/demo purposes only — never presented as authoritative to a real student (I-6).
- Playwright as the E2E test runner (assumed by the testing-strategy doc group; not yet independently confirmed).

## 5. Critical risks

The two non-negotiable invariants that every future change must protect: (1) a non-entitled user's API response must never contain locked TARGET/SAFE content in any form, and (2) payment/entitlement grants happen exclusively through signature-verified, idempotent server-side webhook processing, never client-reported success. Both have dedicated test classes in `36-security-testing.md` and acceptance criteria in `53-acceptance-criteria.md`, and both are called out explicitly in `49-threat-model.md` §5. Any PR touching auth, payments, webhooks, documents, or booking concurrency should be treated as higher-scrutiny by default per that doc's stated CI-gating assumption.

## 6. Implementation prerequisites

Node 24 / npm 11 confirmed available in the target environment. Before Phase 1 code is written: Prisma schema must be authored from `10-database-schema.md` (post state-machine corrections), `.env.example` populated per `38-environment-configuration.md` (adjusted for the $0-phase profile — Supabase Postgres connection string, Upstash Redis URL, S3 credentials, Stripe/PayPal test keys, OAuth client IDs, session secret), and the design-token CSS variables set up per the corrected `07-frontend-architecture.md` §7 before any UI component is built against a color value.

## 7. Final architecture summary

AdmitFlow is a Next.js 15 (App Router, TypeScript, Tailwind) application backed by PostgreSQL (via Prisma; Supabase-hosted in the $0 phase, portable to any managed Postgres later), with AWS S3 as the sole document store, custom session-based auth, Redis/BullMQ for background work (scheduled-batch during the $0 phase, always-on worker as the scale-up path), Stripe and PayPal for payments behind a shared abstraction, a versioned weighted-scoring assessment engine, a generic entitlement/paywall model that never leaks locked data to the client, and RBAC built on permission bundles so new roles are additive, never a redesign. The documentation set in `/docs` is the binding source of truth for all of this; `54-decision-log.md` is where any future conflict gets resolved and recorded, and `52-implementation-roadmap.md` is the phase-by-phase build sequence now beginning.

**Gate status: PASSED.** Proceeding to Phase 1 (Foundation).
