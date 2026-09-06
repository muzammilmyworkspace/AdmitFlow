# 05 — Non-Functional Requirements

**Document status:** Foundational — v1.0
**Depends on:** `00-project-charter.md`, `01-product-requirements.md`, `04-functional-requirements.md`
**Related (separate docs, not duplicated here):** `14-security-architecture.md`, `49-threat-model.md`

---

## 1. Purpose

This document sets the quality bar every functional requirement in `04-functional-requirements.md` must be delivered within: performance, scalability, availability, accessibility, security baseline, internationalization-readiness, timezone/locale/currency handling, mobile-first responsiveness, and maintainability. Where detailed security/threat-model content belongs in dedicated docs, this document states only the NFR-level bar and defers detail to avoid duplication/drift.

---

## 2. Performance

- **NFR-PERF-1:** Core student flow pages (dashboard, assessment results, document vault, application tracker) shall achieve Largest Contentful Paint (LCP) under 2.5s at P75 on mobile 4G-equivalent conditions.
- **NFR-PERF-2:** Time to Interactive on the onboarding wizard shall not exceed 3s at P75 on mobile.
- **NFR-PERF-3:** No API endpoint shall execute an unbounded database query (i.e., a query without a `LIMIT`/pagination bound) against a collection that can grow with usage — this explicitly includes: universities/programs, applications, audit logs, users (admin views), payments, documents, and notifications.
- **NFR-PERF-4:** All list endpoints shall support cursor- or offset-based pagination with a sane default page size (e.g., 20–50) and an enforced maximum page size to prevent abuse.
- **NFR-PERF-5:** Any operation expected to exceed ~500ms of synchronous work (e.g., assessment scoring runs, document virus/format scanning, bulk exports, notification fan-out) shall be executed asynchronously via BullMQ-backed background workers, not inline in the HTTP request/response cycle.
- **NFR-PERF-6:** Document upload/download flows shall use direct-to-S3 signed URLs so file bytes never transit the application server, minimizing server load and latency.
- **NFR-PERF-7:** Frequently-read, rarely-changed data (e.g., published Questionnaire schema, active scoring-rules version, Product/Price config) shall be cached with an explicit, short invalidation strategy rather than queried fresh on every request.
- **NFR-PERF-8:** Database queries on high-traffic paths (assessment result retrieval, document list, application list) shall be covered by appropriate indexes; query plans for these paths shall be reviewed before production release.

---

## 3. Scalability

- **NFR-SCALE-1:** The architecture shall support growth from 100 to 10,000+ active students without requiring a fundamental re-architecture — horizontal scaling of the Next.js application tier and background workers is the assumed scaling lever, not a rewrite of the data model or job architecture.
- **NFR-SCALE-2:** Background job processing (BullMQ + Redis) shall be horizontally scalable by adding worker instances, with job queues partitioned by type (e.g., notifications, assessment scoring, document processing) so a backlog in one queue does not starve another.
- **NFR-SCALE-3:** The relational data model (PostgreSQL + Prisma) shall avoid patterns that degrade non-linearly with scale — e.g., no unbounded self-joins on unindexed columns, no N+1 query patterns on list views.
- **NFR-SCALE-4:** Stateless application server design is required — no in-memory session or job state that would prevent running multiple application server instances behind a load balancer.
- **NFR-SCALE-5:** The system shall be load-tested against a target of at least 10,000 registered students with realistic concurrent-usage assumptions (e.g., peak concurrent onboarding/assessment activity) before that scale is reached in production, not only after issues appear.
- **NFR-SCALE-6:** Multi-tenant-style growth (e.g., adding new destination countries, new document types, new questionnaire sections) shall be achievable via configuration/data changes, consistent with the "configurable over hardcoded" principle, without schema-breaking migrations.

---

## 4. Availability

- **NFR-AVAIL-1:** The production platform shall target a minimum of 99.9% monthly uptime for core student-facing flows (auth, dashboard, assessment, document vault, applications, payments).
- **NFR-AVAIL-2:** Scheduled maintenance windows shall be communicated in advance via the notification system and shall avoid peak usage periods where feasible.
- **NFR-AVAIL-3:** A dependency outage (e.g., payment provider, email provider) shall degrade gracefully — the affected feature shows a clear, honest unavailability message while unrelated features (e.g., browsing REACH matches) remain functional.
- **NFR-AVAIL-4:** Background job failures (e.g., a notification send failure) shall not block or fail the primary user-facing transaction they are attached to (e.g., a successful payment must not be rolled back because a confirmation email failed to send); failures are retried and monitored independently.

---

## 5. Accessibility (WCAG 2.2 AA)

WCAG 2.2 AA compliance is a shipping requirement for all student- and consultant-facing flows, not a post-launch improvement.

- **NFR-A11Y-1:** All interactive elements (buttons, links, form controls, custom widgets) shall be reachable and operable via keyboard alone, in a logical tab order matching visual layout.
- **NFR-A11Y-2:** All focusable elements shall have a visible focus indicator meeting WCAG 2.2's focus-appearance criteria (not removed via `outline: none` without an equally visible replacement).
- **NFR-A11Y-3:** All pages shall use semantic HTML (headings in a logical hierarchy, `<button>` for actions, `<nav>`/`<main>`/`<form>` landmarks) rather than generic `<div>`-based interactive controls.
- **NFR-A11Y-4:** Text and meaningful UI contrast shall meet WCAG 2.2 AA ratios (4.5:1 for normal text, 3:1 for large text and meaningful graphical/UI elements), verified in both light and dark modes if both are supported.
- **NFR-A11Y-5:** All form fields shall have a programmatically associated label (not placeholder-only labeling), clear required/optional indication, and inline, specific error messages associated via `aria-describedby` or equivalent.
- **NFR-A11Y-6:** All custom dialogs/modals (e.g., payment confirmation, document rejection detail) shall trap focus while open, be dismissible via keyboard (Escape), and return focus to the triggering element on close.
- **NFR-A11Y-7:** All custom dropdowns/comboboxes (e.g., country selector, university filter) shall follow the appropriate ARIA authoring pattern (role, state, keyboard interaction) rather than relying on visual styling alone to convey state.
- **NFR-A11Y-8:** Multi-step flows (onboarding wizard, application submission) shall expose progress via an accessible progress indicator (e.g., `aria-valuenow`/`aria-valuemax` or equivalent programmatic exposure), not a purely visual progress bar.
- **NFR-A11Y-9:** The system shall respect the user's `prefers-reduced-motion` setting, disabling or substantially reducing non-essential animation/transition effects when set.
- **NFR-A11Y-10:** All images/icons conveying meaning shall have appropriate text alternatives; purely decorative images shall be marked so assistive technology skips them.
- **NFR-A11Y-11:** Status changes communicated asynchronously (e.g., "document verified," "payment processing," toast notifications) shall be exposed via ARIA live regions so screen reader users receive them without needing to re-navigate.
- **NFR-A11Y-12:** Automated accessibility testing (e.g., axe-core in CI) shall run against core flows on every release, with zero tolerance for blocking (serious/critical) violations before release.

---

## 6. Security Baseline

*(Full security architecture and threat model live in `14-security-architecture.md` and `49-threat-model.md`; this section states only the non-negotiable bar every feature must meet — it does not restate detailed control design.)*

- **NFR-SEC-1:** No password, payment card number, or other authentication secret shall ever be stored in plaintext or logged in application/error logs.
- **NFR-SEC-2:** No document or other private student data shall ever be reachable via a public or predictably-guessable URL; all access is via short-lived signed URLs issued after a server-side authorization check.
- **NFR-SEC-3:** Server-side authorization checks are mandatory on every API route that reads or writes user-specific or role-gated data; frontend route/UI restriction is never treated as a control.
- **NFR-SEC-4:** All data in transit shall be encrypted (TLS) end-to-end, including internal service-to-service calls where they cross a network boundary.
- **NFR-SEC-5:** All data at rest (database, S3, backups) shall be encrypted using provider-managed or customer-managed encryption at rest.
- **NFR-SEC-6:** Every state-changing action relevant to trust/compliance (verification, entitlement grant/revoke, role change, payment) shall produce an immutable audit log entry, per `01-product-requirements.md` and `03-user-journeys.md`.
- **NFR-SEC-7:** Object-level authorization (ownership/scope checks per resource, not just role checks) is mandatory on every resource-by-ID access path, per `02-personas-and-roles.md` §7.
- **NFR-SEC-8:** Detailed threat modeling, penetration-test scope, and control-by-control mapping are owned by `14-security-architecture.md` and `49-threat-model.md` — this NFR document is the enforcement bar those documents must satisfy, and neither document should be treated as optional context.

---

## 7. Internationalization (i18n) Readiness

The v1 UI ships in English only (per `00-project-charter.md` Out of Scope), but the architecture must not need rework to add languages.

- **NFR-I18N-1:** All user-facing strings shall be sourced from a centralized translation/resource layer (e.g., message catalogs keyed by string ID), never hardcoded inline within business-logic components or deep utility functions.
- **NFR-I18N-2:** Business logic (validation rules, scoring engine, state machines) shall be fully decoupled from display strings — changing or translating copy shall never require touching logic code.
- **NFR-I18N-3:** The string resource layer shall support pluralization, interpolation (e.g., inserting a student's name, a price, a date), and right-to-left (RTL) layout readiness, anticipating future languages including Urdu, Arabic, French, and German (Arabic and Urdu require RTL layout support).
- **NFR-I18N-4:** All date, time, number, and currency formatting shall go through locale-aware formatting utilities, never manually concatenated strings, so that adding a locale is a configuration change.
- **NFR-I18N-5:** Backend-generated content that reaches the user (transactional emails, notification text, document-rejection reason templates) shall also be sourced from the same centralized resource layer, not string-concatenated in backend code.

---

## 8. Timezone, Locale, and Currency Handling

- **NFR-TZ-1:** All timestamps shall be stored in UTC in the database, with no exceptions for "convenience" local-time storage anywhere in the schema.
- **NFR-TZ-2:** Every user record shall carry a resolved timezone (auto-detected at signup/login, user-overridable) and locale/currency preference, used consistently for all date/time/price rendering.
- **NFR-TZ-3:** Any deadline, countdown, or scheduled event (application deadline, consultation slot, reminder) shall be computed and displayed against the student's **current** timezone setting at render time, not "frozen" to whatever timezone was active when the record was created — see `01-product-requirements.md` §7/§8 for the specific application-deadline and consultation-booking cases this governs.
- **NFR-TZ-4:** Consultation booking screens shall display both the student's local time (primary, prominent) and the consultant's local time (secondary, contextual) for every slot, with explicit timezone labels (not just an offset).
- **NFR-TZ-5:** Currency for any price display (unlock fee, application fee, consultation fee) shall be resolved from the student's account currency preference; the authoritative price basis stored in the Product/Price configuration remains the source of truth, with display-currency conversion handled as a presentation concern, never altering the stored/charged amount ambiguously.
- **NFR-TZ-6:** Any background job that schedules a future action based on a timestamp (e.g., a reminder) shall re-resolve the recipient's current timezone at send time rather than baking in the timezone at schedule time.

---

## 9. Mobile-First Responsive Design

- **NFR-MOB-1:** Every screen shall be designed and implemented mobile-first (base styles target small viewports; larger breakpoints are additive enhancements), not designed for desktop and passively shrunk.
- **NFR-MOB-2:** The platform shall support, at minimum, four responsive tiers: mobile (~360–480px), tablet (~600–1024px), laptop (~1024–1440px), and desktop (1440px+), with layout, navigation, and information density adapted at each tier — not merely reflowed.
- **NFR-MOB-3:** Primary navigation on mobile shall use a mobile-appropriate pattern (e.g., bottom tab bar or slide-out drawer) rather than a shrunk desktop top-nav; the "what should I do next" primary action shall always be reachable without scrolling on mobile dashboard views.
- **NFR-MOB-4:** University/program match listings shall render as touch-friendly cards on mobile (not dense multi-column tables), with progressive disclosure of secondary detail (tap to expand) rather than cramming all data into the initial view.
- **NFR-MOB-5:** Document upload on mobile shall support native camera capture in addition to file picker, given many students will photograph physical documents rather than scan them.
- **NFR-MOB-6:** Payment flows on mobile shall use large, thumb-reachable tap targets (minimum 44x44px per WCAG 2.2 target-size guidance), avoid small dense forms, and support relevant mobile payment affordances (e.g., autofill, saved card via platform APIs) where the payment provider supports them.
- **NFR-MOB-7:** Consultation booking on mobile shall present time-slot selection in a scrollable, thumb-friendly list/picker rather than a dense desktop-style calendar grid, while still surfacing timezone labeling clearly (per §8).
- **NFR-MOB-8:** Application status tracking on mobile shall use a vertically stacked, glanceable timeline/stepper rather than a wide horizontal stepper that requires horizontal scrolling.
- **NFR-MOB-9:** All interactive tap targets shall meet a minimum size and spacing sufficient to avoid accidental mis-taps, consistent with WCAG 2.2 AA target-size requirements.
- **NFR-MOB-10:** Performance budgets in §2 apply with mobile network conditions as the baseline test condition, not desktop broadband.

---

## 10. Maintainability and Code Quality Bar

- **NFR-MAINT-1:** The codebase shall use TypeScript in strict mode across frontend and backend, with `any` usage requiring explicit justification (e.g., a lint-suppressed comment explaining why), not used as a default escape hatch.
- **NFR-MAINT-2:** No single file/component shall grow unboundedly to hold unrelated responsibilities; components and modules shall be decomposed by responsibility (a "God component" or "God route handler" is treated as a defect, not a style preference).
- **NFR-MAINT-3:** Business logic (scoring computation, entitlement rules, state-machine transitions, validation rules) shall live in dedicated service/domain modules, never embedded directly inside UI components or route handlers — UI components render state and dispatch intents, they do not decide business outcomes.
- **NFR-MAINT-4:** Shared domain logic used by both synchronous request handling and asynchronous background jobs (e.g., entitlement granting logic used by both a webhook handler and an admin override) shall be implemented once and invoked from both call sites, not duplicated.
- **NFR-MAINT-5:** All configurable business rules (pricing, scoring weights, questionnaire content, document requirement sets) shall be data-driven and versioned, consistent with `00-project-charter.md` principle "configurable over hardcoded" — a rule change should be achievable via an admin action or data migration, not a code deploy, wherever product requirements call for it.
- **NFR-MAINT-6:** Automated test coverage shall include unit tests for domain/business logic (especially scoring, entitlement, and state-machine logic) and integration tests for the resilience scenarios enumerated in `01-product-requirements.md` §12 (idempotency, concurrency, session expiry, timezone correctness).
- **NFR-MAINT-7:** Linting and formatting shall be enforced in CI (not just locally), and a pull request shall not be mergeable with failing type-checks, lint errors, or failing tests.
- **NFR-MAINT-8:** Database schema changes shall go through reviewed Prisma migrations; destructive migrations (column/table drops) require explicit sign-off and a documented data-preservation or backfill plan.
- **NFR-MAINT-9:** New engineers/agents shall be able to determine the correct place to add a new questionnaire field, a new document type, or a new pricing tier without touching core scoring/entitlement logic — configuration surfaces shall be discoverable and documented, not implicit tribal knowledge.

---

## 11. Related Documents

- `00-project-charter.md` — the principles (scalable, fast, accessible, secure, maintainable) formalized here
- `01-product-requirements.md` / `04-functional-requirements.md` — the functional scope this quality bar applies to
- `14-security-architecture.md`, `49-threat-model.md` (separate docs) — detailed security control design and threat modeling; this document sets the bar, those documents define how it is met
