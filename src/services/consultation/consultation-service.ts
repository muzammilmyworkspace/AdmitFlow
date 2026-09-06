import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getEnv } from "@/lib/env";
import { writeAuditLog } from "@/lib/audit";
import type { Prisma } from "../../../prisma/generated/client";

// Consultation booking — docs/22-consultation-booking.md, docs/31-state-machines.md §4.
//
// Invariants this module enforces:
//   * at most one live claim per AvailabilitySlot, guaranteed by the Booking.slotId
//     unique constraint rather than by an application-level check-then-insert
//   * every timestamp read or written here is UTC; no local time is ever stored
//   * a student only ever reaches their own Booking rows — the caller's userId is part
//     of the WHERE clause, never a post-fetch comparison
//   * every status transition writes an AuditLog row in the same transaction

/** docs/22 §4.3 (C3) — long enough for 3DS/PayPal approval, short enough to keep slots liquid. */
const HOLD_MINUTES = 12;

/** docs/22 §9.1 (C9) — inside this window a cancellation is allowed but flagged as late. */
const FREE_CANCELLATION_HOURS = 12;

const MAX_SLOTS_RETURNED = 200;
const MAX_HOLDS_RELEASED_PER_SWEEP = 500;

/**
 * The single seam for video-conferencing.
 *
 * No vendor has been chosen — docs/55-known-risks-and-open-questions.md I-2 tracks this as
 * an open decision, and docs/22 §7 (C8) requires the choice to stay swappable without a
 * schema or state-machine change. Until a provider is selected this returns a deterministic
 * in-product room URL: deterministic so a retried confirmation cannot produce two different
 * links for one booking. Swapping to Zoom/Meet/Whereby means replacing this function body
 * (and awaiting it) — nothing else in the booking flow needs to change.
 */
export function generateMeetingLink(bookingId: string): string {
  return `${getEnv().NEXT_PUBLIC_APP_URL}/consultations/meet/${bookingId}`;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

/**
 * Queues one QUEUED Notification per channel the event has a template for.
 *
 * Templates are environment-provisioned rows keyed `EVENT:CHANNEL` (prisma/seed-notifications.ts,
 * docs/23-notification-system.md), not code — so which channels fire is a data decision. A
 * booking must never fail to confirm or cancel because a template row is missing, so an
 * unprovisioned event is logged loudly and skipped rather than thrown.
 */
async function queueNotification(
  params: { userId: string; event: string; metadata: Prisma.InputJsonValue },
  client: Prisma.TransactionClient | typeof db,
): Promise<void> {
  const templates = await client.notificationTemplate.findMany({
    where: { key: { startsWith: `${params.event}:` }, isActive: true },
    orderBy: { version: "desc" },
  });
  if (templates.length === 0) {
    logger.warn("No notification template is provisioned for this event; notification skipped", {
      service: "consultation",
      operation: "queueNotification",
      event: params.event,
    });
    return;
  }

  const seenChannels = new Set<string>();
  for (const template of templates) {
    if (seenChannels.has(template.channel)) continue;
    seenChannels.add(template.channel);
    await client.notification.create({
      data: {
        userId: params.userId,
        templateId: template.id,
        channel: template.channel,
        status: "QUEUED",
        metadata: params.metadata,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Hold expiry
// ---------------------------------------------------------------------------

/**
 * Releases one expired hold. Returns false when the row was already moved on by a
 * concurrent confirmation or another sweep.
 *
 * The `status`/`holdExpiresAt` predicate is re-evaluated by the database as part of the
 * UPDATE, so a webhook confirming this booking at the same instant either wins the row
 * lock (and this returns false) or loses it (and confirms a booking this call already
 * released — handled by confirmBookingFromPayment's CANCELED path, docs/22 §4.4 C6).
 */
async function releaseHold(bookingId: string, slotId: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const released = await tx.booking.updateMany({
      where: { id: bookingId, status: "HELD", holdExpiresAt: { lt: new Date() } },
      data: { status: "CANCELED", holdExpiresAt: null, version: { increment: 1 } },
    });
    if (released.count === 0) return false;

    await tx.availabilitySlot.updateMany({
      where: { id: slotId, status: "HELD" },
      data: { status: "OPEN", version: { increment: 1 } },
    });
    await writeAuditLog(
      {
        actorId: null,
        actorType: "SYSTEM",
        action: "booking.cancelled",
        entityType: "Booking",
        entityId: bookingId,
        metadata: { reason: "HOLD_EXPIRED", slotId },
      },
      tx,
    );
    return true;
  });
}

/**
 * Sweeps every lapsed hold back to an open slot — the backstop called by the scheduled
 * job (docs/22 §4.4 C5). Correctness does not depend on this running: the booking path
 * releases a slot's own expired hold inline, so an abandoned checkout cannot block a slot
 * even while the job is down.
 */
export async function releaseExpiredHolds(): Promise<{ released: number }> {
  const expired = await db.booking.findMany({
    where: { status: "HELD", holdExpiresAt: { lt: new Date() } },
    select: { id: true, slotId: true },
    take: MAX_HOLDS_RELEASED_PER_SWEEP,
  });

  let released = 0;
  for (const booking of expired) {
    if (await releaseHold(booking.id, booking.slotId)) released += 1;
  }
  if (released > 0) {
    logger.info("Expired consultation holds released", {
      service: "consultation",
      operation: "releaseExpiredHolds",
      released,
    });
  }
  return { released };
}

async function releaseExpiredHoldForSlot(slotId: string): Promise<void> {
  const expired = await db.booking.findFirst({
    where: { slotId, status: "HELD", holdExpiresAt: { lt: new Date() } },
    select: { id: true },
  });
  if (expired) await releaseHold(expired.id, slotId);
}

// ---------------------------------------------------------------------------
// Slot listing
// ---------------------------------------------------------------------------

export interface SlotQuery {
  consultantId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

/**
 * Lists bookable slots.
 *
 * Timezone: raw UTC ISO instants are returned alongside the literal `timezone: "UTC"`,
 * and localization happens in the client from the viewer's own `Intl` resolved timezone.
 * That is the simpler correct option here because neither `Profile` nor `Consultant`
 * carries an IANA timezone column, and the only `timezone` in the schema (`City.timezone`)
 * belongs to campus geography and is not reachable from a consultant — inventing a
 * consultant timezone from campus data would be a guess presented as fact. An unqualified
 * instant is never ambiguous; a rendered local time without a zone would be (docs/22 §6).
 */
export async function listAvailableSlots(query: SlotQuery = {}) {
  const now = new Date();
  const from = query.from && query.from > now ? query.from : now;
  const take = Math.min(Math.max(query.limit ?? 100, 1), MAX_SLOTS_RETURNED);

  const slots = await db.availabilitySlot.findMany({
    where: {
      consultantId: query.consultantId,
      startsAt: { gt: from, ...(query.to ? { lt: query.to } : {}) },
      consultant: { isAcceptingBookings: true, deletedAt: null },
      // A slot is bookable when it is OPEN, or when it is HELD by a reservation that has
      // already lapsed — the sweep may not have run yet, and a student should never be
      // shown a stale "unavailable" for a slot the very next booking attempt would free.
      OR: [
        { status: "OPEN" },
        { status: "HELD", booking: { status: "HELD", holdExpiresAt: { lt: now } } },
      ],
    },
    orderBy: { startsAt: "asc" },
    take,
    include: {
      consultant: {
        include: { user: { include: { profile: true } } },
      },
    },
  });

  return {
    timezone: "UTC",
    slots: slots.map((slot) => ({
      id: slot.id,
      consultantId: slot.consultantId,
      consultantName: slot.consultant.user.profile
        ? `${slot.consultant.user.profile.firstName} ${slot.consultant.user.profile.lastName}`
        : slot.consultant.user.email,
      specialties: slot.consultant.specialties,
      startsAtUtc: slot.startsAt.toISOString(),
      endsAtUtc: slot.endsAt.toISOString(),
      durationMinutes: Math.round((slot.endsAt.getTime() - slot.startsAt.getTime()) / 60000),
    })),
  };
}

// ---------------------------------------------------------------------------
// Reservation
// ---------------------------------------------------------------------------

interface HoldResult {
  bookingId: string;
  slotId: string;
  consultantId: string;
  status: "HELD";
  holdExpiresAtUtc: string;
  holdMinutes: number;
  startsAtUtc: string;
  endsAtUtc: string;
  timezone: "UTC";
}

async function loadBookableSlot(tx: Prisma.TransactionClient, slotId: string) {
  const slot = await tx.availabilitySlot.findUnique({
    where: { id: slotId },
    include: { consultant: true },
  });
  if (!slot) throw new AppError("RESOURCE_NOT_FOUND", "That slot is no longer available.");
  if (slot.status === "CANCELED") {
    throw new AppError("RESOURCE_NOT_FOUND", "That slot is no longer available.");
  }
  if (slot.startsAt.getTime() <= Date.now()) {
    throw new AppError("CONFLICT", "That slot has already started.");
  }
  if (slot.consultant.deletedAt || !slot.consultant.isAcceptingBookings) {
    throw new AppError("CONFLICT", "This consultant is not currently accepting bookings.");
  }
  return slot;
}

/**
 * Marks the slot itself HELD and records the transition.
 *
 * The slot update is guarded on its own status: if a concurrent request already moved the
 * slot to BOOKED the guarded update matches nothing, and throwing here rolls the whole
 * reservation back rather than leaving a Booking pointing at a slot someone else owns.
 */
async function completeHold(
  tx: Prisma.TransactionClient,
  params: {
    bookingId: string;
    slotId: string;
    userId: string;
    consultantId: string;
    startsAt: Date;
    endsAt: Date;
    holdExpiresAt: Date;
  },
): Promise<HoldResult> {
  const slotHeld = await tx.availabilitySlot.updateMany({
    where: { id: params.slotId, status: { in: ["OPEN", "HELD"] } },
    data: { status: "HELD", version: { increment: 1 } },
  });
  if (slotHeld.count === 0) {
    throw new AppError("BOOKING_SLOT_TAKEN", "That slot was just taken. Please pick another.");
  }

  await writeAuditLog(
    {
      actorId: params.userId,
      actorType: "STUDENT",
      action: "booking.created",
      entityType: "Booking",
      entityId: params.bookingId,
      metadata: {
        slotId: params.slotId,
        consultantId: params.consultantId,
        status: "HELD",
        holdExpiresAt: params.holdExpiresAt.toISOString(),
      },
    },
    tx,
  );

  return {
    bookingId: params.bookingId,
    slotId: params.slotId,
    consultantId: params.consultantId,
    status: "HELD",
    holdExpiresAtUtc: params.holdExpiresAt.toISOString(),
    holdMinutes: HOLD_MINUTES,
    startsAtUtc: params.startsAt.toISOString(),
    endsAtUtc: params.endsAt.toISOString(),
    timezone: "UTC",
  };
}

/**
 * Places a temporary reservation on a slot — docs/31 §4 B2, docs/22 §4.2.
 *
 * The guarantee against two students racing for one slot is the `Booking.slotId` unique
 * constraint, not any check this code performs: the INSERT is attempted unconditionally and
 * the loser is told the slot is taken. A "does an active booking exist?" query followed by
 * an insert is itself a race — both requests can pass the check before either commits.
 */
export async function createBookingHold(params: {
  userId: string;
  slotId: string;
}): Promise<HoldResult> {
  // Opportunistic release, so an abandoned checkout cannot hold a slot past its expiry
  // even when the scheduled sweep is not running.
  await releaseExpiredHoldForSlot(params.slotId);

  const holdExpiresAt = new Date(Date.now() + HOLD_MINUTES * 60 * 1000);

  try {
    return await db.$transaction(async (tx) => {
      const slot = await loadBookableSlot(tx, params.slotId);
      const booking = await tx.booking.create({
        data: {
          slotId: slot.id,
          studentId: params.userId,
          consultantId: slot.consultantId,
          status: "HELD",
          holdExpiresAt,
        },
      });
      return completeHold(tx, {
        bookingId: booking.id,
        slotId: slot.id,
        userId: params.userId,
        consultantId: slot.consultantId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        holdExpiresAt,
      });
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    // Postgres aborts a transaction on a constraint violation, so the reclaim below cannot
    // run inside the transaction that hit P2002 — it is a fresh, separately-guarded attempt.
    return reclaimCanceledBooking({ ...params, holdExpiresAt });
  }
}

/**
 * Second reservation attempt, for a slot whose only Booking row is CANCELED.
 *
 * `Booking.slotId` is a plain unique column, so the row left behind by a cancelled or
 * expired reservation would otherwise make that slot permanently unbookable. Rather than
 * weaken the constraint that provides the double-booking guarantee, the dead row is
 * reclaimed in place. The reclaim is a conditional UPDATE on `status = 'CANCELED'`: two
 * students racing to reclaim the same row serialize on its row lock, and the second one
 * re-evaluates the predicate after the first commits, matches nothing, and is refused.
 */
async function reclaimCanceledBooking(params: {
  userId: string;
  slotId: string;
  holdExpiresAt: Date;
}): Promise<HoldResult> {
  return db.$transaction(async (tx) => {
    const slot = await loadBookableSlot(tx, params.slotId);

    const reclaimed = await tx.booking.updateMany({
      where: { slotId: slot.id, status: "CANCELED" },
      data: {
        studentId: params.userId,
        consultantId: slot.consultantId,
        status: "HELD",
        holdExpiresAt: params.holdExpiresAt,
        meetingLink: null,
        version: { increment: 1 },
      },
    });
    if (reclaimed.count === 0) {
      // Distinguish "someone else has it" from "you already have it" — the second is a
      // double-click, and telling that student the slot was taken would be false.
      const holder = await tx.booking.findUnique({
        where: { slotId: slot.id },
        select: { studentId: true },
      });
      if (holder?.studentId === params.userId) {
        throw new AppError("CONFLICT", "You already have a reservation for this slot.");
      }
      throw new AppError("BOOKING_SLOT_TAKEN", "That slot was just taken. Please pick another.");
    }

    const booking = await tx.booking.findUniqueOrThrow({ where: { slotId: slot.id } });
    return completeHold(tx, {
      bookingId: booking.id,
      slotId: slot.id,
      userId: params.userId,
      consultantId: slot.consultantId,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      holdExpiresAt: params.holdExpiresAt,
    });
  });
}

// ---------------------------------------------------------------------------
// Confirmation (payment webhook path)
// ---------------------------------------------------------------------------

/**
 * HELD → CONFIRMED — docs/31 §4 B5. Called from the billing webhook once payment settles.
 *
 * `expectedStudentId` is optional but should always be supplied by the webhook: because a
 * cancelled Booking row is reclaimed in place by the next student (see
 * reclaimCanceledBooking), a bookingId alone can no longer prove which student the row
 * currently belongs to. Passing the payer closes that window.
 *
 * A booking already CANCELED by hold expiry is still honoured (docs/22 §4.4 C6): the money
 * was captured, so the slot is granted and the lapse is logged for ops rather than the
 * student being charged for a booking we refuse.
 */
export async function confirmBookingFromPayment(bookingId: string, expectedStudentId?: string) {
  return db.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: { slot: true },
    });
    if (!booking) throw new AppError("RESOURCE_NOT_FOUND", "Booking not found.");
    if (expectedStudentId && booking.studentId !== expectedStudentId) {
      throw new AppError(
        "CONFLICT",
        "This booking is no longer held by the paying student. The payment requires a refund.",
      );
    }

    // Webhook redelivery — docs/48-idempotency.md. Already confirmed is a no-op success.
    if (booking.status === "CONFIRMED") {
      return {
        bookingId: booking.id,
        status: "CONFIRMED" as const,
        meetingLink: booking.meetingLink,
        alreadyConfirmed: true,
      };
    }
    if (booking.status !== "HELD" && booking.status !== "CANCELED") {
      throw new AppError("CONFLICT", "This booking can no longer be confirmed.");
    }
    if (booking.status === "CANCELED") {
      logger.warn("Confirming a booking whose hold had already lapsed", {
        service: "consultation",
        operation: "confirmBookingFromPayment",
        bookingId: booking.id,
      });
    }

    const meetingLink = generateMeetingLink(booking.id);
    const confirmed = await tx.booking.updateMany({
      where: { id: booking.id, status: { in: ["HELD", "CANCELED"] } },
      data: {
        status: "CONFIRMED",
        holdExpiresAt: null,
        meetingLink,
        version: { increment: 1 },
      },
    });
    if (confirmed.count === 0) {
      throw new AppError("CONFLICT", "This booking can no longer be confirmed.");
    }

    await tx.availabilitySlot.updateMany({
      where: { id: booking.slotId, status: { in: ["OPEN", "HELD"] } },
      data: { status: "BOOKED", version: { increment: 1 } },
    });

    await writeAuditLog(
      {
        actorId: null,
        actorType: "SYSTEM",
        action: "booking.confirmed",
        entityType: "Booking",
        entityId: booking.id,
        metadata: {
          slotId: booking.slotId,
          fromStatus: booking.status,
          reactivatedFromExpiredHold: booking.status === "CANCELED",
        },
      },
      tx,
    );

    const consultant = await tx.consultant.findUniqueOrThrow({
      where: { id: booking.consultantId },
      select: { userId: true },
    });
    const notificationPayload = {
      bookingId: booking.id,
      sessionTitle: "Consultation session",
      joinUrl: meetingLink,
      startsAtUtc: booking.slot.startsAt.toISOString(),
      endsAtUtc: booking.slot.endsAt.toISOString(),
      durationMinutes: Math.round(
        (booking.slot.endsAt.getTime() - booking.slot.startsAt.getTime()) / 60000,
      ),
      // Rendered into each recipient's own zone by the notification dispatcher — the
      // stored payload stays an unambiguous UTC instant (docs/22 §6).
      timezone: "UTC",
    };
    await queueNotification(
      { userId: booking.studentId, event: "BOOKING_CONFIRMED", metadata: notificationPayload },
      tx,
    );
    await queueNotification(
      { userId: consultant.userId, event: "BOOKING_CONFIRMED", metadata: notificationPayload },
      tx,
    );

    return {
      bookingId: booking.id,
      status: "CONFIRMED" as const,
      meetingLink,
      alreadyConfirmed: false,
    };
  });
}

// ---------------------------------------------------------------------------
// Student-facing reads and cancellation
// ---------------------------------------------------------------------------

function hoursUntil(startsAt: Date): number {
  return (startsAt.getTime() - Date.now()) / (60 * 60 * 1000);
}

/** The caller's own bookings. `studentId` is part of the filter, never a post-fetch check. */
export async function listMyBookings(userId: string) {
  const bookings = await db.booking.findMany({
    where: { studentId: userId },
    orderBy: { createdAt: "desc" },
    include: {
      slot: true,
      consultant: { include: { user: { include: { profile: true } } } },
    },
  });

  return {
    timezone: "UTC",
    bookings: bookings.map((booking) => {
      const hours = hoursUntil(booking.slot.startsAt);
      const cancellable = booking.status === "HELD" || booking.status === "CONFIRMED";
      return {
        id: booking.id,
        status: booking.status,
        slotId: booking.slotId,
        consultantId: booking.consultantId,
        consultantName: booking.consultant.user.profile
          ? `${booking.consultant.user.profile.firstName} ${booking.consultant.user.profile.lastName}`
          : booking.consultant.user.email,
        startsAtUtc: booking.slot.startsAt.toISOString(),
        endsAtUtc: booking.slot.endsAt.toISOString(),
        holdExpiresAtUtc: booking.holdExpiresAt?.toISOString() ?? null,
        meetingLink: booking.meetingLink,
        cancellable,
        // Surfaced so the UI can warn before the student commits, rather than only
        // reporting the forfeiture after the fact.
        freeCancellationUntilUtc: new Date(
          booking.slot.startsAt.getTime() - FREE_CANCELLATION_HOURS * 60 * 60 * 1000,
        ).toISOString(),
        cancellationWouldBeLate: cancellable && hours < FREE_CANCELLATION_HOURS,
        createdAt: booking.createdAt.toISOString(),
      };
    }),
  };
}

/**
 * Student-initiated cancellation — docs/31 §4 B4/B6, docs/22 §9.1 (C9).
 *
 * Inside the 12-hour window the cancellation still succeeds; it is reported as late so the
 * refund decision is an explicit, audited outcome rather than a silent refusal.
 */
export async function cancelBooking(params: { userId: string; bookingId: string }) {
  return db.$transaction(async (tx) => {
    const booking = await tx.booking.findFirst({
      // Ownership is enforced in the query. A student who knows another student's booking
      // id gets the same "not found" as one who invented it.
      where: { id: params.bookingId, studentId: params.userId },
      include: { slot: true },
    });
    if (!booking) throw new AppError("RESOURCE_NOT_FOUND", "Booking not found.");
    if (booking.status !== "HELD" && booking.status !== "CONFIRMED") {
      throw new AppError("CONFLICT", "This booking can no longer be cancelled.");
    }

    const hours = hoursUntil(booking.slot.startsAt);
    const isLate = hours < FREE_CANCELLATION_HOURS;

    const canceled = await tx.booking.updateMany({
      where: { id: booking.id, studentId: params.userId, status: { in: ["HELD", "CONFIRMED"] } },
      data: { status: "CANCELED", holdExpiresAt: null, version: { increment: 1 } },
    });
    if (canceled.count === 0) {
      throw new AppError("CONFLICT", "This booking can no longer be cancelled.");
    }

    await tx.availabilitySlot.updateMany({
      where: { id: booking.slotId, status: { in: ["HELD", "BOOKED"] } },
      data: { status: "OPEN", version: { increment: 1 } },
    });

    await writeAuditLog(
      {
        actorId: params.userId,
        actorType: "STUDENT",
        action: "booking.cancelled",
        entityType: "Booking",
        entityId: booking.id,
        metadata: {
          slotId: booking.slotId,
          fromStatus: booking.status,
          isLateCancellation: isLate,
          hoursBeforeStart: Math.round(hours * 100) / 100,
          freeCancellationHours: FREE_CANCELLATION_HOURS,
        },
      },
      tx,
    );

    const consultant = await tx.consultant.findUniqueOrThrow({
      where: { id: booking.consultantId },
      select: { userId: true },
    });
    await queueNotification(
      {
        userId: consultant.userId,
        event: "BOOKING_CANCELLED",
        metadata: {
          bookingId: booking.id,
          sessionTitle: "Consultation session",
          startsAtUtc: booking.slot.startsAt.toISOString(),
          timezone: "UTC",
          isLateCancellation: isLate,
        },
      },
      tx,
    );

    return {
      bookingId: booking.id,
      status: "CANCELED" as const,
      slotReleased: true,
      isLateCancellation: isLate,
      // A late cancellation forfeits the session fee (docs/22 §9.1); a refund remains an
      // audited admin action either way (docs/19 §6.1), so nothing is refunded from here.
      refundEligible: !isLate && booking.status === "CONFIRMED",
      hoursBeforeStart: Math.round(hours * 100) / 100,
      freeCancellationHours: FREE_CANCELLATION_HOURS,
    };
  });
}
