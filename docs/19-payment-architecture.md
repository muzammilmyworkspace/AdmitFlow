# 19 — Payment Architecture

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering
**Applies to:** All payment, checkout, webhook, refund, and entitlement-granting code (Stripe, PayPal, and any future provider)

---

## 1. Purpose and Scope

This document defines how AdmitFlow moves real money and, critically, how it converts a confirmed payment into product access without ever trusting the client. It covers Stripe and PayPal integration at the conceptual/flow level (not SDK code), the exact webhook processing contract, the Payment/Purchase/Entitlement data model, refund handling, and failure/expiry handling for abandoned checkouts.

It does not cover: recurring billing lifecycle and multi-currency pricing strategy (`20-subscription-billing.md`), consultation-specific booking/reservation mechanics (`22-consultation-booking.md`), the general idempotency contract shared across all external callbacks (`48-idempotency.md`), or the full database schema (`10-database-schema.md`). Where this document and `06-system-architecture.md` §4 differ in level of detail on the webhook path, **this document is authoritative for the exact transaction boundary** — see §4.5.

## 2. The Non-Negotiable Rule

> **Payment confirmation happens only via signature-verified, idempotent, server-side webhook processing. A client-reported "payment succeeded" (redirect return, polling response, postMessage from a provider iframe, anything originating in the browser) is never trusted to grant access, under any circumstance.**

Every section below exists in service of this rule. Concretely:

- The frontend never sets a "paid" flag anywhere in its own state that gates access. It only renders entitlements as returned by the API (`GET /api/v1/entitlements`, or an entitlement check embedded in the resource response itself — see `07-frontend-architecture.md` §9's paywall rendering rule, which this document's grant path is the server-side half of).
- A successful-looking redirect back from Stripe Checkout or PayPal Approve is a **UX hint** ("looks like it went through, let's check") that triggers a poll of the authoritative entitlement/payment-status endpoint — never a hint that itself unlocks anything.
- There is exactly one code path in the entire system that creates an `Entitlement` row from a payment: the webhook transaction described in §4. Admin manual grants (`14-security-architecture.md`, `44-admin-panel.md`) are the only other path, and they are explicitly audited, permissioned, out-of-band actions — never a "trust the client" shortcut.

## 3. Provider Integration Approach

### 3.1 Stripe: Checkout Session (not raw PaymentIntent + Elements)

**Decision:** All Stripe payments (one-off purchases today, subscriptions when `20-subscription-billing.md` activates) use **Stripe Checkout Session**, hosted by Stripe, not a custom form built on Elements + PaymentIntent directly.

Rationale:
- **PCI scope reduction.** Checkout Session is Stripe-hosted; card data never transits our frontend or backend, keeping AdmitFlow at SAQ A rather than SAQ A-EP/D. For a small engineering team this is a materially lower compliance burden than self-hosted Elements.
- **SCA/3DS handled for us.** Checkout Session natively handles Strong Customer Authentication challenges, wallet payment methods (Apple Pay/Google Pay), and locale-appropriate payment method display, without us building and maintaining that UI.
- **One integration surface for one-off and recurring.** Checkout Session supports both `mode: "payment"` (one-off) and `mode: "subscription"` (recurring) against the same integration pattern, so `20-subscription-billing.md`'s future subscription launch is additive, not a rework.
- **Accepted trade-off:** less control over checkout page branding/UX than a fully custom Elements form. Acceptable — AdmitFlow's conversion-rate sensitivity at this stage does not justify the added PCI scope and maintenance burden of a custom payment form.

Each Checkout Session is created server-side (`POST /api/v1/payments/checkout/stripe`) with: `client_reference_id` = our `Payment.id` (pre-generated UUID, §7), `metadata` carrying `customerId`, `priceId`, and the scope context (e.g. `applicationId` or `bookingId` — §5.3), `expires_at` set explicitly (§7.2), and success/cancel URLs pointing back into the app. We never rely on Stripe's default 24-hour session expiry.

### 3.2 PayPal: Orders API v2 (Create → Approve → Capture)

**Decision:** PayPal integration uses the **Orders API v2** (`intent: "CAPTURE"`) for one-off purchases: `POST /v2/checkout/orders` (create) → student redirected to PayPal's Approve flow → `POST /v2/checkout/orders/{id}/capture` (server-side capture, triggered by the return redirect as a **hint only**, see §4.4) → webhook confirms.

**Decision: PayPal recurring billing (PayPal Subscriptions API) is out of scope for v1.** Stripe is the primary provider and the one that carries subscription support when `20-subscription-billing.md` activates. If PayPal-specific recurring billing is ever required (e.g. a market where PayPal is dominant and Stripe Billing isn't acceptable), it is a distinct, separate integration against PayPal's Subscriptions API (which has its own plan/billing-agreement model, not just Orders) — not something bolted onto the Orders integration described here.

### 3.3 Provider Abstraction

The `Product`/`Price`/`Payment`/`Entitlement` data model (§5) is provider-agnostic by design — a `Price` row carries `stripePriceId` and/or `paypalPlanId`/PayPal-specific identifiers as separate nullable columns, never a provider-specific schema fork. Application code calls an internal `PaymentProvider` interface (conceptually: `createCheckout()`, `verifyWebhookSignature()`, `parseWebhookEvent()`, `refund()`) with a `StripeProvider` and `PayPalProvider` implementation. This keeps webhook processing (§4) and refund logic (§6) provider-agnostic at the business-logic layer, with provider-specific code isolated to the two implementations.

## 4. Webhook Flow (the authoritative contract)

Webhooks are the **only** trigger for entitlement grants. Both providers converge on the same shape once past signature verification.

### 4.1 Events Consumed

| Provider | Event | Meaning | Action |
|---|---|---|---|
| Stripe | `checkout.session.completed` (with `payment_status: "paid"`) | Synchronous payment method succeeded | Grant path (§4.5) |
| Stripe | `checkout.session.async_payment_succeeded` | Delayed payment method (e.g. bank debit) succeeded | Grant path (§4.5) |
| Stripe | `checkout.session.async_payment_failed` | Delayed payment method failed | Failure path (§7) |
| Stripe | `checkout.session.expired` | Session hit its `expires_at` unused | Local expiry reconciliation (§7.2) |
| Stripe | `payment_intent.payment_failed` | Card declined etc. | Failure path (§7) |
| Stripe | `charge.refunded` | Refund completed | Refund path (§6) |
| Stripe | `charge.dispute.created` | Chargeback opened | Dispute path (§6.4) |
| PayPal | `PAYMENT.CAPTURE.COMPLETED` | Capture succeeded | Grant path (§4.5) |
| PayPal | `PAYMENT.CAPTURE.DENIED` | Capture failed | Failure path (§7) |
| PayPal | `PAYMENT.CAPTURE.REFUNDED` | Refund completed | Refund path (§6) |
| PayPal | `CUSTOMER.DISPUTE.CREATED` | Chargeback/dispute opened | Dispute path (§6.4) |

`CHECKOUT.ORDER.APPROVED` (PayPal) is explicitly **not** a grant trigger — approval means the buyer authorized the payment, not that funds were captured. Only `PAYMENT.CAPTURE.COMPLETED` grants.

### 4.2 Signature Verification

- **Stripe:** verify `Stripe-Signature` header against the **raw, unparsed request body** using the endpoint's signing secret, with Stripe SDK's standard timestamp tolerance (5 minutes) to reject replayed payloads. The route handler is configured to skip any JSON body-parsing middleware ahead of this check — verification must run on the exact bytes Stripe signed.
- **PayPal:** PayPal does not offer a simple local HMAC check the way Stripe does. **Decision:** call PayPal's server-to-server `POST /v1/notifications/verify-webhook-signature` API with the transmission headers (`PAYPAL-TRANSMISSION-ID`, `PAYPAL-TRANSMISSION-TIME`, `PAYPAL-CERT-URL`, `PAYPAL-AUTH-ALGO`, `PAYPAL-TRANSMISSION-SIG`) and raw body, rather than implementing local certificate-chain validation. Rationale: local cert-chain verification is a meaningful place to introduce a subtle security bug; PayPal's own verification endpoint is authoritative and the added ~100–300ms latency is well inside the webhook handler's budget (§4.5 keeps the handler otherwise trivial).
- **On invalid signature:** return `400` immediately, write a security-audit log entry (`14-security-architecture.md`), and do not touch any payment/entitlement table. An invalid signature is treated as a potential forgery attempt, not a retry-worthy transient error.

### 4.3 Idempotency: the `WebhookEvent` Claim

Every verified event is claimed via an `INSERT ... ON CONFLICT (provider, providerEventId) DO NOTHING` against the `WebhookEvent` table, **inside the same transaction that performs the business update** (§4.5) — not as a separate pre-check. This matters:

- A separate "check, then insert, then process" sequence is itself a race: two concurrent deliveries of the same event (Stripe and PayPal both retry aggressively on anything short of a fast `2xx`) could both pass a `SELECT`-based check before either commits an `INSERT`.
- A single atomic `INSERT ... ON CONFLICT` inside the same transaction as the Payment/Entitlement writes means **the existence of a committed `WebhookEvent` row is itself proof that the corresponding business update was also committed** — there is no window where the event is "recorded" but the entitlement grant is not, or vice versa.
- If the `INSERT` reports zero rows affected (conflict — this exact `(provider, providerEventId)` was already committed by a prior successful run), the handler rolls back the (otherwise-empty) transaction and returns `200` immediately: a true no-op, per the locked idempotency contract.

`WebhookEvent` columns: `id` (UUID), `provider` (`STRIPE`/`PAYPAL`), `providerEventId`, `eventType`, `rawPayload` (JSONB, stored verbatim for audit/replay per `09-database-architecture.md` §4), `outcome` (`GRANTED` / `PAYMENT_UPDATED_ONLY` / `IGNORED` / `ERROR` — for observability; distinct from the presence of the row, which already means "committed"), `receivedAt`. Unique constraint on `(provider, providerEventId)`.

### 4.4 Diagram: Unified Webhook Flow (both providers)

```
Stripe/PayPal (external, adversarial-by-default input)
        │  POST /api/v1/payments/webhooks/{stripe|paypal}
        ▼
┌───────────────────────────────────────────────────────────────────┐
│  Next.js API route handler (fast path — no business logic beyond   │
│  the transaction below; target: sub-200ms excluding PayPal's       │
│  verify-signature round trip)                                      │
│                                                                     │
│  1. Read raw body (unparsed) + provider signature headers          │
│  2. Verify signature (§4.2)                                        │
│       invalid ──▶ 400, security audit log, STOP                    │
│  3. BEGIN TRANSACTION                                               │
│       a. INSERT WebhookEvent (provider, providerEventId, ...)       │
│          ON CONFLICT DO NOTHING                                     │
│       b. if 0 rows inserted (duplicate delivery of an event         │
│          already committed) ──▶ ROLLBACK, return 200 (no-op)        │
│       c. if 1 row inserted (new event):                             │
│            - re-derive amount/currency from verified payload,       │
│              cross-check against the Payment row's expected         │
│              amount/currency captured at checkout creation (§7.1)   │
│              — mismatch ⇒ do NOT grant, mark outcome=ERROR,          │
│              flag for manual review, still COMMIT the WebhookEvent  │
│              claim (never re-process a tampered/mismatched event)   │
│            - locate Payment by providerPaymentId                    │
│            - update Payment.status (SUCCEEDED / FAILED / REFUNDED   │
│              / DISPUTED, per event type)                            │
│            - if success: create Purchase row; for each               │
│              PriceEntitlementGrant template on the Price, create    │
│              Entitlement row(s) (§5.3)                              │
│            - set WebhookEvent.outcome                                │
│  4. COMMIT                                                          │
│  5. Return 2xx to provider                                          │
└──────────────────────┬──────────────────────────────────────────────┘
                        │  (after commit — never inside the transaction)
                        ▼
        Enqueue BullMQ job(s) to the worker service:
        - send receipt/confirmation email
        - (consultation only) trigger meeting-link generation (22-consultation-booking.md)
        - analytics event
        - (subscription only) sync next-invoice-date cache
```

### 4.5 Decision: What Is Inside the Transaction vs. Queued

**Decision:** Entitlement granting happens **synchronously, inside the webhook handler's own database transaction** — it is not deferred to a worker job. Only genuinely slow, non-critical-path side effects (email delivery, analytics, meeting-link creation against a third-party video API) are enqueued to the BullMQ worker, and only *after* the transaction commits.

Rationale: granting an entitlement is a small, fast, purely-Postgres operation (a handful of row inserts/updates) with no external I/O — it does not violate the serverless "no long-running work in the request path" rule from `06-system-architecture.md` §5, because it isn't long-running. Doing it synchronously means:
- The webhook `2xx` response is only ever sent once the entitlement genuinely exists in Postgres — no gap where the provider considers the event delivered but our system hasn't yet caught up (which would otherwise force the frontend's post-checkout poll to handle an ambiguous "processing" state for longer than necessary).
- There is exactly one atomic unit of work, matching `09-database-architecture.md` §7's "Payment → Entitlement" transaction boundary precisely.

This refines the more schematic version of this diagram in `06-system-architecture.md` §4 (which shows the worker doing "business rules: grant entitlement" as part of reconciliation) — that diagram is correct at the system level (a worker-consumed queue exists and does real work off this event), but the entitlement grant itself is not one of the things deferred to it. Engineers should treat **this document** as the binding contract for exactly what runs in the request path vs. the worker for payments; `06-system-architecture.md` is not being contradicted, only sharpened.

## 5. Data Model: Product / Price / Payment / Purchase / Entitlement / Customer

### 5.1 Entity Overview

| Entity | Represents |
|---|---|
| `Product` | A sellable thing at the business level: `TARGET_SAFE_UNLOCK`, `APPLICATION_SUBMISSION_FEE`, `CONSULTATION_SESSION_40MIN`, (future) `PREMIUM_MEMBERSHIP`. Never a boolean flag — see §5.4. |
| `Price` | One priced offering of a `Product`: amount, currency, billing scheme (`ONE_TIME` here; `RECURRING` per `20-subscription-billing.md`), provider identifiers (`stripePriceId`, `paypalPlanId`), `isActive`. A `Product` has many `Price` rows (multi-currency, historical price changes — see §5.5). |
| `PriceEntitlementGrant` | Declares which `Entitlement` key(s) a successful `Purchase`/`Subscription` of a given `Price` grants. A `Price` has one or many of these (§5.4 — this is how "1 payment grants 1+ entitlements" is modeled). |
| `Customer` | Billing identity for a `User`: `stripeCustomerId`, `paypalPayerId`, billing email, country, currency (denormalized from `User.profile.currency` at time of first purchase — see `20-subscription-billing.md` §5 for the full currency contract). 1:1 with `User`. |
| `Payment` | One provider-level money-movement attempt: a Stripe Checkout Session/PaymentIntent or a PayPal Order/Capture. Created `PENDING` at checkout-initiation time, transitions per §7. |
| `Purchase` | The business-level record of a completed **one-off** transaction: `customerId`, `priceId`, `paymentId`, `quantity`, `scopeType`/`scopeId` (§5.3). Created only on payment success. Recurring transactions use `Subscription` instead (`20-subscription-billing.md`) — a `Purchase` row is never created for a subscription renewal. |
| `Entitlement` | The generic access grant. Never a boolean column on `User`. See §5.3. |
| `WebhookEvent` | Idempotency ledger, §4.3. |

### 5.2 Relationship Diagram (conceptual)

```
Product 1───* Price 1───* PriceEntitlementGrant
                  │
                  │ (referenced by)
                  ▼
Customer 1───* Payment 1───0/1 Purchase 1───* Entitlement
   │                                              ▲
   │                                              │ (source, mutually exclusive FK pair —
   │                                              │  sourcePurchaseId XOR sourceSubscriptionId,
   │                                              │  enforced via CHECK constraint, never a
   │                                              │  polymorphic untyped reference)
   └───* Subscription ───────────────────────────┘
                  (20-subscription-billing.md)

WebhookEvent (independent ledger, referenced by Payment.lastWebhookEventId for traceability only)
```

### 5.3 Entitlement Scoping

An `Entitlement` is not just "does this customer have access to this Product" — several products are scoped to a *specific instance* of another resource, not the account as a whole:

| `entitlementKey` | `scopeType` | `scopeId` | Meaning |
|---|---|---|---|
| `TARGET_SAFE_RESULTS` | `ACCOUNT` | `null` | Once unlocked, unlocked permanently for this student's account — not re-purchased per assessment re-run. |
| `APPLICATION_SUBMISSION` | `APPLICATION` | the specific `Application.id` | The submission fee is paid per application; owning this entitlement is what the Applications state machine (`13-application-lifecycle.md`, if authored separately) checks before allowing the `SUBMITTED` transition for *that* application, not any application. |
| `CONSULTATION_SESSION` | `BOOKING` | the specific `Booking.id` | The right to attend one specific booked, paid session — see `22-consultation-booking.md`. |

`scopeId` is known **at checkout-initiation time** (the student has already selected the application to submit, or the slot to book, before paying) and is stored as context on the `Payment` row (`Payment.scopeType`, `Payment.scopeId`), then copied onto the `Entitlement` row(s) created in the webhook transaction. This avoids inventing an unscoped "credit" concept for v1.

**Decision — "1 payment grants 1+ entitlements":** modeled via `PriceEntitlementGrant`, which is a one-to-many relationship from `Price` to entitlement-key templates. Today, every `Price` has exactly one `PriceEntitlementGrant` row (simple 1:1 mapping — paying for the unlock grants exactly `TARGET_SAFE_RESULTS`, nothing else). The schema already supports a future bundle `Price` (e.g. a "Starter Pack" granting both `TARGET_SAFE_RESULTS` and a discounted `APPLICATION_SUBMISSION` credit) without a redesign — that is *why* the join table exists rather than a single `entitlementKey` column directly on `Price` — but bundling is explicitly **not** built for v1; documenting the extension point here is sufficient.

### 5.4 Why Never a Boolean Flag

`User.hasUnlockedTargetSafe: boolean` (or similar) is explicitly forbidden anywhere in the schema or application code. Every access check is "does an `ACTIVE`, non-expired, non-revoked `Entitlement` row exist for `(customerId, entitlementKey, scopeType, scopeId)`." Rationale: a boolean collapses provenance (which payment granted this?), scoping (per-application vs per-account), temporality (subscriptions expire/renew; refunds revoke), and auditability (admin overrides need a real row to attach a reason and actor to, per `09-database-architecture.md` §6.2) into a single bit that cannot represent any of them. This is the same normalize-by-default stance as `09-database-architecture.md` §3.

### 5.5 Price Versioning

`Price` rows are never mutated in place once referenced by a `Payment`/`Purchase`/`Subscription` — a price change creates a **new** `Price` row (`isActive` flipped on the old one), so historical purchases always resolve to the exact price paid, independent of later configurable pricing changes (same reproducibility principle as assessment snapshots, `09-database-architecture.md` §4).

## 6. Refund Handling

### 6.1 Trigger

**Decision:** Refunds are **admin-initiated only** in v1 — there is no self-serve student "request a refund" button. Rationale: refund eligibility for a consultation (was it delivered?) or an application-fee (has the admissions team already acted on the submission?) frequently requires human judgment that a fully automated self-serve flow would get wrong often enough to cause support/chargeback problems. A refund is a back-office action requiring a free-text reason, performed by a role-permissioned admin (`02-personas-and-roles.md`). Self-serve refunds for the simplest case (unlock refunded within a short window, no application submitted since) is a reasonable v2 candidate, not built now.

### 6.2 Flow

```
Admin (back office) ──▶ Initiate refund (Payment.id, amount, required reason text)
        │
        ▼
[Transaction] Create AuditLog entry + set Payment.status = REFUND_PENDING,
              refundInitiatedAt, refundInitiatedBy   (09-database-architecture.md §7:
              admin action + audit log is always one transaction)
        │
        ▼
Call provider refund API (Stripe Refunds API create / PayPal Captures Refund)
        │  (async on the provider's side — this call does not itself grant/revoke anything)
        ▼
Provider processes refund ──▶ webhook: charge.refunded / PAYMENT.CAPTURE.REFUNDED
        │
        ▼
[Webhook transaction, §4.5] Payment.status = REFUNDED or PARTIALLY_REFUNDED,
        refundedAmount, refundedAt  +  Entitlement revocation per policy (§6.3)
```

If the provider refund API call itself fails (network error, already-refunded, insufficient balance), the admin action surfaces the error immediately and `Payment.status` reverts from `REFUND_PENDING` back to its prior terminal state — it never sits in `REFUND_PENDING` indefinitely; a background reconciliation sweep (§7.2's sweep job, extended) also flags any `REFUND_PENDING` payment older than 1 hour with no confirming webhook for manual ops follow-up.

### 6.3 Entitlement Revocation Policy (decided)

| Case | Policy | Rationale |
|---|---|---|
| Full refund on a one-off `Purchase` (`TARGET_SAFE_RESULTS`, `APPLICATION_SUBMISSION`, `CONSULTATION_SESSION`) | **Immediate** revocation on webhook confirmation (`Entitlement.status = REVOKED`, `revokedAt = now()`, `revokedReason = REFUND`) | These products are instant-access, not consumed over a period — there is no "remaining period" to let run out. Immediate revocation is the only coherent policy; anything else lets a refunded customer keep access indefinitely. |
| Full refund after the gated action already happened (application already submitted; consultation already attended) | Entitlement is still revoked immediately (prospective access only) — the already-completed action is **not** undone. Application submission and consultation attendance are facts recorded in their own state machines (`13-application-lifecycle.md`, `22-consultation-booking.md`), not live-gated by entitlement after the fact. | Entitlement gates the *action* at the moment it is attempted, not a retroactive claim on history. Refunding money does not un-submit an application. |
| Partial refund (amount < 100% of original) on a one-off `Purchase` | **No revocation.** Treated as a goodwill partial discount, not a rescission. Full revocation requires either a subsequent refund reaching 100%, or an explicit separate admin "revoke entitlement" action independent of refund amount. | Avoids ambiguous partial-access states (there is no "50% unlocked"). |
| Goodwill refund on an active `Subscription` (`20-subscription-billing.md`) | Revoke **at period end**, alongside subscription cancellation at period end — not immediately. | Subscription value is consumed continuously through the period already paid for; revoking access mid-period after refunding money already collected for that period is doubly punitive and avoids mid-period proration math. |
| Fraud/chargeback-triggered refund on a `Subscription` | **Immediate** revocation + immediate subscription cancellation. | Fraud cases carry ongoing risk (stolen instrument, near-certain future chargeback) that overrides the continuity rationale above. |

### 6.4 Disputes / Chargebacks

`charge.dispute.created` (Stripe) / `CUSTOMER.DISPUTE.CREATED` (PayPal) are handled distinctly from admin-initiated refunds: on receipt, the webhook transaction immediately sets `Payment.status = DISPUTED` and **immediately revokes** any associated entitlement(s) (same rationale as fraud refunds above — a dispute signals contested funds and elevated risk), and enqueues a worker job that opens an ops-queue item for manual response to the provider's dispute process. This is a security/fraud posture, not a customer-service one — it happens automatically, before any human reviews the case.

## 7. Failure and Expiry Handling

### 7.1 Payment Record Lifecycle

A `Payment` row is created in status `PENDING` **at checkout-session-creation time** (before the student ever reaches the provider's page), carrying the expected `amount`, `currency`, `priceId`, `scopeType`/`scopeId`, and `checkoutExpiresAt`. This is what §4.5's amount/currency cross-check validates against, and what gives us a row to expire even if the student never completes — or never starts — the provider-hosted step.

`Payment.status` values: `PENDING` → `SUCCEEDED` | `FAILED` | `EXPIRED` | `REFUND_PENDING` → `REFUNDED`/`PARTIALLY_REFUNDED` | `DISPUTED`.

### 7.2 Checkout Expiry (no stuck "processing" UI)

**Decision:** Every `Payment` gets a `checkoutExpiresAt` = **30 minutes** from creation, regardless of provider, enforced two ways:

1. **Provider-side, where configurable:** Stripe Checkout Session `expires_at` is explicitly set to 30 minutes (Stripe's own default is 24 hours — we override it down). PayPal Orders API does not allow configuring the order's own validity window below its ~3 hour default, so provider-side expiry cannot be shortened to match.
2. **Our own sweep, regardless of provider:** a repeatable BullMQ job (`payments.sweep-expired-checkouts`, worker service, every 5 minutes) runs `UPDATE Payment SET status = 'EXPIRED' WHERE status = 'PENDING' AND checkoutExpiresAt < now()`. This gives a **consistent, provider-independent 30-minute bound** on how long the UI can ever show a "processing/pending" state, closing the "stuck spinner" problem structurally rather than relying on the frontend to time out gracefully.

**Edge case, decided explicitly:** if a success webhook arrives for a `Payment` we already marked `EXPIRED` (e.g. the student completed a PayPal approval at minute 45, inside PayPal's own 3-hour window but after our 30-minute local sweep), the webhook transaction still processes it as a success — reactivating `Payment` to `SUCCEEDED` and granting the entitlement — rather than rejecting it, and logs a warning for ops visibility. Rationale: refusing to grant access for money that was actually captured is a worse outcome than a rare late grant; our local expiry exists for UX (bounding the "processing" state and freeing consultation slot reservations, `22-consultation-booking.md`), not as a hard cutoff on our contractual obligation to deliver what was paid for.

No student-facing "your checkout expired" notification is sent (**Decision:** silent expiry, student simply retries from the product page) — an abandoned checkout is not assumed to be an error the student needs to be told about; revisit only if cart-recovery becomes a deliberate growth initiative.

### 7.3 Payment Failure (declined card, failed capture)

```
payment_intent.payment_failed / PAYMENT.CAPTURE.DENIED
        │
        ▼
[Webhook transaction] Payment.status = FAILED  (no Purchase, no Entitlement created)
        │
        ▼  (after commit)
Enqueue worker job: send "payment didn't go through" notification email
        │
        ▼
Student returns to the product page; a fresh checkout (new Payment row, new
Idempotency-Key, §8) is the only way to retry — a FAILED Payment is terminal
and is never resurrected by a later webhook.
```

### 7.4 Frontend Polling Contract (bounding the "processing" UX)

After redirect back from the provider (Stripe success/cancel URL, PayPal return URL), the frontend shows a "Confirming your payment…" state and polls `GET /api/v1/payments/{paymentId}` (which returns `status` and, once `SUCCEEDED`, the resulting entitlement summary) every 2 seconds for up to 30 seconds. If no terminal status (`SUCCEEDED`/`FAILED`/`EXPIRED`) is reached in that window, the UI switches to "Still processing — we'll email you and update this automatically" and stops tight-polling (falls back to a slow background poll or relies on the notification). This bounds the worst-case UX to a fixed, short window instead of an indefinite spinner, and is a direct consequence of §7.2's 30-minute hard expiry existing at all — the frontend never needs to guess how long is "too long."

## 8. Double-Click / Duplicate Checkout Prevention

**Decision:** the "Pay now" action is protected at three layers, per the locked concurrency requirements:

1. **Client-side button disable:** the button disables itself synchronously on click, before the network call returns — first line of defense, not the guarantee.
2. **Client-generated `Idempotency-Key`:** a UUID v4 is generated once when the checkout intent is formed (on button click, held in component state so a retry of the *same* click reuses it) and sent as an `Idempotency-Key` request header to `POST /api/v1/payments/checkout/{stripe|paypal}`.
3. **Server-side idempotency store (the actual guarantee):** the endpoint looks up `(userId, endpoint, idempotencyKey)` in an `IdempotencyKey` table before doing anything else. If found, it returns the **stored response** (the same checkout session URL / order ID) from the original call rather than creating a second `Payment` row or a second provider-side session. If not found, it creates the `Payment` row and provider checkout session, stores the response keyed by `(userId, endpoint, idempotencyKey)`, and returns it. Where the provider SDK itself accepts an idempotency key (Stripe's API does), the same key is also passed through to Stripe as defense in depth against our own retry logic double-calling Stripe.

This mirrors `09-database-architecture.md` §7.2's rule that idempotency is a database-level guarantee, never an application-level "check then write."

## 9. Frontend Contract (restated)

- The frontend never marks anything "paid." It renders whatever `GET /api/v1/entitlements` (or a resource endpoint's embedded entitlement/lock markers, per `07-frontend-architecture.md` §9) returns.
- A post-checkout redirect is a cue to poll, never a cue to unlock.
- No client-side computation of "should I show this as paid" exists anywhere — same binding rule as the paywall rendering rule for gated content.

## 10. Summary of Decisions in This Document

| # | Decision | Rationale (short) |
|---|---|---|
| P1 | Stripe integration via Checkout Session (not raw Elements/PaymentIntent) | PCI scope reduction, built-in SCA/3DS, one pattern covers one-off and future subscriptions |
| P2 | PayPal integration via Orders API v2 (Create → Approve → Capture); PayPal recurring billing out of scope for v1 | Stripe is primary for recurring; PayPal Subscriptions API is a distinct future integration if ever needed |
| P3 | PayPal signature verification via PayPal's server-to-server verify API, not local cert-chain validation | Lower risk of implementation bugs in crypto verification |
| P4 | `WebhookEvent` claim (`INSERT ... ON CONFLICT DO NOTHING`) happens inside the same transaction as the Payment/Entitlement writes | Existence of the committed row is proof the business update also committed — no partial-state window |
| P5 | Entitlement granting is synchronous inside the webhook handler's transaction; only slow side effects (email, meeting-link creation, analytics) are queued to the worker | Entitlement grant is fast, pure-Postgres work; no reason to defer it and widen the "processing" window |
| P6 | Entitlement scoping via `scopeType`/`scopeId` on `Entitlement`, set from context captured on `Payment` at checkout time | Models per-application and per-booking access without inventing an unscoped "credit" concept |
| P7 | `PriceEntitlementGrant` join table (1 `Price` → 1+ entitlement templates) | Supports future bundle pricing without a schema redesign, while v1 stays 1:1 |
| P8 | Refunds are admin-initiated only in v1 | Refund eligibility often needs human judgment; avoids automated-refund abuse/support problems |
| P9 | Full refund on a one-off Purchase → immediate entitlement revocation; partial refund → no revocation; subscription goodwill refund → revoke at period end; fraud/dispute → immediate revocation | Matches each product's actual "instant access vs. consumed-over-time" nature |
| P10 | `checkoutExpiresAt` = 30 minutes for every `Payment` regardless of provider, enforced by a 5-minute sweep job; late-arriving success webhooks for an already-expired Payment still grant access | Bounds the "stuck processing" UI structurally; never refuses access for money actually captured |
| P11 | Triple-layered double-click protection: button disable + client Idempotency-Key + server-side idempotency store as the actual guarantee | Check-then-write is itself a race; the DB-backed store is what prevents duplicate charges/sessions |
