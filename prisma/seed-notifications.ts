// ============================================================================
// seedNotificationTemplates — the v1 notification catalog (docs/23 §2)
// ============================================================================
//
// Message copy is data, not code (docs/23 §3): every subject and body the platform
// sends lives in a NotificationTemplate row so ops can correct wording and a new locale
// can be added without a deploy, and so each delivery can record the exact template
// version that rendered it.
//
// Key scheme: the schema's unique is `@@unique([key, version])` — the channel is NOT
// part of it. Each event ships on two channels at the same version, so keying rows by
// the bare event name (`WELCOME`) would make the EMAIL and IN_APP rows collide. The key
// therefore composes both (`WELCOME:EMAIL`, `WELCOME:IN_APP`) while `channel` stays
// populated as the authoritative, queryable field. This mirrors templateKey() in
// src/services/notifications/notification-service.ts, which is what resolution goes
// through — the composed key is the only thing either side looks a template up by.
//
// Bodies: EMAIL bodies are HTML (interpolated values are HTML-escaped at render time);
// IN_APP bodies are plain text, rendered as text by React. Placeholders use
// `{{camelCase}}` and must match the context each event's emitter passes — an unresolved
// one is deliberately rendered verbatim rather than blanked, so a typo is visible.
//
// Idempotency: safe to rerun. Every write upserts on (key, version) and leaves an
// existing row untouched (`update: {}`), so locally edited copy is not clobbered.
// ============================================================================

import type { NotificationChannel, PrismaClient } from "./generated/client";

const TEMPLATE_VERSION = 1;

interface EventTemplates {
  event: string;
  email: { subject: string; body: string };
  inApp: { title: string; body: string };
}

const CATALOG: EventTemplates[] = [
  {
    event: "WELCOME",
    email: {
      subject: "Welcome to AdmitFlow, {{firstName}}",
      body: [
        "<p>Hi {{firstName}},</p>",
        "<p>Your AdmitFlow account is ready. Confirm your email address to unlock your admission assessment.</p>",
        '<p><a href="{{verificationUrl}}">Verify my email address</a></p>',
        "<p>If you did not create this account, you can safely ignore this message.</p>",
      ].join("\n"),
    },
    inApp: {
      title: "Welcome to AdmitFlow",
      body: "Hi {{firstName}}, your account is ready. Verify your email address to unlock your assessment.",
    },
  },
  {
    event: "EMAIL_VERIFIED",
    email: {
      subject: "Your AdmitFlow email address is verified",
      body: [
        "<p>Hi {{firstName}},</p>",
        "<p>Your email address is confirmed. The next step is your profile — it takes about five minutes and powers your university matches.</p>",
        '<p><a href="{{profileUrl}}">Complete my profile</a></p>',
      ].join("\n"),
    },
    inApp: {
      title: "Email verified",
      body: "Your email address is confirmed. Complete your profile to see your university matches.",
    },
  },
  {
    event: "DOCUMENT_REJECTED",
    email: {
      // A rejection with no reason leaves the student with nothing to act on — docs/23 §2.
      subject: "Action needed: your {{documentType}} could not be accepted",
      body: [
        "<p>Hi {{firstName}},</p>",
        "<p>We reviewed your <strong>{{documentType}}</strong> and could not accept it.</p>",
        "<p><strong>Reason:</strong> {{reason}}</p>",
        '<p><a href="{{reuploadUrl}}">Upload a replacement</a></p>',
        "<p>Nothing else in your application is affected — once the replacement is verified you can carry on.</p>",
      ].join("\n"),
    },
    inApp: {
      title: "{{documentType}} needs re-uploading",
      body: "We could not accept your {{documentType}}. Reason: {{reason}}. Upload a replacement to continue.",
    },
  },
  {
    event: "DOCUMENT_VERIFIED",
    email: {
      subject: "Your {{documentType}} has been verified",
      body: [
        "<p>Hi {{firstName}},</p>",
        "<p>Your <strong>{{documentType}}</strong> passed review and is now part of your verified document vault.</p>",
        '<p><a href="{{vaultUrl}}">View my documents</a></p>',
      ].join("\n"),
    },
    inApp: {
      title: "{{documentType}} verified",
      body: "Your {{documentType}} passed review and is ready to attach to an application.",
    },
  },
  {
    event: "ASSESSMENT_READY",
    email: {
      subject: "Your admission assessment is ready",
      body: [
        "<p>Hi {{firstName}},</p>",
        "<p>We have finished assessing your profile against our programme catalog. Your REACH, TARGET and SAFE matches are waiting for you.</p>",
        '<p><a href="{{resultsUrl}}">See my results</a></p>',
      ].join("\n"),
    },
    inApp: {
      title: "Your assessment is ready",
      body: "Your REACH, TARGET and SAFE matches have been calculated. Open your results to review them.",
    },
  },
  {
    event: "PAYMENT_SUCCESS",
    email: {
      // Doubles as the receipt — a financial record the student must always receive on a
      // durable channel regardless of any future per-channel preference (docs/23 §4).
      subject: "Receipt: {{amount}} {{currency}} for {{productName}}",
      body: [
        "<p>Hi {{firstName}},</p>",
        "<p>Thank you — your payment was successful. This email is your receipt.</p>",
        "<ul>",
        "<li><strong>Item:</strong> {{productName}}</li>",
        "<li><strong>Amount:</strong> {{amount}} {{currency}}</li>",
        "<li><strong>Paid at:</strong> {{paidAt}}</li>",
        "<li><strong>Reference:</strong> {{paymentReference}}</li>",
        "</ul>",
        '<p><a href="{{receiptUrl}}">View this receipt online</a></p>',
      ].join("\n"),
    },
    inApp: {
      title: "Payment received",
      body: "We received your payment of {{amount}} {{currency}} for {{productName}}. Reference {{paymentReference}}.",
    },
  },
  {
    event: "PAYMENT_FAILED",
    email: {
      subject: "Your payment for {{productName}} did not go through",
      body: [
        "<p>Hi {{firstName}},</p>",
        "<p>Your payment of {{amount}} {{currency}} for <strong>{{productName}}</strong> was not completed.</p>",
        "<p><strong>What went wrong:</strong> {{reason}}</p>",
        '<p><a href="{{retryUrl}}">Try again</a></p>',
        "<p>You have not been charged. Nothing in your account has changed.</p>",
      ].join("\n"),
    },
    inApp: {
      title: "Payment could not be completed",
      body: "Your payment of {{amount}} {{currency}} for {{productName}} did not go through: {{reason}}. You have not been charged.",
    },
  },
  {
    event: "BOOKING_CONFIRMED",
    email: {
      subject: "Confirmed: {{sessionTitle}} on {{startsAtLocal}}",
      body: [
        "<p>Hi {{firstName}},</p>",
        "<p>Your session is booked.</p>",
        "<ul>",
        "<li><strong>Session:</strong> {{sessionTitle}}</li>",
        "<li><strong>When:</strong> {{startsAtLocal}} ({{timezone}})</li>",
        "<li><strong>Duration:</strong> {{durationMinutes}} minutes</li>",
        "</ul>",
        '<p><a href="{{joinUrl}}">Join link</a> — available from a few minutes before the start time.</p>',
        '<p><a href="{{rescheduleUrl}}">Reschedule or cancel</a></p>',
      ].join("\n"),
    },
    inApp: {
      title: "Booking confirmed",
      body: "{{sessionTitle}} is confirmed for {{startsAtLocal}} ({{timezone}}).",
    },
  },
  {
    // A cancellation must always be able to complete, so the template it needs has to
    // exist — without this row the consultation service can only log and skip, leaving
    // the student with no record that their session went away.
    event: "BOOKING_CANCELLED",
    email: {
      subject: "Cancelled: {{sessionTitle}} on {{startsAtLocal}}",
      body: [
        "<p>Hi {{firstName}},</p>",
        "<p>Your session <strong>{{sessionTitle}}</strong>, booked for {{startsAtLocal}} ({{timezone}}), has been cancelled.</p>",
        "<p>{{reason}}</p>",
        '<p><a href="{{rebookUrl}}">Book another time</a></p>',
      ].join("\n"),
    },
    inApp: {
      title: "Booking cancelled",
      body: "{{sessionTitle}} on {{startsAtLocal}} ({{timezone}}) has been cancelled.",
    },
  },
  {
    event: "BOOKING_REMINDER",
    email: {
      subject: "Reminder: {{sessionTitle}} starts in {{timeUntil}}",
      body: [
        "<p>Hi {{firstName}},</p>",
        "<p>This is a reminder that <strong>{{sessionTitle}}</strong> starts in {{timeUntil}}, at {{startsAtLocal}} ({{timezone}}).</p>",
        '<p><a href="{{joinUrl}}">Join the session</a></p>',
        '<p>Cannot make it? <a href="{{rescheduleUrl}}">Reschedule</a> so the slot can go to someone else.</p>',
      ].join("\n"),
    },
    inApp: {
      title: "{{sessionTitle}} starts in {{timeUntil}}",
      body: "Your session starts at {{startsAtLocal}} ({{timezone}}). Open the booking for the join link.",
    },
  },
  {
    event: "APPLICATION_SUBMITTED",
    email: {
      subject: "Application submitted: {{programName}} at {{universityName}}",
      body: [
        "<p>Hi {{firstName}},</p>",
        "<p>Your application to <strong>{{programName}}</strong> at <strong>{{universityName}}</strong> has been submitted.</p>",
        "<p>We have kept a snapshot of exactly what was sent, including every document attached, so you can always check what the university received.</p>",
        '<p><a href="{{applicationUrl}}">Track this application</a></p>',
      ].join("\n"),
    },
    inApp: {
      title: "Application submitted",
      body: "Your application to {{programName}} at {{universityName}} has been submitted.",
    },
  },
  {
    event: "APPLICATION_STATUS_CHANGED",
    email: {
      // Context carries both statuses so the copy can render a human transition rather
      // than a raw enum — docs/23 §2.
      subject: "Your {{universityName}} application is now {{newStatus}}",
      body: [
        "<p>Hi {{firstName}},</p>",
        "<p>Your application to <strong>{{programName}}</strong> at <strong>{{universityName}}</strong> has moved from <strong>{{oldStatus}}</strong> to <strong>{{newStatus}}</strong>.</p>",
        "<p>{{statusExplanation}}</p>",
        '<p><a href="{{applicationUrl}}">See what happens next</a></p>',
      ].join("\n"),
    },
    inApp: {
      title: "Application update: {{newStatus}}",
      body: "{{programName}} at {{universityName}} moved from {{oldStatus}} to {{newStatus}}.",
    },
  },
  {
    event: "DEADLINE_APPROACHING",
    email: {
      subject: "{{daysRemaining}} days left to apply to {{universityName}}",
      body: [
        "<p>Hi {{firstName}},</p>",
        "<p>The application deadline for <strong>{{programName}}</strong> at <strong>{{universityName}}</strong> is <strong>{{deadlineLocal}}</strong> ({{timezone}}) — {{daysRemaining}} days from now.</p>",
        "<p>Your application is still in progress. Anything you have already saved is kept.</p>",
        '<p><a href="{{applicationUrl}}">Finish my application</a></p>',
      ].join("\n"),
    },
    inApp: {
      title: "{{daysRemaining}} days until the {{universityName}} deadline",
      body: "{{programName}} closes on {{deadlineLocal}} ({{timezone}}). Your application is not submitted yet.",
    },
  },
];

/**
 * Seeds one EMAIL and one IN_APP template per v1 event. Idempotent: rerunning creates
 * nothing new and mutates nothing existing.
 */
export async function seedNotificationTemplates(db: PrismaClient): Promise<void> {
  for (const entry of CATALOG) {
    const rows: Array<{
      channel: NotificationChannel;
      subjectTemplate: string;
      bodyTemplate: string;
    }> = [
      {
        channel: "EMAIL",
        subjectTemplate: entry.email.subject,
        bodyTemplate: entry.email.body,
      },
      {
        // For in-app, subjectTemplate is the notification title (docs/23 §5).
        channel: "IN_APP",
        subjectTemplate: entry.inApp.title,
        bodyTemplate: entry.inApp.body,
      },
    ];

    for (const row of rows) {
      const key = `${entry.event}:${row.channel}`;
      await db.notificationTemplate.upsert({
        where: { key_version: { key, version: TEMPLATE_VERSION } },
        update: {},
        create: {
          key,
          version: TEMPLATE_VERSION,
          channel: row.channel,
          subjectTemplate: row.subjectTemplate,
          bodyTemplate: row.bodyTemplate,
          isActive: true,
        },
      });
    }
  }
}
