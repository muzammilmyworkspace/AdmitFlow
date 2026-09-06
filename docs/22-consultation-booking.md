# 22 — Consultation Booking Architecture

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering
**Applies to:** Consultant availability, slot reservation, paid booking, meeting-link generation, and cancellation/rescheduling logic

---

## 1. Purpose and Scope

This document defines the full lifecycle of a paid consultation booking: from a consultant publishing availability, through a student reserving and paying for a slot, to the confirmed meeting and its eventual completion or cancellation. It is the concurrency-critical companion to `19-payment-architecture.md` (which governs the payment/webhook mechanics reused here unchanged) and depends on `09-database-architecture.md` §7.3 for the double-booking prevention pattern.

It does not redefine payment/webhook processing — a consultation purchase is simply a `Payment`/`Purchase`/`Entitlement` scoped to a `Booking` (`19-payment-architecture.md` §5.3) — it defines what is specific to booking: reservation, expiry, timezone display, and the booking state machine.

## 2. Data Model

| Entity | Key fields | Notes |
|---|---|---|
| `ConsultantProfile` | `userId`, `timezone` (IANA, e.g. `Europe/Berlin`), `defaultSessionMinutes` (40) | The consultant's own working timezone — availability is authored in this timezone conceptually, stored in UTC. |
| `AvailabilitySlot` | `id`, `consultantId`, `startsAt` (UTC `timestamptz`), `endsAt` (UTC `timestamptz`), `createdAt` | A pre-materialized bookable slot. Slots do not carry a `status` column themselves (see §4 — booking status, not slot status, is the source of truth for occupancy) other than being soft-deletable if a consultant removes unpublished availability. |
| `Booking` | `id`, `studentId`, `slotId`, `status` (§5), `reservedAt`, `reservationExpiresAt`, `paymentId` (nullable until checkout starts), `meetingLink` (nullable until confirmed), `cancelledAt`, `cancelledBy`, `cancellationReason`, `version` (optimistic concurrency, `09-database-architecture.md` §6.4) | One row per booking *attempt* — an expired or cancelled `Booking` does not get reused; a fresh attempt on the same slot is a new `Booking` row. |
| `Entitlement` (`CONSULTATION_SESSION`, scope `BOOKING`) | `scopeId = Booking.id` | Created in the payment webhook transaction, per `19-payment-architecture.md` §5.3. |

## 3. Full Booking Flow

```
1. AVAILABLE SLOTS
   Student browses GET /api/v1/consultations/slots?consultantId=...
   → API returns AvailabilitySlot rows NOT currently held by a RESERVED or
     CONFIRMED Booking, each rendered in the STUDENT's own timezone (§6)

2. STUDENT SELECTS SLOT
   POST /api/v1/consultations/bookings/reserve  { slotId }
   → §4: attempt atomic reservation

3. TEMPORARY RESERVATION (Booking.status = RESERVED, reservationExpiresAt = now()+12min)
   → API returns bookingId + reservationExpiresAt to the client;
     UI shows a countdown ("slot held for 12:00")

4. CHECKOUT
   Student proceeds to pay. POST /api/v1/payments/checkout/{stripe|paypal}
   with scopeType=BOOKING, scopeId=bookingId (19-payment-architecture.md §3)
   → Payment row created PENDING, checkoutExpiresAt = min(30min, reservationExpiresAt)
     (Decision: a booking's checkout can never outlive its own reservation —
     see §4.3)

5. PAYMENT
   Student completes payment on Stripe Checkout / PayPal Approve+Capture

6. WEBHOOK  (19-payment-architecture.md §4 — unmodified)
   Signature verified → WebhookEvent claimed → single transaction:
     Payment.status = SUCCEEDED
     → Purchase created
     → Entitlement (CONSULTATION_SESSION, scope=BOOKING, scopeId=bookingId) created
     → Booking.status: RESERVED → CONFIRMED   (§5 transition table)

7. BOOKING CONFIRMED
   (still inside the same webhook-commit boundary as step 6 — Booking
    confirmation is not a separate transaction; see §4.3)

8. MEETING LINK GENERATED
   After commit: worker job `bookings.generate-meeting-link` enqueued
   → calls the video-conferencing provider integration (§8), writes
     Booking.meetingLink, bumps Booking.version

9. NOTIFICATIONS
   After meeting link is written: worker job sends confirmation email +
   calendar invite (.ics, times embedded per-recipient timezone, §6) to
   both student and consultant; schedules 24h and 1h reminder jobs
   keyed off Booking.slotId's startsAt
```

## 4. Concurrency: Preventing Double-Booking

### 4.1 The Guarantee Is a DB Constraint, Not an Application Check

**Decision:** a partial unique index enforces that at most one `Booking` may hold `RESERVED` or `CONFIRMED` status for a given `slotId` at any time:

```
CREATE UNIQUE INDEX booking_slot_active_unique
  ON "Booking" ("slotId")
  WHERE status IN ('RESERVED', 'CONFIRMED');
```

This is the actual guarantee against two students racing for the same slot — not the "slot appears in the available list" check the frontend already did (which is inherently stale the instant it's rendered). An application-level "check if any active booking exists for this slot, then insert if not" sequence is itself a race (identical reasoning to the `WebhookEvent` idempotency check in `19-payment-architecture.md` §4.3): two concurrent reservation requests could both pass the check before either commits.

### 4.2 Reservation Transaction

```
BEGIN TRANSACTION
  INSERT INTO "Booking" (id, studentId, slotId, status='RESERVED',
                          reservedAt=now(), reservationExpiresAt=now()+'12 minutes')
  -- relies on booking_slot_active_unique to reject a concurrent duplicate
COMMIT
  → success: return bookingId + reservationExpiresAt
  → unique_violation: return 409 Conflict, "this slot was just taken" —
    frontend refreshes the available-slots list
```

This matches `09-database-architecture.md` §7's "Booking → Reservation" mandatory transaction boundary and §7.1's decision to use `SERIALIZABLE`/row-locking specifically for this path (the unique constraint is the backstop; a `SELECT ... FOR UPDATE` on the slot row inside the same transaction, before the insert, is the primary mechanism for well-behaved concurrent requests to fail fast rather than both attempt the insert and rely purely on the constraint to break the tie).

### 4.3 Decision: Reservation Expiry = 12 Minutes

**Decision:** a `RESERVED` booking holds the slot for **12 minutes** (within the 10–15 minute range under consideration). Rationale: long enough to comfortably complete a Stripe Checkout or PayPal Approve flow including a 3DS/SCA challenge or a PayPal login+approve round trip (typically well under 5 minutes end to end), short enough that a student who abandons checkout doesn't lock a popular consultant's slot away from other students for an excessive window. **Decision:** the `Payment.checkoutExpiresAt` for a consultation checkout is capped at `min(30 minutes, reservationExpiresAt)` rather than the usual flat 30 minutes from `19-payment-architecture.md` §7.2 — a payment cannot meaningfully succeed a slot reservation that has already lapsed, so there is no reason to give the payment a longer window than the reservation it depends on.

### 4.4 Auto-Release on Expiry (payment never completes)

If payment is never completed before `reservationExpiresAt`:

```
Background sweep job `bookings.release-expired-reservations`
(BullMQ repeatable job, worker service, every 1 minute — tighter interval
than the payment sweep in 19-payment-architecture.md §7.2, since a stuck
slot reservation is more time-sensitive to other students than a stuck
generic checkout)

  UPDATE "Booking" SET status = 'EXPIRED'
  WHERE status = 'RESERVED' AND reservationExpiresAt < now()

  -- the partial unique index (§4.1) only covers RESERVED/CONFIRMED, so the
  -- moment this UPDATE commits, the slot is implicitly free again — no
  -- separate "release" step on AvailabilitySlot is needed, because
  -- AvailabilitySlot never carried an occupancy flag in the first place (§2)
```

In addition to the periodic sweep (the backstop, matching the same "constraint/sweep as backstop, not the only mechanism" philosophy used for payment expiry), a **precise** BullMQ *delayed* job is also enqueued at reservation-creation time (`delay = 12 minutes`) that performs the same conditional update for that specific `bookingId` — this gives near-immediate release in the common case (freeing the slot for other students within seconds of expiry, not up to a full sweep-interval late) while the periodic sweep guarantees eventual correctness even if a delayed job is lost (worker restart, Redis eviction under memory pressure, etc.). Same edge case as `19-payment-architecture.md` §7.2 applies here: if a payment webhook confirms success for a `Booking` already marked `EXPIRED` by this sweep, the webhook transaction still honors it — reactivating the booking to `CONFIRMED` and generating the meeting link — logging a warning for ops, rather than accepting the student's money while denying the booking.

## 5. Booking State Machine

### 5.1 States

`RESERVED` → `CONFIRMED` → `COMPLETED` / `CANCELLED` / `EXPIRED` / `NO_SHOW`

### 5.2 Transition Table

| From | To | Trigger | Actor |
|---|---|---|---|
| *(none)* | `RESERVED` | Slot reservation request succeeds (§4.2) | Student |
| `RESERVED` | `CONFIRMED` | Payment webhook success (§3 step 6) | System (webhook) |
| `RESERVED` | `EXPIRED` | `reservationExpiresAt` elapses with no successful payment (§4.4) | System (scheduled job) |
| `RESERVED` | `CANCELLED` | Student explicitly cancels before paying | Student |
| `CONFIRMED` | `CANCELLED` | Cancellation within policy (§9) by student or consultant, or admin override | Student / Consultant / Admin |
| `CONFIRMED` | `COMPLETED` | Session end time passes and consultant marks it held (or auto-marked complete if not disputed within 24h — §5.3) | Consultant / System |
| `CONFIRMED` | `NO_SHOW` | Consultant marks student absent after the grace period (§9.3) | Consultant |
| `CONFIRMED` | `RESERVED` (new `Booking` row, not a reverse transition) | Reschedule (§9.2) — modeled as cancel-original + reserve-new, never an in-place mutation of `startsAt` | Student |

**Decision:** a reschedule is never an in-place update of an existing `Booking`'s slot — it is a `CANCELLED` transition on the old `Booking` plus a fresh `RESERVED` booking (and, if within the payment's already-succeeded window, the original `Entitlement`/`Payment` is re-scoped to the new `Booking.id` rather than requiring a new payment — see §9.2). Rationale: preserves a clean, append-only audit trail of what was actually booked and when, consistent with `09-database-architecture.md`'s soft-delete/history philosophy — an in-place slot mutation would destroy the record of what the original confirmed time actually was.

### 5.3 `CONFIRMED` → `COMPLETED` Mechanics

A scheduled worker job (`bookings.auto-complete`) runs after each slot's `endsAt` + a fixed buffer (2 hours) and transitions any still-`CONFIRMED` booking with no consultant-entered `NO_SHOW` to `COMPLETED` automatically — the consultant is not required to take an explicit action for the common "session happened normally" case; they only need to act when marking a `NO_SHOW` (§9.3) or filing a dispute.

## 6. Timezone Handling

**Rule (restated from `09-database-architecture.md` §6.1):** `AvailabilitySlot.startsAt`/`endsAt` and every `Booking` timestamp are stored in UTC. Display conversion happens only at the presentation layer, using the viewer's own timezone — a consultant and a student looking at the *same* `Booking` see two different rendered times, both correct.

### 6.1 Concrete Example

A single stored slot: `startsAt = 2026-09-10T14:00:00Z` (UTC), 40 minutes.

| Viewer | Profile timezone | Rendered as |
|---|---|---|
| Consultant | `Europe/Berlin` (CEST, UTC+2 in September) | **Thursday, 10 Sep 2026, 16:00–16:40 CEST** |
| Student | `Asia/Karachi` (PKT, UTC+5) | **Thursday, 10 Sep 2026, 19:00–19:40 PKT** |
| Student (different case) | `America/New_York` (EDT, UTC-4) | **Thursday, 10 Sep 2026, 10:00–10:40 EDT** |

The consultant's `ConsultantProfile.timezone` governs how *they* author/view availability (e.g. a recurring-availability UI that says "I'm free 9am–5pm Berlin time on weekdays" is translated to UTC `AvailabilitySlot` rows at creation time); the viewing student's `Profile.timezone`/locale (`09-database-architecture.md`'s user profile fields) governs how the same UTC row is rendered to them. Neither party's UI ever displays a raw UTC timestamp.

### 6.2 Calendar Invites

The `.ics` file generated per booking (§3 step 9) encodes the event in UTC (`DTSTART`/`DTEND` with a `Z` suffix) so that each recipient's own calendar client renders it in their own configured timezone automatically — we do not generate two different `.ics` files per recipient timezone; UTC-encoded `.ics` is the standard-compliant way to make this a non-issue.

## 7. Meeting Link Generation

**Decision:** meeting-link creation is abstracted behind an internal `VideoConferenceProvider` interface (conceptually: `createMeeting(bookingId, startsAt, durationMinutes, hostEmail, guestEmail) → { joinUrl, hostUrl? }`), called from the worker job in §3 step 8 — **not** the webhook handler itself, keeping the webhook path fast per `19-payment-architecture.md` §4.5's "only slow side effects are queued" rule (an external video-API call is exactly the kind of I/O that must not run inline in the webhook transaction).

No specific vendor is treated as load-bearing in this document or in the `Booking` schema — `Booking.meetingLink` is a plain URL column, and `Booking.meetingProvider` records which integration produced it (e.g. a configured value like `GOOGLE_MEET`/`ZOOM`/`WHEREBY`), so the vendor can be swapped by changing the `VideoConferenceProvider` implementation without a schema or state-machine change. If meeting-link generation fails (provider API error), the worker job retries with backoff (same BullMQ retry convention as every other worker job, `06-system-architecture.md` §4); the `Booking` remains `CONFIRMED` with `meetingLink = null` in the interim, and the confirmation notification (§3 step 9) is held until the link exists — a booking is never confirmed-and-notified without a working meeting link, since retrying link generation is cheap and fast compared to the alternative of sending a broken invite.

## 8. Notifications and Reminders

| Trigger | Recipients | Timing |
|---|---|---|
| Booking confirmed + meeting link ready | Student, Consultant | Immediately after link generation (§3 step 9) |
| Reminder | Student, Consultant | 24 hours before `startsAt`, and again 1 hour before `startsAt` (both scheduled as delayed BullMQ jobs at confirmation time, keyed off the slot's `startsAt`, cancelled/rescheduled if the booking is cancelled/rescheduled before firing) |
| Cancellation | Student, Consultant (whichever did not initiate it) | Immediately on `CANCELLED` transition |
| No-show recorded | Student | Immediately, with the applicable refund/policy outcome (§9.3) stated in the notification |

## 9. Cancellation and Rescheduling Policy

### 9.1 Decision: Free Cancellation/Reschedule Up to 12 Hours Before

**Decision:** a student may cancel or reschedule a `CONFIRMED` booking free of charge (full refund on cancellation; no fee on reschedule) up until **12 hours before** the slot's `startsAt`. Inside that 12-hour window, a student-initiated cancellation or reschedule forfeits the session fee (no refund) except in the consultant-fault cases below.

Rationale: 12 hours gives the consultant enough lead time to potentially re-fill the slot from their available-slots pool (a same-day scheduling change is rarely re-fillable, but a next-day one often is) while still being generous enough that a student with a genuine short-notice conflict (up to half a day out) isn't unfairly penalized. This is a deliberately simpler cutoff than tiered refund percentages (e.g. 100%/50%/0% at different windows) — a single hard cutoff is easier for students to understand and for support/admin staff to apply consistently without judgment calls, which matters given refunds are otherwise an admin-judgment action (`19-payment-architecture.md` §6.1).

### 9.2 Reschedule Mechanics

A reschedule inside the free window: `CONFIRMED` → `CANCELLED` (reason: `RESCHEDULED`) on the original `Booking`, then a new `RESERVED` booking against the newly chosen slot (§4.2's normal reservation flow) — but **Decision:** because the student already has a valid `Entitlement` (`CONSULTATION_SESSION`, scoped to the *old* `Booking.id`), completing the new reservation within the same flow re-scopes that entitlement (`scopeId` updated from old to new `Booking.id`) rather than requiring a second payment, provided the new booking reaches `CONFIRMED` before the old reservation's own audit trail is closed out. This is the one case in the entire system where an `Entitlement.scopeId` is mutated after creation — it is treated as a rescope, not a new grant, and is itself an audited action (actor = the reschedule request, not a person, logged to `AuditLog` for traceability). A reschedule requested inside the 12-hour cutoff is treated identically to a cancellation for fee purposes (forfeits the fee, requires a fresh payment for the new slot) unless a consultant-fault exception (§9.3) applies.

### 9.3 No-Show Handling

| Scenario | Policy |
|---|---|
| Student does not join within a grace period (**decision: 10 minutes** into the scheduled start) | Consultant marks `NO_SHOW`. **No refund**, entitlement remains consumed (not revoked — the consultant held the slot as agreed). |
| Consultant does not join within the same 10-minute grace period | Student (or the consultant themselves, or an admin on review) flags it; **Decision: automatic full refund** (triggers the standard admin-initiated refund flow, `19-payment-architecture.md` §6, fast-tracked for this cause) plus priority rebooking (the student's next reservation attempt against that consultant is exempted from the normal slot-availability race for a short window — an operational nicety, not a schema requirement). |
| Consultant-initiated cancellation for any reason inside the 12-hour window | Treated as consultant-fault: full refund regardless of the 12-hour cutoff (the cutoff only constrains *student*-initiated changes) and no entitlement forfeiture. |

Admins retain override authority over any cancellation/refund outcome in this section, consistent with `19-payment-architecture.md` §6.1's stance that refunds are always an auditable admin-permissioned action, not a fully automated rule engine — the automatic-refund cases above are the fast-tracked/pre-approved subset of that same admin action, not a separate code path that bypasses the `AuditLog` requirement.

## 10. Summary of Decisions in This Document

| # | Decision | Rationale (short) |
|---|---|---|
| C1 | Double-booking prevented by a partial unique index on `Booking(slotId)` WHERE status IN (RESERVED, CONFIRMED), backed by `SELECT ... FOR UPDATE` in the reservation transaction | The constraint, not an application check, is the actual guarantee |
| C2 | `AvailabilitySlot` carries no occupancy status column — occupancy is entirely derived from active `Booking` rows | Avoids two sources of truth for "is this slot taken" |
| C3 | Reservation expiry = 12 minutes | Long enough for a normal checkout incl. 3DS/PayPal approval; short enough to keep popular slots liquid |
| C4 | Consultation `Payment.checkoutExpiresAt` capped at the reservation's own expiry, not the flat 30-minute default | A payment cannot outlive the reservation it depends on |
| C5 | Expired reservations auto-release via both a precise delayed job (per-booking) and a 1-minute periodic sweep (backstop) | Fast release in the common case; correctness guaranteed even if the delayed job is lost |
| C6 | Late-arriving success webhook for an already-`EXPIRED` booking still confirms it | Never refuse a confirmed booking for money actually captured |
| C7 | Reschedule modeled as cancel-original + reserve-new (never in-place mutation), with entitlement rescoped rather than re-purchased | Preserves audit trail; avoids double-charging for a like-for-like time change |
| C8 | Meeting-link generation happens in a worker job, abstracted behind a `VideoConferenceProvider` interface; confirmation notification withheld until the link exists | Keeps the webhook path fast; never sends a broken meeting invite; vendor stays swappable |
| C9 | Free cancellation/reschedule cutoff = 12 hours before start; inside the window, student-initiated changes forfeit the fee | Simple, consistently applicable cutoff; balances re-fill lead time against student flexibility |
| C10 | No-show grace period = 10 minutes; student no-show forfeits the fee, consultant no-show triggers an automatic full refund + priority rebooking | Symmetric accountability for both sides of the session |
