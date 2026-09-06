# 48 — Idempotency

**Document status:** Foundational — v1.0
**Depends on:** `11-api-architecture.md`, `12-api-contracts.md`, `14-security-architecture.md`
**Read alongside:** `47-rate-limiting.md`

---

## 1. Purpose

This document specifies two related-but-distinct idempotency mechanisms AdmitFlow relies on:

1. **Client-supplied `Idempotency-Key`** for mutating endpoints prone to duplicate submission from the browser (double-click, retry-on-timeout, two open tabs).
2. **Server-side webhook deduplication** via a `WebhookEvent` table, which is the mechanism that makes the non-negotiable "payment success is never trusted from the client" rule (`14-security-architecture.md` §15) safe to implement without ever double-granting an entitlement when a provider redelivers the same event.

These are not interchangeable: the `Idempotency-Key` pattern protects one client's retries of *its own* request; the `WebhookEvent` pattern protects against a provider redelivering the *same event* (by design — both Stripe and PayPal explicitly document that webhook delivery is at-least-once, not exactly-once). §5 covers the double-submit UI scenarios explicitly, including the cases where neither mechanism alone is sufficient and a database constraint is the real guarantee.

## 2. Client-Supplied `Idempotency-Key`

### 2.1 Applies to

Per `12-api-contracts.md`: `POST /billing/checkout-session` (required), `POST /consultation/bookings` (required), `POST /applications/:id/submit` (required), `POST /applications` (supported), `POST /assessment/run` (supported). "Required" means the endpoint returns `400 VALIDATION_ERROR` if the header is absent; "supported" means the endpoint behaves idempotently if the header is present but does not mandate it, because a missing key there degrades to "worst case, a harmless duplicate resource" rather than "worst case, a double charge or double booking."

### 2.2 Client behavior

- The client generates a UUIDv4 **once per logical user action** — e.g., once when the "Pay" button is first rendered/clicked, stored in component state — and reuses that same value for every retry of that same action (network timeout, explicit "try again" click bound to the same in-flight action). A **new** user-initiated action (the user navigates away and starts a fresh checkout later) generates a **new** key. The client is responsible for this scoping; the server cannot infer "same logical action" on its own.
- Sent as the `Idempotency-Key` request header.

### 2.3 Server behavior

- Storage: an `IdempotencyKey` record keyed by `hash(userId + endpoint + idempotencyKey)` — composing the key with `userId` and `endpoint` is deliberate: a key value is scoped to one user and one endpoint, so a coincidental key collision from a different user or a different endpoint can never replay an unrelated response. Stored fields: `requestHash` (hash of the normalized request body, so a reused key with a *different* payload can be detected), `responseStatus`, `responseBody`, `createdAt`, `expiresAt`.
- **First request with a given key:** processed normally; on completion, the response (status + body) is stored against the key before being returned to the client.
- **Duplicate request, same key, same `requestHash`:** the stored response is replayed verbatim (same status code, same body, including the original `201`/resource id) — the underlying operation is **not** re-executed. This is what makes triple-clicking "Pay" resolve to one Stripe Checkout Session rather than three.
- **Duplicate request, same key, different `requestHash`:** rejected with `409 CONFLICT`, code `IDEMPOTENCY_KEY_REUSED` — this indicates a client bug (reusing a key across two genuinely different requests), not a legitimate retry, and is never silently processed as either the old or the new payload.
- **Concurrent duplicate (the second request arrives while the first is still in flight, before a response is stored):** the key-insert step uses a unique constraint on the storage key, so the second concurrent writer fails the insert; that request is held/retried briefly against the store (short bounded wait) and, if the first request's result becomes available within that window, replays it — otherwise returns `409 CONFLICT` (`IDEMPOTENCY_KEY_IN_PROGRESS`) rather than proceeding to execute the operation twice. The critical property is that **the underlying business operation itself is never invoked twice concurrently for the same key**, whether that's enforced via this table's unique constraint, an advisory lock, or (for endpoints where it exists) the resource-level unique constraint from §5.
- **TTL:** 24 hours from `createdAt`. This is long enough to cover any realistic client retry window (including "user closed the tab and reopened it a few minutes later") without keeping the table growing unbounded; a key reused after expiry starts a fresh operation, which is an accepted, documented trade-off — 24 hours of client-side key stability is expected UX behavior, not a guarantee extending indefinitely.

## 3. Webhook Idempotency (`WebhookEvent`)

### 3.1 Schema

```
WebhookEvent(
  id,
  provider            -- 'STRIPE' | 'PAYPAL'
  providerEventId     -- the provider's own event id (Stripe: evt_..., PayPal: resource/event id)
  payloadHash
  receivedAt
  processedAt
  status              -- 'RECEIVED' | 'PROCESSED' | 'FAILED'
  UNIQUE (provider, providerEventId)
)
```

### 3.2 Processing sequence (Stripe and PayPal alike)

1. Verify the provider's cryptographic signature (`14-security-architecture.md` §11). **Invalid signature → reject before step 2, nothing written.**
2. Begin a database transaction.
3. Insert into `WebhookEvent` on `(provider, providerEventId)`. If the unique constraint is violated (this event id has been seen before — a redelivery), **catch the conflict, roll back to a no-op, and return `200` immediately** without touching `Purchase`/`Entitlement` tables at all. This is the entire dedup mechanism: redelivery is detected at the database level via a real constraint, not via an application-level "have I seen this before" cache that could itself be inconsistent under concurrency.
4. If the insert succeeded (genuinely new event): update the corresponding `Purchase` to `COMPLETED` and grant the `Entitlement` row(s) **inside the same transaction** as the `WebhookEvent` insert.
5. Commit. Mark `WebhookEvent.status = 'PROCESSED'` (same transaction) and `processedAt = now()`.
6. Return `200` to the provider.

**Why the insert and the entitlement grant must be one transaction:** if they were separate operations, a crash between "insert WebhookEvent" and "grant entitlement" would leave the event marked as seen forever while the entitlement was never actually granted — a silent, permanent failure that looks identical to a successful duplicate-suppression from the outside. Doing both in one transaction means either both happen or neither does, and a crash mid-transaction simply results in the provider's automatic redelivery retry finding no `WebhookEvent` row yet and processing normally.

### 3.3 Failure handling

- If step 4 (business logic) throws after the `WebhookEvent` insert but the transaction hasn't committed, the whole transaction rolls back — including the insert — so the event is *not* marked as seen, and the provider's redelivery will be processed as a fresh attempt. This is intentional: a failed grant should be retried by the next redelivery, not permanently swallowed because "we already saw this event id."
- If processing repeatedly fails (a bug, a downstream outage), `WebhookEvent` rows accumulate as never successfully inserted-and-committed (because of the rollback above) — genuine processing failures are visible in error monitoring/logs (tagged with `requestId` per `11-api-architecture.md` §9) rather than hidden behind an "already processed" no-op.

## 4. Double-Submit UI Cases (Explicit)

| Case | What actually prevents the duplicate effect | Idempotency-Key's role |
|---|---|---|
| **Double-click "Pay"** | The `Idempotency-Key` replay mechanism (§2.3) — same key, same payload, same response replayed; only one Stripe/PayPal Checkout Session is ever created. | Primary guard. |
| **Two open tabs both submitting the same application** | The **application state-machine transition itself** (`31-state-machines.md` §3, transition P6): `POST /applications/:id/submit` executes a conditional update `WHERE id=? AND status='READY_TO_SUBMIT'`. The first tab's request flips `READY_TO_SUBMIT → SUBMITTED` and affects one row; the second tab's request (even with a *different* `Idempotency-Key`, since it's a separate browser context that never shared client state with the first tab) matches zero rows and returns `409 CONFLICT` (`ALREADY_SUBMITTED`) with the current, already-submitted application state — a safe, non-destructive outcome even though the two tabs never coordinated on an idempotency key. | Backstop only for retries *within* one tab; the cross-tab case is solved by the DB-level conditional state transition, not by idempotency keys, since two tabs cannot be expected to share a client-generated key. |
| **Duplicate webhook delivery (Stripe/PayPal redelivers the same event)** | `WebhookEvent` unique constraint on `(provider, providerEventId)` (§3) — the second delivery's insert conflicts and the handler no-ops, returning `200` without re-granting. | Not applicable — this is a server-to-server case with no client-supplied key; §3's mechanism is the complete answer here. |
| **Concurrent booking of the same consultation slot (two different students, two different requests, genuinely simultaneous)** | Per the canonical Booking state machine (`31-state-machines.md` §5, transition B2) and `09-database-architecture.md` §7.3: a `SELECT ... FOR UPDATE` row lock on the target `AvailabilitySlot` inside a transaction is the **primary** guard (whichever request acquires the lock first verifies the slot is still `AVAILABLE` and inserts the `Booking` as `RESERVED`; the second request's lock-wait resolves against the now-changed state and it is rejected before it can insert). A DB-level unique constraint — `UNIQUE (consultantId, startsAt)` or `slotId`, scoped to non-terminal booking statuses — is the **backstop** that still holds even if the transactional lock path has a bug. Either way, the loser receives `409 CONFLICT` (`SLOT_ALREADY_TAKEN`), regardless of idempotency keys, because the two requests come from two different users who by definition cannot share one. | Idempotency-Key on `POST /consultation/bookings` remains useful as the UX-level backstop for *one* student's own double-click on the same slot (same key replays the same booking attempt/response), but it is explicitly **not** the mechanism that adjudicates two different students racing for one slot — the transactional row lock (backed by the unique constraint) is. |

**Decision, stated generally:** wherever two *different* actors could race for the same exclusive resource (a slot, a submission transition, a webhook event id), the real correctness guarantee is a **database-level transactional lock, uniqueness, or conditional-update constraint**, because idempotency keys are scoped to a single client/actor and cannot coordinate across two independent callers. `Idempotency-Key` is the right tool for "protect one actor's own retries from creating duplicates"; a DB constraint is the right tool for "prevent two different actors from both succeeding at something only one of them should be able to do." Every mutating endpoint in `12-api-contracts.md` that faces a genuine multi-actor race (bookings, application submission, webhook processing) is built on the latter; `Idempotency-Key` is layered on top for the single-actor UX case, not relied upon as the multi-actor guarantee.

## 5. Related Documents

- `12-api-contracts.md` §9–11 — endpoint-level `Idempotency-Key: required/supported` markers and the underlying state-transition/constraint behavior referenced here
- `14-security-architecture.md` §11, §15 — webhook signature verification and the payment-trust non-negotiable this mechanism implements
- `47-rate-limiting.md` — the volume-layer control this document's correctness-layer controls are paired with
