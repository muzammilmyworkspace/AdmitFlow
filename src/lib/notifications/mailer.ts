import "server-only";
import { logger } from "@/lib/logger";
import { getEnv } from "@/lib/env";

// Email delivery — docs/23-notification-system.md, docs/55 I-3.
//
// Two drivers behind one function, chosen the same way every other external dependency
// in this codebase is: a real provider when it is configured, a local one when it is not,
// and a hard failure if production is reached without the real one. An auth email that
// vanishes without a trace is worse than a refusal at deploy time — a student who never
// receives a verification link simply cannot use the product, and nothing in the logs
// would say so.
//
// The provider is Resend, called over its REST API rather than through its SDK: the whole
// integration is one POST, and a dependency that exists to wrap one fetch is a dependency
// to keep patched for no benefit. Swapping to SendGrid or Postmark means changing
// `postToProvider` and nothing else.

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 10_000;

interface OutboundEmail {
  to: string;
  subject: string;
  body: string;
}

/** True when a real provider is configured and should be used. */
function providerConfigured(): boolean {
  return Boolean(getEnv().EMAIL_PROVIDER_API_KEY);
}

/**
 * Wraps the plain-text body in the minimum viable HTML.
 *
 * Auth emails are short and transactional, so this stays deliberately plain: a heavily
 * styled template is more likely to land in spam, and the one thing these messages must
 * do is deliver a link that works.
 */
function toHtml(body: string): string {
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Bare URLs become links, so a student on a client that does not autolink can still
  // click through rather than having to copy the text out.
  const linked = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="color:#2F8449">$1</a>',
  );
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;color:#1A1F36">${linked.replace(/\n/g, "<br>")}</div>`;
}

async function postToProvider(params: OutboundEmail): Promise<void> {
  const env = getEnv();
  // A hung provider must not hold a signup request open indefinitely.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.EMAIL_PROVIDER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM_ADDRESS,
        to: [params.to],
        subject: params.subject,
        text: params.body,
        html: toHtml(params.body),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // The provider's error body can echo the recipient address back. Read the status
      // and a short reason; never log the body wholesale.
      const reason = await response.text().catch(() => "");
      throw new Error(
        `Email provider rejected the message (${response.status}): ${reason.slice(0, 200)}`,
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

function deliverLocally(operation: string, params: OutboundEmail, context: Record<string, unknown>) {
  // Development only: writes the verification/reset link to the server log so the flow is
  // exercisable end-to-end without a provider account. The browser suites read the link
  // back out of this log.
  logger.info("[dev-mailer] email (not actually sent)", {
    service: "dev-mailer",
    operation,
    to: params.to,
    subject: params.subject,
    body: params.body,
    ...context,
  });
}

async function deliver(
  operation: string,
  params: OutboundEmail,
  context: Record<string, unknown>,
): Promise<void> {
  const env = getEnv();

  if (!providerConfigured()) {
    if (env.APP_ENV === "production") {
      throw new Error(
        "EMAIL_PROVIDER_API_KEY is not set. Auth and notification emails cannot be delivered, " +
          "and a student who never receives a verification link cannot use the product.",
      );
    }
    deliverLocally(operation, params, context);
    return;
  }

  await postToProvider(params);
  // Never log the body once a real provider is in use: these messages carry
  // single-use verification and password-reset links (docs/27-audit-logging.md).
  logger.info("Email sent", {
    service: "mailer",
    operation,
    subject: params.subject,
    ...context,
  });
}

export async function sendAuthEmail(params: OutboundEmail): Promise<void> {
  await deliver("sendAuthEmail", params, {});
}

/**
 * Templated delivery for the notification service (docs/23 §2). Separate from
 * sendAuthEmail only so the log line carries which event and template version produced
 * the message; the provider path itself is shared.
 */
export async function sendEmail(
  params: OutboundEmail & { event: string; templateVersion: number },
): Promise<void> {
  await deliver("sendEmail", params, {
    event: params.event,
    templateVersion: params.templateVersion,
  });
}
