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

export async function sendAuthEmail(params: {
  to: string;
  subject: string;
  body: string;
}): Promise<void> {
  const env = getEnv();
  if (env.APP_ENV === "production") {
    throw new Error(
      "No email provider is configured. Wire up the notification service (docs/23-notification-system.md) before running auth flows in production.",
    );
  }

  logger.info("[dev-mailer] auth email (not actually sent)", {
    service: "dev-mailer",
    operation: "sendAuthEmail",
    to: params.to,
    subject: params.subject,
    body: params.body,
  });
}
