# 37 — Seed Data Strategy

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering
**Applies to:** `prisma/seed.ts` (or equivalent), local/dev/staging environment bootstrap, CI test fixtures

---

## 1. Purpose

Defines what gets seeded, how, in which environments, and the idempotency/determinism guarantees seed scripts must provide. This document governs **seed data** (fake/reference data inserted by a script run outside the migration pipeline). The distinction between seed data and migration-carried reference data is normative and is re-stated in `51-seed-and-migration-plan.md` §4 — read that section if unsure which mechanism a given row belongs to.

## 2. Binding Rules

1. **Idempotent / safe to rerun.** Every seed script can be run any number of times against the same database without creating duplicates or erroring. This is achieved via `upsert` keyed on a stable natural key (never `create`-only, never relying on auto-increment gaps).
2. **Deterministic.** Given the same seed script version, the same rows (same IDs, same field values) are produced every time. IDs for seeded rows are **fixed, hardcoded UUIDs** (not `uuid()`-generated at seed time) so that cross-references between seed scripts (e.g. a `Booking` fixture referencing a specific seeded `Consultant`) are stable across reseeds and across environments. A documented UUID namespace convention (below) prevents collisions.
3. **Environment-gated.** Seed scripts that create demo/fake data **must never run automatically in production**. See §7.
4. **Clearly fake.** Any demo account or demo catalog data uses obviously fake, non-real-world-colliding values (see naming convention §6) so it can never be mistaken for real student/university data in logs, screenshots, or support tickets.
5. **Layered, not monolithic.** Seeding is split into independent, individually-runnable modules (`seedRolesAndPermissions`, `seedCatalog`, `seedAssessmentRules`, `seedProductsAndPrices`, `seedDemoAccounts`, `seedNotificationTemplates`, `seedFeatureFlags`) so that, e.g., staging can seed everything while a production reference-data bootstrap runs only `seedRolesAndPermissions` + `seedProductsAndPrices` (the config subset — see `51-seed-and-migration-plan.md`).

## 3. UUID Namespace Convention for Seed Data

**Decision:** seeded rows use UUIDv5 (name-based, deterministic) derived from a fixed namespace UUID (`AdmitFlow seed namespace: 6f2c9e10-0000-4000-8000-000000000000`) plus a human-readable slug, e.g. `uuidv5("role:student", SEED_NAMESPACE)`. Rationale: gives every engineer/agent a reproducible way to compute "what is the ID of the seeded STUDENT role" without a lookup table, while still being a real UUID (satisfying the platform-wide UUID PK rule in `09-database-architecture.md`), and guarantees the same seed script produces byte-identical IDs on every machine and every environment — required for idempotency (rule 1) and for fixtures that cross-reference each other by literal ID in test code.

## 4. Seed Modules and Content

### 4.1 Roles & Permissions
- Roles: `STUDENT`, `CONSULTANT`, `ADMIN`, `SUPER_ADMIN` (active in v1); `UNIVERSITY_MANAGER`, `APPLICATION_REVIEWER`, `FINANCE_MANAGER`, `SUPPORT_AGENT`, `CONTENT_MANAGER`, `DATA_MANAGER`, `COMPLIANCE_ADMIN` (seeded as `isSystem: true`, inactive/unused in v1, per `00-project-charter.md` §4 forward-compatibility requirement).
- Permissions: seeded as a flat list per module, e.g. `document:review`, `document:override_status`, `entitlement:override_grant`, `entitlement:revoke`, `application:submit_on_behalf`, `payment:refund`, `user:impersonate`, `user:role_change`, `catalog:manage`, `assessment_rule:manage`, `booking:manage_any`, `audit_log:read`, `feature_flag:manage`. (Full enumerated list lives alongside the RBAC matrix in `02-personas-and-roles.md`/security docs — this document seeds whatever that matrix defines; it is not the source of truth for the list itself.)
- `RolePermission` bundle assignments: `STUDENT` gets student-scoped permissions only (own-resource read/write, no `*:manage_any`); `ADMIN` gets the operational set (document review, entitlement override, refund, booking management, audit log read); `SUPER_ADMIN` gets `ADMIN`'s set plus `user:role_change`, `feature_flag:manage`, `assessment_rule:manage`, `catalog:manage`.
- Idempotency key: `Role.name`, `Permission.key`, composite `(roleId, permissionId)`.

### 4.2 University Catalog (realistic sample set)
A representative cross-section, enough to exercise every zone (REACH/TARGET/SAFE) and every requirement type, across **3 destination countries**: United Kingdom, Canada, Germany (chosen for variety: UK = high tuition/no free public option, Canada = mixed public tuition + strong scholarship culture, Germany = low/no tuition at public universities — this spread stress-tests the budget-fit and scholarship-priority factors in the assessment engine).

| Country | Universities seeded | Programs per university | Intakes | Notes |
|---|---|---|---|---|
| United Kingdom | 3 (one "reach"-tier research-intensive, one mid-tier, one accessible post-92) | 2–3 each (e.g. MSc Data Science, MSc International Business, BSc Computer Science) | Fall 2026, Spring 2027 | Includes both `MIN_GPA` and `STANDARDIZED_TEST` (e.g. GRE-required) requirement rows on at least one program to exercise both `ProgramRequirement` types. |
| Canada | 3 (one large research university, one mid-size, one polytechnic/applied) | 2–3 each | Fall 2026, Winter 2027 | At least one program with a co-op/work-experience requirement (`requirementType = WORK_EXPERIENCE`); at least two `Scholarship` rows including one university-wide (`programId = null`). |
| Germany | 2 (one TU-style technical university, one public university with near-zero tuition) | 2 each | Winter 2026/27, Summer 2027 | Exercises `TuitionFee.amount ≈ 0` with a small semester contribution fee, distinct from UK/Canada's high tuition — stresses budget-fit scoring across a wide range. |

Each seeded `University` gets a `UniversityMetadata` row with `source: "AdmitFlow seed data — for development/testing only"`, `confidence: MEDIUM`, `verifiedAt: null` — deliberately never marked `HIGH`/verified, so seed catalog data can never be confused with ops-verified production catalog data if a seed ever leaked into a lower non-prod environment shared with content ops.

Each program gets: at least one `EnglishRequirement` row per accepted test type (IELTS + TOEFL minimum, Duolingo on at least one program), at least one `DocumentRequirement` set (passport + transcript mandatory; SOP/CV/recommendation letters per program level — undergraduate programs skip recommendation letters, graduate programs require them), and `TuitionFee` rows for both `INTERNATIONAL` and `DOMESTIC` categories.

Idempotency key: `University.name` (unique in seed context via a seed-only natural-key check — production catalog does not enforce a unique constraint on `name` alone since two real universities could share a name across countries, but seed data avoids collisions by construction), `Program.(universityId, name)`, `Intake.(programId, term)`.

### 4.3 Default Assessment Rules
Seeds one active `rulesVersion` (e.g. `"seed-rules-v1"`) with `AssessmentRule` rows covering the minimum factor set the matching engine needs to produce non-trivial REACH/TARGET/SAFE splits against the seeded catalog:

| Rule key | Type | Purpose (illustrative config) |
|---|---|---|
| `academic_gpa_fit` | WEIGHTED_FACTOR | Weight 0.30; compares `Education.gradeValue` (normalized) against `ProgramRequirement(MIN_GPA)`. |
| `english_proficiency_fit` | WEIGHTED_FACTOR | Weight 0.25; compares `LanguageTest.overallScore` against `EnglishRequirement.minOverallScore`. |
| `budget_fit` | WEIGHTED_FACTOR | Weight 0.20; compares `Profile.budgetMax` against `TuitionFee.amount`. |
| `academic_gap_penalty` | PENALTY | Deducts weighted points per `AcademicRecord.hasGap` without a documented reason. |
| `standardized_test_gate` | THRESHOLD | Hard-gates a program out of TARGET/SAFE (demotes toward REACH-only visibility) if a mandatory `ProgramRequirement(STANDARDIZED_TEST)` is unmet and no score is on file. |
| `scholarship_bonus` | BONUS | Small positive adjustment when a matching `Scholarship`'s `eligibilityCriteria` is satisfied, weighted by `Preference.scholarshipPriority`. |

**Decision:** seeded rule weights are illustrative defaults meant to produce a believable REACH/TARGET/SAFE spread against the seeded catalog for demoing/testing, not a tuned production scoring model — actual weight tuning is a product/data-science responsibility tracked separately and is expected to change via new `AssessmentRule` versions without touching this seed script's structure.

Idempotency key: `(key, version)`.

### 4.4 Default Products & Prices
| Product key | Type | Seeded price (illustrative, matches `00-project-charter.md` §5) |
|---|---|---|
| `TARGET_SAFE_UNLOCK` | ONE_TIME | €9.99 |
| `APPLICATION_FEE` | ONE_TIME | €15.00 |
| `CONSULTATION_40MIN` | ONE_TIME | €30.00 |

Each gets one `Price` row per supported currency at launch (minimum: EUR; USD/GBP as stretch — decision: seed EUR only for v1 non-prod, since multi-currency pricing tables are a real-money-market decision owned by finance/product, not something a seed script should fabricate). `stripePriceId`/`paypalPlanId` on seeded `Price` rows point at **sandbox/test-mode** provider IDs only, read from environment variables (`SEED_STRIPE_TEST_PRICE_TARGET_UNLOCK`, etc.) rather than being hardcoded — so the same seed script works against whichever sandbox account a given non-prod environment is wired to, and can never accidentally reference a live Stripe price ID.

Idempotency key: `Product.key`, composite `(productId, currency, effectiveFrom)` for `Price`.

### 4.5 Demo / Test Accounts
Full account list and per-account purpose lives in `50-test-accounts.md` (this document seeds them; that document explains what each is for). Summary: one account per RBAC role plus a set of student accounts pinned at each journey stage (fresh signup, onboarded-no-assessment, assessed-no-payment, paid-target-unlocked, has-submitted-application, has-booking), all using the `@admitflow-seed.test` email domain and the `SeedTest123!` placeholder password pattern described there. Passwords are still argon2id-hashed exactly as in production — seeding never bypasses the real hashing path, so login/auth code is exercised identically to a real signup.

Idempotency key: `User.email`.

### 4.6 Default Notification Templates
One `NotificationTemplate` row per event key needed by v1 flows, minimum set: `EMAIL_VERIFICATION`, `PASSWORD_RESET`, `ONBOARDING_INCOMPLETE_REMINDER`, `ASSESSMENT_READY`, `DOCUMENT_VERIFIED`, `DOCUMENT_REJECTED`, `DOCUMENT_EXPIRED`, `PAYMENT_SUCCEEDED`, `PAYMENT_FAILED`, `ENTITLEMENT_GRANTED`, `APPLICATION_SUBMITTED`, `APPLICATION_STATUS_CHANGED`, `BOOKING_CONFIRMED`, `BOOKING_REMINDER_24H`, `BOOKING_CANCELED`, `ADMIN_OVERRIDE_NOTICE` (sent to the affected student whenever an admin override touches their data, per the audit/transparency principle). Each seeded with `channel: EMAIL`, `isActive: true`, placeholder copy marked `[SEED PLACEHOLDER COPY — replace before production content freeze]` in non-prod-only seed runs.

**Note:** in production, the *keys* for these templates are reference/config data (see §4.7 distinction) that must exist, but the actual production copy is authored by content/product, not generated by this seed script — see `51-seed-and-migration-plan.md` §4 for how the two are kept separate (a config migration inserts the required keys with placeholder/production-approved copy; this seed script only overwrites copy in non-prod).

Idempotency key: `NotificationTemplate.key` + `version` (upsert on `key` where `isActive = true`).

### 4.7 Default Feature Flags
| Flag key | Default | Notes |
|---|---|---|
| `DEMO_MODE` | `false`, and hardcoded `false` in the production seed/config path with no code path that sets it `true` via seed data | See `50-test-accounts.md` §Demo Mode for the full guarantee. |
| `CONSULTATION_BOOKING_ENABLED` | `true` in seed/dev, environment-controlled elsewhere | |
| `SUBSCRIPTIONS_ENABLED` | `false` (v1 out-of-scope per Charter §8) | Present so the `Subscription`/`Entitlement` code paths can be developed and tested behind the flag before launch. |
| `NEW_QUESTIONNAIRE_VERSION_PREVIEW` | `false` | Example of the flag pattern used for gradually rolling out a new `QuestionnaireVersion` before flipping it to the default. |

Idempotency key: `FeatureFlag.key`.

## 5. Seed Script Structure and Execution Order

Seed modules run in dependency order (a later module may reference an earlier module's fixed UUIDs):

1. `seedRolesAndPermissions`
2. `seedGeography` (Country, City)
3. `seedCatalog` (University → Campus → Program → Intake → ProgramRequirement/EnglishRequirement/TuitionFee/Scholarship/DocumentRequirement/UniversityMetadata)
4. `seedAssessmentRules`
5. `seedProductsAndPrices`
6. `seedNotificationTemplates`
7. `seedFeatureFlags`
8. `seedDemoAccounts` (depends on 1–5: roles, catalog, rules, products all need to exist before a "paid-target-unlocked" or "assessed" demo student can be constructed in a realistic, referentially-valid state)

Each module is its own function, independently invokable (e.g. `npm run seed -- --only=catalog`) for fast iteration, and the top-level `seed` command runs all modules in the order above inside a single Prisma transaction per module (not one transaction for the entire run, so a failure in module 8 doesn't force re-running 1–7).

## 6. Naming Conventions for Fake Data

- Demo user emails: `student.freshsignup@admitflow-seed.test`, `admin.primary@admitflow-seed.test`, etc. — always the reserved `.test` TLD (RFC 2606) so they can never resolve as real mail and can never collide with a real user's address.
- Demo names: drawn from an obviously-placeholder set (e.g. "Test Student One", "Demo Consultant Priya") — never real-sounding names lifted from real people, and never using the platform owner/operator's own name or email as a demo identity.
- Seeded universities use their real, correctly-researched names and data (this is reference/sample **real-world catalog data** for realism, not fictional universities) but are flagged via `UniversityMetadata.source`/`confidence` as unverified seed data (§4.2), and the seed script itself is documented as never appropriate to point at a production database without a full content-ops verification pass.

## 7. Environment Gating (binding)

**Rule:** the full seed command (`seedDemoAccounts` in particular, and any module producing non-reference "fake" data) refuses to run unless `NODE_ENV !== 'production'` **and** an explicit `ALLOW_SEED=true` environment variable is set — a double gate, not a single flag, so that a mis-set `NODE_ENV` alone cannot trigger demo-data creation in what is actually a production database. The reference-data-only subset (`seedRolesAndPermissions`, `seedProductsAndPrices` restricted to the `--reference-only` flag, `seedFeatureFlags` restricted to inserting missing keys without overwriting existing values) is the only part of this script ever invoked against production, and only via the migration-adjacent process defined in `51-seed-and-migration-plan.md` §4 — never via the general `npm run seed` entry point an engineer might run out of habit.

## 8. CI / Automated Testing Use

CI test suites run the full seed script (including demo accounts and full catalog) against an ephemeral test database created fresh per test run, so integration tests exercise the same fixture data as local development — no separate, drifting "test-only" fixture format. Because seeding is idempotent and deterministic (§2), the same seed run can be asserted against by ID in test code without brittleness.

## 9. Summary of Decisions in This Document

| # | Decision | Rationale (short) |
|---|---|---|
| D1 | Fixed UUIDv5 IDs for all seed rows, derived from a documented namespace | Deterministic cross-references, safe reruns, no ID drift across environments |
| D2 | 3-country catalog sample (UK/Canada/Germany) with deliberately varied tuition/scholarship/requirement profiles | Exercises full REACH/TARGET/SAFE and requirement-type range |
| D3 | Seeded catalog data marked `confidence: MEDIUM`, never `verifiedAt` set | Prevents confusion with ops-verified production catalog data |
| D4 | Seeded `Price` rows reference sandbox/test-mode provider IDs via env vars only | Never risk referencing a live Stripe/PayPal price |
| D5 | Double environment gate (`NODE_ENV` + `ALLOW_SEED`) before any demo-data seed can run | Single-flag misconfiguration must not be enough to seed fake data into production |
| D6 | Reference-data subset (roles, products, feature-flag keys) is the only seed content ever run near production, via the migration-adjacent process, never the general seed command | Keeps "safe for prod" and "fake demo data" mechanically separated |
