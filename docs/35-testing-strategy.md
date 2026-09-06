# 35 — Testing Strategy

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering
**Depends on:** `00-project-charter.md`, `02-personas-and-roles.md`, `06-system-architecture.md`, `08-backend-architecture.md`, `09-database-architecture.md`, `11-api-architecture.md`
**Read alongside:** `36-security-testing.md` (the security-specific test catalog this pyramid gates on), `15-document-vault-security.md` §10, `40-ci-cd.md` (how these suites run as pipeline gates), `53-acceptance-criteria.md` (the Given/When/Then contracts these tests must satisfy)
**Applies to:** Every unit, integration, and end-to-end test suite in the AdmitFlow codebase

---

## 1. Purpose and Scope

This document defines AdmitFlow's testing pyramid: what gets a unit test, what gets an integration test, what gets an end-to-end (E2E) test, how much coverage each layer needs, and why. It does not define *how* tests are wired into the deploy pipeline (branch gates, required checks, environments) — that is `40-ci-cd.md`'s job; this document only states which suites exist and must be gates. It does not define the security-specific attack scenarios in exhaustive detail — that is `36-security-testing.md`; this document positions security testing within the pyramid and states that the money/security paths get the pyramid's highest coverage bar.

**Non-negotiable framing, restated from the charter and `02-personas-and-roles.md` §7:** AdmitFlow handles identity documents, financial records, and payment flows for a population with limited recourse if the platform fails them (first-in-family applicants, no informal expert network, real financial and immigration stakes). Test coverage is not a vanity metric here — a missed state-machine edge case can mean a double charge, a leaked passport, or a wrongly-locked application. This document treats the money paths, the security invariants, and the state machines as production-grade software from day one, not "we'll add tests later."

## 2. Coverage Philosophy: Risk-Weighted, Not Uniform

**Decision:** AdmitFlow does not target a single flat line-coverage percentage across the codebase. Coverage requirements are tiered by blast radius:

| Tier | Examples | Minimum line coverage | Minimum branch coverage | Rationale |
|---|---|---|---|---|
| **Tier 0 — Money & security-critical** | Entitlement/permission checks, payment amount/currency re-derivation, webhook signature verification and idempotency, document vault authorization, application submission snapshotting, booking concurrency, RBAC object-level checks | **100% branch coverage on the decision logic itself** (every `if`/guard clause exercised both ways); every state-machine transition table-tested exhaustively (§4.4) | 100% | A single unguarded branch here is a data breach or a financial-integrity bug, not a cosmetic defect. |
| **Tier 1 — Core business logic** | Assessment/matching scoring engine, questionnaire response validation, document requirements engine, notification triggering logic, pricing/quote calculation | ≥ 90% | ≥ 85% | Wrong output here erodes trust (a wrong Reach/Target/Safe classification) but is not itself a security breach; still core to the product's value proposition. |
| **Tier 2 — Supporting application logic** | API route input validation/schemas, repository query builders, formatting/serialization helpers, non-critical notification content assembly | ≥ 75% | — | Bugs are recoverable and low-blast-radius; still worth catching before production. |
| **Tier 3 — UI presentational code** | Layout components, styling, purely visual state (accordions, tooltips, animations), copy rendering with no business logic | No enforced numeric target; covered opportunistically via component tests and E2E flows that happen to exercise them | — | Presentational regressions are caught by E2E/visual review, not worth the maintenance cost of exhaustive unit coverage. |

**Decision:** coverage tooling (Istanbul/`c8` for unit+integration, per-package thresholds in CI) fails the build when a Tier 0 or Tier 1 package drops below its floor — not just reports a number. Tier 2/3 coverage is visible in CI output but is advisory, not a hard gate, so contributors are not incentivized to write low-value tests purely to hit a number on presentational code.

**Decision:** a bug found in production in a Tier 0 or Tier 1 path always ships with a regression test in the same PR that fixes it, added to the layer (unit/integration/E2E) closest to where the bug actually lived — never bolted on only at the E2E layer "because it's easier," since a slow, broad E2E test is a poor substitute for a fast, precise unit test pinpointing the actual faulty branch.

## 3. The Testing Pyramid

```
                    ▲
                   ╱ ╲        E2E (browser-driven)
                  ╱   ╲       Few, slow, expensive — full journeys + key branches
                 ╱─────╲
                ╱       ╲     Integration
               ╱         ╲    DB layer, auth flows, API handlers w/ mocked
              ╱           ╲   external providers, webhook fixtures, upload
             ╱─────────────╲  workflow
            ╱               ╲
           ╱                 ╲ Unit
          ╱                   ╲Many, fast, cheap — scoring rules, state
         ╱                     ╲machines, permission checks, price validation
        ╱───────────────────────╲
```

Ratio target (guideline, not a hard gate): roughly 70% unit / 20% integration / 10% E2E by test count, reflecting that unit tests are two to three orders of magnitude cheaper to run and to diagnose a failure in than a browser-driven E2E test. A failing E2E test tells you *that* something broke; a failing unit test tells you *what* and *where*.

## 4. Unit Tests

Unit tests run with no network, no real database, no real filesystem, no real S3/Stripe/PayPal — pure functions and in-memory fakes only. Target runtime for the full unit suite: under 60 seconds, so it runs on every save in local dev and on every commit in CI with no meaningful friction.

### 4.1 Matching / Assessment Engine Scoring Rules

The scoring engine (`services/assessment/logic`) is Tier 0/1 boundary — it is not itself a security control, but a wrong Reach/Target/Safe classification is a core product-integrity failure and, combined with the paywall, adjacent to a security concern (a scoring bug could accidentally reclassify a paid TARGET match as a free REACH match, which is a revenue-leak variant of the same "wrong things being exposed" family).

Required unit test coverage, one test group per `AssessmentRule` type (per `09-database-architecture.md` §4, rule types are versioned/configurable, so tests must be structured to run against a rule *definition* fixture, not hardcoded expectations that silently rot when a rule version changes):

- Each rule type (e.g., GPA-threshold rule, test-score-band rule, budget-fit-curve rule, country-eligibility rule) has table-tested inputs spanning: below-threshold, at-threshold (boundary), above-threshold, missing/null input field, and malformed input (wrong type after upstream validation should have caught it — defense in depth).
- Zone classification (Reach/Target/Safe) boundaries are table-tested at the exact cutoff score on both sides — off-by-one boundary bugs are the single most common scoring engine defect class.
- Weighted aggregation across multiple factors is tested with at least one case per factor being the deciding/tie-breaking one, plus an all-factors-tied case with a defined, tested tie-break rule.
- **Reproducibility contract:** given a fixed `AssessmentSnapshot` (profile + questionnaire answers + rule version, all frozen), re-running the scoring function against that exact snapshot always produces bit-identical output — tested by snapshot-replay fixtures, not just "run once and eyeball it." This directly protects the charter's reproducibility non-negotiable (`00-project-charter.md` §7, `09-database-architecture.md` §4).
- Rule-version migration: a new `AssessmentRule` version does not retroactively change the *stored* result of a prior `AssessmentResult`/`AssessmentSnapshot` — tested by asserting the scoring function is never called against a snapshot's frozen inputs using "current" rule config instead of the rule version referenced by that snapshot.
- Malformed/incomplete profile input (a required field the questionnaire should have enforced but didn't, due to a versioning bug) fails closed — the engine never silently defaults a missing critical input (e.g., budget) to a value that could artificially inflate a Target/Safe count, since that count feeds the paywall teaser copy (`01-product-requirements.md` §6).

### 4.2 Entitlement / Permission Checks

Tier 0. Every permission-check function (`hasPermission(actor, permission, resource)` and every object-level ownership check, per `02-personas-and-roles.md` §7 and `11-api-architecture.md` §10) is unit tested in isolation from the HTTP layer:

- For every defined permission (`document:verify`, `entitlement:grant`, `application:review`, `scoring_rules:publish`, `audit_log:read`, and the full matrix in `02-personas-and-roles.md` §8), a table test asserts each role's expected boolean outcome — including that a role *not* explicitly granted a permission is denied by default (fail-closed, never an implicit allow).
- Object-level ownership checks are tested with: owner accessing own resource (allow), non-owner student accessing another student's resource (deny), ADMIN accessing without an active support/verification scope reason recorded (this must still be an explicit, testable code path — "ADMIN can always read" is exactly the anti-pattern `02-personas-and-roles.md` §1 forbids), CONSULTANT accessing a booking-scoped resource within the access window (allow), CONSULTANT accessing the same resource after the booking-scoped window has expired (deny — the window's expiry itself is exercised by both a "one second before expiry" and "one second after" table case).
- Entitlement resolution (`Entitlement`/`Subscription` lookup for a given student + Product/Price scope) is table-tested against: no entitlement row, an active never-expiring entitlement, an active entitlement with a future expiry, an expired entitlement, a revoked entitlement (admin-revoked post-refund), and a soon-to-expire entitlement (boundary at the exact expiry timestamp) — each asserted against the exact boolean/field-shape the caller receives, since this function's return value is what §4.3-style field-omission logic downstream keys off of.
- **Field-omission unit test (the platform's single most important unit test class):** given a mock assessment result payload containing both REACH (unlocked) and TARGET/SAFE (locked) records, and a non-entitled actor, the response-shaping function under test is asserted to produce an output object that does not contain the locked records' `universityId`, `universityName`, `programId`, `programName`, `feeAmount`, or any other identifying field as a *key* in the resulting object at all (not `null`, not an empty string, not present-but-falsy — genuinely absent, verified with something like `expect(Object.keys(result)).not.toContain(...)` / a deep-key-enumeration assertion, not a shallow equality check that could pass with a null-valued field). See `36-security-testing.md` for the corresponding integration/HTTP-level version of this same test — the unit test proves the shaping function's logic is right in isolation; the integration test proves nothing upstream re-adds the field before it reaches the wire.

### 4.3 Price / Amount Validation

Tier 0. The server-side price re-derivation function (which looks up the authoritative `Price` record and computes the expected chargeable amount, per `36-security-testing.md`'s payment-manipulation scenario) is unit tested against:

- Client-supplied amount matches the server-derived amount exactly (allow).
- Client-supplied amount is lower than server-derived (deny, regardless of how small the discrepancy — 1 cent is still a tampering signal, not a rounding tolerance to be silently accepted).
- Client-supplied amount is higher than server-derived (deny — an inflated client amount is still rejected, not "accepted because the platform benefits," since it indicates the client is not to be trusted for *any* amount field, and could itself signal a confused/compromised client).
- Currency mismatch between client-supplied and the `Price` record's currency (deny).
- A `Price` record that has been superseded/deactivated between quote-time and checkout-completion-time (deny with a specific "price changed, please re-quote" outcome, never silently charging the stale price — ties to `01-product-requirements.md`'s currency/locale mismatch table entry).
- Zero-amount and negative-amount inputs (deny outright as malformed, never reach the payment provider call).
- Rounding/floating-point edge cases: amounts are validated as integer minor units (cents), never floating-point currency math — a test asserts the validation function rejects any non-integer minor-unit value rather than coercing/rounding it.

### 4.4 State-Transition Logic: Table-Tested Legal vs. Illegal Transitions

**Decision:** every state machine in the system is tested with an exhaustive from-state × event matrix, asserting both the legal transitions (documented, expected result state + side effects) and — just as importantly — that every *undocumented* from-state/event combination is rejected (throws/returns a `CONFLICT`-class error), never silently ignored and never silently succeeding into an unintended state. Rationale: state machine bugs are disproportionately caused by transitions nobody thought to forbid explicitly; testing only the "happy" transitions leaves the illegal ones as untested surface area exactly where a race condition or a missed guard clause would land.

**4.4.1 Document state machine** (authoritative definition: `15-document-vault-security.md` §3)

- Full transition table from §3.2 is encoded as unit test fixtures: 11 states × the actual triggering events, asserting the documented `From → To` pairs succeed with the documented side effects (audit log entry emitted with correct action code, notification enqueued where specified).
- Illegal-transition assertions required at minimum: `UPLOADED → VERIFIED` directly (must fail — cannot skip `PROCESSING`/`PENDING_REVIEW`); `REJECTED → VERIFIED` without going through a new version's own `PENDING_REVIEW → VERIFIED` path; a STUDENT actor attempting `PENDING_REVIEW → VERIFIED` (must fail — reviewer-only transition, see §8.1); a reviewer attempting `PENDING_REVIEW → REJECTED` with no reason code (must fail server-side, per §8.1's "enforced at the API layer" rule, not just a UI validation); any transition attempted from `DELETED` (terminal — nothing transitions out of it).

**4.4.2 Application state machine**

**Decision:** for v1, the `Application.status` state machine is: `DRAFT → SUBMITTED → DECISION_PENDING → { OFFER_RECEIVED | REJECTED_BY_UNIVERSITY | WAITLISTED }`, with `DRAFT → WITHDRAWN` as the only withdrawal path (student-initiated, pre-submission only, per `02-personas-and-roles.md` §2's "withdrawing (pre-submission only)"), and `WAITLISTED → { OFFER_RECEIVED | REJECTED_BY_UNIVERSITY }` as the only transition out of `WAITLISTED`. Rationale: this is the minimal state set that satisfies the product requirement that withdrawal is pre-submission-only, while leaving room for the future `APPLICATION_REVIEWER` role's review sub-status (`02-personas-and-roles.md` §6) to be inserted between `SUBMITTED` and `DECISION_PENDING` later as an additive change, not a rename.

Table-tested transitions required:
- `DRAFT → SUBMITTED` succeeds only when the readiness-gating checks pass (see `53-acceptance-criteria.md` §Application Submission Readiness) and is atomic with snapshot creation per `09-database-architecture.md` §7's transaction table — a unit test at this layer verifies the *guard clause* logic (which required documents/fields must be present) in isolation from the actual DB transaction, which is covered at the integration layer.
- `SUBMITTED → WITHDRAWN` is illegal and must be rejected (post-submission withdrawal is out of scope for self-service per the persona doc — it would require a support-initiated cancellation flow, a distinct, permission-gated action, not a state the student can trigger directly).
- `DRAFT → DECISION_PENDING` (skipping `SUBMITTED`) is illegal.
- `OFFER_RECEIVED`, `REJECTED_BY_UNIVERSITY`, and `WITHDRAWN` are terminal — no event transitions out of them; attempts are rejected, not ignored.
- A second `DRAFT → SUBMITTED` attempt on an already-`SUBMITTED` application (double submission) is illegal at the state-machine layer independent of the idempotency-key mechanism tested at the integration layer (§5) — defense in depth, two independent controls for the same invariant.

**4.4.3 Booking state machine**

**Decision:** `Booking.status` is `PENDING_PAYMENT → CONFIRMED → { COMPLETED | CANCELLED | NO_SHOW }`, with `CONFIRMED → RESCHEDULED` treated as a cancellation of the original booking plus creation of a new `PENDING_PAYMENT`/`CONFIRMED` booking against a different slot (never an in-place slot mutation on the same row), so the slot-capacity/uniqueness constraint (`09-database-architecture.md` §7.3, §9.3) always reasons about one slot per booking row. Rationale: reusing one row across two different slots would complicate the DB-level uniqueness constraint that is the actual double-booking backstop (§4.4.3 integration/§5 below); modeling reschedule as cancel+recreate keeps that constraint simple and correct.

Table-tested transitions required:
- `PENDING_PAYMENT → CONFIRMED` only on authoritative, webhook-confirmed payment (never on a client-reported "payment succeeded" signal — see §5's webhook integration tests and `36-security-testing.md`'s payment-manipulation catalog).
- `PENDING_PAYMENT → CANCELLED` on payment failure or on the payment-hold timeout expiring (a `PENDING_PAYMENT` booking that never confirms must not hold a slot indefinitely — tested with an explicit timeout boundary case).
- `CONFIRMED → COMPLETED` only after the scheduled session's end time has passed (system-triggered, not student/consultant-triggered early).
- `CONFIRMED → CANCELLED` within a defined cancellation window (policy-driven; tested at both "inside window, allowed" and "outside window, denied or requires an admin override" boundary cases).
- `COMPLETED`, `CANCELLED`, `NO_SHOW` are terminal.
- Concurrency-adjacent unit test: given two in-memory "requests" that both pass the pre-lock read of remaining slot capacity before either write commits, the *decision logic* (not the DB lock itself, which is an integration-level concern per §5) correctly computes that only one should proceed when replayed against a capacity of 1 — this is a logic-correctness unit test, distinct from and not a substitute for the DB-constraint integration/security test in `36-security-testing.md`.

**4.4.4 Entitlement / Subscription state machine**

**Decision:** `Entitlement.status` is `ACTIVE → { EXPIRED | REVOKED }` (no transition out of either terminal state, and `EXPIRED`/`REVOKED` are mutually exclusive — an entitlement is never both). `Subscription.status` (future-facing, per `00-project-charter.md`'s subscription roadmap) is modeled as `ACTIVE → { PAST_DUE → { ACTIVE | CANCELED } | CANCELED }`, mirroring the common provider-webhook-driven subscription lifecycle so Stripe/PayPal subscription webhooks map onto it without translation logic.

Table-tested transitions required:
- `ACTIVE → EXPIRED` only via the scheduled expiry job reaching the entitlement's `expiresAt` (system-triggered), never via any student- or consultant-facing endpoint.
- `ACTIVE → REVOKED` only via an ADMIN/SUPER_ADMIN action carrying a mandatory reason (see `53-acceptance-criteria.md` §Admin Override Auditing) — a unit test asserts the revoke function rejects a call missing a reason string before it ever touches the DB.
- A revoked or expired entitlement can never be "reactivated" by re-running the same grant path that created it originally without an explicit, separately-audited re-grant action — tested by asserting the grant function distinguishes "create new entitlement" from "un-revoke existing entitlement" as different code paths with different audit action codes, so an accidental double-grant call is not silently interpreted as a reactivation.
- `Subscription: PAST_DUE → ACTIVE` only on a subsequent successful payment webhook for that subscription (never on a client "retry" button click alone — the button triggers a provider-hosted retry; the state transition still only happens on the resulting webhook).

## 5. Integration Tests

Integration tests exercise real collaborating components with real protocols, but replace only the genuinely external third parties (Stripe, PayPal, email/SMS providers, the malware-scan engine, any external university-data API) with recorded fixtures or local fakes. Everything AdmitFlow owns and controls — the real Postgres instance, the real Prisma schema, the real Redis instance, the real BullMQ queue/worker code — runs for real.

**Decision:** Integration tests run against a real, disposable PostgreSQL instance in CI (a dedicated test database created per test run against the exact same Prisma schema/migrations as production, not SQLite or an in-memory substitute), using one of two isolation patterns depending on the test's shape:
- **Transaction-rollback pattern** (default, preferred): each test opens a transaction, runs, and rolls back — fast, fully isolated, no cross-test pollution, but not usable for tests that must themselves assert cross-transaction behavior (e.g., testing that a `SERIALIZABLE`/row-lock actually blocks a second concurrent transaction).
- **Full commit + truncate-between-tests pattern**: used specifically for concurrency tests (booking double-lock, webhook double-delivery, application double-submit) where the test *is* about two genuinely concurrent transactions racing against the real lock/constraint — these tests commit for real and clean up via truncation between runs, and are allowed to be slower as a result.

Rationale for real Postgres over a lightweight substitute: AdmitFlow's correctness guarantees for money and concurrency (§7 of `09-database-architecture.md`) are explicitly DB-level (unique constraints, `SELECT ... FOR UPDATE`, `SERIALIZABLE` isolation) — a substitute database that doesn't enforce the same constraint/locking semantics would let these tests pass while the real production behavior differs, which is worse than not having the test at all.

### 5.1 Database Layer

- Every DB-level unique constraint named in `09-database-architecture.md` §7.3/§9.3 has a dedicated integration test that attempts to violate it directly (two concurrent inserts) and asserts the second write fails at the constraint, not merely "the application logic happened to prevent it in this run": `WebhookEvent(provider, providerEventId)`, `AvailabilitySlot`/`Booking` slot-uniqueness, and the application-submission idempotency key.
- Soft-delete filtering middleware is tested to confirm a soft-deleted row is excluded from every default query path and is still reachable via the explicit, permissioned "including deleted" path (`09-database-architecture.md` §6.3).
- Optimistic concurrency (`version` column, §6.4) is tested with a genuine stale-write race: read a row, mutate it out of band, then attempt to write using the stale `version` — asserted to fail rather than silently overwrite.
- Cascade policy is tested negatively: soft-deleting/anonymizing a `User` is asserted to leave `Payment`, `AuditLog`, `ApplicationProfileSnapshot`, `AssessmentResult`, and `WebhookEvent` rows fully intact and still resolvable via their FK (§6.3).

### 5.2 Authentication Flows End-to-End (Server-Side, No Browser)

Exercised against real session/Postgres/Redis, real argon2id hashing, but no browser — HTTP requests directly against route handlers or a local test server:

- Signup → email verification token issued → verification consumed → account transitions `EMAIL_UNVERIFIED → VERIFIED` (or the equivalent lifecycle states defined in `13-authentication-authorization.md`).
- Login with correct credentials issues a valid session; login with incorrect credentials returns `INVALID_CREDENTIALS` without revealing whether the email exists (no user enumeration via timing or message differences — tested by asserting response latency and body shape are indistinguishable between "wrong password" and "no such account").
- Session expiry/revocation: a session used after its expiry, or after an explicit logout/revoke-all-sessions action, is rejected on the very next request (`401 UNAUTHENTICATED`), never honored due to a stale in-memory or Redis cache entry.
- Password reset flow: reset token is single-use (a second attempt to consume the same token fails), time-limited, and consuming it invalidates all other active sessions for that account (a stolen-then-reset-fixed account doesn't leave the attacker's session alive).
- Argon2id parameters (memory/time cost) are asserted present and within the documented configuration (a regression test against accidentally weakening hash parameters in a future change) — see `13-authentication-authorization.md`.

### 5.3 API Route Handlers Against Real Services, Mocked External Providers

For every module in `11-api-architecture.md` §3, at least one integration test per route handler exercises the full request pipeline (`08-backend-architecture.md` §3: validation → auth → authorization/entitlement → business logic → data layer → response) against the real DB, asserting:
- The correct standard error code (`11-api-architecture.md` §5.1) for each failure class (`VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `ENTITLEMENT_REQUIRED`, `NOT_FOUND`, `CONFLICT`).
- The response envelope shape is always `{ success, data, meta }` or `{ success, error }` — never a bare array/object, and `meta.requestId` is present on every response including error responses.
- External provider calls (Stripe/PayPal checkout session creation, email/SMS send, malware-scan invocation, university-data API calls) are mocked at the provider-client boundary, not stubbed out at the service-function level, so the test still exercises AdmitFlow's own request-building/response-parsing code against the provider's real (recorded) response shape.

### 5.4 Document Upload / Verification Workflow

End-to-end through the real state machine (`15-document-vault-security.md` §3) with a fake S3 (a local S3-compatible test double, e.g. a MinIO container or an equivalent mock, never real AWS in CI) and a fake malware scanner returning scripted verdicts:

- Full happy path: upload-authorization → simulated S3 PUT → upload-confirmation → `documents.process` job runs against the real BullMQ/Redis test instance → magic-byte check passes → fake scanner returns `clean` → `PENDING_REVIEW` reached, with every intermediate audit log row asserted present with the correct action code.
- Fake scanner returns `infected` → object relocated to the quarantine-prefix double → `REJECTED` with reason `malware_detected` → audit log `document.malware_detected` present with no file content in its payload.
- Fake scanner returns `scan_error` → fail-closed behavior verified: document does not advance, is retried a bounded number of times, then `REJECTED` with `scan_unavailable` (§5 of `15-document-vault-security.md`) — this is a specifically named integration test because fail-closed-on-scanner-outage is exactly the kind of guarantee that only a real retry-loop integration test (not a unit test of one retry attempt) can validate.
- Re-upload-after-rejection creates a new `DocumentVersion`, the prior version transitions to `REPLACED`, and `currentVersion` on the `Document` row points at the new version — verified against real rows, not mocked repository calls.

### 5.5 Stripe / PayPal Webhook Handling

Uses **recorded fixture payloads** (captured or hand-built to match each provider's real documented shape, stored under version control, e.g. `test/fixtures/webhooks/stripe/payment_intent.succeeded.json`) rather than hand-typed minimal JSON, so a provider schema drift is more likely to be caught by a fixture refresh review than silently missed:

- Valid signature + new `providerEventId` → event persisted → `payments.reconcile` job enqueued → worker grants the entitlement/marks the booking confirmed/marks the application fee paid, atomically, per `09-database-architecture.md` §7's Payment→Entitlement transaction boundary.
- Invalid/tampered signature → rejected with `WEBHOOK_SIGNATURE_INVALID` (400) before any DB write, verified by asserting zero rows written to `WebhookEvent` for that request.
- **Duplicate delivery, same `providerEventId`, sent twice in immediate succession:** the second delivery returns `200` (providers must see success so they stop retrying) but performs zero business-logic side effects the second time — no second entitlement row, no second confirmation email enqueued, no double-decrement of any counter. Asserted by row-count diffing before/after the second delivery, not just "no error was thrown."
- **Duplicate delivery, out of order** (e.g., a `charge.refunded` event for a payment whose `payment_intent.succeeded` event has not yet been processed, simulating provider redelivery/retry ordering, which providers do not guarantee): the reconciliation logic is asserted to handle this without corrupting state — either by correctly sequencing based on record state rather than delivery order, or by deferring/retrying the out-of-order event until its prerequisite has landed, never by producing an inconsistent `Payment`/`Entitlement` pair.
- A webhook event referencing a `Price`/`Product` that no longer matches what the checkout session was created against (simulating a race between a pricing change and an in-flight checkout) is reconciled against the amount actually charged and recorded by the provider, never against a live re-lookup of current pricing.

## 6. End-to-End (E2E) Tests

Browser-driven (real rendered frontend, real backend, mocked external providers via a test-mode configuration — e.g., Stripe test mode / a sandboxed PayPal environment rather than fully mocked, since the E2E layer's specific value is validating the real integration surface a unit/integration mock can't). E2E is the smallest, slowest, most expensive layer by design (§3) — reserved for flows that only fail when multiple systems are wired together correctly, not for re-testing logic already covered at lower layers.

**Required E2E coverage:**

1. **Full happy-path journey (at least one complete run, gating every release):** Signup → email verification → onboarding/questionnaire completion → eligibility assessment run → REACH results visible, TARGET/SAFE shown only as locked teaser → document upload for a required category → document reaches `VERIFIED` (test environment auto-approves or a scripted reviewer step) → TARGET/SAFE unlock purchase (test-mode payment) → unlocked match details become visible → consultation slot browsed and booked (test-mode payment) → application submitted against an unlocked program → confirmation and notifications observed at each milestone.
2. **Document rejection → re-upload branch:** a document is deliberately rejected (reviewer action or a scripted "fails validation" fixture) → student sees the specific rejection reason → re-uploads → new version reaches `PENDING_REVIEW`/`VERIFIED` → prior version is visibly retained in history, not erased.
3. **Payment failure → retry branch:** a test-mode declined card (or PayPal failure simulation) on the unlock or application-fee flow surfaces a clear, non-alarming failure state → no entitlement is granted → student retries with a valid payment method → success this time → entitlement now present, with no double-charge artifact from the failed first attempt.
4. **Locked-content-never-leaks browser check (defense in depth over the API-level test in `36-security-testing.md`):** while TARGET/SAFE is locked, the E2E test inspects the actual network response body captured by the browser automation tool (not just the rendered DOM) for the current page and asserts no locked university/program identifying field is present anywhere in it — this exists because an E2E-level regression (e.g., a well-intentioned developer "helpfully" including extra fields for a future feature) is exactly the kind of change a pure unit test wouldn't catch if it slipped past code review.
5. **Concurrent booking attempt (two browser contexts):** two automated sessions attempt to book the same last-remaining slot within milliseconds of each other → exactly one succeeds, the other sees a clear "slot no longer available" outcome, not a duplicate confirmation.
6. **Unverified-email gating:** a freshly signed-up, unverified account attempting to reach onboarding-gated screens directly by URL is redirected/blocked with a clear "verify your email" state, never shown partial onboarding content.

**Decision:** E2E tests run against a dedicated, seeded staging-like environment (or an ephemeral per-PR preview environment where `40-ci-cd.md`'s pipeline supports it), never against production, and use test-mode credentials for every external provider — there is no code path where an E2E test run can create a real charge, send a real email to a real inbox outside a controlled test-mailbox catch-all, or write into the production database.

**Tooling note (implementation detail, not re-litigated here):** Playwright is the assumed E2E runner given its multi-browser-context support (needed for the concurrent-booking scenario above) and first-class network-interception API (needed for the response-body inspection in scenario 4); this is a recommendation for the implementation team, not a locked architectural decision requiring sign-off elsewhere.

## 7. Test Data Management

- **Factories, not fixtures-as-truth-source, for unit/integration tests:** every core entity (`User`, `Profile`, `University`, `Program`, `Document`, `Application`, `Booking`, `Payment`, `Entitlement`) has a factory function producing a minimal-valid instance with sensible overrides, so tests express only the fields they care about, and a schema change (a new required column) breaks factories in one place rather than dozens of hand-built object literals.
- **Recorded fixtures are versioned alongside the code that consumes them** (webhook payloads, malware-scan verdict shapes) and are reviewed like code — a fixture update in a PR is a signal reviewers should specifically check against the provider's current documented schema.
- **No production data in any test environment, ever**, including anonymized-looking exports — synthetic data only, generated by factories/seed scripts (see `51-seed-and-migration-plan.md` for seed data ownership).

## 8. CI Integration

This document defines the suites; `40-ci-cd.md` defines how they gate the pipeline (which suites run on every push vs. every PR vs. pre-deploy, required-check configuration, flake-quarantine policy, and how `36-security-testing.md`'s catalog is wired in as its own required gate rather than folded silently into "integration tests"). The binding rule stated here, for `40-ci-cd.md` to implement rather than redecide: **unit and integration suites are a required, blocking gate on every pull request; the full E2E suite is a required, blocking gate before any production deploy; the `36-security-testing.md` catalog is a required, blocking gate on every pull request that touches an authorization, payment, webhook, document, or booking code path**, with path-based CI triggering (not a blanket "run everything always" policy) used only to keep feedback latency low, never to skip a Tier 0 area's coverage.

## 9. Related Documents

- `36-security-testing.md` — the concrete security test catalog; this pyramid's security-specific gate
- `40-ci-cd.md` — pipeline wiring for the suites defined here
- `53-acceptance-criteria.md` — Given/When/Then criteria these tests must satisfy
- `15-document-vault-security.md` §10 — the vault-specific required test list this document incorporates by reference
- `09-database-architecture.md` §7 — the transactional/concurrency guarantees the integration layer verifies
- `11-api-architecture.md` §5, §10 — the response envelope and authorization contract every integration test asserts against
- `49-threat-model.md` — the risk model this testing strategy is built to cover
