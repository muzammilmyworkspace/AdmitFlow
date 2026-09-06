import { createRequire } from "node:module";
import type { PrismaClient } from "./generated/client";

// ============================================================================
// seedConsultantAvailability — DEMO consultant accounts and bookable slots
// ============================================================================
//
// The two consultants below are FICTIONAL demo accounts on the reserved `.example`
// TLD (RFC 2606), matching seed-catalog.ts's rule that seeded data can never be
// mistaken for a real person or institution. They exist so the consultation booking
// flow (docs/22-consultation-booking.md) is exercisable end to end in a fresh
// environment.
//
// Idempotency: safe to rerun. Accounts are matched by email, every other write is an
// upsert on a real unique key, and slot instants are derived from the UTC calendar day
// rather than the current clock, so a rerun on the same day regenerates exactly the
// same rows. Slot upserts never overwrite `status`, so re-seeding cannot quietly
// release a slot a student has already booked.

const SESSION_MINUTES = 40;
const HORIZON_DAYS = 21;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Plaintext is fixed and published in the docs — these are demo accounts, never production ones. */
const DEMO_PASSWORD = "ConsultantPass42!";

interface ConsultantSeed {
  email: string;
  firstName: string;
  lastName: string;
  bio: string;
  specialties: string[];
  /** Business-hour starts in UTC, rotated across the weekdays in the horizon. */
  startHoursUtc: number[];
}

const CONSULTANTS: ConsultantSeed[] = [
  {
    email: "consultant1@admitflow.example",
    firstName: "Amara",
    lastName: "Okonkwo",
    bio: "(DEMO DATA) Advises on postgraduate applications to German and Dutch public universities.",
    specialties: ["Germany", "Netherlands", "Masters applications", "Blocked account & visa prep"],
    startHoursUtc: [9, 11, 13],
  },
  {
    email: "consultant2@admitflow.example",
    firstName: "Tobias",
    lastName: "Lindqvist",
    bio: "(DEMO DATA) Advises on statements of purpose, scholarships and Nordic admissions.",
    specialties: ["Sweden", "Scholarships", "Statement of purpose review"],
    startHoursUtc: [10, 14, 16],
  },
];

/**
 * Loads the app's own password hasher into this plain Node process.
 *
 * `src/lib/auth/password.ts` is marked `server-only`, and that marker package throws on
 * import outside a React Server Component — which is every seed run. Stubbing the marker
 * is preferable to re-implementing argon2id here: a second hashing implementation could
 * drift from the app's parameters and produce hashes the login path cannot verify.
 */
async function loadHashPassword(): Promise<(plain: string) => Promise<string>> {
  const req = createRequire(import.meta.url);
  const markerPath = req.resolve("server-only");
  if (!req.cache[markerPath]) {
    req.cache[markerPath] = {
      id: markerPath,
      filename: markerPath,
      path: markerPath,
      loaded: true,
      exports: {},
      children: [],
      paths: [],
      parent: null,
      isPreloading: false,
      require: req,
    } as NodeJS.Module;
  }
  const passwordModule = await import("../src/lib/auth/password");
  return passwordModule.hashPassword;
}

/**
 * Weekday business-hour slots across the next three weeks, in UTC.
 *
 * Anchored to the next UTC midnight rather than `now`, so the generated instants depend
 * only on the calendar day — that is what makes a rerun idempotent against the
 * `AvailabilitySlot(consultantId, startsAt)` unique key.
 */
function futureWeekdaySlots(startHoursUtc: number[]): Array<{ startsAt: Date; endsAt: Date }> {
  if (startHoursUtc.length === 0) return [];

  const now = new Date();
  const anchor =
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY_MS;

  const slots: Array<{ startsAt: Date; endsAt: Date }> = [];
  let weekdayIndex = 0;

  for (let offset = 0; offset < HORIZON_DAYS; offset += 1) {
    const day = new Date(anchor + offset * DAY_MS);
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;

    const hour = startHoursUtc[weekdayIndex % startHoursUtc.length] ?? startHoursUtc[0] ?? 9;
    weekdayIndex += 1;

    const startsAt = new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, 0, 0, 0),
    );
    slots.push({ startsAt, endsAt: new Date(startsAt.getTime() + SESSION_MINUTES * 60 * 1000) });
  }

  return slots;
}

export async function seedConsultantAvailability(db: PrismaClient): Promise<void> {
  const hashPassword = await loadHashPassword();
  const consultantRole = await db.role.findUnique({ where: { name: "CONSULTANT" } });
  if (!consultantRole) {
    throw new Error("The CONSULTANT role must be seeded before consultant availability.");
  }

  for (const seed of CONSULTANTS) {
    let user = await db.user.findUnique({ where: { email: seed.email } });
    if (!user) {
      user = await db.user.create({
        data: {
          email: seed.email,
          passwordHash: await hashPassword(DEMO_PASSWORD),
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      });
    }

    await db.profile.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        firstName: seed.firstName,
        lastName: seed.lastName,
        onboardingCompletedAt: new Date(),
      },
    });

    await db.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: consultantRole.id } },
      update: {},
      create: { userId: user.id, roleId: consultantRole.id },
    });

    const consultant = await db.consultant.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        bio: seed.bio,
        specialties: seed.specialties,
        defaultSessionMinutes: SESSION_MINUTES,
        isAcceptingBookings: true,
      },
    });

    for (const slot of futureWeekdaySlots(seed.startHoursUtc)) {
      await db.availabilitySlot.upsert({
        where: {
          consultantId_startsAt: { consultantId: consultant.id, startsAt: slot.startsAt },
        },
        update: {},
        create: {
          consultantId: consultant.id,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
        },
      });
    }
  }
}
