# 55 — Known Risks and Open Questions

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Living — triaged into BLOCKING / IMPORTANT / NON-BLOCKING / FUTURE
**Owner:** SNZ Ventures Engineering

---

Per the discovery brief's rule: do not block the whole project on minor open items — most below already have a sensible default applied elsewhere in `/docs` (see the cross-reference in each row) and are listed here so they get revisited deliberately rather than forgotten.

## BLOCKING (must resolve before the relevant feature ships to real users)

| # | Item | Why it blocks | Current default / where |
|---|---|---|---|
| B-1 | **Legal review of all compliance/GDPR claims.** Engineering has built the architecture that *supports* privacy compliance (consent records, export, deletion/anonymization, retention policy) — it has not been reviewed by counsel, and no public compliance claim should be made on the strength of this documentation alone. | Publishing an unreviewed compliance claim is a real legal exposure, not just a documentation gap. | `42-gdpr-and-data-privacy.md` §7 (flagged there as blocking) |
| B-2 | **Legal review of all admission/visa outcome language** ("Strong Match," "SAFE," etc.) before public launch, to confirm the copy cannot be read as a guarantee in any target market's consumer-protection law. | The entire "no fake guarantees" brand rule depends on this holding up legally, not just linguistically. | `16-assessment-engine.md`, `00-project-charter.md` |
| B-3 | **Malware-scanning vendor/library selection.** The document vault architecture assumes a pluggable scanning step exists before a document can leave `PROCESSING`, but no specific vendor (ClamAV self-hosted, a managed API, etc.) has been chosen, and the $0-infra goal (D-11) constrains the options. | Documents cannot safely reach `PENDING_REVIEW` without this — it's on the critical path for the entire vault subsystem. | `15-document-vault-security.md` |
| B-4 | **Exact brand color sampling.** `#3DA35D` (SnZ Green) is an approximation from visual inspection of the supplied logo image, not a pixel-sampled value from the source asset, and has not yet passed an AA contrast check for text use. | Shipping an unverified brand color risks both an off-brand look and an accessibility failure once used as a text color. | `07-frontend-architecture.md` §7, `54-decision-log.md` D-12 |
| B-5 | **Subprocessor list and DPAs.** GDPR architecture assumes categories of subprocessors (hosting, S3/AWS, Stripe/PayPal, email provider, error monitoring) but an actual subprocessor list and signed DPAs is a legal/procurement task outside engineering's scope. | Required before any EU/UK user data is genuinely processed in production. | `42-gdpr-and-data-privacy.md` |

## IMPORTANT (should resolve early, but a documented default unblocks work meanwhile)

| # | Item | Current default / where |
|---|---|---|
| I-1 | $0-infrastructure profile (Supabase-Postgres-only, Upstash Redis, scheduled-batch jobs instead of an always-on worker) is a bridge, not the target architecture — revisit once real usage data exists to decide when to graduate to the fully always-on worker topology. | `54-decision-log.md` D-11, `39-deployment-architecture.md` |
| I-2 | Video-conferencing vendor for consultation meeting links is deliberately left pluggable/abstracted — no vendor chosen yet. | `22-consultation-booking.md` |
| I-3 | Email/transactional-notification provider for the $0 phase not finalized (Resend/SendGrid-class free tier assumed). | `54-decision-log.md` D-11, `23-notification-system.md` |
| I-4 | Support-agent impersonation is included in the admin platform design (15-minute cap, fully audited) but has not been explicitly confirmed as wanted — it's a meaningful trust/privacy surface and worth a deliberate yes/no before Phase 15 (admin) is built. | `25-admin-platform.md` |
| I-5 | Exact password policy (min length 12 assumed) and MFA scope (not in v1) should be confirmed against SNZ's actual risk tolerance before auth ships. | `30-validation-rules.md`, `13-authentication-authorization.md` |
| I-6 | University catalog seed data (UK/Canada/Germany assumed in `37-seed-data-strategy.md`) is illustrative demo data, not sourced/verified real requirements — must never be presented to a real student as authoritative; production catalog population is a separate content workstream. | `37-seed-data-strategy.md`, `26-university-data-management.md` |

## NON-BLOCKING (fine to defer, tracked so they aren't lost)

| # | Item |
|---|---|
| N-1 | Multi-currency FX conversion is out of scope for v1 (EUR fallback currency, no dynamic FX) — `20-subscription-billing.md`. |
| N-2 | Push notifications and SMS/WhatsApp channels are explicitly future, not v1 — `23-notification-system.md`. |
| N-3 | AI-assisted explanation/SOP-assistance features are explicitly out of v1 scope; the assessment engine's hard eligibility gates must never depend on them if/when added — `16-assessment-engine.md`. |
| N-4 | Full i18n (Urdu/Arabic/French/German) is architecture-ready (no hardcoded strings in business logic) but not implemented in v1 — `05-non-functional-requirements.md`. |
| N-5 | A `/api/v2` versioning strategy is documented conceptually but has no concrete trigger yet — revisit when the first genuinely breaking change is needed — `11-api-architecture.md`. |

## FUTURE (explicitly deferred, revisit only when relevant)

| # | Item |
|---|---|
| F-1 | Additional RBAC roles (`UNIVERSITY_MANAGER`, `APPLICATION_REVIEWER`, `FINANCE_MANAGER`, `SUPPORT_AGENT`, `CONTENT_MANAGER`, `DATA_MANAGER`, `COMPLIANCE_ADMIN`) — the permission-bundle model supports adding these without redesign; no need to build them until a real need exists. |
| F-2 | Subscription/recurring billing (`TRIALING/ACTIVE/PAST_DUE/CANCELED/EXPIRED`) is fully designed but v1 ships one-off purchases only — activate when a bundled/subscription pricing product is actually offered. |
| F-3 | A second matching-engine version, once enough real outcome data exists to justify retuning weights/thresholds — must ship as a new versioned `AssessmentRule`, never an in-place edit (D-6). |
| F-4 | University-data-source automation/sync jobs (`data-refresh`/`university-data-sync` in `24-background-jobs.md`) — v1 assumes admin-managed catalog entry; automated sourcing is a later investment. |

---

## Note on scope realism

The build-authorization message's Phase 1–20 build order (foundation → design system → auth → onboarding → questionnaire → university engine → assessment → vault → paywall → Stripe → PayPal → consultation → applications → dashboard → admin → notifications → jobs → error handling → testing → security hardening → UX polish → production-readiness) is accepted as the implementation sequence and is restated with canonical naming in `52-implementation-roadmap.md`. It is not achievable in a single work session; it is a genuine multi-phase engineering program. Each phase will be built, checkpointed (lint/typecheck/test/build per phase, per the message's own §69–70 rule), and reported on before the next begins, rather than attempted all at once.
