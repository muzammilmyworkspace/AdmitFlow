# 50 — Test Accounts

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering / QA
**Applies to:** Local development, CI, staging environments only

---

## 1. Purpose and Binding Rule

This document enumerates the demo/test accounts engineers, QA, and AI agents use to exercise every meaningful journey state without manually walking the full flow every time. **These accounts only ever exist in dev/staging, created exclusively by the seed scripts defined in `37-seed-data-strategy.md`, gated by the double environment check in that document's §7. They must never exist in production.** There is no manual account-creation path for these — if a listed account is missing in an environment, the fix is "run the seed script," never "create it by hand through the signup form and remember to mark it as a test account."

All accounts use the email domain `@admitflow-seed.test` (RFC 2606 reserved TLD, never deliverable, never collidable with a real address) and the shared placeholder password `SeedTest123!` unless stated otherwise, hashed with the same argon2id path production uses (seeding never takes an auth shortcut — see `37-seed-data-strategy.md` §4.5).

## 2. Demo Mode Flag (binding constraint)

A future "demo mode" (a public-facing sandbox experience using fake data, if ever built) must be gated by an explicit `DEMO_MODE` feature flag (see `10-database-schema.md` §12.2, `FeatureFlag`), with these properties:

- `DEMO_MODE` defaults to `false` and is seeded as `false` explicitly in every environment, including production (§4.7 of `37-seed-data-strategy.md`).
- There is no code path, migration, or configuration precedence rule under which `DEMO_MODE` can become `true` in production as a side effect of another setting, a missing environment variable, or a deploy-order race. It is checked directly against the production `SystemSetting`/`FeatureFlag` value with no client-supplied override capable of forcing it on (never a query param, header, or cookie toggle — those are exactly the kind of "accidentally activated in prod" vector this rule exists to close).
- Enabling `DEMO_MODE` in any environment is itself an audited admin action (`AuditLog` entry, `SUPER_ADMIN`-only permission), consistent with the platform-wide rule that state-changing admin actions are always logged.
- **This flag does not exist yet as of v1** (no demo-mode feature is currently planned/built) — this section documents the constraint pre-emptively so that if/when demo mode is proposed, it is built against this rule from day one rather than retrofitted after an incident.

## 3. Account Roster

### 3.1 Student accounts (by journey state)

| # | Email | Journey state | What it exercises |
|---|---|---|---|
| 1 | `student.fresh@admitflow-seed.test` | Signed up, email **not yet verified** | Email verification flow, resend-verification, blocked access to onboarding/profile routes pre-verification, expired-token handling. |
| 2 | `student.verified-no-onboarding@admitflow-seed.test` | Email verified, onboarding not started | Post-verification landing, onboarding entry state, "nudge" notifications (`ONBOARDING_INCOMPLETE_REMINDER`). |
| 3 | `student.onboarded-no-assessment@admitflow-seed.test` | Full `Profile`/`Education`/`LanguageTest`/`Preference` populated, onboarding complete, questionnaire **not yet started** | Profile completeness gating before assessment can run; questionnaire entry point; validates that assessment cannot be triggered with an incomplete profile. |
| 4 | `student.questionnaire-in-progress@admitflow-seed.test` | Onboarded, `QuestionnaireResponse.status = IN_PROGRESS` (partial answers saved) | Resume-in-progress questionnaire UX; partial-answer persistence; the partial-unique-index rule (§4.6 of `10-database-schema.md`) preventing a second concurrent in-progress response. |
| 5 | `student.assessed-no-payment@admitflow-seed.test` | Has a completed `Assessment` + `AssessmentResult` with REACH results visible, TARGET/SAFE locked | Freemium paywall boundary; REACH-only rendering with explainability; upsell/unlock CTA; verifies no TARGET/SAFE data leaks pre-entitlement at the API layer. |
| 6 | `student.paid-target-unlocked@admitflow-seed.test` | Has an active `Entitlement` (`TARGET_SAFE_UNLOCK`) scoped to their `AssessmentResult`, full REACH/TARGET/SAFE visible | Entitlement-gated content unlock; `Payment`/`Purchase`/`Entitlement` chain correctness; receipt/notification (`PAYMENT_SUCCEEDED`, `ENTITLEMENT_GRANTED`). |
| 7 | `student.documents-in-review@admitflow-seed.test` | Unlocked, has uploaded documents spread across `PENDING_REVIEW`, one `REJECTED` (with a reason), and one `REPLACED` (superseded by a re-upload) | Document vault state machine (§3 of `15-document-vault-security.md`, §5.1.1 of `10-database-schema.md`) across multiple states at once; `DocumentAuditLog` history rendering. |
| 8 | `student.has-submitted-application@admitflow-seed.test` | Unlocked, documents approved, one `Application` with `status = SUBMITTED` and a full `ApplicationSnapshot` (+ children) | Submission snapshot integrity; verifies the application view renders from the snapshot, not the live profile; `ApplicationStatusHistory`. |
| 9 | `student.has-booking@admitflow-seed.test` | Unlocked, has a `CONFIRMED` `Booking` against a seeded `Consultant`'s `AvailabilitySlot` | Booking confirmation flow, `BOOKING_CONFIRMED`/`BOOKING_REMINDER_24H` notifications, reschedule/cancel flows, calendar rendering. |
| 10 | `student.multi-application-mixed-status@admitflow-seed.test` | Unlocked, 3 applications in different states (`DRAFT`, `UNDER_UNIVERSITY_REVIEW`, `OFFER_RECEIVED`) | Dashboard/list views with mixed application states; status-history timeline rendering across different terminal/non-terminal states. |
| 11 | `student.expired-entitlement@admitflow-seed.test` | Had a `TARGET_SAFE_UNLOCK` entitlement that is now `expiresAt`-lapsed (not revoked, naturally expired) | Entitlement expiry re-gating logic; distinguishes "never purchased" (#5) from "purchased then expired" for correct upsell copy ("renew" vs. "unlock"). |
| 12 | `student.admin-overridden-document@admitflow-seed.test` | Has one document whose status was set via `sourceType = ADMIN_GRANT`-style manual override rather than the normal review flow | Verifies admin overrides are visibly distinguished in `DocumentAuditLog`/student-facing history and trigger `ADMIN_OVERRIDE_NOTICE`. |

### 3.2 Consultant accounts

| # | Email | State | What it exercises |
|---|---|---|---|
| 13 | `consultant.available@admitflow-seed.test` | `Consultant.isAcceptingBookings = true`, several `OPEN` `AvailabilitySlot` rows in the next 14 days | Consultant-facing calendar/availability management; booking creation against open slots. |
| 14 | `consultant.fully-booked@admitflow-seed.test` | All slots in the next 7 days `BOOKED` | Booking UI correctly shows no availability; tests the double-booking-prevention constraint isn't just "never tested because slots are always free." |
| 15 | `consultant.not-accepting@admitflow-seed.test` | `isAcceptingBookings = false` | Consultant directory/search correctly excludes non-accepting consultants. |

### 3.3 Admin / Super Admin accounts

| # | Email | Role | What it exercises |
|---|---|---|---|
| 16 | `admin.primary@admitflow-seed.test` | `ADMIN` | Document review queue, entitlement override (with mandatory reason + audit log), refund initiation, application status override, booking management-any. |
| 17 | `admin.limited@admitflow-seed.test` | `ADMIN` with a deliberately reduced `RolePermission` set (no `payment:refund`) | Negative-path RBAC testing — verifies permission checks are enforced server-side per-permission, not just per-role, and that removing one permission from a role actually blocks the corresponding action. |
| 18 | `superadmin.primary@admitflow-seed.test` | `SUPER_ADMIN` | Role/permission management, feature flag toggling (including the `DEMO_MODE` audited-toggle path, §2), assessment rule version management, full audit log read access. |

### 3.4 Cross-cutting / edge-case accounts

| # | Email | State | What it exercises |
|---|---|---|---|
| 19 | `student.suspended@admitflow-seed.test` | `User.status = SUSPENDED` | Login rejection for suspended accounts; verifies suspension doesn't hard-delete or lose data, only blocks access. |
| 20 | `student.oauth-google-linked@admitflow-seed.test` | Signed up via Google OAuth, no password set (`passwordHash = null`) | OAuth-only login path; `OAuthAccount` unique-constraint behavior; "add a password" account-settings flow for OAuth-only accounts. |
| 21 | `student.soft-deleted@admitflow-seed.test` | `deletedAt` set (account deletion requested and processed) | Verifies soft-deleted accounts cannot log in, are excluded from default queries, but linked `Payment`/`AuditLog` rows remain intact and queryable by admins (cascade-policy regression test — see `10-database-schema.md` §13). |

## 4. Usage Notes for Engineers and Agents

- When writing a new feature that touches student state, check this table first for an account already in the state you need before creating a new one-off fixture — extending this roster (with a corresponding seed module update) is preferred over ad hoc test data so the roster stays the single source of truth.
- E2E/integration tests reference these accounts **by their fixed seed UUIDs** (see `37-seed-data-strategy.md` §3), not by re-deriving them, so tests remain stable across reseeds.
- If a new journey state is added to the product (e.g. a visa-prep stage), this document and the corresponding `seedDemoAccounts` module are updated together in the same change — this file is not allowed to drift from what the seed script actually produces.

## 5. Summary of Decisions in This Document

| # | Decision | Rationale (short) |
|---|---|---|
| D1 | Fixed roster of 21 accounts spanning every major journey/permission edge case, keyed to `37-seed-data-strategy.md`'s seed script | Predictable, reusable fixtures instead of ad hoc per-feature test data |
| D2 | `DEMO_MODE` is specified as a flag with no client-controllable or precedence-based path to `true` in production, and its toggle is itself audited | Closes the "accidentally activated in prod" failure mode explicitly, even though the feature doesn't exist yet |
| D3 | Negative-permission admin account (#17) included deliberately | Ensures RBAC tests cover permission removal, not just role presence |
