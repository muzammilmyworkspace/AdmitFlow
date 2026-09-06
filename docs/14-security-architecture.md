# 14 — Security Architecture

**Document status:** Foundational — v1.0
**Depends on:** `00-project-charter.md`, `11-api-architecture.md`, `13-authentication-authorization.md`
**Read alongside:** `12-api-contracts.md`, `47-rate-limiting.md`, `48-idempotency.md`, `15-document-vault-security.md` (referenced, authored separately), `49-threat-model.md` (referenced, authored separately)

---

## 1. Purpose

This document is the consolidated security architecture for AdmitFlow: the concrete controls that make the platform's non-negotiables (`00-project-charter.md` §10) real. It assumes the session/RBAC model from `13-authentication-authorization.md` and the API conventions from `11-api-architecture.md`, and layers the remaining defense-in-depth controls on top: transport/header security, injection prevention, CSRF/SSRF protection, webhook trust, file upload security, secrets, and encryption. It closes with the platform's two single most critical rules, restated as unambiguous engineering requirements.

## 2. Authentication & Session Security

Fully specified in `13-authentication-authorization.md`; summarized here for completeness of the security posture:

- Passwords hashed with **argon2id** (memory-hard, tuned parameters reviewed periodically as hardware cost changes); never reversible, never logged, never returned in any API response.
- Sessions are opaque, random (≥256-bit) identifiers backed by server-side Postgres+Redis records — not self-contained JWTs — so revocation ("logout all devices," suspension, password reset) is immediate and total.
- **Session fixation prevention:** a new session id is issued at every successful authentication event (login, OAuth callback, post-verification), never reusing a pre-authentication session id.
- **Rotation:** sessions rotate on privilege change, password reset, and email change; sliding 30-day idle expiration with a 90-day absolute cap regardless of activity.
- Cookie flags and CSRF interaction are covered in §7–8 below.

## 3. RBAC Enforcement Layer

Fully specified in `13-authentication-authorization.md` §4–5. Summarized: permission checks run in middleware ahead of the route handler (fail closed, `403`/`404` before business logic executes), permissions are granular resource-actions rather than role-name checks, and every protected resource fetch is actor-scoped at the query layer (never a bare `findById`) so object-level authorization can't be bypassed even by an authenticated, permission-holding, wrong-role-boundary request.

## 4. Rate Limiting

Rate limiting is part of the security posture — it is the primary control against credential-stuffing/brute-force login attempts, signup/OTP abuse, and accidental client-side double-submit storms hitting expensive endpoints (assessment runs, checkout creation). Full policy, concrete per-endpoint limits, and response format live in **`47-rate-limiting.md`** — not duplicated here.

## 5. Input Validation & Output Encoding

- **Every** API input — body, path params, query params, relevant headers (e.g., declared `Content-Type`/`Content-Length` on upload requests), and file metadata — is validated server-side against an explicit schema before it reaches business logic. Frontend validation is a UX convenience only and is never trusted as a security boundary (`00-project-charter.md` §10.3, `11-api-architecture.md`).
- Validation is **allow-list shaped**: known fields, known types, known enums, bounded lengths/ranges. Unknown fields on a request body are rejected by default (`VALIDATION_ERROR`) rather than silently ignored, except where a schema explicitly documents forward-compatible passthrough (rare, and called out per-endpoint).
- **Output encoding / XSS prevention:** the API returns `application/json` exclusively for data payloads; the frontend (a modern component-based SPA framework) auto-escapes interpolated values by default, and any place that must render user-supplied rich content (e.g., a consultant's session notes, a support message) goes through a sanitization step on a strict allow-list of HTML elements/attributes server-side before storage — never "sanitize on render only," because that leaves raw unsafe content sitting in the database for any other consumer (exports, admin tools, future integrations) to render unsafely.
- File names, free-text fields, and anything ending up in a downloadable filename or email template are treated as untrusted and encoded/escaped appropriately for that specific output context (HTML body vs. plain-text email vs. filename-safe slug) — there is no single "sanitize once, safe everywhere" function relied upon across contexts.

## 6. SQL Injection Prevention

- All database access goes through the ORM (Prisma) using its parameterized query builder. **No endpoint constructs SQL via raw string interpolation of user input.** Where a genuinely dynamic query is unavoidable (rare — e.g., a dynamic `sort` field), the dynamic portion is resolved through an explicit allow-list mapping (`{'createdAt': 'created_at', 'matchScore': 'match_score'}`) before being placed into the query — the user-supplied string itself is never concatenated into SQL, even when it "looks like" a safe column name.
- Any use of Prisma's raw-query escape hatches (`$queryRaw`/`$executeRaw`) is required to use tagged-template parameterization (which Prisma parameterizes automatically) and is flagged for mandatory code review — never string-built raw SQL, ever, under any performance justification.

## 7. CSRF Protection

AdmitFlow authenticates the browser client via a cookie (§2), which means CSRF is a real threat class here (unlike a pure `Authorization: Bearer` API client, which is naturally immune).

- **Cookie `SameSite=Lax`** (not `Strict`) — chosen specifically because `Strict` would break the OAuth redirect-back flow (`13-authentication-authorization.md` §3.2), where the browser navigates cross-site (from Google/Apple) back to AdmitFlow and must still carry the session-establishing context. `Lax` blocks the cookie on cross-site `POST`/fetch/XHR (the actual CSRF-relevant request types) while still allowing it on top-level GET navigations, which is exactly the OAuth callback's shape.
- **Decision:** `SameSite=Lax` alone is treated as a strong mitigation, not a complete one, so it is layered with a **double-submit CSRF token** for every state-changing request (`POST`/`PATCH`/`PUT`/`DELETE`) made by the cookie-authenticated web client: a non-httpOnly `af_csrf` cookie holding a random token is set alongside the session cookie, and the frontend is required to echo its value back in an `X-CSRF-Token` request header; the server rejects the request (`403 FORBIDDEN`, code `CSRF_TOKEN_MISMATCH`) if the header is missing or doesn't match the cookie. Rationale: defense-in-depth against `SameSite` misconfiguration, older/non-compliant clients, and the general principle that a single control should not be the only thing standing between a state-changing request and forgery.
- This CSRF check applies **only** to cookie-authenticated requests. A future mobile app or partner integration authenticating via `Authorization: Bearer <token>` is exempt by design (bearer tokens aren't automatically attached by the browser to cross-site requests, so the CSRF threat model doesn't apply the same way) — the middleware distinguishes the two by checking whether the session cookie or a bearer header was the credential used.
- Webhook endpoints (`/billing/webhook`, `/billing/webhook-paypal`) are exempt from CSRF checks entirely — they carry no session cookie and are authenticated exclusively by provider signature verification (§10).

## 8. SSRF Protection

Any place the server itself makes an outbound HTTP(S) request based on user-influenced input is an SSRF surface. Known/anticipated cases: avatar or university-logo import-by-URL (if/when offered), OAuth provider metadata/token endpoints, PayPal/Stripe API calls, any future consultant calendar-integration callout, and webhook-adjacent outbound confirmations.

Controls, applied uniformly to every such outbound call:

- **Destination allow-listing** where the set of valid destinations is known and small (OAuth providers, Stripe, PayPal) — the server only ever calls a fixed, configured set of provider hostnames; user input never determines the *hostname* of an outbound call, only parameters within a call to an already-allow-listed destination.
- For the narrower case of user-supplied URLs (e.g., "import my photo from this URL," if shipped) the server resolves DNS itself and **rejects any resolution to a private/link-local/loopback/metadata address range** (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16` — explicitly including the cloud metadata endpoint `169.254.169.254`, `::1`, and unique-local/link-local IPv6 ranges) before connecting, and again re-validates on any HTTP redirect the target returns (a common allow-list bypass is a public URL that 302s to an internal address) — redirects to a disallowed range abort the fetch.
- Outbound fetches from server-initiated code have a strict timeout and response-size cap, and never run with the credentials/network reachability of a highly-privileged internal service — the fetching worker runs with least-privilege network policy (egress rules), not just an application-level check, as defense-in-depth.
- **Decision:** until an actual "import by URL" feature is scoped, this control exists primarily to bound OAuth/payment-provider callouts and to pre-empt the SSRF class before any future feature (avatar import, calendar sync) introduces user-controlled destinations without this review having already happened.

## 9. Secure HTTP Headers

Applied to every response via a single shared middleware (not per-route, so nothing is ever accidentally missing it):

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` |
| `Content-Security-Policy` | Strict, nonce-based `script-src`; no `unsafe-inline`/`unsafe-eval`; `default-src 'self'`; `frame-ancestors 'none'`; `object-src 'none'`; `base-uri 'self'`; `connect-src` limited to the API origin, configured payment-provider SDK origins, and the CDN; `img-src` allows `'self'`, the private-signed-URL S3 domain, and the CDN. |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | Deny-by-default for `geolocation`, `camera`, `microphone`, `payment`, `usb`, `interest-cohort`, enabling only what a specific page genuinely needs (e.g., none of the above by default; revisit if a video-consultation feature needs camera/mic on a specific route). |
| `X-Frame-Options` | `DENY` (kept alongside the CSP `frame-ancestors` directive for older-browser defense-in-depth) |
| `Cache-Control` | `no-store` on all authenticated API responses containing personal data (never cached by an intermediary or the browser disk cache). |

## 10. Secure Cookie Flags

Every cookie AdmitFlow sets (`af_session`, `af_csrf`, and any future ones) uses:

- `HttpOnly` — on `af_session` (never on `af_csrf`, which must be JS-readable for the double-submit pattern in §7 to work; the CSRF cookie's value is not itself sensitive/session-granting).
- `Secure` — always, in every environment including staging (no environment ships an insecure cookie, so "works locally over http" is handled via a documented local-dev exception, not a production code path that could ship by accident).
- `SameSite=Lax` for `af_session` (rationale in §7); `SameSite=Lax` for `af_csrf` as well.
- `Path=/` scoped to the application; `Domain` scoped to the exact application domain (no wildcard subdomain sharing unless a specific subdomain architecture requires it, reviewed case-by-case).
- No sensitive value (session id, tokens, PII) is ever placed in a `SameSite=None` or third-party-readable cookie.

## 11. Webhook Signature Verification

Restated as a security control (mechanics and idempotency detail in `48-idempotency.md`, contracts in `12-api-contracts.md` §9):

- **Stripe:** every inbound event to `/billing/webhook` is verified via the `Stripe-Signature` header against the endpoint's webhook signing secret, including Stripe's timestamp-tolerance replay check, **before** any parsing of the event's business content. An invalid or missing signature is rejected `400 WEBHOOK_SIGNATURE_INVALID` with **zero** side effects — no database write of any kind, not even a rejected-attempt log beyond standard access logging.
- **PayPal:** every inbound event to `/billing/webhook-paypal` is verified via PayPal's webhook-signature verification mechanism (transmission ID/signature/cert-chain validation against the configured webhook ID) before any processing, with the same zero-side-effect-on-failure rule.
- Both webhook secrets/credentials are stored in the secrets manager (§13), never in application code or version control, and are environment-specific (staging and production use different signing secrets, so a staging event can never be replayed against production).
- This is the sole authentication mechanism for these two endpoints — they take no session cookie, no bearer token, and are explicitly exempted from CSRF checks (§7) because they aren't reachable via a browser-driven forged request in the first place; signature verification is the entire trust boundary.

## 12. File Upload Security (Summary)

Full detail lives in `15-document-vault-security.md`; this section summarizes the integration points relevant to the overall security architecture:

- Browser uploads never go directly to the API with file bytes in the request body — the flow is: authenticated request → **upload authorization check** (is this student allowed to upload this document type, within quota) → short-lived, scoped, signed S3 **PUT** URL issued server-side → browser uploads directly to private S3 → browser calls `verify-upload` → async worker job (not inline in the request) performs **magic-byte file-type detection** (never trusting the client-declared `Content-Type` or file extension), size-limit enforcement on the actual uploaded bytes (not just the pre-upload declared size), and a **malware scan** pass before the document is eligible for use in an application or admin verification.
- Documents are **never** served from a public/permanent URL — every read (view/download) is a freshly generated, short-lived, scoped signed GET URL, issued only after the same object-level ownership/permission check as any other protected resource (`13-authentication-authorization.md` §5).
- A document that fails magic-byte validation or is flagged by the malware scan transitions to `REJECTED` (never silently accepted); a malware hit additionally relocates the underlying S3 object to a restricted quarantine prefix/bucket with its own tighter access policy, so the object is never reachable via a normal signed URL to anyone, including the uploader — see `15-document-vault-security.md` §5 for the full quarantine/audit contract (the object is never silently deleted, to preserve forensic evidence).

## 13. Secrets Management

- All credentials (DB connection strings, Redis connection string, S3 keys/roles, Stripe/PayPal API keys and webhook secrets, OAuth client secrets, SMTP/email-provider keys) are supplied via environment variables sourced from a managed secrets store in every deployed environment (e.g., AWS Secrets Manager / SSM Parameter Store) — never committed to the repository, never baked into a container image layer, never logged.
- `.env.example` (committed) documents every required variable name with a placeholder/dummy value only (`STRIPE_SECRET_KEY=sk_test_placeholder`) — it is a schema, not a source of real values, and CI fails a build that reads a production-shaped value out of a committed file.
- Local development uses a git-ignored `.env` populated from the secrets store or a dev-only value set; it is never the same value set as any deployed environment.
- IAM/service credentials follow least privilege: the API's S3 role can generate signed URLs and write/read within the document bucket only; it cannot list/delete arbitrary buckets or access unrelated infrastructure. The worker service's role is scoped separately from the API's role, matching the "different service, different blast radius" principle.
- Secrets are rotated on a defined schedule and immediately on suspected exposure; rotation is an operational runbook item, not something requiring a code change (secrets are read at runtime from the store, never compiled in).

## 14. Encryption

- **At rest:** the managed Postgres instance uses provider-managed encryption at rest (e.g., RDS/Cloud SQL encrypted storage, AES-256); S3 buckets use server-side encryption — **Decision:** SSE-KMS with a customer-managed key specifically for the document vault bucket (rather than default SSE-S3), so key usage is independently auditable via the cloud provider's key-usage logs, on top of AdmitFlow's own access logging — a meaningful additional control given documents include passports, transcripts, and financial proof. Redis, where used to cache session/permission data (never raw documents or payment credentials), uses the managed provider's at-rest encryption as well.
- **In transit:** TLS 1.2+ is enforced everywhere — browser-to-API (terminated at the load balancer, HSTS-enforced per §9), API-to-database, API-to-Redis, API/worker-to-S3, and every outbound call to Stripe/PayPal/OAuth providers/email provider. No internal service-to-service call is made over plaintext, including within a private network — TLS is not treated as "only needed at the public edge."
- Backups (database snapshots) inherit the same at-rest encryption as the primary store and are never exported to an unencrypted medium.

## 15. Non-Negotiable Rules (Restated)

These two rules are the platform's most load-bearing security constraints. Every design or implementation choice elsewhere in the system defers to these, not the other way around.

1. **No locked data leaves the server.** A student without the relevant TARGET/SAFE entitlement receives an API response that **omits** locked university identity/name/program/fee/metadata entirely — not `null`, not a blurred/truncated value, not present-but-flagged-hidden. The backend must never send locked content for the frontend to hide, because a browser is not a trust boundary: DevTools, a proxy, or a modified client trivially exposes anything sent, regardless of what the intended UI does with it. This is a required test case, treated as the IDOR/data-leakage class of test (`12-api-contracts.md` §6–7 show the exact expected shape; test coverage for this belongs in the security-testing documentation as a first-class, mandatory suite — not an incidental assertion inside a feature test).
2. **Payment success is never trusted from the client.** No API response, redirect parameter, client-reported status, or frontend state is ever a trigger for granting an entitlement. Entitlements are granted **exclusively** by signature-verified (§11), idempotent (`48-idempotency.md`), server-side webhook processing from Stripe/PayPal, recorded in a `WebhookEvent` table keyed on the provider's event id under a **unique constraint**, with the dedup-insert and the entitlement grant occurring inside the **same database transaction** (`12-api-contracts.md` §9). A client hitting a "thank you" page, calling a `/confirm` endpoint, or presenting any client-side payment-intent object grants nothing by itself.

## 16. Related Documents

- `13-authentication-authorization.md` — session, RBAC, and object-level authorization mechanics this document builds on
- `11-api-architecture.md` §10 — the object-level/locked-data API contract rule
- `12-api-contracts.md` — concrete endpoint shapes demonstrating locked-field omission and webhook handling
- `47-rate-limiting.md` — full rate-limiting policy (referenced, not duplicated, per §4)
- `48-idempotency.md` — idempotency-key and webhook-dedup mechanics referenced in §11, §15
- `15-document-vault-security.md` (referenced, authored separately) — full vault/file-upload security detail
- `49-threat-model.md` (referenced, authored separately) — structured threat modeling this architecture is designed against
