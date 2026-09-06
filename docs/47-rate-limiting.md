# 47 — Rate Limiting

**Document status:** Foundational — v1.0
**Depends on:** `11-api-architecture.md`, `14-security-architecture.md`
**Read alongside:** `12-api-contracts.md`, `48-idempotency.md`

---

## 1. Purpose

Rate limiting protects AdmitFlow against three distinct failure modes that all present the same way at the infrastructure level (a burst of requests) but need the same underlying control: **credential/brute-force abuse** (login, OTP, password reset), **resource/cost abuse** (assessment runs, document uploads, checkout session creation), and **accidental client-side storms** (a retry loop, a double-click, a flaky network causing a form to resubmit). Rate limiting is the first line of defense against all three; `48-idempotency.md` is the complementary control that makes the *legitimate* retry/double-click case safe rather than merely slowed down. The two are designed together — rate limiting throttles volume, idempotency makes repeated volume within that throttle harmless.

## 2. Mechanism

- **Redis-backed**, using a sliding-window counter per limit key (not a naive fixed-window reset, which allows a burst exactly at the window boundary). Implementation detail (e.g., a token-bucket or sliding-log library) is an implementation choice; the contract every endpoint must honor is the response shape in §4 and the limits in §3.
- **Limit keys are composite and endpoint-class-specific** — never a single global "requests per IP" bucket, because that would let abuse of one cheap endpoint starve legitimate traffic to an unrelated expensive one. Common key shapes:
  - `ip` — for pre-authentication endpoints where no account context exists yet (signup, initial login attempt).
  - `ip + accountIdentifier` (email/userId) — for login/OTP/reset, so a distributed attack against one account is throttled by account even if spread across many IPs, and a single IP hammering many accounts is throttled by IP even if each account is only tried once.
  - `userId` — for authenticated-endpoint abuse/cost control (assessment runs, uploads, checkout, bookings, submissions) once a session exists.
- Limits apply **per endpoint class**, not per exact route — e.g., all vault upload-URL requests share one bucket per user, all consultation-booking-attempt requests share another, so the table in §3 is the authoritative policy rather than a per-route configuration scattered through the code.

## 3. Limits by Endpoint Class

| Endpoint class | Key | Limit | Window | Notes |
|---|---|---|---|---|
| `POST /auth/login` | `ip` | 20 attempts | 15 min | Coarse anti-flood ceiling per IP. |
| `POST /auth/login` | `ip + email` | 5 failed attempts | 15 min | Triggers a temporary account-level cooldown (not a permanent lock) on the 6th failure; does not reveal whether the account exists (`13-authentication-authorization.md` §3, `14-security-architecture.md`). |
| `POST /auth/signup` | `ip` | 5 | 1 hour | Anti-abuse for mass fake-account creation. |
| `POST /auth/forgot-password` | `accountIdentifier` (email, regardless of existence) | 3 | 1 hour | Prevents reset-email spam to a single inbox. |
| `POST /auth/forgot-password` | `ip` | 10 | 1 hour | Prevents one IP from spraying reset requests across many emails. |
| `POST /auth/verify-email` (OTP attempts) | `userId` | 5 wrong attempts | 10 min (tied to OTP lifetime) | Code is invalidated after the 5th wrong attempt, forcing a resend rather than allowing indefinite guessing of a 6-digit space. |
| Resend verification / resend OTP | `userId` | 3 | 1 hour | Distinct bucket from the initial signup-triggered send. |
| `POST /assessment/run` | `userId` | 10 | 1 hour | Assessment execution is the heaviest per-user compute path; also guards against a runaway client retry loop against a slow/failed run. |
| `POST /vault/upload-url` | `userId` | 30 | 1 min | Allows a legitimate multi-document upload session (transcript, passport, test scores, financial proof in quick succession) while bounding storage/scan-pipeline abuse. |
| `POST /vault/upload-url` | `userId` | 200 | 1 day | Secondary daily ceiling independent of the per-minute burst allowance. |
| `POST /billing/checkout-session` | `userId` | 10 | 1 min | Payment-adjacent endpoints get a tighter, cost-aware limit; paired with required `Idempotency-Key` (`48-idempotency.md`) so legitimate retries within this limit are also duplicate-safe. |
| `POST /consultation/bookings` | `userId` | 10 | 1 min | Booking-attempt storms (e.g., a script trying to grab a popular consultant's slot) are throttled here in addition to the DB-level slot uniqueness constraint (`48-idempotency.md` §Concurrent Booking) that provides the actual correctness guarantee. |
| `POST /applications` / `POST /applications/:id/submit` | `userId` | 10 | 1 min | Covers both draft creation and submission attempts. |
| `POST /billing/webhook`, `POST /billing/webhook-paypal` | shared bucket, not per-account | 1000 | 1 min | Generous, since these are server-to-server calls from the provider, not end-user traffic; real trust boundary is signature verification (`14-security-architecture.md` §11), not this limit — this ceiling exists only to bound infrastructure impact from a provider-side incident or a misdirected/malicious flood of webhook-shaped requests. |
| All other authenticated endpoints (default) | `userId` | 300 | 1 min | Baseline ceiling so no single authenticated endpoint class goes unprotected by default; endpoints with a more specific rule above use that rule instead of the default. |
| All other unauthenticated/public endpoints (default) | `ip` | 60 | 1 min | Baseline ceiling for pre-session traffic not covered by a specific rule. |

All numbers above are launch defaults, stored in configuration (not hardcoded in route handlers), and expected to be tuned post-launch against real traffic/abuse patterns — consistent with the charter's "configurable over hardcoded" principle (`00-project-charter.md` §7).

## 4. Response Format on Rate Limit

A request exceeding its limit receives:

- **HTTP status:** `429 Too Many Requests`
- **Body (standard error envelope, `11-api-architecture.md` §5):**
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Please try again later.",
    "requestId": "req_01J8X7ZC2K3QK5R6P8N9T4M2AF"
  }
}
```
- **Headers:**
  - `Retry-After: 42` — seconds until the caller may retry, always present on a `429`.
  - `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` — included on every response (not only `429`s) for the applicable bucket, so well-behaved clients can back off before hitting the limit rather than only after.
- The account-level login cooldown (§3) does **not** reveal via its response whether the underlying reason is "too many attempts on this specific account" versus "too many attempts from this IP" — both surface as the same generic `RATE_LIMITED` response, preserving the account-enumeration protections established in `13-authentication-authorization.md`.

## 5. Interaction with Idempotency

Rate limiting and idempotency solve adjacent but distinct problems and are deliberately layered rather than treated as substitutes for each other:

- Rate limiting answers "how much volume is allowed through," and protects against both malicious brute force and accidental storms.
- Idempotency (`48-idempotency.md`) answers "what happens when the *same logical request* is submitted more than once within that allowed volume," and protects against double-charging, double-booking, or double-submitting as a correctness problem, not just a volume problem.
- A user double-clicking "Pay" three times in two seconds is likely well within the `checkout-session` rate limit (10/min) — rate limiting alone would let all three through. The `Idempotency-Key` requirement on that endpoint is what makes those three requests resolve to one Stripe Checkout Session rather than three.

## 6. Related Documents

- `48-idempotency.md` — idempotency-key mechanics and webhook dedup, the correctness-layer complement to this volume-layer control
- `14-security-architecture.md` §4 — rate limiting's role in the overall security posture
- `11-api-architecture.md` §5 — the error envelope and `RATE_LIMITED` code definition
- `12-api-contracts.md` — per-endpoint `Rate-limited` markers referencing this document's limits
