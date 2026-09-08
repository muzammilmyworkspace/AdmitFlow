import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { notify } from "@/services/notifications/notification-service";
import { releaseExpiredHolds } from "@/services/consultation/consultation-service";
import { executeDueDeletions } from "@/services/account-service";

// The scheduled sweeps — docs/24-background-jobs.md.
//
// There is no always-on worker: the $0-infrastructure profile (docs/54 D-11) trades a
// resident BullMQ process for periodic batch runs, and `src/worker/index.ts` has been an
// empty placeholder since Phase 1. Until now nothing ran any of this on a timer at all,
// so a booking hold only expired when a later request happened to touch the same slot,
// and a deadline reminder was an event name with no sender.
//
// These are written so that running them twice does nothing the second time, and so that
// not running them for a day loses nothing permanently — each one is a backstop, never
// the only path to a correct state.

/** Days before an application deadline that a student is reminded. */
const REMINDER_WINDOWS = [14, 3];

/**
 * Reminds students whose application deadline is close and whose application is not yet
 * submitted.
 *
 * Idempotency comes from the Notification table rather than from a flag on the
 * application: before sending, it checks whether this student has already had a reminder
 * for this application inside the same window. That keeps a job that runs hourly from
 * sending an hourly reminder, and survives a re-run after a partial failure.
 */
export async function sendDeadlineReminders(now: Date = new Date()): Promise<{ sent: number }> {
  const horizon = new Date(now.getTime() + Math.max(...REMINDER_WINDOWS) * 24 * 60 * 60 * 1000);

  const applications = await db.application.findMany({
    where: {
      deletedAt: null,
      submittedAt: null,
      status: { notIn: ["SUBMITTED", "WITHDRAWN"] },
      intake: { applicationDeadline: { gt: now, lte: horizon } },
    },
    include: { program: true, intake: true },
    take: 500,
  });

  let sent = 0;
  for (const application of applications) {
    const msLeft = application.intake.applicationDeadline.getTime() - now.getTime();
    const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));

    // The tightest window this deadline currently falls inside.
    const window = REMINDER_WINDOWS.filter((w) => daysLeft <= w).sort((a, b) => a - b)[0];
    if (window === undefined) continue;

    const already = await db.notification.findFirst({
      where: {
        userId: application.studentId,
        // notify() nests the caller's context under `context`, so the application id is
        // at metadata.context.applicationId — not at the top level.
        AND: [
          { metadata: { path: ["event"], equals: "DEADLINE_APPROACHING" } },
          { metadata: { path: ["context", "applicationId"], equals: application.id } },
        ],
        createdAt: {
          // Anything sent inside this window already covered this reminder.
          gte: new Date(
            application.intake.applicationDeadline.getTime() - window * 24 * 60 * 60 * 1000,
          ),
        },
      },
      select: { id: true },
    });
    if (already) continue;

    await notify({
      userId: application.studentId,
      event: "DEADLINE_APPROACHING",
      context: {
        program: application.program.name,
        term: application.intake.term,
        daysLeft: String(daysLeft),
        applicationId: application.id,
        applicationUrl: `/dashboard/applications/${application.id}`,
      },
    });
    sent += 1;
  }

  if (sent > 0) {
    logger.info("Deadline reminders sent", { service: "jobs", operation: "deadlineReminders", sent });
  }
  return { sent };
}

export interface SweepResult {
  holdsReleased: number;
  remindersSent: number;
  accountsDeleted: number;
  errors: string[];
}

/**
 * Runs every sweep, in order, isolating failures.
 *
 * One failing sweep must not stop the others: a broken deadline query should not also
 * mean that nobody's account deletion is ever executed. Each error is collected and
 * returned so the caller (and the scheduler's own logs) can see exactly what failed.
 */
export async function runScheduledSweeps(now: Date = new Date()): Promise<SweepResult> {
  const result: SweepResult = {
    holdsReleased: 0,
    remindersSent: 0,
    accountsDeleted: 0,
    errors: [],
  };

  const steps: [string, () => Promise<void>][] = [
    [
      "releaseExpiredHolds",
      async () => {
        result.holdsReleased = (await releaseExpiredHolds()).released;
      },
    ],
    [
      "sendDeadlineReminders",
      async () => {
        result.remindersSent = (await sendDeadlineReminders(now)).sent;
      },
    ],
    [
      "executeDueDeletions",
      async () => {
        result.accountsDeleted = (await executeDueDeletions(now)).deleted;
      },
    ],
  ];

  for (const [name, run] of steps) {
    try {
      await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`${name}: ${message}`);
      logger.error("Scheduled sweep failed", { service: "jobs", operation: name, message });
    }
  }

  return result;
}
