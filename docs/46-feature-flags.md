# 46 — Feature Flag Architecture

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering
**Applies to:** Gradual rollout of any risky or incomplete feature; explicitly not a substitute for the entitlement system

---

## 1. Purpose and Scope

This document defines how AdmitFlow ships risky or partially-built functionality safely: AI assessment, a new matching-engine version, new pricing, the consultation module itself, a new onboarding flow, a new dashboard, and a new application workflow are the concrete examples driving this design, but the mechanism is generic and applies to any future rollout.

It does **not** cover entitlements/paywall gating (`19-payment-architecture.md`) or the general caching strategy (`33-caching-strategy.md`, referenced in §7) beyond what's needed to explain flag-evaluation caching. The single most important thing this document establishes is the boundary in §2 — read that section first.

## 2. The Boundary: Flags Are Not Entitlements (binding rule)

> **A feature flag controls whether a feature exists yet at all, for a given rollout cohort. An `Entitlement` (`19-payment-architecture.md` §5) controls whether a specific paying user may use a feature that already exists.**

These are orthogonal and both are checked, independently, wherever both apply:

| Question | Answered by |
|---|---|
| "Has the new matching-engine v2 been rolled out to this user's cohort yet?" | Feature flag (`matching_engine_v2`) |
| "Has this specific student paid to unlock their Target/Safe results?" | Entitlement (`TARGET_SAFE_RESULTS`) |
| "Is the consultation module turned on for this environment/cohort at all?" | Feature flag (`consultation_module`) |
| "Has this specific student paid for a specific consultation session?" | Entitlement (`CONSULTATION_SESSION`, scoped to a `Booking`) |

**Concrete example that ties both together:** while `consultation_module` is flagged off, no student — paying or not — sees any booking UI, and the booking API routes return `404`/feature-disabled regardless of entitlement state. Once `consultation_module` is flagged on for a cohort, the feature *exists* for those users, but an individual student still cannot book without completing a payment that grants a `CONSULTATION_SESSION` entitlement scoped to that specific booking. Neither system is ever used to accomplish the other's job: a flag is never used as a cheap substitute for "did they pay" (that would mean turning a feature on for everyone the instant it's flagged on, defeating rollout safety, and would bypass the audited payment/webhook path entirely), and an entitlement is never used to gate whether unfinished/risky code paths are reachable at all (that would mean every paying customer immediately hits a half-built feature the moment they've paid for something unrelated).

Any PR that uses a feature flag to answer an entitlement question, or vice versa, is a defect — the same severity as the client-side entitlement-computation defect described in `07-frontend-architecture.md` §9.

## 3. Data Model

| Entity | Purpose |
|---|---|
| `FeatureFlag` | The flag itself: `key` (stable string, e.g. `ai_assessment`), `description`, `enabled` (master on/off — a hard kill switch independent of rollout percentage/segments, §6), `rolloutPercentage` (0–100, nullable — null means "segment/allow-list only, no percentage rollout"), `rules` (JSONB — targeting rules; see below for why JSON is correct here), `createdAt`, `updatedAt`. |
| `FeatureFlagOverride` | Per-user or per-role explicit override, independent of percentage rollout: `flagId`, `targetType` (`USER`/`ROLE`), `targetId`, `value` (`true`/`false` — an override can force a flag *off* for someone even if their cohort would otherwise get it on, which matters for support/QA scenarios in §9). |
| `FeatureFlagAuditLog` | Every change to `enabled`, `rolloutPercentage`, `rules`, or an override: `flagId`, `actorId`, `before`, `after`, `changedAt`. Mandatory per `09-database-architecture.md` §7's "admin action → audit log" transaction rule — a flag change is an admin action with real product/risk consequences and must be traceable to who changed what, when. |

**Decision:** `FeatureFlag.rules` is JSONB, not a normalized targeting-rule table, matching the exact test already codified in `09-database-architecture.md` §4 ("Flags/settings are a generic key-value-with-structure system by nature — that is the entire point of the table"). Rules vary in shape per flag (a percentage rollout needs nothing but a number; a role-based rollout needs a role list; a cohort-based rollout for `new_onboarding_flow` might need a signup-date-range condition) — forcing one normalized shape across all of them would produce a wide, mostly-null table for no query benefit, since flag rules are read as a whole object at evaluation time (§4), never filtered by internal field at the database layer.

## 4. Evaluation

### 4.1 Evaluation Is Server-Side, Always

**Decision:** every flag is evaluated on the server, once per relevant request context, and exposed to the frontend only as an already-resolved value for that specific user — never as the raw flag configuration (percentage, rules, or the existence of unreleased variants) shipped to the client for it to branch on locally.

Concretely:
- A page/API route that needs to know "should this user see the new dashboard" calls a server-side `evaluateFlag(flagKey, context)` function (context = `{ userId, role, signupDate, ... }` as relevant) during SSR/route-handling, and the resulting boolean/variant is what gets embedded in the server-rendered props or the API response — e.g. `{ "newDashboard": true }`, not `{ "newDashboardRolloutPercentage": 25, "userBucket": 13 }`.
- For features with meaningfully different code paths (e.g. `new_onboarding_flow` vs. the legacy one), the server decides which flow to render/route to; the client never receives both variants' code and data and choose between them at runtime. This is the same "never ship all variants' code+data to the client" rule stated in the task brief, and it matters most for anything security- or entitlement-adjacent — a client that received the "premium dashboard" bundle and merely had a flag telling it not to render it would still have the bundle sitting in its network payload/dev tools.
- A small number of purely cosmetic, non-sensitive flags (e.g. a UI experiment with no data-sensitivity implications) **may** be exposed as a resolved boolean via a `/api/v1/flags/resolved` endpoint called once per session and cached client-side for the session's lifetime — but this is still a *resolved* value per user, computed server-side, never the raw configuration.

### 4.2 Percentage Rollout: Deterministic Bucketing

**Decision:** percentage rollout uses deterministic hashing, not random sampling per request, so a given user consistently lands on the same side of the rollout across requests/sessions until the percentage itself changes:

```
bucket(userId, flagKey) = integer_hash(userId + ":" + flagKey) mod 100
included = bucket(userId, flagKey) < flag.rolloutPercentage
```

Salting the hash with `flagKey` (not just `userId`) ensures a user's bucket for one flag is independent of their bucket for another — a user in the first 10% for `matching_engine_v2` is not thereby predisposed to also be in the first 10% for `new_pricing_v2`. Rationale for determinism over random-per-request: random sampling would make the experience flicker (a user sees the new dashboard on one page load and the old one on the next), which is both a poor UX and makes rollout-stage bug reports impossible to reproduce reliably.

### 4.3 Evaluation Order

1. **Master kill switch first:** if `FeatureFlag.enabled = false`, the flag resolves `false` for everyone, full stop — no rule/percentage/override evaluation happens at all (§6).
2. **Per-user override next:** if a `FeatureFlagOverride` exists for this `userId` (or a role the user holds), it wins outright, in either direction (forcing on for QA, or forcing off for a user having a bad experience with a rollout).
3. **Segment rules:** if `rules` defines a role/cohort condition, evaluate it.
4. **Percentage rollout:** deterministic bucketing (§4.2) against `rolloutPercentage`.
5. Default: `false` if none of the above resolve it to `true`.

## 5. Flag Lifecycle

| Stage | Meaning | Housekeeping rule |
|---|---|---|
| **Proposed** | Flag row created, `enabled = false`, `rolloutPercentage = 0` or unset — code behind the flag can merge to main safely (trunk-based development enabled by flags) without being live. | — |
| **Active rollout** | `enabled = true`, `rolloutPercentage` incrementing (e.g. 5% → 25% → 50% → 100%) and/or specific role/cohort rules active. | Each percentage change is an audited action (§3); a rollout stage is expected to bake for a deliberate observation period (monitored via `28-observability.md`-tracked error rates/metrics specific to the feature) before advancing. |
| **Fully rolled out** | `rolloutPercentage = 100`, no meaningful segment restriction left. | The flag is now purely a historical toggle — it should not stay load-bearing in the codebase indefinitely (see next row). |
| **Deprecated / removed** | The flag check is deleted from the codebase (old branch removed, new behavior becomes the only behavior) and the `FeatureFlag` row is marked inactive/archived (not hard-deleted, for audit-history continuity). | **Decision: a flag must be removed from the codebase within 90 days of reaching and holding 100% rollout with no incidents.** Rationale: a flag left in the code indefinitely after full rollout is dead weight — an extra branch every future engineer/agent has to reason about, and a stale flag is exactly the kind of thing that silently reintroduces a bug when someone flips it "just to check" years later. 90 days is enough buffer to be confident the rollout is stable without becoming a de facto permanent conditional. |

## 6. Flags for the Named Risky Features

| Flag key | Feature | Default state at introduction | Rollout mechanism |
|---|---|---|---|
| `ai_assessment` | AI-driven assessment generation (as opposed to, or alongside, the rules-based matching engine) | `enabled = true`, `rolloutPercentage = 0`, role rule allowing internal/staff accounts only | Percentage ramp once staff-only validation passes; kill switch is the primary safety net given AI-output-quality risk is harder to bound with tests alone than deterministic code. |
| `matching_engine_v2` | New scoring/matching engine version | `enabled = true`, `rolloutPercentage = 0` | Percentage ramp; because this affects the reproducible, versioned `AssessmentSnapshot` (`09-database-architecture.md` §4), the flag additionally gates *which engine version is invoked for new assessments only* — it never retroactively changes which engine version an already-generated snapshot claims to have used, since that would violate the reproducibility non-negotiable independent of this flag system entirely. |
| `new_pricing_v2` | New `Price` rows / pricing page | `enabled = true`, `rolloutPercentage = 0`, allow-list of test accounts first | Pricing changes are commercially sensitive and irreversible-feeling to end users (a student who saw a price shouldn't see a different one moments later) — rollout is by new-signup cohort (users who registered after a cutover date), never by re-bucketing existing users mid-session, to avoid exactly that "price changed under me" perception. |
| `consultation_module` | The entire booking feature (`22-consultation-booking.md`) | `enabled = false` until launch-ready, then `enabled = true, rolloutPercentage = 100` at launch (an all-or-nothing feature, not typically percentage-ramped, since a partial consultant/student pool would fragment slot availability) | Kill switch retained permanently post-launch for incident response (§6.1) even after reaching 100%, given it gates a real-money booking flow. |
| `new_onboarding_flow` | Replacement onboarding/questionnaire flow | `enabled = true`, `rolloutPercentage = 0` | Percentage ramp by new-signup cohort (existing users mid-onboarding are never switched to a different flow than the one they started, to avoid losing in-progress answers to a differently-shaped questionnaire — see `09-database-architecture.md` §4's questionnaire-versioning JSON rationale, which this flag composes with, not replaces). |
| `new_dashboard` | Redesigned student dashboard | `enabled = true`, `rolloutPercentage = 0` | Straightforward percentage ramp; low risk (presentation-layer, no data-shape implications), so this is the flag most likely to move through stages quickly. |
| `new_application_workflow` | New application submission workflow | `enabled = true`, `rolloutPercentage = 0`, role rule for staff first | Because this interacts with the `Application` state machine and submission idempotency (`09-database-architecture.md` §7), rollout is by *new application* (an application already `IN_PROGRESS` under the old workflow finishes under the old workflow) rather than by user, mirroring the `new_onboarding_flow` in-progress-continuity rule above. |

### 6.1 Kill Switch

`FeatureFlag.enabled = false` is the emergency-response lever: setting it takes effect on the **next evaluation** for any affected request (subject to the cache propagation bound in §7) without a deploy, and is the first response to a production incident traced to a flagged feature — flip the flag, then investigate, not the other way around. This is why `enabled` is evaluated first and independently of `rolloutPercentage`/`rules` (§4.3) — it must never be possible for a stale percentage or rule to keep serving a feature that's been switched off centrally.

## 7. Caching and Propagation

Flag evaluation is read-heavy and latency-sensitive (it sits in the hot path of nearly every page/API request), so flag configuration is cached rather than read from Postgres on every evaluation:

- **Decision:** flag configuration (`FeatureFlag` rows + `FeatureFlagOverride` rows) is cached in Redis (cache-aside, per `33-caching-strategy.md`'s general caching conventions) with a short TTL — **60 seconds** — and invalidated proactively on write (a flag/override change publishes an invalidation via Redis pub/sub to all Next.js instances, in addition to the TTL expiry acting as a backstop for any instance that missed the pub/sub message).
- **Decision: worst-case propagation delay for a flag change is bounded at 60 seconds.** This is an explicit, accepted trade-off — a true zero-latency global kill switch would require either no caching (unacceptable request-path cost at scale) or a more complex real-time push mechanism not justified by the actual incident-response cadence AdmitFlow operates at. 60 seconds is fast enough for effective incident response (a human decides to flip a kill switch on a timescale of minutes, not sub-second) while keeping flag evaluation cheap on every request.
- What is cached is the **flag configuration**, never a **resolved per-user result** — resolution (§4) still happens per-request against the cached configuration, because resolution depends on request-specific context (`userId`, role) that isn't safe to cache as a shared value across users.

## 8. QA and Support Overrides

`FeatureFlagOverride` (§3) is the mechanism for: internal staff needing to see an in-progress feature regardless of their rollout bucket, and support needing to force a flag off for one specific user experiencing a rollout-related issue without touching the global percentage. Overrides are themselves audited (§3's `FeatureFlagAuditLog`) and are expected to be temporary — a long-lived override accumulating unnoticed is the same category of risk as a stale flag (§5) and should be reviewed alongside flag cleanup.

## 9. Summary of Decisions in This Document

| # | Decision | Rationale (short) |
|---|---|---|
| F1 | Flags answer "does this feature exist yet, for this cohort"; entitlements answer "can this specific paying user use it" — never conflated, never substituted for each other | Rollout safety and monetization/access control are orthogonal concerns with different audiences and different audit requirements |
| F2 | `FeatureFlag.rules` is JSONB, not a normalized rule table | Matches `09-database-architecture.md`'s existing JSON-column test; rule shape genuinely varies per flag and is never filtered by internal field at the DB layer |
| F3 | Flags evaluated server-side only; frontend receives a resolved value per request, never raw configuration or multiple variants' code+data | Prevents leaking unreleased features/config via client inspection; avoids client-side branching on security/entitlement-sensitive logic |
| F4 | Percentage rollout uses deterministic hashing (`hash(userId + flagKey) mod 100`), not per-request random sampling | Consistent experience per user; reproducible bug reports during rollout |
| F5 | Evaluation order: kill switch → per-user override → segment rules → percentage | Kill switch must always win immediately, regardless of any other configuration |
| F6 | Flags must be removed from the codebase within 90 days of reaching stable 100% rollout | Prevents permanent dead-branch accumulation and stale-flag incidents |
| F7 | `new_onboarding_flow`, `new_application_workflow`, and similar structural flags roll out by new-signup/new-entity cohort, never mid-flight for an in-progress user/application | Avoids switching the shape of an in-progress flow out from under an existing user |
| F8 | Flag configuration cached in Redis with a 60-second TTL + pub/sub invalidation; resolved per-user results are never cached | Bounds kill-switch propagation delay predictably while keeping evaluation cheap on the hot request path |
