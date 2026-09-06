# 51 — Seed and Migration Plan

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering
**Applies to:** All Prisma migrations, all environments (local, CI, staging, production)

---

## 1. Purpose

Defines the mechanical workflow for changing the database schema and for getting reference/config data into every environment (including production) without ever hand-editing a production database. This document is the detailed "how"; `09-database-architecture.md` §10 states the binding rule that this workflow is mandatory.

## 2. Migration Workflow

### 2.1 Stages

1. **Design.** Schema change is designed against this document's conventions (§3) and `09-database-architecture.md`/`10-database-schema.md`'s modeling rules (normalization stance, JSON-column justification, UUID PKs, soft-delete policy, cascade policy). A change that contradicts those documents requires updating them in the same PR, not silently diverging.
2. **Generate.** `npx prisma migrate dev --name <descriptive_name>` generates the migration SQL from the updated `schema.prisma`, run against a local/ephemeral database — never against shared staging/production.
3. **Review.** The generated SQL (not just the Prisma schema diff) is reviewed in the pull request like any other code change. Reviewers specifically check for: (a) destructive operations against tables with production data (`DROP COLUMN`, `DROP TABLE`, `ALTER COLUMN ... TYPE` with implicit cast risk, adding a `NOT NULL` column without a default on a non-empty table), (b) whether an index is being added `CONCURRENTLY` where the target table will have production rows (a plain `CREATE INDEX` takes a lock that blocks writes — unacceptable on `Document`, `Payment`, `Application`, `AuditLog`), (c) whether the change needs a corresponding backfill migration or data migration script, and (d) whether the change requires a `51-seed-and-migration-plan.md`-style reference-data migration (§4) alongside it (e.g. a new `Role` or `Product` needed by the feature).
4. **Test.** The migration is applied to a CI database seeded with realistic volume/shape fixture data (via the seed scripts in `37-seed-data-strategy.md`) and the full test suite runs against the post-migration schema. For migrations touching high-traffic tables, a staging dry run against a production-data-volume clone (anonymized) is required before deploy sign-off.
5. **Deploy.** `npx prisma migrate deploy` runs as an explicit, logged step in the deployment pipeline — never as a side effect of application boot in production (application boot may run `migrate deploy` in dev/CI for convenience, but the production deploy pipeline runs it as its own gated step, before the new application version receives traffic, so a mid-rollout schema mismatch between old/new app code and the DB is never possible for more than the deploy window covered by the expand/contract pattern in §3.3).
6. **Verify.** Post-deploy verification checks: migration marked applied in Prisma's `_prisma_migrations` table, application health checks green, a smoke-test query against the changed table(s), and — for any migration touching a table in the "sensitive" list (`Payment`, `Entitlement`, `WebhookEvent`, `AuditLog`, `Document`) — a manual row-count/spot-check comparison against the pre-migration baseline captured in step 4.
7. **Rollback plan (documented per migration, not improvised at incident time).** Every migration PR includes a "Rollback" note in its description covering: is this migration safely reversible (a pure additive change: yes, trivially); if not purely additive, what is the compensating migration (e.g. a dropped column's rollback is "re-add the column; data is only recoverable from the last backup — see `41-backup-and-disaster-recovery.md`, not automatically"); and whether a rollback requires an application-code rollback in lockstep (it does, whenever the migration is not purely additive — see §3.3).

### 2.2 Never-Do List

- Never connect a DB client directly to the production database and run `ALTER TABLE`/`UPDATE`/`DELETE` outside a reviewed migration or an explicitly-approved, logged, one-off incident-response script (and even the latter is followed by a same-day migration that codifies the change so `schema.prisma` and production never silently diverge).
- Never run `prisma migrate dev` (which can drift-detect and offer to reset the database) against staging or production — only `prisma migrate deploy`, which is non-destructive and purely applies pending migrations.
- Never edit an already-applied migration file. A mistake in a shipped migration is fixed by a new forward migration, never by rewriting history (rewriting a migration that has already run in any shared environment desyncs that environment's `_prisma_migrations` ledger from the repository).

## 3. Migration Naming, Versioning, and Safety Patterns

### 3.1 Naming Convention

Prisma's default timestamp-prefixed directory naming (`20260906143000_add_entitlement_scope_column`) is retained as the authoritative ordering mechanism (never reordered/renamed after the fact — that breaks the applied-migrations ledger). The descriptive suffix follows `<verb>_<entity>_<detail>` in `snake_case`, verbs limited to a small controlled vocabulary for grep-ability: `add`, `remove`, `rename`, `alter`, `backfill`, `index`, `constraint`, `seed_reference` (§4). Examples: `add_entitlement_scope_column`, `backfill_document_status_history`, `index_application_student_status`, `seed_reference_default_roles`.

### 3.2 One Concern Per Migration

Each migration does one logical thing. A new feature needing both a new table and a backfill of an existing column is two migrations (schema change, then backfill), not one — so a failed backfill never leaves an ambiguous "is the schema change also rolled back?" state, and so the review in §2.1 step 3 can reason about each concern independently.

### 3.3 Expand/Contract for Breaking Changes

Any change that would break the currently-deployed application version if applied instantly (renaming a column, changing a type, making a nullable column required, dropping a column still read by old code) follows expand/contract across at least two deploys, never a single-step breaking migration:

1. **Expand:** add the new column/table alongside the old one; deploy application code that writes to both (dual-write) and reads from the old one.
2. **Backfill:** a separate migration (or an application-level backfill job for large tables, to avoid a long-held lock) populates the new column from the old.
3. **Cut over:** deploy application code that reads/writes only the new column.
4. **Contract:** a final migration drops the old column, only after confirming (via the review checklist in §2.1) that no code path — including any long-running background job or external report — still references it.

This is the standard, load-bearing pattern for evolving tables that already hold production data (`User`, `Document`, `Application`, `Payment`) without downtime or a broken in-flight-deploy window.

### 3.4 Locking-Sensitive Operations

On tables expected to hold non-trivial production row counts (`Document`, `Application`, `Payment`, `AuditLog`, `Notification`), migrations use `CREATE INDEX CONCURRENTLY` (which Prisma supports via a manually-adjusted migration when needed, since `prisma migrate dev` does not generate `CONCURRENTLY` by default) and avoid `ALTER TABLE ... ADD COLUMN ... NOT NULL` without a `DEFAULT` (which historically required a full table rewrite/lock in Postgres versions prior to 11, and even on modern Postgres is avoided as a defensive default) — instead: add nullable, backfill, then add a `NOT NULL` constraint via `ALTER TABLE ... ADD CONSTRAINT ... CHECK (...) NOT VALID` followed by `VALIDATE CONSTRAINT` (which does not hold a long lock for the validation scan), a pattern documented here so it isn't rediscovered ad hoc under deploy pressure.

## 4. Seed Data vs. Reference/Config Data Migrations (the core distinction)

This is the single most important distinction in this document — getting it wrong either means fake demo data leaking into production, or production launching without rows it structurally requires (no `Role` rows means nobody can log in with any permissions at all).

| | **Reference/config data migrations** | **Fake demo/seed data** |
|---|---|---|
| Examples | Default `Role` rows (`STUDENT`, `ADMIN`, ...), default `Permission` rows, `RolePermission` bundle assignments, default `Product`/`Price` rows (application fee, unlock, consultation — using **real, production Stripe/PayPal price IDs**), `NotificationTemplate` keys with production-approved copy, baseline `FeatureFlag` rows (including `DEMO_MODE = false`), default `SystemSetting` rows | Demo/test `User` accounts (`50-test-accounts.md`), the sample university/program/intake catalog (`37-seed-data-strategy.md` §4.2), illustrative `AssessmentRule` weights meant only for non-prod demoing |
| Is it safe/required in production? | **Yes — required.** The application does not function correctly without these rows; they are effectively part of the schema's contract, just expressed as data instead of DDL. | **No — forbidden in production**, per the double-gate in `37-seed-data-strategy.md` §7. |
| How is it applied? | As a **data migration** — a Prisma migration file (or a dedicated `prisma/migrations/<timestamp>_seed_reference_*/migration.sql` using raw `INSERT ... ON CONFLICT DO UPDATE`) that runs through the exact same `prisma migrate deploy` pipeline as schema changes, reviewed and deployed the same way. | Via the seed scripts in `37-seed-data-strategy.md`, run manually/via CI job, never via `migrate deploy`. |
| Idempotency mechanism | `INSERT ... ON CONFLICT (key) DO UPDATE SET ...` (or `DO NOTHING` for immutable rows like historical `Price` versions) keyed on the same natural keys used by seed scripts (`Role.name`, `Product.key`, etc.) — this is not a coincidence: reference data migrations and seed scripts intentionally use the same natural-key upsert convention so the two can never disagree about what a given key's canonical row looks like. | `upsert` inside the seed script, per `37-seed-data-strategy.md` §2. |
| Owner / who authors it | Engineering, as part of the feature PR that needs the new reference row (e.g. adding a `COMPLIANCE_ADMIN`-scoped permission ships its `Permission`/`RolePermission` rows in the same migration set as the code that checks it) | Engineering/QA, maintained as part of the seed module, evolves independently of any single feature |
| Rollback | Rollback re-runs the previous migration's `INSERT` state or, for a genuinely removed reference row, a compensating migration that deletes/deactivates it (reference rows are typically deactivated — `isActive = false` — rather than deleted, consistent with the platform's no-hard-delete stance where the row has any historical dependency, e.g. a `Product` once purchased) | Rerun the seed script; no production rollback path needed since it never ran in production |

**Rule of thumb engineers/agents can apply without re-reading this table every time:** *if the application would misbehave in production without this row existing, it's a reference-data migration; if the row's entire purpose is to let a human or test pretend to be a specific kind of user/data for testing, it's seed data and stays out of production, full stop.*

## 5. Order of Operations for a New Environment

1. Provision the Postgres database (managed provider).
2. `prisma migrate deploy` — applies every schema migration **and every reference-data migration** in timestamp order (they are ordinary migrations from the tool's perspective — see §4).
3. **Production stops here.** The environment is now fully functional (roles/permissions/products/templates/flags exist) with zero real users, zero fake data.
4. **Non-production only:** run `npm run seed` (gated per `37-seed-data-strategy.md` §7) to additionally populate the demo catalog, demo accounts, and illustrative assessment rules.

## 6. Summary of Decisions in This Document

| # | Decision | Rationale (short) |
|---|---|---|
| D1 | Migration deploy is a distinct, gated pipeline step before new app code receives traffic — never a side effect of app boot in production | Prevents mid-rollout schema/code mismatch |
| D2 | Expand/contract mandatory for any breaking change to a table already holding production data | Zero-downtime, safe in-flight-deploy behavior |
| D3 | Reference/config data (roles, products, templates, flags) shipped as reviewed data migrations through the same `migrate deploy` pipeline as schema changes, using `INSERT ... ON CONFLICT` upserts keyed on natural keys | Production needs this data to function; it must go through the same rigor as schema changes, not an ad hoc manual insert |
| D4 | Fake/demo seed data is mechanically a completely separate pipeline (`37-seed-data-strategy.md`) that never touches `migrate deploy` | Structural guarantee against fake data reaching production, independent of any single engineer remembering a rule |
| D5 | Reference rows are deactivated (`isActive = false`), not deleted, when retired | Consistent with platform-wide no-hard-delete-of-historically-referenced-rows stance |
