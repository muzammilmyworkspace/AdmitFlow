# 43 — Accessibility

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering
**Depends on:** `00-project-charter.md` (WCAG 2.2 AA is a shipping requirement, §7)
**Read alongside:** `35-testing-strategy.md` (how these requirements are gated in QA/CI), `45-analytics-and-events.md` (motion/async-state events should not assume sight/sound as the only channel)
**Applies to:** Every user-facing screen, component, and flow — student, consultant, and admin surfaces alike

---

## 1. Target and Non-Negotiable Framing

**Target: WCAG 2.2 Level AA**, applied to every core flow (signup, onboarding, assessment, document vault, applications, payments, consultation booking) and to admin/consultant tooling — accessibility is not scoped down for internal-facing screens just because the audience is smaller. Per `00-project-charter.md` §6, zero blocking automated WCAG 2.2 AA violations on core flows is a launch success metric, not an aspiration to revisit later.

This document translates that target into concrete, checkable engineering requirements. It does not restate the WCAG spec in full — it calls out the requirements most likely to be gotten wrong or skipped under deadline pressure, with enough specificity that an engineer or agent can implement and verify against them without re-deriving intent.

## 2. Keyboard Navigation

- **Every interactive element** (links, buttons, form controls, custom components — dropdowns, date pickers, file-upload triggers, modal/drawer controls, the document-vault review actions) must be reachable and operable using only the keyboard. If it responds to a click, it must equally respond to `Enter`/`Space` (for button-role elements) or the ARIA-pattern-appropriate key (arrow keys for listbox/menu-style widgets, per §7).
- **Tab order must be logical** — it follows visual/reading order (generally top-to-bottom, left-to-right for LTR content), not DOM order that happens to diverge from layout due to CSS positioning tricks. A component absolutely positioned out of document flow must not silently jump the tab sequence.
- **No keyboard traps.** A user tabbing into a modal, drawer, or custom widget must always be able to tab back out (or explicitly close it) using the keyboard alone — see §6 for the specific modal/drawer focus-trap contract, which traps focus *within* an open dialog intentionally but must always provide an explicit, keyboard-reachable escape (`Esc`, a focusable close button, or both).
- **Skip links:** every page provides a "Skip to main content" link, visible on keyboard focus, as the first focusable element — critical on pages with a large navigation header (common across the student dashboard, admin console) so a keyboard/screen-reader user isn't forced through the same nav on every page load.
- **Custom interactive components built from non-semantic elements** (a `div` styled to look like a button, a custom checkbox) are only acceptable when they carry the correct `role`, `tabindex="0"`, and key-event handling to fully replicate native behavior — the default and preferred choice is always the real native element (`<button>`, `<input type="checkbox">`) styled to match the design system, per §4.

## 3. Visible Focus States

- **Focus outlines are never removed without a compliant replacement.** `outline: none` / `outline: 0` on `:focus` with no alternative styling is a blocking defect, full stop — it is one of the single most common accessibility regressions introduced by well-intentioned visual polish and must be caught in code review, not just automated scanning.
- Any custom focus style must meet **WCAG 2.2's focus-appearance expectations**: the focus indicator must have sufficient contrast against both the unfocused and focused states of the component, and sufficient size/thickness to be clearly perceptible (a 1px, low-contrast border swap is not sufficient).
- Focus styles must be visually distinct from hover styles — a component that looks identical on `:hover` and `:focus-visible` fails users navigating by keyboard who rely on focus as their only positional signal.
- **Decision:** use `:focus-visible` (not bare `:focus`) as the primary styling hook, so mouse users don't see focus rings on every click while keyboard users always do. Rationale: this is the current best-practice default across major design systems and avoids the historical false tradeoff between "focus rings everywhere look bad for mouse users" and "we removed them entirely."

## 4. Semantic HTML

- **Landmark structure:** every page exposes proper landmark regions — `<header>`, `<nav>`, `<main>` (exactly one per page), `<footer>`, and `<aside>` where genuinely supplementary — so screen-reader users can jump between regions instead of reading linearly through the whole DOM.
- **Heading structure:** headings (`<h1>`–`<h6>`) follow a logical, non-skipping hierarchy per page (one `<h1>` describing the page's purpose, `<h2>`s for major sections, etc.) — headings are never chosen for their default visual size (using an `<h4>` because it "looks right" at a given font size) rather than their semantic level; visual size is a CSS concern, level is a structure concern, and the two must not be conflated.
- **Form labels:** every form input has a programmatically associated `<label>` (via `for`/`id`, or the input nested inside the label) — a placeholder is never a substitute for a label (placeholders disappear on input and are not reliably announced the same way by all assistive tech). Grouped inputs (e.g., a set of radio buttons for a questionnaire question) are wrapped in `<fieldset>`/`<legend>`, not just visually grouped with a heading-like `<div>` above them.
- **Buttons vs. links, used correctly:** a `<button>` triggers an action within the current page (submit a form, open a modal, trigger the upload-authorization call); an `<a href>` navigates (to another page, another route, an anchor). A link styled to look like a button but wired to an `onClick` with no real `href` (or a `href="#"`/`href="javascript:void(0)"`) is a recurring anti-pattern here and is disallowed — if it navigates, it's a link; if it acts, it's a button.
- Icon-only interactive elements (a trash icon to delete a document, an eye icon to preview) always carry an accessible name via `aria-label` or visually-hidden text — never rely on a `title` attribute alone (inconsistent screen-reader support) or on the icon being "obviously" a delete icon.

## 5. Color Contrast

- **Minimum contrast ratios** (WCAG 2.2 AA): **4.5:1** for normal body text, **3:1** for large text (≥24px regular weight, or ≥18.66px bold) and for the visual boundaries of active UI components (input borders, focus indicators, icon-only buttons' icon against its background).
- **Decision — Electric Mint (#00D4B2) usage constraint:** `#00D4B2` on a white or near-white background does not reliably clear the 4.5:1 threshold required for normal body text (it sits in a range that is contrast-borderline-to-failing against white depending on exact rendering, and must be verified with a contrast checker against the platform's actual final white/near-white token before any component ships, not assumed safe because it "reads as a strong color"). **Rule: Electric Mint is reserved for large text (≥24px / bold ≥18.66px), UI accents (icons paired with a text label, borders, backgrounds behind white/dark text that itself meets contrast independently, focus rings, progress-bar fills), and decorative/brand moments — it is never used as the sole color of small body text or small link text on a light background.** Where a brand moment calls for mint at body-text size, pair it with sufficient weight/size to qualify as "large text" under WCAG, or darken it for that specific text usage (a distinct "mint-text" token, darker than the brand swatch, reserved for text contexts) rather than using the raw brand hex for text. Rationale: brand colors are frequently chosen for visual appeal on marketing surfaces and then reused unchanged in product UI without a contrast re-check — this is a named, common failure mode this document is heading off explicitly rather than leaving to be discovered late by an automated scan.
- **Color is never the only signal.** Any UI state conveyed by color (an error field outlined in red, a "verified" badge in green, a required-field asterisk) must also carry a non-color signal — an icon, a text label, a pattern — so a color-blind or low-vision user gets the same information (see §6 for the error-state–specific version of this rule).
- Contrast checks apply against the **actual rendered background**, including images or gradients behind text — a text overlay on a photographic hero image must be checked against the specific region of the image it sits over, or given a scrim/overlay that guarantees the ratio regardless of image content.

## 6. Accessible Error States

- Form validation errors are **announced to assistive technology**, not just shown visually. Use `aria-live="polite"` (or `aria-live="assertive"` for a submission-blocking error that needs immediate attention, used sparingly) on the region that renders error messages, or `aria-invalid="true"` plus `aria-describedby` pointing at the specific error message tied to the offending input, so a screen-reader user navigating to that field hears the error, not just sees a red border.
- **Never color-only.** An invalid field is marked with an icon and/or explicit error text in addition to a color change to its border/background — restating §5's color rule specifically for the error case because it's the single most common place the rule gets violated (a red border with no text is a frequent "looks done" shortcut).
- Error messages are specific and actionable ("File exceeds the 20 MB limit for financial documents" — not "Upload failed") — this is both a usability requirement and an accessibility one, since a vague error disproportionately burdens a user who can't visually scan the rest of the form for context clues.
- Global/toast-style error and success notifications use an `aria-live` region so they're announced even though they're not tied to a specific input's focus.

## 7. Accessible Dialogs and Drawers

Applies to every modal, dialog, and slide-in drawer (document preview overlays, the document-rejection-reason dialog, confirmation dialogs for destructive actions, the consultation booking flow's modal steps):

- **`role="dialog"` (or `"alertdialog"` for a blocking confirmation) with `aria-modal="true"`**, and an accessible name via `aria-labelledby` (pointing at the dialog's own heading) or `aria-label`.
- **Focus trap while open:** keyboard focus is constrained to the dialog's contents — `Tab`/`Shift+Tab` cycle only through the dialog's own focusable elements, never escaping to the page behind it while the dialog is open (a page behind an open modal must also be marked `aria-hidden="true"` or use the `inert` attribute so screen-reader virtual-cursor navigation doesn't wander into it either).
- **Focus restore on close:** when the dialog closes (via `Esc`, an explicit close control, or successful submission), keyboard focus returns to the element that triggered it (the button that opened the dialog), not to the top of the page or nowhere.
- **`Esc` closes the dialog** for any non-destructive/dismissable dialog. A dialog representing an irreversible action in progress (e.g., mid-submission) may reasonably suppress `Esc` only while the action is actively processing, and must communicate why (a disabled/loading state, not a silently ignored keypress).
- Initial focus on open lands on a sensible first element (commonly the dialog's heading or its first interactive control) — never left on the page behind it, and never dropped to `<body>`.

## 8. Accessible Dropdowns and Selects

- Prefer the **native `<select>`** wherever its visual/behavioral constraints are acceptable — it is free keyboard accessibility, free screen-reader support, and free mobile-native picker behavior, and is the default choice unless the design genuinely requires custom rendering (e.g., a searchable/multi-select combobox for university selection).
- Where a **custom dropdown/combobox** is required, it must implement the appropriate WAI-ARIA pattern in full: correct `role` (`listbox`/`combobox` + `option` children as appropriate), `aria-expanded` on the trigger reflecting open/closed state, `aria-activedescendant` or roving `tabindex` to communicate the currently highlighted option, full arrow-key navigation (`Up`/`Down` to move, `Enter`/`Space` to select, `Esc` to close without selecting, `Home`/`End` to jump to first/last option), and type-ahead (typing a letter jumps to the next matching option) for any list long enough to benefit from it (e.g., a university/country selector).
- The selected value's accessible name/state is exposed to assistive tech after selection (not just visually swapped in) — closing a custom combobox must update its accessible current-value representation, not only its visual label.

## 9. Accessible Progress Indicators and Steppers

Directly relevant to the document vault (upload progress, `PROCESSING` state per `15-document-vault-security.md`) and the multi-step application/onboarding flows:

- **Async state changes are announced**, not only visually rendered. An upload progress bar, a "processing your document…" spinner transitioning to "verified"/"rejected," and a multi-step application stepper advancing to the next step all live inside (or update) an `aria-live="polite"` region so a screen-reader user is told the state changed without needing to re-poll the page by re-focusing the element.
- A determinate progress bar uses the native `<progress>` element or `role="progressbar"` with `aria-valuenow`/`aria-valuemin`/`aria-valuemax` kept in sync with the actual value — an indeterminate state (e.g., "scanning…" with no known completion percentage) uses `aria-valuetext` or omits `aria-valuenow` per the ARIA spec for indeterminate progress, rather than faking a value.
- **Decision:** upload-progress and document-processing-state announcements are throttled/debounced (announce meaningful milestones — "upload complete, verifying now," "verification passed" — rather than every percentage tick), rationale: a live region firing on every 1% progress increment produces a torrent of screen-reader announcements that is actively hostile to the user it's meant to help; this is a common accessibility over-implementation mistake worth heading off explicitly.
- A multi-step stepper (onboarding, application submission) exposes the current step and total step count in an accessible way (e.g., "Step 2 of 5: Upload documents" as the accessible name of the stepper region, kept current via the same live-region discipline above), not solely via a visual progress bar with numbers that have no text equivalent.

## 10. Reduced Motion

- All meaningful transitions/animations respect the `prefers-reduced-motion: reduce` media query — when set, non-essential motion (page-transition slides, decorative parallax, animated illustrations, celebratory confetti/success animations) is disabled or replaced with a simple opacity/instant-state change, not merely slowed down.
- **No motion-only conveyance of meaning.** If an animation is the only signal that something happened (a card sliding away to indicate "dismissed," a shake to indicate "error"), that state must also be communicated through a non-motion channel (a status message, a color/icon change respecting §5–§6) so a user with `prefers-reduced-motion` set — or a user who simply looked away at the wrong moment — doesn't miss the state change entirely.
- Loading spinners and progress indicators (§9) are exempt from full removal under reduced motion (their motion *is* their informational content, communicating "in progress") but should avoid high-frequency flashing/strobing regardless of the media query, per WCAG's seizure-safety guidance (no more than three flashes per second for any content).

## 11. Testing Requirement — Real Screen Readers, Not Automated Linting Alone

**Automated accessibility scanning (e.g., axe-core integrated into CI, per `35-testing-strategy.md`) catches roughly a third of real-world WCAG failures at best** — it verifies things like missing `alt` text, contrast ratios computed from CSS, and missing form labels, but it cannot verify that a focus trap actually releases correctly, that a live region announces at a sensible cadence, or that a custom combobox's keyboard behavior actually matches the ARIA pattern it claims via `role`.

**Decision:** every core flow (signup/onboarding, document upload and vault review, application submission, payment checkout, consultation booking) must be manually tested with at least one real screen reader — **NVDA on Windows and VoiceOver on macOS/iOS** as the two required combinations, covering the two most common desktop/mobile-adjacent screen-reader environments this audience is likely to use — as part of QA before a release that touches those flows, not as a one-time pre-launch audit that's never repeated. This is a QA gate defined in full in `35-testing-strategy.md`; this document establishes that the gate must exist and specifies the minimum tooling combination, not the CI mechanics.

## 12. Related Documents

- `00-project-charter.md` — accessibility as a binding product principle and success metric
- `35-testing-strategy.md` — how automated (axe-core/CI) and manual (NVDA/VoiceOver) accessibility testing are gated into the release process
- `15-document-vault-security.md` — the document state machine whose processing/verification states this document's §9 progress-announcement rules apply to
- `45-analytics-and-events.md` — ensuring async-state and motion-related UI events don't assume sight/sound as the only channel when instrumented
