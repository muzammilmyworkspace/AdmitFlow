# 07 — Frontend Architecture

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering (Frontend)
**Applies to:** All Next.js application code

---

## 1. Stack

- **Framework:** Next.js 15+, App Router, TypeScript (strict mode on), React Server Components by default, Client Components only where interactivity requires it.
- **Styling:** Tailwind CSS, with design tokens (§7) as the single source of visual truth — no ad hoc hex values in component code.
- **Runtime split:** this app is the request/response surface only (see `06-system-architecture.md` §5). It never performs long-running work; anything that would block a response is delegated via API call to a queued job on the worker service.

## 2. Folder Structure

```
src/
├── app/                          # Next.js App Router: routing + composition only
│   ├── (public)/                 # Marketing, login, signup, verify-email — no auth required
│   │   ├── page.tsx
│   │   ├── login/
│   │   ├── signup/
│   │   └── verify-email/
│   ├── (app)/                    # Authenticated app shell
│   │   ├── layout.tsx            # Session check, nav, role-aware shell
│   │   ├── onboarding/
│   │   ├── assessment/
│   │   ├── universities/
│   │   ├── documents/
│   │   ├── applications/
│   │   ├── consultation/
│   │   ├── billing/
│   │   └── notifications/
│   ├── (admin)/                  # ADMIN/SUPER_ADMIN (and future admin roles) shell
│   │   └── admin/
│   └── api/
│       └── v1/                   # Route handlers — thin, see 08-backend-architecture.md
│           ├── auth/
│           ├── users/
│           ├── profiles/
│           ├── onboarding/
│           ├── questionnaires/
│           ├── assessment/
│           ├── universities/
│           ├── programs/
│           ├── vault/
│           ├── applications/
│           ├── consultation/
│           ├── billing/
│           ├── payments/
│           ├── notifications/
│           └── admin/
│
├── features/                     # Feature-owned UI — one folder per bounded module
│   ├── auth/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── api/                  # typed client calls for this feature only
│   │   ├── schemas/               # zod (or equivalent) validation schemas
│   │   ├── types/
│   │   └── state/                 # feature-local client state (if any)
│   ├── onboarding/                (same internal shape)
│   ├── assessment/                (same internal shape)
│   ├── universities/              (same internal shape)
│   ├── documents/                 (same internal shape — Document Vault UI)
│   ├── applications/               (same internal shape)
│   ├── consultation/               (same internal shape)
│   ├── billing/                    (same internal shape)
│   ├── notifications/              (same internal shape)
│   └── admin/                      (same internal shape, further split by admin sub-area)
│
├── components/                   # Design-system components — cross-feature, no business logic
│   ├── ui/                        # Button, Input, Select, Modal, Toast, etc. (§8)
│   └── layout/                    # AppShell, PageHeader, Sidebar, etc.
│
├── lib/                           # Framework-adjacent infrastructure, not business logic
│   ├── api-client/                # Centralized typed HTTP client (§4)
│   ├── auth/                      # Client-side session helpers (read-only; never decides authz)
│   ├── query/                     # Server-state cache config (§3)
│   ├── validation/                # Shared schema helpers/utilities
│   └── utils/                     # Pure helpers (formatting, date math, etc.)
│
├── services/                      # Cross-feature orchestration used by app/ pages
│                                    # (e.g., composing multiple feature API clients for a dashboard page)
│
├── hooks/                         # Cross-feature hooks (useMediaQuery, useDebounce, etc.)
│
├── schemas/                       # Cross-feature shared schemas (e.g., pagination envelope, error shape)
│
├── types/                         # Cross-feature shared types (API envelope types, role enums, etc.)
│
├── config/                        # Runtime config: design tokens, feature-flag client, env-derived constants
│
├── styles/                        # Tailwind config, globals.css, token CSS variables
│
└── tests/                         # Component/integration tests mirroring feature structure
```

**Decision:** every `features/*` folder owns its UI, hooks, API client calls, schemas, types, and any client state related to that module, and never imports another feature's internals directly (only via that feature's public `index.ts`, or better, not at all — cross-feature composition happens in `app/` or `services/`). Rationale: this is what lets the codebase scale from a handful of features to the full role set (`UNIVERSITY_MANAGER`, `APPLICATION_REVIEWER`, etc.) without cross-cutting rewrites — a new feature is a new folder, not a refactor of existing ones.

## 3. State Management

AdmitFlow draws a hard line between **server state** and **client state**, and treats most of the app as the former.

- **Server state** (assessment results, applications, documents, catalog data, billing status — i.e. anything that lives in Postgres/S3): fetched through the centralized API client (§4) using a React Query–style pattern (stale-while-revalidate cache, keyed by endpoint + params, automatic refetch on window focus/reconnect for data that can change server-side, mutation hooks that invalidate the relevant query keys on success). This is the default for essentially every screen.
- **Client state** (form draft values before submit, modal open/closed, active tab, wizard step, sort/filter UI selection before it's applied): local component state or a lightweight feature-scoped store. Client state is never used to hold a copy of server-authoritative data beyond the current render cycle.

**Decision:** no global client-state store (Redux/Zustand-style) for domain data. Rationale: domain data already has a canonical cache in the server-state layer; a second global store would create two sources of truth that can drift, which is exactly the class of bug that matters most in a system with paywalled data and legal/compliance exposure. A small, feature-scoped store is acceptable only for genuinely ephemeral, multi-component UI state (e.g. a multi-step application wizard's current step) — never for anything that round-trips through the API.

## 4. Centralized Typed API Client

All network calls go through one client module (`lib/api-client/`), never raw `fetch` scattered through components. It provides:

- **Base URL + versioning:** always targets `/api/v1/*`; a client-side constant, never hardcoded per call site.
- **Auth headers:** attaches the session cookie/bearer token automatically; callers never manually set auth headers.
- **Request ID propagation:** generates a `x-request-id` (UUID) per outgoing call if one isn't already in flight (e.g. for a retry, the same ID is reused), so a single logical action can be traced end-to-end through Next.js route handler logs and worker job logs (see `28-observability.md`).
- **Typed responses:** every endpoint has a generated or hand-written TypeScript type for its success and error envelope; the client returns `Result<T, ApiError>`-shaped values, never `any`.
- **Retry policy:** idempotent GETs retry on network failure/5xx with capped exponential backoff (e.g. up to 2 retries); mutating calls (POST/PATCH/DELETE) do **not** auto-retry unless the endpoint is documented as safe-to-retry (idempotency-key-backed — see `48-idempotency.md`), to avoid duplicate side effects like double-booking a consultation slot.
- **Error normalization:** every failure — network error, validation 400, auth 401/403, not-found 404, server 5xx — is normalized into one `ApiError` shape (`code`, `message`, `fieldErrors?`) so feature UI never branches on raw HTTP status codes; it branches on `code`.
- **Entitlement/authorization transparency:** the client does not interpret 402/403 responses as anything beyond "cannot proceed" — see §9.

```
lib/api-client/
├── client.ts          # fetch wrapper: base URL, headers, request-id, retry, timeout
├── errors.ts          # ApiError type + normalization
├── types.ts           # shared envelope types (Paginated<T>, ApiError, etc.)
└── endpoints/         # thin per-module wrappers re-exported for features to consume
```

Feature-level `api/` folders (e.g. `features/applications/api/`) call into `lib/api-client` and add only the feature-specific request/response typing — they do not reimplement headers, retries, or error handling.

## 5. Form Architecture

- **Schema-based validation:** every form (login, onboarding steps, questionnaire pages, document metadata, admin edit forms) is backed by a schema (zod or equivalent) that is the single source of truth for both client-side validation and the shape sent to the API. The same schema (or a server-safe subset) is reused by the corresponding API route handler's input validation (see `08-backend-architecture.md` §3) so client and server validation cannot drift.
- **Server error surfacing:** a 400 response's `fieldErrors` map is matched back onto form fields by name; unmatched/general errors surface as a form-level banner. Client-side validation is a UX convenience, not the authority — the server's validation result is what's rendered as final truth on submit.
- **Autosave/resume:** long multi-step forms (onboarding, questionnaire, application wizard) autosave on step-change and on a debounce interval while typing in a step, via a dedicated draft-save endpoint distinct from final submit. On re-entry, the form hydrates from the last saved draft server-side (not from local storage — local storage is not treated as durable for this purpose, since a student may switch devices).
- **Dirty-state guard on navigation away:** any form with unsaved changes blocks in-app navigation and the browser's own unload with a confirmation prompt, unless autosave has just completed successfully. This is implemented once as a shared hook (`hooks/useDirtyFormGuard`) rather than per-feature.

## 6. Loading / Empty / Error State Conventions

Every data-fetching screen uses the same three-state contract, driven by the server-state layer's query status:

| State | Convention |
|---|---|
| **Loading** | `Skeleton` components matching the target layout's shape (never a generic spinner-only screen for primary content; a spinner is acceptable only for small inline actions like a button's own pending state) |
| **Empty** | `EmptyState` component: icon/illustration + one-sentence explanation + a primary action where one exists (e.g. "No applications yet" → "Browse your matches") |
| **Error** | `ErrorState` component: normalized `ApiError.message` (never a raw stack trace or raw HTTP status), a retry action wired to re-trigger the failed query, and a support-contact link for persistent failures |

These three components live in `components/ui/` and are composed, not reimplemented, by every feature.

## 7. Design Tokens

Tokens are defined once (`styles/tokens.css` as CSS variables, mirrored into `tailwind.config`) and consumed everywhere — no component hardcodes a color, spacing, or font value.

**Color:**

**Decision (supersedes the placeholder palette below — see `54-decision-log.md` §"Logo-derived brand palette"):** once the SnZ Ventures logo was supplied, the palette was re-derived from it rather than kept as an arbitrary starting guess, per the brand rule that the logo is the primary identity reference. The logo is a navy-ringed badge on white, with the "SnZ" wordmark split diagonally — a fresh mid-tone green on the upper-left, deep navy on the lower-right — and "VENTURES" in a muted gray beneath. That gives a **Green → Navy** brand relationship, not a Navy → Mint → Indigo one:

| Token | Value | Usage |
|---|---|---|
| `color-primary` | `#0A2540` (SnZ Navy — unchanged, matches logo exactly) | Primary brand surface, headers, primary buttons |
| `color-secondary` | `#3DA35D` (SnZ Green — sampled approximation of the logo's green; **OPEN QUESTION** in `55-known-risks-and-open-questions.md`: confirm exact hex against the source vector/high-res logo file before final brand sign-off) | Secondary brand surface, success/positive accents, the brand gradient's light end |
| `color-accent` | `#635BFF` (Vibrant Indigo — retained from the original brief as a *tertiary*, sparingly-used accent; it does not appear in the logo, so it is demoted from "secondary" to an optional premium-moment accent, not a brand-defining color) | Rare premium-unlock/CTA emphasis only — never primary or secondary UI weight |
| `color-bg` | `#F8F9FA` | App background |
| `color-surface` | `#FFFFFF` | Card/panel surfaces |
| `color-text-primary` | `#1A1F36` | Primary text |
| `color-text-secondary` | `#697386` | Secondary/muted text |

The primary brand gradient (§6 of the build-authorization brief) is therefore **`color-secondary → color-primary`** (Green → Navy, matching the logo's own diagonal split), used exactly where that brief specifies gradients belong (hero backgrounds, premium feature cards, assessment highlights, CTA emphasis) — Indigo may tint a gradient's midpoint for premium/paywall-unlock surfaces only, never replace the Green→Navy relationship as the default. `#00D4B2` (Electric Mint) from the original brief is dropped entirely — it does not appear in the logo and a Green secondary already fills its "positive/success accent" role, so keeping both would violate the "don't force arbitrary colors" rule. Contrast note: SnZ Green at this tone should be checked against white/`color-bg` for AA text contrast before use in small body text (see `43-accessibility.md`); treat it as a UI/accent color first and a text color only after that check passes.

**Typography:** font family `Inter` (system-ui fallback stack); type scale defined as `text-xs` through `text-4xl` Tailwind steps, weights 400/500/600/700 only (no arbitrary weights).

**Spacing:** 4px base unit scale (`space-1` = 4px through `space-16` = 64px), matching Tailwind's default spacing scale — no off-scale magic numbers in component styles.

**Radius:** `radius-sm` (4px, inputs/badges), `radius-md` (8px, cards/buttons), `radius-lg` (16px, modals/large panels), `radius-full` (pills/avatars).

**Shadows:** `shadow-sm` (subtle card lift), `shadow-md` (dropdowns/popovers), `shadow-lg` (modals/drawers) — no custom one-off shadow values per component.

**Breakpoints:** `sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px, `2xl` 1536px (Tailwind defaults) — mobile-first is the default authoring direction per `00-project-charter.md` §7.

**Motion:** `duration-fast` 120ms (hover/focus feedback), `duration-base` 200ms (most transitions), `duration-slow` 320ms (modal/drawer enter-exit); easing `ease-out` for entrances, `ease-in` for exits — no bespoke easing curves per component.

## 8. Design System Component Inventory

All in `components/ui/`, each with its own variants, no feature-specific styling forked into a feature folder:

`Button`, `Input`, `Select`, `Checkbox`, `Radio`, `Modal`, `Drawer`, `Toast`, `Badge`, `Card`, `Table`, `Tabs`, `Progress`, `Timeline`, `Stepper`, `UploadZone`, `FileCard`, `UniversityCard`, `ApplicationCard`, `PaymentCard`, `EmptyState`, `ErrorState`, `Skeleton`.

Notes on a few with cross-cutting rules:

- **UploadZone / FileCard** (Document Vault): never handle the actual file bytes beyond streaming to the signed upload URL the API issued; they render progress/status only, and never construct or guess an S3 URL themselves.
- **UniversityCard / ApplicationCard / PaymentCard:** pure presentational components driven entirely by props from the server-state layer; they contain no fetching logic and no entitlement logic (see §9).
- **Table:** always paginated (cursor-based, per `34-performance-strategy.md`) — there is no "Table" variant that renders an unbounded list.

## 9. Entitlement/Paywall Rendering Rule (binding)

**The frontend never decides entitlement or unlock state.** There is no client-side "if locked, blur the content" logic anywhere in the codebase, because locked fields are never sent to the client in the first place — the API response for a paywalled resource (e.g. Target/Safe zone matches) omits the gated fields entirely for a student without the entitlement and includes a `locked: true` / `unlockHint` marker instead of the real data. The UI renders exactly what it's given: if the field isn't in the payload, it renders a locked-state card driven by the presence of the lock marker, not by any client-side computation of "should this be visible." This is a security property, not a UX detail — see `14-security-architecture.md` for the server-side enforcement contract. Any PR that adds a client-side branch computing whether a user "should" see gated data (as opposed to rendering what the API already decided) is a defect, not a style choice.

## 10. Testing Conventions

`tests/` mirrors `features/` and `components/`. Component tests assert on rendered output for each of loading/empty/error/populated states (§6) and on the entitlement-rendering rule (§9) — every gated component has a test asserting it renders the locked state correctly when the API omits gated fields, and never attempts to compute lock status itself.
