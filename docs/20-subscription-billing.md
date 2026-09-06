# 20 — Subscription & Billing Architecture

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering
**Applies to:** Pricing model, recurring billing lifecycle, invoicing, and multi-currency handling

---

## 1. Purpose and Scope

AdmitFlow v1 launches with **one-off purchases only** (Target/Safe unlock, application submission fee, paid consultations — see `19-payment-architecture.md`). This document exists so that if/when the product introduces a recurring plan (e.g. a "Premium Membership" bundling unlimited unlocks + discounted consultations), that launch is **additive to the existing `Product`/`Price`/`Entitlement` model**, not a schema redesign or a second parallel billing system.

It covers: the `Plan`/`Price` model shared by one-off and recurring products, the `Subscription` lifecycle state machine and how entitlements attach/detach through it, invoice/receipt generation, and per-customer currency handling. It assumes the webhook processing contract, idempotency mechanics, and refund policy already defined in `19-payment-architecture.md` — this document only adds what is specific to *recurring* billing.

## 2. Locked Decisions (context, restated from `19-payment-architecture.md`)

- Stripe is the primary and, for v1, **only** provider for recurring billing. PayPal remains one-off-only (Orders API) — see `19-payment-architecture.md` §3.2.
- Entitlement grants are never a boolean; a `Subscription` is one of the two possible **sources** of an `Entitlement` (the other being a one-off `Purchase`), via the mutually-exclusive `sourcePurchaseId`/`sourceSubscriptionId` FK pair on `Entitlement` (`19-payment-architecture.md` §5.2).
- All monetary amounts and timestamps follow `09-database-architecture.md`'s conventions: UTC `timestamptz` for every date, amounts stored as integer minor units (cents), never floats.

## 3. Plan / Price Model (shared by one-off and recurring)

The model introduced in `19-payment-architecture.md` §5 is deliberately generic enough to cover both purchase types without a fork:

```
Product ("what")
  │
  ├── Price #1  { billingScheme: ONE_TIME,  amount: 999,  currency: EUR }   ← today's unlock price
  ├── Price #2  { billingScheme: ONE_TIME,  amount: 899,  currency: USD }   ← same Product, different currency
  └── (future) Price #3 { billingScheme: RECURRING, amount: 1999, currency: EUR,
                           interval: MONTH, intervalCount: 1 }              ← same Product model, no redesign
```

- **`Product`** stays business-level and provider-agnostic: `TARGET_SAFE_UNLOCK`, `APPLICATION_SUBMISSION_FEE`, `CONSULTATION_SESSION_40MIN`, and (whenever introduced) `PREMIUM_MEMBERSHIP`.
- **`Price`** carries `billingScheme: ONE_TIME | RECURRING`. A `RECURRING` price additionally carries `interval` (`DAY`/`WEEK`/`MONTH`/`YEAR`), `intervalCount`, and `trialPeriodDays` (nullable). Provider identifiers: `stripePriceId` for both schemes (Stripe Checkout Session handles both `mode: "payment"` and `mode: "subscription"` off the same `Price` object type on Stripe's side, matching our decision in `19-payment-architecture.md` §3.1 to use Checkout Session for exactly this reason).
- **Decision: no separate `Plan` table distinct from `Price`.** A "plan" (e.g. "Premium Monthly" vs. "Premium Annual") is modeled as two `Price` rows under the same `Product`, differing in `interval`/`intervalCount`/`amount` — not as a third table. Rationale: introducing a `Plan` layer above `Price` would duplicate most of `Price`'s fields for no additional capability at AdmitFlow's scale (a handful of products, each with a handful of price points); if a genuinely plan-level concept emerges later (e.g. per-plan feature entitlement bundles beyond what `PriceEntitlementGrant` already expresses), it is added as a thin `Plan` grouping over existing `Price` rows, not a rewrite.
- **`Purchase`** (one-off) and **`Subscription`** (recurring) are the two distinct transaction-history entities, deliberately *not* unified into one table — a `Purchase` is a single completed event; a `Subscription` is an ongoing stateful entity with its own lifecycle (§4). Unifying them would force every one-off purchase query to filter out subscription-lifecycle columns that never apply to it, violating `09-database-architecture.md` §3's "no wide mostly-null tables" stance.

## 4. Subscription Lifecycle

### 4.1 States

| State | Meaning |
|---|---|
| `TRIALING` | Subscription created with a trial period active; no payment collected yet; entitlements already attached (§4.3). |
| `ACTIVE` | Current billing period is paid (or trial converted to paid). Entitlements attached. |
| `PAST_DUE` | Most recent invoice payment failed; Stripe is retrying per its dunning schedule. Entitlements attached during the grace period only (§4.4). |
| `CANCELED` | Subscription ended, either by the customer (effective at period end by default, §6) or by exhausting dunning retries. Terminal. Entitlements detached. |
| `EXPIRED` | Reserved for a `TRIALING` subscription whose trial ended with no payment method attached/no conversion — distinguished from `CANCELED` (which implies there was a paid relationship at some point) for reporting/analytics clarity. Terminal. Entitlements detached (they were never really "consumed" if trial-only). |

### 4.2 Transition Table

| From | To | Trigger | Entitlement effect |
|---|---|---|---|
| *(none)* | `TRIALING` | Checkout completed with a trial-enabled `Price`; `customer.subscription.created` webhook (`status: trialing`) | Attach immediately |
| *(none)* | `ACTIVE` | Checkout completed, no trial; `customer.subscription.created` (`status: active`) | Attach immediately |
| `TRIALING` | `ACTIVE` | Trial ends, payment method charged successfully; `invoice.paid` | Remains attached (no gap) |
| `TRIALING` | `EXPIRED` | Trial ends, no payment method / charge fails at trial end with no prior successful payment; `customer.subscription.updated` (`status: canceled`, trial-ended reason) | Detach immediately |
| `ACTIVE` | `PAST_DUE` | Renewal invoice payment fails; `invoice.payment_failed` | Remains attached through grace period (§4.4) |
| `PAST_DUE` | `ACTIVE` | A retried charge within the dunning schedule succeeds; `invoice.paid` | Remains attached (no gap) |
| `PAST_DUE` | `CANCELED` | Grace period elapses with no successful payment (either our own grace-period cutoff, §4.4, or Stripe's dunning schedule exhausts first — whichever comes first) | Detach |
| `ACTIVE`/`TRIALING`/`PAST_DUE` | `CANCELED` | Customer-initiated cancellation, or admin-initiated cancellation, or fraud/dispute (`19-payment-architecture.md` §6.3) | Detach immediately (fraud) or at period end (voluntary, §6) |

All transitions are driven by Stripe webhook events (`customer.subscription.created`/`updated`/`deleted`, `invoice.paid`, `invoice.payment_failed`) processed through the **same** `WebhookEvent` idempotency and single-transaction contract defined in `19-payment-architecture.md` §4 — a subscription-lifecycle webhook is not a special case of the webhook pipeline, it is the same pipeline updating a `Subscription` row (and its attached `Entitlement` rows) instead of creating a `Purchase` row.

### 4.3 How Entitlements Attach/Detach

A subscription's `Entitlement` row(s) are **not** re-created every billing period. One `Entitlement` row per `PriceEntitlementGrant` template is created when the `Subscription` first becomes `TRIALING`/`ACTIVE`, with `sourceSubscriptionId` set and `expiresAt` = the subscription's `currentPeriodEnd`. Each successful renewal (`invoice.paid`) **extends** `expiresAt` to the new `currentPeriodEnd` in the same webhook transaction that updates the `Subscription` row — it does not create a new `Entitlement`. This keeps entitlement history for a subscriber as one continuous row per grant (with an audit trail of period extensions via `updatedAt`/`version`, per `09-database-architecture.md` §6.4) rather than a new row every month, which would make "does this customer currently have access" a query over N rows instead of one.

Detachment (`Entitlement.status = REVOKED`, `revokedReason = SUBSCRIPTION_ENDED`) happens the moment the `Subscription` reaches a terminal state that ends access — see §4.4 for the `PAST_DUE` grace period, which is the one case where detachment is deliberately *not* immediate on the state transition itself.

### 4.4 Decision: `PAST_DUE` Grace Period = 3 Days

**Decision:** when a `Subscription` enters `PAST_DUE`, its entitlements remain attached for **3 calendar days** from the first failed renewal invoice. If no successful payment lands within that window, entitlements are revoked (`revokedReason = PAST_DUE_GRACE_EXPIRED`) even though Stripe's own dunning/Smart Retries schedule may continue attempting charges for longer (Stripe's default schedule can span up to ~2–4 weeks before the subscription itself is canceled).

Rationale: AdmitFlow's subscription price point is a low-value consumer product, not an enterprise contract — the business risk of giving away multiple weeks of free access to a card that has already failed once outweighs the goodwill of a long grace window. Three days is enough time for a normal "card expired, update your payment method" recovery (the student gets an immediate notification, §5.1) without the platform effectively subsidizing extended free access. This is enforced independently of Stripe's own subscription status: a scheduled worker job (`subscriptions.enforce-past-due-grace`, runs hourly) checks `Subscription.status = 'PAST_DUE' AND pastDueSince < now() - interval '3 days'` and revokes entitlements directly — it does not wait for Stripe to eventually cancel the subscription itself, because Stripe's cancellation timeline is intentionally longer than our access-grace policy. The `Subscription.status` in our database can therefore show `PAST_DUE` with entitlements already revoked (`entitlements.status = REVOKED` while `subscription.status` is still `PAST_DUE` from Stripe's perspective) — this is expected and correctly modeled as two independent facts (payment relationship state vs. access state), not a bug.

If the customer's card is later fixed and Stripe successfully charges a retry after our grace period already revoked access, the resulting `invoice.paid` webhook re-attaches (re-activates) the same `Entitlement` row rather than creating a new one, and the subscription returns to `ACTIVE`.

## 5. Invoicing and Receipts

**Decision:** AdmitFlow does not build its own invoice-rendering/tax-calculation system. It relies on the provider's native invoicing:

- **Stripe:** Stripe Billing automatically generates a hosted, tax-compliant invoice for every subscription charge (and can for one-off Checkout Session payments too, via "generate invoice" on the Checkout Session). We store `Payment.providerInvoiceId` and `Payment.providerHostedInvoiceUrl` (or `Subscription.latestInvoiceUrl` for renewals) and surface that URL to the student ("Download receipt") rather than rendering our own PDF.
- **PayPal:** PayPal's transaction receipt (accessible via the transaction ID / order ID) serves the same role for one-off PayPal purchases; we store `Payment.providerReceiptUrl` analogously.
- **What we do generate ourselves:** a lightweight internal `Receipt`-equivalent view (not a separate table — derived from `Payment`/`Purchase`/`Subscription` + the stored provider URL) shown in the student's billing history page, listing product, amount, currency, date, and a link to the provider's hosted document. We do not reimplement VAT/sales-tax calculation, invoice numbering sequences, or PDF generation — that is explicitly Stripe/PayPal's responsibility, since both providers already handle jurisdiction-specific tax compliance (e.g. Stripe Tax) that would be a significant, ongoing compliance burden to duplicate.

### 5.1 Touchpoints

| Event | What happens |
|---|---|
| One-off purchase succeeds | Worker job (enqueued post-webhook-commit, `19-payment-architecture.md` §4.4) sends a confirmation email linking the provider receipt URL. |
| Subscription renewal succeeds (`invoice.paid`) | Worker job sends a renewal receipt email with the Stripe hosted invoice link. |
| Subscription renewal fails (`invoice.payment_failed`) | Worker job sends a "payment failed, update your card, you have 3 days" email — this is the primary lever that makes the §4.4 grace period actually recoverable in practice. |
| Grace period about to expire | Worker job sends a final warning at the 48-hour mark within the 3-day grace window (scheduled relative to `pastDueSince`). |
| Refund processed | Worker job sends a refund confirmation email (amount, whether entitlement was affected, per `19-payment-architecture.md` §6.3's policy table). |

## 6. Cancellation Policy

**Decision:** customer-initiated cancellation defaults to **cancel-at-period-end** (`Subscription.cancelAtPeriodEnd = true`, `Subscription.status` remains `ACTIVE` until `currentPeriodEnd`, at which point the next scheduled `customer.subscription.updated`/`deleted` webhook transitions it to `CANCELED` and detaches entitlements). The student retains full access for the period they already paid for. **Decision:** admins have an "cancel immediately" override (used for fraud, ToS violations, or an explicit refund-and-cancel request) that calls Stripe's immediate-cancellation API and revokes entitlements in the same webhook-confirmed transaction, bypassing the period-end default.

Plan upgrades (moving to a higher-tier `Price` on the same `Product`, or a different `Product` in the same subscription family, once such tiers exist) use Stripe's proration: **Decision:** upgrades prorate and take effect immediately (customer is charged the prorated difference right away, entitlement set — if the higher tier grants additional entitlement keys — attaches immediately); downgrades take effect **at period end** (no proration credit issued mid-period), mirroring the same "don't claw back or mid-period-adjust access that's already been paid for" philosophy as the refund policy in `19-payment-architecture.md` §6.3.

## 7. Currency Handling

**Decision:** currency is **not** dynamically converted at checkout. Every `Price` row has an explicit `currency`, and a `Product` supports multiple currencies only by having multiple `Price` rows (one per supported currency), exactly as shown in §3's diagram. Rationale: dynamic FX conversion at the moment of checkout introduces rate risk, reconciliation complexity (what rate was actually charged vs. displayed), and provider-specific FX-fee handling that isn't worth the complexity at AdmitFlow's current market footprint.

- **`Customer.currency`** is set once, derived from the student's profile locale/country (`09-database-architecture.md`'s `Profile` timezone/locale/currency fields) at the time of their **first** purchase, and is then treated as the customer's billing currency for the life of the account (a `Subscription`, once started in a currency, stays in that currency for its lifetime per Stripe's own constraints — Stripe does not support changing a subscription's currency mid-life without canceling and recreating it).
- **If no `Price` exists in the customer's derived currency**, the checkout flow falls back to a configured default currency (**Decision: EUR**, since AdmitFlow's primary market is European university applications) and displays an explicit "charged in EUR" disclaimer before the student proceeds to the provider's page — never a silent conversion.
- Every `Payment`/`Purchase`/`Subscription`/`Entitlement`-adjacent monetary field stores its own `currency` alongside the `amount`, never inheriting an assumed currency from the customer record, so historical records remain correct even if a customer's profile currency preference changes later.

## 8. Summary of Decisions in This Document

| # | Decision | Rationale (short) |
|---|---|---|
| S1 | No separate `Plan` table — a "plan" is two or more `Price` rows under one `Product` | Avoids a near-duplicate table for negligible added capability at current scale |
| S2 | `Purchase` (one-off) and `Subscription` (recurring) remain distinct tables, not unified | Avoids wide mostly-null tables; each has a genuinely different lifecycle shape |
| S3 | Subscription entitlements are one continuous row per grant, extended on each renewal rather than recreated | Keeps "does this customer have access" a single-row lookup; clean audit trail via `updatedAt`/`version` |
| S4 | `PAST_DUE` grace period = 3 calendar days before entitlement revocation, independent of Stripe's own longer dunning schedule | Bounds free-access risk on a low-value consumer product while giving a real card-update recovery window |
| S5 | Invoicing/receipts delegated entirely to Stripe/PayPal's native hosted documents; we store and surface the URL, never reimplement tax/PDF generation | Avoids duplicating jurisdiction-specific tax compliance |
| S6 | Cancellation defaults to cancel-at-period-end; admin override for immediate cancellation (fraud/ToS) | Matches the refund-revocation philosophy: don't claw back access already paid for, except for risk cases |
| S7 | Upgrades prorate immediately; downgrades apply at period end | Standard, predictable proration behavior; avoids mid-period credit reconciliation on downgrades |
| S8 | No dynamic FX conversion at checkout; multi-currency via explicit per-currency `Price` rows; EUR is the fallback default currency | Avoids FX rate risk and reconciliation ambiguity; matches AdmitFlow's primary market |
