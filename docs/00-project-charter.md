# 00 — Project Charter

**Product:** AdmitFlow by SNZ Ventures
**Tagline:** Say No to Consultants. Apply Abroad Yourself.
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Product
**Applies to:** All engineering, design, and content work on AdmitFlow

---

## 1. Vision

Every year, millions of students pursuing international education pay hundreds to thousands of dollars to consultants for services that are, in large part, information lookup, form-filling, and status-chasing — work a well-designed platform can do transparently, faster, and at a fraction of the cost. AdmitFlow's vision is a world where **any student, anywhere, can independently discover, evaluate, and apply to universities abroad** with the same quality of guidance a good consultant would offer — minus the opacity, the upsell pressure, and the hidden bias toward whichever university pays the largest commission.

## 2. Mission

Give students a single, trustworthy, self-serve platform that:

1. Assesses their real eligibility using transparent, explainable rules — not a sales pitch.
2. Matches them to universities across a full range of ambition (Reach / Target / Safe), never oversimplifying to a single "best fit."
3. Manages their documents, application prep, and submissions in one auditable place.
4. Offers **optional**, clearly-priced human expertise (paid consultations) for the moments a student genuinely wants a second opinion — never as a gate on basic information.
5. Tracks the student all the way through offer, visa prep, and departure, so no student is left wondering "what do I do next?"

## 3. Problem Statement

International admissions consulting today is broken in four specific ways AdmitFlow is designed to fix:

| Problem | Detail | AdmitFlow's answer |
|---|---|---|
| **Dependency** | Students often cannot start the process without a consultant because information is scattered, non-standardized, and confusing across hundreds of university websites. | A single guided journey (assessment → matches → documents → application → visa) that a student can complete alone. |
| **Opacity** | Students rarely see *why* a university was recommended, what their real chances are, or what the consultant's incentive is. | Every match shows the zone (Reach/Target/Safe) and the factors that drove it; every assessment result is a reproducible, versioned snapshot. |
| **Cost** | Consultants commonly charge flat fees of $500–$3,000+ per student, often for services that amount to form-filling. | Freemium assessment, low-cost à la carte unlocks (~€9.99) and consultations (~€30/40 min) — a fraction of traditional consultant fees. |
| **Bias** | Many consultants are paid commissions by partner universities, which skews recommendations toward those universities regardless of true fit. | AdmitFlow's matching engine is university-commission-agnostic; ranking is driven only by configurable, auditable eligibility/fit rules. |

## 4. Target Users

- **Primary:** Prospective international students (undergraduate and postgraduate) evaluating study-abroad options, typically ages 17–30, with wide variance in English proficiency, digital literacy, and financial means. Mobile-first usage is the default assumption, not the exception.
- **Secondary:** Paid consultants who provide optional expert review/advisory sessions on the platform (not required for any core journey step).
- **Internal:** Platform admins and super admins who operate the platform (content, verification, support, entitlement overrides).
- **Future (see `02-personas-and-roles.md`):** University Managers, Application Reviewers, Finance Managers, Support Agents, Content Managers, Data Managers, Compliance Admins — not built in v1, but RBAC and data models must not require rework to add them.

## 5. Business Model Summary

AdmitFlow is a **freemium + à la carte + services** model, not a single subscription:

1. **Free tier:** Account creation, profile/onboarding, eligibility assessment, and REACH-zone matches are free — this is the trust-building layer, not a stripped-down demo.
2. **Paid unlocks:** TARGET and SAFE zone recommendations are paywalled per the entitlement model (illustrative default: ~€9.99 per unlock scope). See `01-product-requirements.md` and the entitlements model for exact scoping (per-assessment vs. per-university-set).
3. **Application fee:** A per-application platform fee (illustrative default: ~€15) charged when a student formally submits an application package through AdmitFlow, distinct from any university application fee paid directly to the institution.
4. **Consultations:** Optional, bookable paid sessions with consultants (illustrative default: ~€30 / 40 minutes), for students who want a human review at any journey stage.
5. **Future:** Subscription tiers (e.g., unlimited unlocks, priority support, multi-cycle access for students reapplying) are anticipated but out of scope for v1. The entitlement model (Product/Price/Entitlement/Subscription) is deliberately generic so subscriptions can be introduced without a data model rewrite.

**Decision:** All prices above are stored as seed/default data in the Product/Price tables, never hardcoded in code or copy — copy must reference "unlock fee" / "application fee" / "consultation fee" generically or via templated values pulled from the pricing config, so a price change is a data change, not a deploy. Rationale: pricing will change by market/currency/promotion and must never require an engineering release.

## 6. Success Metrics (v1)

| Category | Metric | Target (illustrative, revisit post-launch) |
|---|---|---|
| Activation | % of signups completing onboarding + assessment | ≥ 60% within 7 days of signup |
| Monetization | % of assessed students purchasing ≥1 unlock | ≥ 15% within 30 days |
| Monetization | % of unlocked students submitting ≥1 application | ≥ 40% |
| Trust | Support tickets citing "confusing recommendation" per 1,000 assessments | < 5 |
| Trust | Consultant session CSAT | ≥ 4.5 / 5 |
| Reliability | Document upload success rate | ≥ 99.5% |
| Reliability | Payment success rate (excluding card declines) | ≥ 99.9% |
| Accessibility | Automated WCAG 2.2 AA violations on core flows | 0 blocking violations |
| Performance | Core flow pages Largest Contentful Paint (P75, mobile) | < 2.5s |
| Scale | Platform performs at spec from 100 to 10,000+ concurrent students without architecture rewrite | No re-architecture required through 10,000 students |

## 7. Product Principles

These principles are binding on every feature decision, not aspirational text:

- **Student-first** — every design and business decision optimizes for genuine student outcomes over short-term revenue.
- **Transparent** — students always see why a recommendation, decision, or fee exists.
- **Unbiased** — no ranking, match, or recommendation is influenced by undisclosed commercial incentives.
- **Secure** — student data (identity documents, transcripts, financial info) is treated as high-sensitivity by default.
- **Privacy-first** — collect only what's needed for the stated purpose; students control and can export/delete their data subject to legal retention needs.
- **Mobile-first** — every flow is designed for a phone first, then adapted upward, not the reverse.
- **Accessible** — WCAG 2.2 AA compliance is a shipping requirement, not a backlog item.
- **Fast** — perceived and actual performance are treated as a feature.
- **Scalable** — architecture must support growth from 100 to 10,000+ students without a rewrite.
- **Auditable** — every state-changing action (verification, override, payment, entitlement grant) is logged with actor, timestamp, and reason.
- **Maintainable** — code and content are structured so a new engineer/agent can extend the system without reverse-engineering intent.
- **No dark patterns** — no forced continuity, hidden costs, disguised ads, confirm-shaming, or fake urgency.
- **Configurable over hardcoded** — pricing, scoring weights, eligibility rules, and questionnaire content live in configuration/data, not code, wherever feasible.

## 8. Out of Scope for v1

Explicitly **not** built in the first production release (candidates for v2+):

- Subscription billing (recurring plans) — entitlement model must anticipate it, but it is not launched.
- In-app messaging/chat between student and consultant (sessions are scheduled + conducted via a linked video tool; in-app chat is future work).
- Automated visa document submission to embassies/immigration portals (AdmitFlow tracks and prepares the visa file; it does not submit to government systems).
- University-side portal (universities do not get direct platform accounts in v1 — see `UNIVERSITY_MANAGER` under future roles).
- Multi-language UI (English only at launch; i18n architecture must be ready — see `05-non-functional-requirements.md`).
- Native mobile apps (responsive web only in v1; mobile-first web is not the same as a native app and is not a substitute commitment to build one).
- AI-generated essays/SOPs or any feature that drafts application content on the student's behalf (conflicts with "apply yourself" positioning; document *review* and *checklists* are in scope, ghostwriting is not).
- Financial aid disbursement, loans, or forex services.

## 9. Brand Basics

| Element | Value |
|---|---|
| Name | AdmitFlow |
| Parent company | SNZ Ventures |
| Tagline | Say No to Consultants. Apply Abroad Yourself. |
| Positioning statement | AdmitFlow is the independent, transparent alternative to traditional study-abroad consultants — giving students the same quality of eligibility assessment, university matching, and application support, without the cost, opacity, or bias of commission-driven advising. |
| Voice | Plain-language, encouraging, honest about uncertainty (never overpromising outcomes it doesn't control) |
| Visual tone | Clean, calm, confidence-building — not a sales landing page aesthetic |

## 10. Key Non-Negotiables

These are hard constraints. Any feature proposal that violates one of these must be rejected or escalated, not quietly shipped:

1. **No fake guarantees.** The platform must never state or imply "100% guaranteed admission" or "100% guaranteed visa." Approved language: *Strong Match*, *High Confidence*, *Safer Options*, *Strong Eligibility*. Admission and visa outcomes always depend on universities, immigration authorities, the student's finances, and document authenticity — factors outside AdmitFlow's control — and copy must reflect that (see `01-product-requirements.md` §Copy Rules).
2. **No dark patterns.** No pre-checked upsells, no fake scarcity/countdown timers on pricing, no disguised paywalls, no obstructed cancellation/deletion flows, no confirm-shaming.
3. **Security-first.** No plaintext secrets, no public/guessable document URLs, all authorization enforced server-side (never trust a hidden frontend route), all documents in private S3 storage behind signed URLs (see `14-security-architecture.md` for the full model — this charter only sets the bar).
4. **Object-level data isolation.** A student must never be able to access another student's data by guessing or incrementing an ID, regardless of role or feature.
5. **Reproducibility of assessments.** Every eligibility/matching result must be explainable after the fact — the system stores the full input snapshot (profile, questionnaire answers, scoring rules version, university-data version) used to produce it, so results don't silently drift as rules or data are updated later.
6. **Pricing is data, not code.** All fees are configurable; nothing student-facing hardcodes a currency amount in application code or static copy that competes with the pricing config.

## 11. Related Documents

This charter sets direction; downstream docs must remain consistent with it and not duplicate detail:

- `01-product-requirements.md` — stage-by-stage requirements
- `02-personas-and-roles.md` — personas and RBAC roles
- `03-user-journeys.md` — detailed journey walkthroughs
- `04-functional-requirements.md` — testable FRs per module
- `05-non-functional-requirements.md` — performance, scalability, accessibility, security bar, i18n, mobile
- `14-security-architecture.md` (referenced, authored separately) — full security model
- `49-threat-model.md` (referenced, authored separately) — threat modeling
