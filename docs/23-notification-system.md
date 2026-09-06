# 23 — Notification System

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering
**Depends on:** `06-system-architecture.md` (worker split), `24-background-jobs.md` (delivery jobs), `31-state-machines.md` (events that trigger notifications)
**Applies to:** All email and in-app communication sent by the platform

---

## 1. Architecture

AdmitFlow has one notification service, not a scatter of ad-hoc `sendEmail()` calls sprinkled through business logic. Every part of the platform that needs to notify a user goes through the same path:

```
Business logic (route handler or worker job)
        │
        │  emits a domain event, e.g. ApplicationSubmittedEvent { applicationId, studentId, ... }
        ▼
Notification service (library code, callable from both Next.js route handlers and the worker)
        │  1. Look up the event → channel(s) mapping (§2)
        │  2. Look up the student's NotificationPreference for this event's category
        │  3. Resolve the correct NotificationTemplate (event, channel, locale)
        │  4. Enqueue delivery job(s) — never send synchronously
        ▼
BullMQ queue: `notifications`
        │
        ▼
Worker: `notification-send` job → writes the in-app Notification row (+ real-time push to an open session if applicable)
Worker: `email-send` job        → calls the email provider API, records delivery status
```

**Rule (restated from `06-system-architecture.md` §6, "Notifications is a sink, not a dependency"): no code path in a Next.js route handler ever calls an email/SMS provider directly, and no code path blocks a user-facing response on notification delivery.** A route handler (or a worker job that is doing something else, e.g. the document-verification job) enqueues a job and returns; the `notifications` queue is what actually talks to providers. This means a slow or down email provider degrades to queue depth/delay, never to a failed or slow user-facing request.

### 1.1 Channels

| Channel | Status | Notes |
|---|---|---|
| **Email** | v1, live | Primary channel; the only channel guaranteed to reach a user who isn't currently in the app. |
| **In-app** | v1, live | Persistent notification center + unread badge; the record of truth for "what has the student been told," independent of whether the email was opened. |
| **Push (mobile/web push)** | **Future — not in v1** | Data model (`NotificationTemplate.channel` enum already includes `PUSH`) anticipates it; no delivery implementation exists yet. |
| **SMS / WhatsApp** | **Future — not in v1** | Same treatment as push — reserved in the enum, not built. Relevant for time-critical deadline alerts in a later phase given patchy email-checking habits in the target user base (see `02-personas-and-roles.md` §2). |

Every notification event below is delivered on Email + In-app in v1. When Push/SMS ship, they are added as additional rows to the same mapping table — no architectural change required, because delivery is already decoupled per-channel behind the same job.

## 2. Event → Channel → Template Mapping

| Event | Channel(s) v1 | Template key | Category | Notes |
|---|---|---|---|---|
| `WELCOME` | Email, In-app | `welcome` | Essential | Fired on `Account.REGISTERED → EMAIL_UNVERIFIED` (§2 of `31-state-machines.md`); email carries the verification link. |
| `EMAIL_VERIFIED` | Email, In-app | `email_verified` | Essential | Fired on `EMAIL_UNVERIFIED → VERIFIED`. |
| `DOCUMENT_REJECTED` | Email, In-app | `document_rejected` | Essential | Fired on Document `D7`/`D10` (§4 of `31`). Must include the rejection reason and a direct link to re-upload. |
| `DOCUMENT_VERIFIED` | Email, In-app | `document_verified` | Essential | Fired on Document `D9`. |
| `ASSESSMENT_READY` | Email, In-app | `assessment_ready` | Essential | Fired when assessment-processing job (`24-background-jobs.md`) completes. |
| `PAYMENT_SUCCESS` | Email, In-app | `payment_success` | Essential — **email not user-disable-able** | Doubles as the payment receipt; a financial record the student must always receive by email regardless of preference (§3). |
| `PAYMENT_FAILED` | Email, In-app | `payment_failed` | Essential | Must include a clear, jargon-free reason where the provider gives one, and a retry link. |
| `BOOKING_CONFIRMED` | Email, In-app | `booking_confirmed` | Essential | Fired on Booking `B5`; email includes a calendar-addable event (`.ics`) attachment. |
| `BOOKING_REMINDER` | Email, In-app | `booking_reminder` | Essential | Fired by the `booking-reminders` job at fixed offsets (24h and 1h before the session) per `24-background-jobs.md`. Times shown in the **recipient's** timezone. |
| `APPLICATION_SUBMITTED` | Email, In-app | `application_submitted` | Essential | Fired on Application `P6`. |
| `APPLICATION_STATUS_CHANGED` | Email, In-app | `application_status_changed` | Essential | Fired on Application `P7`–`P13`. Template context includes both the old and new status so the copy can render a human-readable transition, not just the raw enum. |
| `DEADLINE_APPROACHING` | Email, In-app | `deadline_approaching` | Essential | Fired by the `deadline-alerts` job at T-30/T-14/T-7/T-1 days relative to a program's application deadline, for any application not yet `SUBMITTED`. Deadline rendered in the recipient's timezone; underlying value is the same UTC instant for every recipient. |

**Decision:** none of the above are `MARKETING` category. A separate, smaller set of events (`PRODUCT_TIPS`, `NEWSLETTER`, `PROMOTIONAL_OFFER` — not detailed here, owned by growth/marketing tooling when built) is the only thing gated by the marketing opt-in in §3. Every event in this table is service/transactional communication tied to an action the student took or a status change affecting them.

## 3. Templates Are Data, Not Code

**Decision:** every message body/subject the platform sends lives in a `NotificationTemplate` row, never as a string literal inside business logic.

```
NotificationTemplate {
  id
  eventType        // e.g. "APPLICATION_STATUS_CHANGED"
  channel          // EMAIL | IN_APP | PUSH (reserved) | SMS (reserved)
  locale           // "en", "ur", "ar", "fr", "de" — en is the only populated locale in v1
  subjectTemplate  // email only
  bodyTemplate     // interpolated with a fixed, per-event context schema
  version
  isActive
  effectiveFrom
  createdBy / updatedBy
}
```

Why this matters, concretely:

- **i18n without a deploy.** AdmitFlow's students are international and the roadmap explicitly includes Urdu, Arabic, French, and German. If email copy were embedded in TypeScript template literals, adding a language would mean an engineering release and a re-audit of every call site for hardcoded strings. With `NotificationTemplate`, adding a locale is inserting new rows; the notification service already resolves `(eventType, channel, locale)` and falls back to `en` if a requested locale has no active template.
- **Content changes without a deploy.** A support/ops team correcting a confusing rejection-reason email, or legal requiring updated payment-receipt language, is a content edit, not a code change — same rationale already applied to pricing in `00-project-charter.md` §10 ("pricing is data, not code").
- **Versioning and audit.** Every send records which `NotificationTemplate.version` was used (on the delivery record, §5), so a dispute about "what did the email actually say" is answerable even after the template is later edited.
- **A fixed context schema per event** (documented alongside each event, e.g. `APPLICATION_STATUS_CHANGED` → `{ studentFirstName, applicationId, universityName, programName, oldStatus, newStatus, statusChangedAtLocal, ctaUrl }`) is what the template's placeholders are allowed to reference. The notification service validates that every placeholder in an active template resolves against the known schema before allowing the template to be activated — this catches a typo'd `{{ studentFistName }}` at template-save time, not in production email.

## 4. Notification Preferences

**Entity:** `NotificationPreference` (per student, per event category — not per individual event, to keep the settings UI small; category granularity is the deliberate choice).

**Decision:** preferences are split into exactly two independently-controlled buckets:

| Category | Can the student fully disable it? | Notes |
|---|---|---|
| **Essential / service** (every event in §2's table — payment, application, document, booking, security notices) | **No, not fully.** Per-channel toggles exist for convenience (e.g. a student may turn off email for `BOOKING_REMINDER` if in-app is sufficient for them), but the system enforces server-side that **at least one live channel remains enabled per essential category** — a save request that would zero out every channel for an essential category is rejected (`VALIDATION_ERROR`). `PAYMENT_SUCCESS`, `PAYMENT_FAILED`, and any future account-security notice (password changed, new-device login) are additionally hardcoded to always send by email regardless of the per-channel toggle, because these are financial/security records the student must receive on a durable channel. |
| **Marketing** (`PRODUCT_TIPS`, `NEWSLETTER`, `PROMOTIONAL_OFFER`, and any future growth communication) | **Yes, fully — and it is opt-in by default false.** `NotificationPreference.marketingOptIn` starts `false` for every new account (no dark patterns, no pre-checked box) and is independently, instantly revocable from account settings with no confirmation friction. It is stored and audited **separately** from essential-category toggles so a student can never accidentally silence a payment-failure notice while trying to unsubscribe from marketing email, and so consent for marketing is evidenced independently for any future compliance need (e.g. CAN-SPAM/GDPR-style consent record-keeping). | 

This directly implements the requirement that "marketing consent must be a distinct, separately revocable opt-in from essential/service notifications, which cannot be fully disabled."

## 5. In-App Notification Model

```
Notification {
  id
  userId
  eventType
  title
  body
  metadata        // JSON — event-specific context for rendering (e.g. { applicationId, deepLinkUrl })
  channel: IN_APP
  isRead: boolean  (default false)
  readAt: timestamptz | null
  createdAt
  templateVersion  // which NotificationTemplate.version rendered this row, for audit
}
```

- **Unread state** is a single boolean plus `readAt` for analytics (time-to-read), not a separate read-receipt table — this is per-notification, per-user, and there is exactly one row per delivered in-app notification (no fan-out needed since each `Notification` already belongs to one `userId`).
- The notification center exposes: unread count (badge), mark-one-read (on open/click), mark-all-read, and pagination newest-first.
- **Retention:** in-app notifications are retained and visible for 12 months, then archived (moved out of the default query, not deleted) — consistent with the soft-delete-never-hard-delete posture in `09-database-architecture.md` §6.3, since a notification can be relevant evidence in a support dispute (e.g. "I was never told my document was rejected").
- In-app notifications are **never** the sole delivery for an essential event by default — email is the durable channel that reaches a student who isn't currently in the app; in-app is the always-on companion record.

## 6. Delivery Is Always Asynchronous

Restating the binding rule from `06-system-architecture.md`: notification delivery is **never** performed synchronously inside a Next.js API route handler. The two delivery job types are defined fully in `24-background-jobs.md`:

- `notification-send` — writes the `Notification` (in-app) row and, when Push/SMS ship, fans out to those provider-specific jobs.
- `email-send` — calls the transactional email provider, records the provider's message ID and delivery status, retries on transient provider failure.

A route handler's or worker job's only responsibility toward notifications is to enqueue one of these jobs with a well-formed event payload; it never waits on the result.

## 7. What This Document Does Not Cover

- Job-level retry/backoff/idempotency specifics for `notification-send`/`email-send` — see `24-background-jobs.md`.
- Exact HTML/branding of email templates — a design/content deliverable, not an architecture one.
- Push/SMS provider selection — deferred until those channels are built.
