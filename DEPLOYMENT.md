# Deploying AdmitFlow to Vercel

Two paths. **Staging** needs no paid service and no credentials, and is the right first
deploy — it gets a shareable URL running the real code. **Production** needs five external
services, because the local drivers refuse to run when `APP_ENV=production` rather than
silently pretending to send an email or take a payment.

---

## 1. Staging (start here)

Everything runs on the local drivers: documents go to a local object store, emails land in
the logs, payments use the development provider that signs its own webhook.

### Supabase

1. Create a project. Pick the region closest to `regions` in `vercel.json` (currently
   `fra1`, Frankfurt) — every query pays this round trip.
2. **Settings → Database → Connection string**, and take *both*:
   - **Transaction pooler** (port `6543`) → `DATABASE_URL`, with
     `?pgbouncer=true&connection_limit=1` appended
   - **Direct connection** (port `5432`) → `DIRECT_URL`

   These are not interchangeable. Runtime queries must go through the pooler: on a
   serverless platform every invocation is its own process, and unpooled connections
   exhaust Postgres' limit long before traffic does. Migrations must go direct: the pooler
   runs pgbouncer in transaction mode, which has no session state, and the migration
   engine needs it.

### Vercel

1. Import the GitHub repo. Framework is detected as Next.js; leave the build command alone
   — `vercel-build` in `package.json` already runs `prisma migrate deploy && next build`.
2. Set the environment variables below, then deploy.

```
APP_ENV=staging
NEXT_PUBLIC_APP_URL=https://<your-deployment>.vercel.app
DATABASE_URL=<supabase pooler url>?pgbouncer=true&connection_limit=1
DIRECT_URL=<supabase direct url>
SESSION_SECRET=<64 hex chars>
AWS_REGION=eu-west-1
S3_BUCKET=admitflow-staging
REDIS_URL=unused-in-staging
```

`AWS_REGION`, `S3_BUCKET` and `REDIS_URL` are required by the startup validation but are
not read on staging — the local drivers are selected because no credentials are present.
Generate the secret with `openssl rand -hex 32`.

3. Seed the catalog once, from your machine, pointing at the Supabase database:

```bash
DATABASE_URL="<direct url>" DIRECT_URL="<direct url>" npm run db:seed
```

**The seeded catalog is demo data.** It is illustrative, not sourced from any university.
It must never be shown to a real student as authoritative — see §4.

---

## 2. Production

Everything in staging, plus five services. Each one exists because a driver throws without
it, and each throw is deliberate: a payment that silently does nothing, or a verification
email that vanishes, is worse than a deployment that refuses to start.

| Service | Why it is required | Variables |
|---|---|---|
| **Supabase** | as above | `DATABASE_URL`, `DIRECT_URL` |
| **Upstash Redis** | Rate limiting. The in-memory fallback is empty on every serverless invocation, so login and signup limits would not be enforced at all. This is a security requirement, not an optimisation. | `REDIS_URL` (a `rediss://` URL) |
| **AWS S3** | Document storage. Private bucket, no public ACLs, no bucket-level public access. | `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET` |
| **Resend** | Verification and password-reset email. Without it nobody can complete a signup. | `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM_ADDRESS` (on a domain you have verified with Resend) |
| **Stripe** | Payments. | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |

Plus:

```
APP_ENV=production
NEXT_PUBLIC_APP_URL=https://<your-domain>
CRON_SECRET=<64 hex chars>
```

### Stripe webhook

Add an endpoint in the Stripe dashboard pointing at
`https://<your-domain>/api/v1/billing/webhook`, subscribed to `checkout.session.completed`
and `checkout.session.async_payment_failed`. Copy the signing secret into
`STRIPE_WEBHOOK_SECRET`.

The webhook is the only thing that grants an entitlement. Nothing on the client path can:
`processWebhookEvent` verifies the signature, claims the event id, and grants inside one
transaction. If this endpoint is not reachable, students will pay and receive nothing —
test it with Stripe's "Send test webhook" before taking real money.

### Scheduled work

`vercel.json` declares an hourly cron against `/api/v1/internal/cron`. Vercel sends
`Authorization: Bearer $CRON_SECRET` automatically, which is exactly what the route
expects.

**Hobby plan runs crons once a day, not hourly.** Correctness survives this — the booking
path releases its own expired hold inline, so the sweep is a backstop — but deadline
reminders and account deletions will lag by up to a day. Either move to Pro, or point a
free external scheduler (cron-job.org) at the same URL with the same bearer token.

The route fails closed: with no `CRON_SECRET` set it refuses every request rather than
running unauthenticated, and a wrong secret and an unconfigured deployment both return 404
so neither announces itself.

---

## 3. After the first deploy

Check these, in this order:

1. **`/api/health`** returns 200 — the app booted and the environment validated.
2. **Sign up with a real address.** If the email does not arrive, `EMAIL_PROVIDER_API_KEY`
   or the Resend domain verification is wrong. Nothing else works until this does.
3. **Run an assessment.** Confirms the database has the seeded catalog.
4. **Check the Vercel function logs for `Rate limiting is using the in-memory store`.** At
   `error` level in production, that line means `REDIS_URL` is not being used and the
   limits are not real.
5. **Send a Stripe test webhook** and confirm the entitlement appears under Billing.

---

## 4. What is still not ready for real students

Deploying does not change any of this:

- **The university catalog is demo data.** Twelve invented universities and forty-eight
  programmes, with requirements nobody sourced. A real student acting on them would be
  acting on fiction. This is a content workstream, not a deployment step.
- The legal reviews in `docs/55-known-risks-and-open-questions.md` (B-1, B-2) — compliance
  claims and outcome language — are outstanding.
- No malware scanning on uploaded documents (B-3). The vault architecture has the seam;
  no vendor is wired in.
- Test accounts from `prisma/seed.ts` must not be seeded into a production database.
