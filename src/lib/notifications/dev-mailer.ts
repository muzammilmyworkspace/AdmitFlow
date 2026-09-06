import { logger } from "@/lib/logger";
import { getEnv } from "@/lib/env";

// Placeholder delivery for auth emails until a real provider is wired up.
//
// docs/23-notification-system.md specifies templated delivery through the background
// worker via an `email-send` job; that is Phase 16/17 work and needs a provider account
// (docs/55-known-risks-and-open-questions.md I-3 — provider not yet chosen). Until then
// this writes the verification/reset link to the server log so the flow is exercisable
// end-to-end in development.
//
// It refuses to run in production rather than silently "sending" nothing: an auth email
// that vanishes without a trace is worse than a hard failure at deploy time.

interface OutboundEmail {
  to: string;
  subject: string;
  body: string;
}

function deliver(operation: string, params: OutboundEmail, context: Record<string, unknown>): void {
  const env = getEnv();
  if (env.APP_ENV === "production") {
    throw new Error(
      "No email provider is configured. Wire up the notification service (docs/23-notification-system.md) before running auth flows in production.",
    );
  }

  logger.info("[dev-mailer] email (not actually sent)", {
    service: "dev-mailer",
    operation,
    to: params.to,
    subject: params.subject,
    body: params.body,
    ...context,
  });
}

export async function sendAuthEmail(params: OutboundEmail): Promise<void> {
  deliver("sendAuthEmail", params, {});
}

/**
 * Templated delivery for the notification service (docs/23 §2). Separate from
 * sendAuthEmail only so the log line carries which event/template produced the message —
 * the provider path itself is shared, and stays the single place a real provider lands.
 */
export async function sendEmail(
  params: OutboundEmail & { event: string; templateVersion: number },
): Promise<void> {
  deliver("sendEmail", params, {
    event: params.event,
    templateVersion: params.templateVersion,
  });
}
