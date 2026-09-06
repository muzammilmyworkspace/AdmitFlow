# 40 — CI/CD

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering
**Applies to:** All code shipped to staging or production (Next.js app, worker service, Prisma schema/migrations)

---

## 1. Purpose

CI/CD is the enforcement mechanism for every other architecture decision in this doc set — a locked decision (S3-only storage, webhook-gated entitlements, migration-based schema changes) is only real if the pipeline actually blocks a change that violates it. This document defines the pipeline stages and their pass/fail gates.

## 2. Pipeline Stages

Every pipeline run (on pull request, and again on merge to the deploy branch) executes these stages in order; a failure at any stage stops the pipeline — later stages do not run against a broken build.

```
1. Install              → deterministic dependency install (lockfile-verified, no ad hoc resolution)
2. Lint                 → ESLint/TypeScript-aware lint rules, including project-specific rules
                            (e.g. no business logic in app/api/**/route.ts — see 08-backend-architecture.md §3;
                            no client-side entitlement/lock computation — see 07-frontend-architecture.md §9)
3. Typecheck            → full TypeScript project build in type-check-only mode, both the Next.js
                            app and the worker service packages
4. Unit Tests           → service-layer logic, scoring/eligibility rules, pricing calc, schema validation,
                            pure utility functions — fast, no real DB/Redis/S3
5. Integration Tests    → route handlers and worker processors against a real (ephemeral, throwaway)
                            Postgres + Redis, and a mocked/sandboxed S3 + Stripe/PayPal — covers the
                            request lifecycle (08-backend-architecture.md §3), transaction seams (§5),
                            and webhook idempotency behavior
6. Build                → production build of the Next.js app and the worker service artifact
7. Security Checks      → dependency vulnerability audit (fails on new high/critical advisories),
                            secret scanning across the diff and full history of the changed files
                            (fails if anything matching a credential/key pattern is found),
                            and a check that no `.env*` file other than `.env.example` is staged
8. Migration Validation → `prisma migrate diff` / `prisma migrate deploy --dry-run` (or equivalent)
                            executed against a throwaway database seeded from the current
                            production schema snapshot — catches destructive/incompatible migrations
                            before they ever reach staging or production
9. Deploy               → promote the build artifact to the target environment (staging automatically
                            on merge; production via an explicit, reviewed promotion step)
10. Smoke Tests          → a small, fast suite against the just-deployed environment: health check,
                            login, one read from each major module (catalog, assessment, applications,
                            billing), and a webhook-endpoint reachability check (signature-rejection
                            behavior only — no real payment is triggered)
```

## 3. Gate Details Worth Calling Out

| Stage | What specifically blocks the pipeline |
|---|---|
| Lint | A route handler containing business-rule branching beyond input/authz validation (per `08-backend-architecture.md` §3) is treated as a lint failure where a rule can detect the pattern, and as a mandatory code-review rejection otherwise. |
| Security Checks | Any dependency advisory rated high/critical with an available fix blocks merge; a detected secret pattern (API key format, PEM block, connection string with embedded credentials) anywhere in the diff blocks merge outright, even in a test fixture — test fixtures use obviously-fake placeholder values only. |
| Migration Validation | A migration that would drop a column/table or change a type in a way Prisma flags as data-loss-risking requires an explicit, reviewed expand/contract migration plan (add new, backfill, cut over, remove old in a later release) rather than being applied directly — this stage's job is to make that risk visible before deploy, not to auto-approve it. |
| Smoke Tests | A smoke test failure on a production deploy triggers an automatic rollback to the previous artifact, not a manual "investigate first" delay — production stays on the last known-good build while the failure is investigated. |

## 4. Schema Changes Are Always Migration-Based

**Decision:** every production Postgres schema change ships as a versioned Prisma migration, applied through the pipeline's Migration Validation → Deploy stages. There is no path — not a hotfix, not an admin script, not a manual `psql` session against production — that mutates the production schema outside a committed, reviewed migration file. Rationale: this is the only way `48-idempotency.md`'s transactional guarantees and the reproducibility requirement in `00-project-charter.md` non-negotiable #5 stay trustworthy — an out-of-band schema change is exactly the kind of drift that silently invalidates both. Emergency fixes still go through the same pipeline; "emergency" changes the review speed, not the mechanism.

## 5. Risky Features Roll Out Behind Flags, Not to 100%

**Decision:** a feature the team considers risky — a change to the scoring/matching engine, a new payment flow, a change to document verification logic, anything touching entitlement-granting — ships disabled or partially enabled behind a feature flag (`46-feature-flags.md`) and is deployed to production in that state; enabling it for 100% of students is a separate, explicit, reversible action (a flag flip, not a redeploy) taken after a staged rollout (e.g. internal accounts → small student percentage → full). Rationale: this decouples "is the code deployed" from "is the behavior live," which is what makes it possible to ship frequently without every deploy being a full-population bet — a bad rollout is a flag flip back, not a rollback-and-redeploy under incident pressure. CI/CD's job here is narrow: it must not silently strip or ignore a feature-flag check as dead code, and any PR touching a flagged code path is expected to keep the flag guard intact until an explicit "graduate the flag" follow-up removes it.

## 6. What This Document Does Not Cover

- Feature flag storage, evaluation, and targeting mechanics — see `46-feature-flags.md`.
- Detailed idempotency/retry contracts exercised by integration tests — see `48-idempotency.md`.
- Hosting topology for where staging/production actually run — see `39-deployment-architecture.md`.
- Required environment variables validated at deploy/startup time — see `38-environment-configuration.md`.
