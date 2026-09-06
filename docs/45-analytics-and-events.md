# 45 — Analytics and Events

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering / Product
**Depends on:** `06-system-architecture.md` (Next.js API + worker split)
**Read alongside:** `27-audit-logging.md` (the separate compliance audit trail — see §1 for how the two differ), `42-gdpr-and-data-privacy.md` §privacy-safe-analytics (authoritative privacy rule this document implements, not duplicated here)

---

## 1. Purpose and Scope, and How This Differs From Audit Logging

This document defines AdmitFlow's **product analytics** system — the event stream used to understand product usage, funnel drop-off, and feature adoption. It is a distinct system from `27-audit-logging.md`'s compliance audit trail:

| | Product Analytics | Audit Log |
|---|---|---|
| Purpose | Understand usage patterns, funnels, adoption | Compliance-grade record of sensitive actions |
| Audience | Product/growth/engineering | ADMIN/SUPER_ADMIN/COMPLIANCE_ADMIN, legal/compliance |
| Identifiability | Minimal — IDs/enums only, no free text (§3) | Full actor/resource/reason detail, including a required free-text reason for overrides |
| Retention | Shorter, product-decision-driven (§5) | Years (`27-audit-logging.md` §6) |
| Delivery | Asynchronous, via the worker (§4) | Synchronous, same transaction as the state change |

A single user action may produce entries in both systems (e.g. a document rejection is both an audit-logged admin override and, separately, may inform product analytics about verification funnel health) — the two are never the same table, the same event schema, or the same retention policy, because they answer different questions for different, differently-privileged audiences.

## 2. Delivery Architecture: Asynchronous via the Worker

**Decision:** analytics events are never sent synchronously from within a user-facing request/response cycle. The API route that handles the triggering action enqueues a lightweight `analytics-processing` job (BullMQ, per the locked runtime split) with the event name and properties as payload; the always-on worker consumes that queue and forwards the event to the analytics store/provider. Rationale:

- A slow or briefly-down analytics provider must never add latency to, or fail, a user-facing request (signing up, submitting an application) — coupling those paths would let a third-party analytics outage degrade the core product.
- Batching/retrying delivery is naturally handled by the existing BullMQ retry/backoff machinery already used for every other background job, rather than inventing a separate analytics-specific retry mechanism.
- This is the same job-queue pattern used for notification sending and webhook-retry processing (`28-observability.md` §4) — analytics is treated as one more background job type, not a special case with its own infrastructure.

The enqueue call itself is fire-and-forget from the request handler's perspective (it does not block the response, and a failure to enqueue is logged as a warning, not surfaced to the user or used to fail the request) — analytics delivery is best-effort by design; it must never become a reason a real user-facing action fails.

## 3. Privacy Rule (binding, cross-referenced)

**Rule:** analytics events carry **IDs and enums only** — never free-text student input, document contents, full profile dumps, or any field not explicitly listed in the catalog below as a property of that event. This is a privacy requirement, not a nice-to-have: collecting more than the minimum needed to answer a real product question is itself the failure mode, independent of how the data is later secured. The authoritative privacy-safe-analytics policy (what counts as identifiable, anonymization/pseudonymization approach, and how this interacts with data-subject rights) is owned by `42-gdpr-and-data-privacy.md`; this document only defines the concrete event catalog and enforces the "IDs/enums only" property rule at the schema level so engineers have no ambiguity about what's allowed in a given event's payload.

**Enforcement:** the analytics-emitting helper function (whatever wraps "enqueue this event") only accepts a payload matching a typed schema defined per event name — there is no generic `track(eventName: string, properties: Record<string, any>)` escape hatch that lets a call site pass arbitrary free-text fields. Adding a new property to an event is a reviewed schema change, not a one-line addition at an arbitrary call site.

## 4. Event Catalog

The following event names are the fixed vocabulary for product analytics — used exactly as spelled here. Each row lists the minimal properties that justify the event's product purpose; anything not listed here is out of scope for that event by default.

| Event | Fired when | Properties (IDs/enums/numbers only) |
|---|---|---|
| `SIGNUP_STARTED` | A visitor begins account creation (form rendered / first field interacted with) | `referralSource` (enum, e.g. `organic`, `paid`, `referral`) |
| `SIGNUP_COMPLETED` | An account is successfully created | `userId`, `signupMethod` (enum: `email`, `oauth_google`, etc.) |
| `EMAIL_VERIFIED` | The verification link/code is confirmed | `userId` |
| `ONBOARDING_STARTED` | The post-signup onboarding/profile-setup flow begins | `userId` |
| `ONBOARDING_COMPLETED` | Onboarding/profile setup is finished | `userId`, `durationSeconds` |
| `ASSESSMENT_STARTED` | The student begins the assessment questionnaire | `userId`, `questionnaireVersionId` |
| `ASSESSMENT_COMPLETED` | An assessment run finishes and results are generated | `userId`, `assessmentResultId`, `assessmentRuleVersionId`, `durationSeconds` |
| `UNIVERSITY_VIEWED` | A student views a specific university/program detail page (authenticated context — distinct from anonymous marketing-site views, which are out of scope for this catalog) | `userId`, `universityId`, `programId` (nullable) |
| `TARGET_UNLOCK_CLICKED` | The student clicks the CTA to unlock TARGET-tier matches | `userId`, `assessmentResultId` |
| `TARGET_UNLOCK_PURCHASED` | Payment for a TARGET unlock completes | `userId`, `entitlementType`, `amount`, `currency` |
| `SAFE_UNLOCK_PURCHASED` | Payment for a SAFE unlock completes | `userId`, `entitlementType`, `amount`, `currency` |
| `DOCUMENT_UPLOAD_STARTED` | A document upload begins (client initiates the upload request) | `userId`, `documentType` (enum, e.g. `passport`, `transcript`, `test_score`) |
| `DOCUMENT_UPLOADED` | A document upload completes successfully | `userId`, `documentId`, `documentType` |
| `APPLICATION_STARTED` | A draft application is created for a program | `userId`, `applicationId`, `programId` |
| `APPLICATION_SUBMITTED` | An application is submitted | `userId`, `applicationId`, `programId`, `daysFromStartToSubmit` |
| `CONSULTATION_VIEWED` | A student views a consultant's profile/availability | `userId`, `consultantId` |
| `CONSULTATION_BOOKED` | A booking is confirmed | `userId`, `consultantId`, `bookingId`, `amount`, `currency` |
| `PAYMENT_COMPLETED` | Any payment completes (general funnel signal, in addition to the unlock-specific events above where applicable) | `userId`, `paymentId`, `productType` (enum), `amount`, `currency` |

**Note on naming overlap with the audit catalog:** `PAYMENT_COMPLETED` appears in both this catalog and `27-audit-logging.md` §4. This is intentional and not a conflict — they are different events in different systems (one row in `AuditLog`, one message on the `analytics-processing` queue), sharing a name because it is the clearest name for the same real-world moment in both contexts. Engineers implementing a payment-completion handler should expect to trigger both independently (the audit write, synchronously, in the payment transaction; the analytics event, asynchronously, via the worker) rather than assuming one implies or produces the other.

## 5. Retention and Aggregation

**Decision:** raw analytics events are retained for 25 months (a common analytics-industry default that supports year-over-year comparison one full cycle back) and are then either deleted or rolled up into aggregated, non-identifiable metrics (e.g. monthly funnel-conversion rates) for longer-term trend tracking — never retained indefinitely at the raw, per-user-event level. Rationale: unlike the audit log (retained for years because it is a compliance/dispute record), product analytics has no legal-retention driver, and indefinite raw retention is pure downside from a privacy-minimization standpoint once the product-analysis value of raw events has been captured. This sits alongside, and does not override, whatever shorter deletion timeline applies to a specific user's data under a right-to-erasure request per `42-gdpr-and-data-privacy.md` — an erasure request purges that user's identifiable analytics events regardless of the general 25-month window.

## 6. Provider and Storage Notes

This document does not mandate a specific third-party analytics vendor — the worker-side delivery step (§2) is written against an internal event schema, with the actual provider integration as a swappable adapter behind it, so a vendor change is a worker-side integration change, not a rework of every call site that emits an event. Whatever provider is chosen must support server-side (not client-side-only) event delivery, consistent with the "delivered by the worker, not the browser" architecture in §2 — a client-side analytics snippet firing directly from the browser is explicitly out of scope, both because it reintroduces the request-blocking risk §2 avoids and because it is harder to guarantee the IDs/enums-only property rule (§3) at the point of firing versus at a single, reviewed server-side emission path.

## 7. Summary of Decisions in This Document

| # | Decision | Rationale (short) |
|---|---|---|
| D1 | Analytics delivered asynchronously via the worker's `analytics-processing` job, never synchronously from the request path | A third-party analytics outage must never degrade or fail a real user-facing action |
| D2 | Fixed catalog of 17 event names, each with an explicit minimal property list; no generic free-text `track()` escape hatch | Prevents accidental collection of free-text/sensitive data at arbitrary call sites |
| D3 | `PAYMENT_COMPLETED` intentionally exists in both this catalog and the audit catalog, as two independent events | Same real-world moment, two different systems with different audiences/retention; not a dedup target |
| D4 | Raw events retained 25 months, then deleted or rolled up to aggregate, non-identifiable metrics | No legal-retention driver for analytics (unlike audit logs); indefinite raw retention is pure privacy downside |
| D5 | Server-side-only delivery (no client-side analytics snippet firing directly from the browser) | Consistent with async-via-worker architecture and the IDs/enums-only enforcement point |

## 8. Related Documents

- `27-audit-logging.md` — the separate, compliance-grade immutable audit trail
- `42-gdpr-and-data-privacy.md` §privacy-safe-analytics — authoritative privacy policy this document implements
- `28-observability.md` — the BullMQ job-queue metrics (queue depth/failure rate) that apply to the `analytics-processing` job type like any other
- `06-system-architecture.md` — the Next.js/worker runtime split this document's delivery architecture depends on
