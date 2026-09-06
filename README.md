# AdmitFlow by SNZ Ventures

> Say No to Consultants. Apply Abroad Yourself.

A platform for students applying to universities abroad without an agent: eligibility
assessment against a university catalog, a private document vault, application
preparation and tracking, and paid consultations when a human is genuinely needed.

The architecture is documented in [`/docs`](./docs) (56 files). Two documents are the ones
to read first: [`00-ARCHITECTURE-GATE.md`](./docs/00-ARCHITECTURE-GATE.md) for what was
decided, and [`54-decision-log.md`](./docs/54-decision-log.md) for why — including every
contradiction that had to be resolved and every judgment call made along the way.

## Running it locally

```bash
npm install
npm run devdb:start          # local Postgres (real, embedded — see below)
cp .env.example .env         # then set DATABASE_URL / SESSION_SECRET
npm run db:migrate           # apply migrations
npm run db:seed              # roles, products, rules, demo catalog, test accounts
npm run dev
```

Then open http://localhost:3000.

### Test accounts

Seeded in development only (`prisma/seed-accounts.ts` refuses to run in production):

| Email | Role | Password |
|---|---|---|
| `student@admitflow.example` | Student | `AdmitFlowDev42!` |
| `admin@admitflow.example` | Admin | `AdmitFlowDev42!` |
| `superadmin@admitflow.example` | Super admin | `AdmitFlowDev42!` |
| `consultant1@admitflow.example` | Consultant | `ConsultantPass42!` |

## What runs without external accounts

This project was built in an environment with no AWS, Stripe, Redis or email
credentials. Rather than stub those out — which would have left the security-critical
paths untested — each is a driver interface with a production implementation *and* a
local one that preserves the same semantics:

| Concern | Production | Local | What stays real either way |
|---|---|---|---|
| Object storage | AWS S3, private buckets | Filesystem outside the web root | Short-lived scoped signed URLs; no public path; server-side magic-byte validation |
| Payments | Stripe Checkout | A local checkout page | The webhook is genuinely signed and genuinely verified; entitlements are granted only in that transaction |
| Rate limiting | Redis | In-memory | The same policies and the same 429 contract |
| Email | Provider API | Written to the server log | Refuses to run in production rather than silently sending nothing |
| Database | Managed Postgres | Embedded Postgres 18 | Identical — it is real Postgres |

The production drivers are selected automatically when their credentials are present, and
the local ones **refuse to load when `APP_ENV=production`**, so a missing credential
cannot silently downgrade a deployed environment.

## Verifying it

```bash
npm run verify      # typecheck + lint + unit tests + production build
npm run test:api    # 54-check API suite against a running server
npm run test:e2e    # Playwright, drives the real UI in Chromium
```

The API and browser suites need `npm run dev` and the dev database running.

## Two invariants worth knowing before you change anything

**Locked results are omitted, never hidden.** A student without the unlock entitlement
receives results whose locked entries contain only `locked`, `placeholderId` and `zone` —
no name, no score, no tuition, no reasoning. Nothing is sent for the client to blur. The
projection in `src/services/assessment/result-projection.ts` is the only path that may
return assessment data, and there is deliberately no raw accessor beside it.

**Access is granted by webhooks, never by the browser.** No client-side signal grants an
entitlement. Payment confirmation flows provider → signed webhook → signature check →
idempotent transaction → entitlement row, and the UI reads its unlock state back from the
server afterwards.

Both are covered by named tests; breaking either should fail the suite loudly.
