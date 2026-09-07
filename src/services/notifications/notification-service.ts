import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { sendEmail } from "@/lib/notifications/dev-mailer";
import type { NotificationChannel, Prisma } from "../../../prisma/generated/client";

// Notification service — docs/23-notification-system.md.
//
// Invariants this module enforces:
//   * message copy lives in NotificationTemplate rows, never as string literals here (§3)
//   * a notification failure never propagates into the caller's business transaction (§1)
//   * interpolated values are escaped for the channel they are rendered into
//   * every read/write is scoped by userId in the WHERE clause, never fetch-then-check

// ---------------------------------------------------------------------------
// Event catalog
// ---------------------------------------------------------------------------

/** The v1 transactional catalog — docs/23 §2. Every one of these is essential. */
export const NOTIFICATION_EVENTS = [
  "WELCOME",
  "EMAIL_VERIFIED",
  "DOCUMENT_REJECTED",
  "DOCUMENT_VERIFIED",
  "ASSESSMENT_READY",
  "ASSESSMENT_REVIEW_READY",
  "PAYMENT_SUCCESS",
  "PAYMENT_FAILED",
  "BOOKING_CONFIRMED",
  "BOOKING_CANCELLED",
  "BOOKING_REMINDER",
  "APPLICATION_SUBMITTED",
  "APPLICATION_STATUS_CHANGED",
  "DEADLINE_APPROACHING",
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/**
 * Marketing events — docs/23 §4. Named here (rather than left implicit) so the
 * essential/optional split is a total function over everything notify() can be handed,
 * and so a growth event added later cannot accidentally inherit essential treatment.
 */
export const MARKETING_EVENTS = ["PRODUCT_TIPS", "NEWSLETTER", "PROMOTIONAL_OFFER"] as const;

export type MarketingEvent = (typeof MARKETING_EVENTS)[number];

export type NotifiableEvent = NotificationEvent | MarketingEvent;

const ESSENTIAL_EVENTS: ReadonlySet<string> = new Set<string>(NOTIFICATION_EVENTS);

/**
 * Essential (service/transactional) vs. optional (marketing) — docs/23 §4.
 *
 * There is no NotificationPreference model in the schema yet, and adding one is a
 * follow-up (it needs a migration, a settings UI and a consent audit trail). The
 * classification is the half that must exist first: without it, a future preferences
 * table has nothing to consult and the "marketing consent is separately revocable, and
 * essential notices cannot be silenced" rule would end up re-derived at each call site.
 *
 * Until the store exists, notify() reads this as: essential always sends; optional never
 * sends, because marketingOptIn is specified to default false (§4, "opt-in by default
 * false") and silence is the only safe default for consent we have not recorded.
 */
export function isEssentialEvent(event: NotifiableEvent): boolean {
  return ESSENTIAL_EVENTS.has(event);
}

/**
 * Template key scheme — the schema's unique is `(key, version)`, not
 * `(key, channel, version)`, so an event delivered on two channels at the same version
 * cannot use the bare event name as its key without colliding. The channel is therefore
 * folded into the key (`WELCOME:EMAIL`, `WELCOME:IN_APP`) while `channel` stays populated
 * as the queryable, authoritative field. Resolution is always by this composed key, so
 * the two are never allowed to disagree.
 */
export function templateKey(event: NotifiableEvent, channel: NotificationChannel): string {
  return `${event}:${channel}`;
}

/** Every v1 event ships on email + in-app — docs/23 §1.1. */
const DEFAULT_CHANNELS: readonly NotificationChannel[] = ["IN_APP", "EMAIL"];

/**
 * The notification centre is the in-app channel. Email rows are delivery records, not
 * feed items, so listing/unread/mark-read all scope to IN_APP — otherwise every event
 * would appear twice in the badge count.
 */
const CENTER_CHANNEL: NotificationChannel = "IN_APP";

/** docs/23 §5 — in-app notifications stay in the default query for 12 months. */
const RETENTION_MONTHS = 12;

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Template interpolation
// ---------------------------------------------------------------------------

export type NotificationContext = Record<string, string | number | boolean | null | undefined>;

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/**
 * Interpolates `{{placeholder}}` tokens.
 *
 * Two deliberate behaviours:
 *
 *   * `escapeHtml` escapes the *values*, never the template. Context carries
 *     user-supplied data — student names, a rejection reason, a university name — and an
 *     HTML email body built by raw concatenation is a stored-XSS sink reachable by anyone
 *     who can set their own first name.
 *   * an unresolved placeholder is left visibly intact (`{{studentFistName}}` stays in the
 *     output) rather than collapsing to an empty string. docs/23 §3 wants a typo'd
 *     placeholder to be caught; a blank where a name should be reads as a rendering
 *     glitch, while the literal token names the exact key that failed to resolve.
 */
export function interpolate(
  template: string,
  context: NotificationContext,
  options: { escapeHtml: boolean },
): string {
  return template.replace(PLACEHOLDER, (match: string, name: string): string => {
    if (!Object.prototype.hasOwnProperty.call(context, name)) return match;
    const value = context[name];
    if (value === undefined || value === null) return match;
    const text = String(value);
    return options.escapeHtml ? escapeHtml(text) : text;
  });
}

/**
 * Subjects become a mail header, so a newline in an interpolated value would let
 * user-supplied data inject additional headers. Escaping is wrong here (the subject is
 * not HTML and `&amp;` would be shown to the reader verbatim) — stripping controls is.
 */
function sanitizeSubject(subject: string): string {
  return subject.replace(/[\u0000-\u001F\u007F]+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export interface NotifyParams {
  userId: string;
  event: NotifiableEvent;
  /** Omit to deliver on every channel the event ships on in v1. */
  channel?: NotificationChannel;
  context: NotificationContext;
}

export interface ChannelResult {
  channel: NotificationChannel;
  notificationId: string | null;
  status: "SENT" | "FAILED";
  failureReason?: string;
}

export interface NotifyResult {
  results: ChannelResult[];
  /** True when the event was withheld by the essential/optional rule rather than failing. */
  suppressed: boolean;
}

/**
 * Emits a notification. Never throws.
 *
 * docs/23 §1 — notifications are a sink, not a dependency: a booking must not fail
 * because an email bounced or the template row is missing. Every failure is captured on
 * the Notification row (FAILED + reason) and logged, and the caller gets a result object
 * it is free to ignore.
 *
 * Delivery is synchronous here because the BullMQ `notifications` queue (docs/23 §6) is
 * not yet wired; the seam is this function, so moving to enqueue-and-return later changes
 * nothing at any call site.
 */
export async function notify(params: NotifyParams): Promise<NotifyResult> {
  const channels = params.channel ? [params.channel] : DEFAULT_CHANNELS;

  if (!isEssentialEvent(params.event)) {
    logger.info("Optional notification suppressed: no recorded opt-in", {
      service: "notifications",
      operation: "notify",
      userId: params.userId,
      event: params.event,
    });
    return { results: [], suppressed: true };
  }

  try {
    const user = await db.user.findUnique({
      where: { id: params.userId },
      select: { id: true, email: true },
    });
    if (!user) {
      logger.warn("Notification skipped: unknown recipient", {
        service: "notifications",
        operation: "notify",
        userId: params.userId,
        event: params.event,
      });
      return { results: [], suppressed: false };
    }

    const results: ChannelResult[] = [];
    for (const channel of channels) {
      results.push(await deliver(user.id, user.email, channel, params));
    }
    return { results, suppressed: false };
  } catch (error) {
    logger.error("Notification dispatch failed", {
      service: "notifications",
      operation: "notify",
      userId: params.userId,
      event: params.event,
      reason: reasonOf(error),
    });
    return { results: [], suppressed: false };
  }
}

async function deliver(
  userId: string,
  email: string,
  channel: NotificationChannel,
  params: NotifyParams,
): Promise<ChannelResult> {
  const key = templateKey(params.event, channel);
  const template = await db.notificationTemplate.findFirst({
    where: { key, isActive: true },
    orderBy: { version: "desc" },
  });

  if (!template) {
    // No row means no Notification row either — templateId is a required FK. Loud log,
    // silent for the caller.
    logger.error("Notification template missing", {
      service: "notifications",
      operation: "deliver",
      userId,
      event: params.event,
      channel,
      templateKey: key,
    });
    return { channel, notificationId: null, status: "FAILED", failureReason: "template_missing" };
  }

  // Email bodies are HTML; in-app bodies are plain text rendered as text by React, where
  // escaping here would surface `&amp;` to the reader.
  const body = interpolate(template.bodyTemplate, params.context, {
    escapeHtml: channel === "EMAIL",
  });
  const subject = template.subjectTemplate
    ? sanitizeSubject(interpolate(template.subjectTemplate, params.context, { escapeHtml: false }))
    : null;

  const metadata = {
    event: params.event,
    title: subject,
    body,
    templateKey: template.key,
    // docs/23 §3 — the version that actually rendered this message, so "what did the email
    // say" stays answerable after the template is edited.
    templateVersion: template.version,
    context: toJsonContext(params.context),
  } satisfies Prisma.InputJsonObject;

  const notification = await db.notification.create({
    data: {
      userId,
      templateId: template.id,
      channel,
      status: "QUEUED",
      metadata,
    },
  });

  if (channel !== "EMAIL") {
    // The in-app row IS the delivery; there is no provider to wait on.
    await db.notification.update({
      where: { id: notification.id },
      data: { status: "SENT", sentAt: new Date() },
    });
    return { channel, notificationId: notification.id, status: "SENT" };
  }

  try {
    await sendEmail({
      to: email,
      subject: subject ?? params.event,
      body,
      event: params.event,
      templateVersion: template.version,
    });
    await db.notification.update({
      where: { id: notification.id },
      data: { status: "SENT", sentAt: new Date() },
    });
    return { channel, notificationId: notification.id, status: "SENT" };
  } catch (error) {
    const failureReason = reasonOf(error);
    logger.error("Notification delivery failed", {
      service: "notifications",
      operation: "deliver",
      userId,
      event: params.event,
      channel,
      notificationId: notification.id,
      reason: failureReason,
    });
    await db.notification.update({
      where: { id: notification.id },
      data: { status: "FAILED", metadata: { ...metadata, failureReason } },
    });
    return { channel, notificationId: notification.id, status: "FAILED", failureReason };
  }
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function toJsonContext(context: NotificationContext): Prisma.InputJsonObject {
  const json: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) continue;
    json[key] = value;
  }
  return json;
}

// ---------------------------------------------------------------------------
// Notification centre
// ---------------------------------------------------------------------------

export interface NotificationPage {
  cursor?: string;
  pageSize?: number;
}

export interface NotificationItem {
  id: string;
  event: string | null;
  title: string | null;
  body: string | null;
  metadata: Prisma.JsonValue;
  status: string;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}

function retentionFloor(): Date {
  const floor = new Date();
  floor.setMonth(floor.getMonth() - RETENTION_MONTHS);
  return floor;
}

/** The WHERE every centre query shares — the userId scope lives here, not at a call site. */
function centerScope(userId: string): Prisma.NotificationWhereInput {
  return { userId, channel: CENTER_CHANNEL, createdAt: { gte: retentionFloor() } };
}

function stringField(metadata: Prisma.JsonValue, field: string): string | null {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return null;
  const value = (metadata as Prisma.JsonObject)[field];
  return typeof value === "string" ? value : null;
}

/**
 * Newest-first cursor pagination plus the unread badge count — docs/23 §5.
 *
 * Cursor rather than offset for the same reason as the catalog (docs/34): new
 * notifications arrive at the head of this list constantly, and offsets would repeat or
 * skip rows mid-scroll.
 */
export async function listNotifications(userId: string, page: NotificationPage = {}) {
  const pageSize = Math.min(Math.max(page.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const where = centerScope(userId);

  const [rows, unreadCount] = await Promise.all([
    db.notification.findMany({
      where,
      take: pageSize + 1, // one extra row tells us whether another page exists
      ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    db.notification.count({ where: { ...where, readAt: null } }),
  ]);

  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;

  return {
    items: items.map(
      (row): NotificationItem => ({
        id: row.id,
        event: stringField(row.metadata, "event"),
        title: stringField(row.metadata, "title"),
        body: stringField(row.metadata, "body"),
        metadata: row.metadata,
        status: row.status,
        isRead: row.readAt !== null,
        readAt: row.readAt,
        createdAt: row.createdAt,
      }),
    ),
    nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    hasMore,
    pageSize,
    unreadCount,
  };
}

/**
 * Marks one notification read.
 *
 * `readAt` is the read state (docs/23 §5); NotificationStatus is left alone so a FAILED
 * delivery stays diagnosable after the student opens the in-app copy.
 *
 * Object-level authorization: userId is part of the WHERE of both statements, so an id
 * belonging to another student matches nothing — it is never fetched and then checked.
 */
export async function markRead(userId: string, notificationId: string) {
  const updated = await db.notification.updateMany({
    where: { ...centerScope(userId), id: notificationId, readAt: null },
    data: { readAt: new Date() },
  });

  if (updated.count === 0) {
    // Either it is not theirs / does not exist, or it was already read. Re-marking is a
    // no-op rather than an error, and must not clobber the original readAt (docs/23 §5
    // keeps it for time-to-read analytics) — so a second, still userId-scoped count
    // separates "already read" from "not yours".
    const exists = await db.notification.count({
      where: { ...centerScope(userId), id: notificationId },
    });
    if (exists === 0) {
      throw new AppError("RESOURCE_NOT_FOUND", "Notification not found.");
    }
  }

  const unreadCount = await db.notification.count({
    where: { ...centerScope(userId), readAt: null },
  });
  return { id: notificationId, unreadCount };
}

export async function markAllRead(userId: string) {
  const updated = await db.notification.updateMany({
    where: { ...centerScope(userId), readAt: null },
    data: { readAt: new Date() },
  });
  return { updated: updated.count, unreadCount: 0 };
}
