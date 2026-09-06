# 38 — Environment Configuration

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering
**Applies to:** Next.js app, worker service, and all deployment environments

---

## 1. Environments

| Environment | Purpose | Data |
|---|---|---|
| **development** | Local engineer/agent machines | Local or dev-tier managed Postgres/Redis instance; synthetic/seed data only |
| **staging** | Pre-production validation, QA, demo | Isolated Postgres/Redis/S3 from production; synthetic or explicitly anonymized data only |
| **production** | Live traffic | Real student data; real Stripe/PayPal live keys; production S3 bucket |

**Decision:** never use unsanitized production data locally or in staging. Rationale: student data includes identity documents, transcripts, and financial information (`00-project-charter.md` §7, "Secure"/"Privacy-first"); a laptop or a staging environment with weaker access controls than production is not an acceptable place for that data to exist, full stop, regardless of convenience for debugging. If a production-shaped dataset is needed for testing, it is generated synthetically or is a structurally anonymized/scrubbed export (PII replaced, documents replaced with placeholder files) produced by a dedicated, reviewed script — never a raw dump.

Each environment has its own: Postgres database, Redis instance, S3 bucket, Stripe/PayPal keys (test-mode for dev/staging, live-mode only for production), and OAuth client credentials (separate Google/Apple OAuth app registrations per environment, since redirect URIs differ). Nothing is shared across environment boundaries.

## 2. `.env.example`

This is the canonical, placeholder-only variable contract. Every variable listed here must be present (validated at startup — §4) in every environment; actual values are never committed.

```dotenv
# ── App ──────────────────────────────────────────────────────────────
NODE_ENV=development
NEXT_PUBLIC_APP_URL=https://localhost:3000
APP_ENV=development                     # development | staging | production — drives config validation, NOT NODE_ENV
DEMO_MODE=false                         # see §5 — must be explicit, never silently true

# ── Database (PostgreSQL via Prisma) ───────────────────────────────────
DATABASE_URL=postgresql://user:password@host:5432/admitflow?sslmode=require
DATABASE_POOL_URL=postgresql://user:password@pooled-host:5432/admitflow?sslmode=require   # pgbouncer/Neon pooled endpoint, used by serverless routes

# ── Redis (cache + BullMQ) ──────────────────────────────────────────────
REDIS_URL=rediss://default:password@host:6379

# ── AWS S3 (private buckets only) ───────────────────────────────────────
S3_BUCKET=admitflow-documents-placeholder
S3_REGION=eu-west-1
AWS_ACCESS_KEY_ID=REPLACE_ME
AWS_SECRET_ACCESS_KEY=REPLACE_ME
S3_SIGNED_URL_UPLOAD_TTL_SECONDS=120    # matches the 60-120s upload PUT URL window in 15-document-vault-security.md
S3_SIGNED_URL_DOWNLOAD_TTL_SECONDS=60   # matches the 60s download GET URL window in 15-document-vault-security.md

# ── Auth / Sessions ───────────────────────────────────────────────────
SESSION_SECRET=REPLACE_ME_LONG_RANDOM_VALUE
SESSION_COOKIE_NAME=admitflow_session
JWT_SIGNING_SECRET=REPLACE_ME_LONG_RANDOM_VALUE      # if JWT-based access tokens are used alongside server sessions
ARGON2_MEMORY_COST=19456                              # argon2id tuning, see 14-security-architecture.md
ARGON2_TIME_COST=2
ARGON2_PARALLELISM=1

# ── OAuth Providers ───────────────────────────────────────────────────
GOOGLE_CLIENT_ID=REPLACE_ME
GOOGLE_CLIENT_SECRET=REPLACE_ME
APPLE_CLIENT_ID=REPLACE_ME
APPLE_TEAM_ID=REPLACE_ME
APPLE_KEY_ID=REPLACE_ME
APPLE_PRIVATE_KEY=REPLACE_ME_PEM_BLOCK

# ── Payments: Stripe ───────────────────────────────────────────────────
STRIPE_SECRET_KEY=REPLACE_ME
STRIPE_PUBLISHABLE_KEY=REPLACE_ME
STRIPE_WEBHOOK_SECRET=REPLACE_ME

# ── Payments: PayPal ────────────────────────────────────────────────────
PAYPAL_CLIENT_ID=REPLACE_ME
PAYPAL_CLIENT_SECRET=REPLACE_ME
PAYPAL_WEBHOOK_ID=REPLACE_ME
PAYPAL_ENV=sandbox                       # sandbox | live

# ── Email / Notifications ────────────────────────────────────────────────
EMAIL_PROVIDER_API_KEY=REPLACE_ME
EMAIL_FROM_ADDRESS=no-reply@admitflow.example
SMS_PROVIDER_API_KEY=REPLACE_ME          # optional at launch; validated only if SMS notifications are enabled

# ── Worker Service ────────────────────────────────────────────────────────
WORKER_CONCURRENCY=5
WORKER_QUEUE_PREFIX=admitflow

# ── Feature Flags / Observability (pointers; full contracts in their own docs) ─
FEATURE_FLAGS_PROVIDER=internal          # internal (Postgres/Redis-backed) by default — see 46-feature-flags.md
LOG_LEVEL=info                            # see 28-observability.md
```

**Decision:** `APP_ENV` is a distinct variable from `NODE_ENV`. Rationale: `NODE_ENV` controls framework/library build behavior (`production` vs `development` builds) and is often forced to `production` by the hosting platform even for a staging deployment; AdmitFlow needs its own explicit environment signal to drive config validation rules (e.g. "Stripe keys must be live-mode") and `DEMO_MODE` gating (§5) without being coupled to build-tool semantics.

## 3. Secrets Management

- **Never committed.** `.env*` files (other than `.env.example`) are git-ignored. No secret ever appears in source, in a comment, in a commit message, or in a CI log line (CI redacts known secret env var names from logs).
- **Local development:** engineers/agents use a local `.env` populated with dev-tier/test-mode credentials only (test-mode Stripe/PayPal keys, a dev OAuth app, a personal/dev S3 bucket or a local S3-compatible emulator) — never given access to production secrets for local work.
- **Staging/production:** secrets are stored and injected exclusively via the hosting platform's secret manager (e.g. Vercel Environment Variables for the Next.js app, the chosen container host's secret store for the worker service — see `39-deployment-architecture.md`), scoped per-environment so a staging deploy cannot read production secrets and vice versa.
- **Rotation:** any secret suspected of exposure (leaked in a log, a screen-share, a former team member's access) is rotated immediately, not on a routine schedule as the only trigger. Stripe/PayPal webhook secrets, OAuth client secrets, `SESSION_SECRET`/`JWT_SIGNING_SECRET`, and AWS credentials are the highest-priority rotation targets given their blast radius.
- **Least privilege:** the AWS credentials used by the app/worker are scoped (via IAM policy) to only the operations they need on only the AdmitFlow document bucket (put/get/delete signed-URL generation) — not broad S3 or account-wide access.

## 4. Startup Config Validation

**Decision:** both the Next.js app and the worker service validate their complete required-variable set against a schema (e.g. zod) at process boot, before serving a single request or consuming a single job, per `08-backend-architecture.md` §4. On failure:

- The process **refuses to start** (or, for the worker, refuses to enter its consume loop).
- The failure output **lists every missing or invalid variable in one pass** (name + which constraint failed — missing / wrong type / doesn't match expected format such as a URL or key prefix), not just the first one hit.
- There is no partial-start mode where, e.g., the app comes up and serves pages but payment or document endpoints silently 500 because `STRIPE_SECRET_KEY` was never set. A missing variable required by any module fails the whole process's startup.

This applies identically in development, staging, and production — the same validation schema runs everywhere; only the values differ.

## 5. `DEMO_MODE`

`DEMO_MODE` exists to allow sandboxed demonstrations (e.g. a sales/investor walkthrough environment) where certain real-world side effects (real payment capture, real outbound email to non-test addresses, real university-data sync writes) are stubbed or redirected to safe equivalents.

**Decision:** `DEMO_MODE` must be an explicit, validated environment variable (`true`/`false`, no implicit default beyond `false`), and config validation **rejects startup in the `production` `APP_ENV` if `DEMO_MODE=true`** — production must never silently run in demo mode. Rationale: a demo-mode flag that quietly leaks into production (e.g. via a copied environment or a forgotten override) is exactly the kind of failure that would let real payments go uncaptured or fabricate application submissions — an unacceptable outcome for a platform whose core promise is transactional and legal reliability. Any environment other than production that wants demo behavior must set it explicitly per the `.env.example` contract above, and the running environment's `DEMO_MODE` state is surfaced visibly in the admin UI so it's never ambiguous which mode a given deployment is in.

This environment variable is the deploy-time hard gate (fails startup outright — a structural, not merely a logical, block). It is a separate layer from the `DEMO_MODE` `FeatureFlag` row described in `37-seed-data-strategy.md`/`10-database-schema.md` §12.2, which governs finer-grained runtime demo behavior (e.g. which seeded demo accounts/content are active) once a process has already started; the two are kept in agreement by seeding/refreshing the `FeatureFlag` row from this environment variable at boot, never the other way around — the environment variable is always the source of truth for whether demo mode is even permitted to be considered in a given environment.

## 6. Consistency With Other Docs

- Variable names here are the canonical names; database schema, API, and security docs should reference these names rather than inventing new ones for the same concept.
- The signed-URL/S3 access pattern referenced here (`S3_SIGNED_URL_TTL_SECONDS`) must match the enforcement described in `14-security-architecture.md`.
- Webhook secret variables (`STRIPE_WEBHOOK_SECRET`, `PAYPAL_WEBHOOK_ID`) back the signature verification step described in `06-system-architecture.md` §4 and detailed further in `14-security-architecture.md`.
