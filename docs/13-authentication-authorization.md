# 13 — Authentication & Authorization

**Document status:** Foundational — v1.0
**Depends on:** `00-project-charter.md`, `02-personas-and-roles.md`, `11-api-architecture.md`
**Read alongside:** `12-api-contracts.md`, `14-security-architecture.md`

---

## 1. Purpose

This document specifies AdmitFlow's full authentication and authorization implementation: how a session comes to exist and stops existing, how OAuth accounts link to the domain model, the account lifecycle state machine, the RBAC permission model, and — most critically — how object-level authorization is implemented so that a valid session is never, by itself, enough to reach another actor's data.

**Locked architecture decision (restated):** authentication is **custom-built** on our own `User`/`Session`/`Role`/`Permission` tables — not Supabase Auth. Passwords are hashed with **argon2id**. OAuth (Google, Apple) is wired through Auth.js/Lucia-style *adapters* into our own domain model — the adapters translate provider callbacks into rows in *our* `User`/`OAuthAccount`/`Session` tables; they are not the source of truth. Sessions are **server-side records** in Postgres (durable) + Redis (fast lookup/cache), which is what makes real "logout all devices" possible — a JWT-only design cannot do this without a separate revocation-list mechanism bolted on, so we don't use bare JWTs for session state at all.

---

## 2. Session Model

### 2.1 What a session is

- On successful authentication, the server creates a `Session` row: `id` (opaque, cryptographically random, ≥256-bit), `userId`, `createdAt`, `lastSeenAt`, `expiresAt`, `ipAddress`, `userAgent`, `revoked` (bool), `revokedAt`, `revokedReason`.
- The session `id` is written into an **httpOnly, Secure, SameSite=Lax** cookie (`af_session`) — never returned in a JSON response body, never accessible to page JavaScript (see `14-security-architecture.md` §Cookies for the full flag rationale, including why `Lax` rather than `Strict`).
- The cookie value is opaque; it is not a JWT and carries no embedded claims — every request resolves it against the server-side `Session` store, so revocation is immediate and total, not "eventually, when the token expires."
- **Redis** holds a cache of `sessionId → {userId, role, permissionsHash, expiresAt}` for fast per-request lookups without hitting Postgres on every call; Postgres remains the durable source of truth and system of record for session history/audit. A cache miss falls through to Postgres and repopulates Redis.

### 2.2 Expiration and rotation

- **Sliding expiration:** each authenticated request that hits a real endpoint (not static assets) extends `expiresAt` by the idle timeout (default: 30 days) if the session is more than 25% through its idle window — avoiding a write on every single request while still keeping active users logged in.
- **Absolute maximum lifetime:** 90 days from `createdAt` regardless of activity — a session older than this is rejected and the user must re-authenticate, bounding the blast radius of a long-lived stolen cookie.
- **Rotation on privilege change:** the session `id` is rotated (new row issued, old one revoked) whenever the account's role or permission set changes, and after password reset / email change — this prevents a scenario where a session issued under old privileges keeps working after an admin demotes/promotes the account.
- **Session fixation prevention:** a new session `id` is always issued at the moment of successful login (or OAuth callback) — never reusing a pre-login "anonymous" session id, even if one happened to exist in the browser already. See `14-security-architecture.md` §Session Security for the general principle.

### 2.3 Logout and "logout all devices"

- `POST /auth/logout` (see `12-api-contracts.md`) revokes exactly one `Session` row (the current one) and evicts it from Redis.
- `POST /auth/logout-all` marks **every** `Session` row for that `userId` as `revoked=true` (bulk update, single transaction) and evicts all corresponding Redis keys. Because every request re-validates against this store, this takes effect for every other device/tab on its *next* request — there is no token that keeps working until it "expires" elsewhere.
- Password reset and detected-compromise flows (future: "sign out this device" from a security page, breach-credential rotation) reuse the same bulk-revoke mechanism, not a separate one-off implementation.

---

## 3. Authentication Flows

### 3.1 Signup → Verify Email → Login

```
1. Client:  POST /auth/signup {email, password, firstName, lastName}
2. Server:  hash password (argon2id) -> create User{status: REGISTERED}
            -> transition to EMAIL_UNVERIFIED
            -> generate verification artifacts:
                 - single-use link token (random 256-bit, stored hashed, 24h expiry)
                 - 6-digit OTP (stored hashed, 10 min expiry, max 5 attempts)
            -> enqueue verification email (both link and OTP shown)
3. Client:  either clicks the link  -> POST /auth/verify-email {token}
            or types the OTP       -> POST /auth/verify-email {userId, otp}
4. Server:  validate token/OTP -> User.status EMAIL_UNVERIFIED -> VERIFIED
            -> emailVerifiedAt = now()
            -> issue full Session, set af_session cookie
5. Client:  proceeds to onboarding (VERIFIED -> ONBOARDING on first onboarding call)
6. Client:  POST /auth/login {email, password} on any future visit
7. Server:  verify argon2id hash -> issue new Session (session fixation prevention: always a fresh id)
```

**Decision:** we support **both** a secure link and an OTP for email verification (and for password reset — link only there, see §3.3) rather than picking one. Rationale: AdmitFlow's primary users are international students on mobile data with sometimes-unreliable email-client link handling (corporate/university email scanners that "click" links automatically and burn single-use tokens is a documented real-world failure mode); an OTP typed back into the same tab sidesteps that class of bug entirely, at the cost of slightly more UI. Both artifacts are invalidated the moment either succeeds.

### 3.2 OAuth (Google, Apple) Signup/Login and Linking

```
1. Client:  redirect to /auth/oauth/google (or /apple)
2. Provider: user authenticates with Google/Apple, redirects back with an auth code
3. Server:  exchange code for provider identity (sub, email, email_verified)
   Case A — no existing User with this provider identity or matching verified email:
       -> create User{status: VERIFIED} directly (provider-verified email skips EMAIL_UNVERIFIED)
       -> create OAuthAccount{provider, providerUserId, userId}
       -> issue Session
   Case B — existing User with this OAuthAccount already linked:
       -> issue Session directly (normal login)
   Case C — existing User (password-based) whose *verified* email matches the OAuth email:
       -> do NOT silently auto-link (email match alone is not proof of intent/ownership in
          every provider's guarantee model) -> require the user to be logged in first, then
          explicitly confirm "link Google account" from an authenticated /users/me/oauth-accounts
          flow, OR complete an email-verification step post-OAuth-callback before linking
       -> Decision: explicit-confirmation linking, not silent auto-link by email match.
          Rationale: silently merging accounts on email equality is a known account-takeover
          vector if any upstream provider ever has a weaker email-verification guarantee than
          assumed; an explicit user action closes that gap at a small UX cost.
4. Server:  issue Session, redirect to app
```

- Apple's "hide my email" relay addresses are treated as a normal email value for matching/linking purposes; we do not attempt to defeat Apple's relay.
- A user may have multiple `OAuthAccount` rows (Google + Apple) attached to one `User` — the domain model is many-`OAuthAccount`-to-one-`User`, never the reverse.
- OAuth-created accounts still go through `ONBOARDING` normally; only email verification is short-circuited (the provider already asserts a verified email).

### 3.3 Password Reset

```
1. Client:  POST /auth/forgot-password {email}
2. Server:  ALWAYS returns 200 with a generic message, regardless of whether the email exists
            (account enumeration prevention) -> if it exists: generate single-use reset token
            (random 256-bit, stored hashed, 30 min expiry) -> enqueue reset email
3. Client:  POST /auth/reset-password {token, newPassword}
4. Server:  validate token -> re-hash password (argon2id) -> REVOKE ALL existing sessions
            for this user (logout-all semantics) -> send a "your password was changed"
            confirmation email (not the token) -> user must log in again
```

### 3.4 Session Issuance/Rotation/Expiration Summary Diagram

```
                 signup/OAuth/login
                        |
                        v
              [ new Session row created ]
              id=random256, expiresAt=+30d(sliding), maxAt=+90d(absolute)
                        |
        every authenticated request  --(if session valid & not revoked)-->  extend expiresAt
                        |
        role/permission change, password reset -> REVOKE + issue new Session (rotation)
                        |
        logout -> revoke THIS session
        logout-all / password reset -> revoke ALL sessions for user
                        |
        idle > 30d OR age > 90d OR revoked=true -> request rejected as UNAUTHENTICATED
```

---

## 4. RBAC Model

### 4.1 Core principle

**Decision (restated from `02-personas-and-roles.md`):** authorization is modeled as **Permission → Role → User**, never `if (role === 'ADMIN')` scattered through the code. A **Permission** is a granular, resource-scoped capability (`document:verify`, `entitlement:grant`, `application:override_status`, `audit_log:read`, `scoring_rules:publish`, `pricing:configure`, `user:read:any`, `application:review`, …). A **Role** is nothing more than a named, stored bundle of Permissions. Every permission check in code asks "does this actor hold permission X," never "is this actor's role Y" — which is exactly what makes adding `UNIVERSITY_MANAGER`, `APPLICATION_REVIEWER`, `FINANCE_MANAGER`, `SUPPORT_AGENT`, `CONTENT_MANAGER`, `DATA_MANAGER`, and `COMPLIANCE_ADMIN` later a **data change** (insert a Role row, attach existing Permission rows to it, assign it to users) rather than a code change.

### 4.2 Schema shape

```
Permission(id, key, description)                 -- e.g. key = "document:verify"
Role(id, name)                                    -- e.g. name = "ADMIN"
RolePermission(roleId, permissionId)              -- many-to-many
UserRole(userId, roleId)                          -- many-to-many (v1 assigns exactly one
                                                   --   role per user by product decision,
                                                   --   but the schema supports many so a
                                                   --   future multi-role actor — e.g. an
                                                   --   ADMIN who is also a CONSULTANT —
                                                   --   needs no migration)
```

### 4.3 Permission-check pattern

Every protected route declares the permission(s) it requires via middleware/decorator, resolved once per request against the actor's cached permission set (Redis-cached alongside the session, invalidated on role/permission change):

```
route: POST /api/v1/admin/entitlements/grant
  requiresPermission("entitlement:grant")
  handler(req):
    // permission already confirmed present by middleware before handler runs
    entitlementService.grant({ actorId: req.session.userId, ...req.body })
```

```
route: GET /api/v1/applications/:id
  requiresAuthentication()          // no specific permission needed — ownership decides
  handler(req):
    application = applicationService.getForActor(req.params.id, req.actor)
    // ^ service layer performs the object-level scoping — see §5
```

- **Decision:** the permission-check middleware runs *before* the route handler and short-circuits with `403 FORBIDDEN` (or `404`, per `11-api-architecture.md` §10, when existence itself is sensitive) — a handler body is never trusted to remember to check permissions itself for role-gated endpoints. Rationale: centralizing the check at the routing layer means a new endpoint is insecure-by-default only if someone forgets to declare *any* requirement, which is a much easier code-review catch than an inline check buried in business logic.
- Endpoints with no `requiresPermission(...)` declaration but only `requiresAuthentication()` are exactly the ones where authorization is **object-level, not role-level** — see §5. This split is intentional and documented per-endpoint in `12-api-contracts.md`.

### 4.4 Role → Permission Mapping (v1 roles)

| Permission | STUDENT | CONSULTANT | ADMIN | SUPER_ADMIN |
|---|---|---|---|---|
| `profile:read:own` / `application:read:own` / `document:read:own` / `payment:read:own` | Y | — | — | — |
| `student_data:read:booking_scoped` | — | Y | — | — |
| `document:verify` | — | — | Y | Y |
| `application:override_status` | — | — | Y | Y |
| `entitlement:grant` | — | — | Y | Y |
| `catalog:manage_content` | — | — | Y | Y |
| `user:read:any` (support/verification context, audited) | — | — | Y | Y |
| `audit_log:read:scoped` (own actions + support scope) | — | — | Y | — |
| `audit_log:read:any` | — | — | — | Y |
| `admin:manage_accounts` | — | — | — | Y |
| `scoring_rules:publish` | — | — | — | Y |
| `pricing:configure` | — | — | — | Y |

This table is illustrative of the pattern, not exhaustive of every permission key in the system — the authoritative list lives in the `Permission` seed data, not in this document, precisely so it can grow without a doc-and-code drift problem.

### 4.5 How Future Roles Slot In

Adding `SUPPORT_AGENT` (chosen as the example because it's the narrowest future role) requires **zero new code paths**:

1. Insert `Role(name='SUPPORT_AGENT')`.
2. Insert `RolePermission` rows attaching a *subset* of ADMIN's existing permissions — e.g. `user:read:any` (to see support context) — while deliberately **not** attaching `document:verify` or `entitlement:grant` (per `02-personas-and-roles.md` §6, a Support Agent can view but not verify/adjust).
3. Assign the role to the relevant users via `UserRole`.
4. Done. Every existing endpoint that checks `requiresPermission("user:read:any")` now correctly admits a `SUPPORT_AGENT`; every endpoint checking `requiresPermission("document:verify")` correctly continues to reject one — with no changes to those endpoints' code.

The same pattern applies to `UNIVERSITY_MANAGER` (a new bundle scoped to that university's own catalog rows — see the "owning organization" data-model note in `02-personas-and-roles.md` §6), `FINANCE_MANAGER`, `CONTENT_MANAGER`, `DATA_MANAGER`, and `COMPLIANCE_ADMIN`. This is the entire point of Permission-first modeling: **a role is a spreadsheet row, not a pull request.**

---

## 5. Object-Level Authorization

### 5.1 The rule

Restated once more because it is the platform's most commonly-violated-in-practice control class (IDOR):

> A valid session belonging to Student A, plus a syntactically valid (even non-guessable UUID) identifier for a resource belonging to Student B, must **never** succeed in reading or writing that resource. This holds for every resource type — profile, documents, assessment runs/results, applications, payments, consultation bookings, notifications — with no exceptions carved out for "but the ID is a UUID so it's not guessable." Enumeration resistance is not authorization.

### 5.2 Implementation pattern

**Decision:** no service-layer function may look up a protected resource by a bare `findById(id)`. Every fetch of a protected resource is written as a **scoped fetch** that takes the actor as a mandatory argument and bakes the ownership/permission condition into the query itself:

```
// FORBIDDEN pattern — never written this way:
applicationRepository.findById(id)

// REQUIRED pattern — actor-scoped at the query layer:
applicationRepository.findByIdForActor(id, actor)
  // STUDENT actor  -> WHERE id = :id AND studentId = :actor.userId
  // ADMIN actor with application:read:any -> WHERE id = :id
  //   (broader query only reachable via the permission check, and only
  //    ever invoked from a route that both requires that permission AND
  //    writes an AuditLog row for the access — see 12-api-contracts.md §13)
```

- The scoping condition lives in the repository/query layer, not as an after-the-fetch filter in the controller — an after-the-fetch check ("fetch it, then verify `resource.studentId === actor.id`, else 403") is explicitly disallowed as the *primary* control, because it's one refactor away from someone deleting the check while leaving the fetch, and it still executes a query against another user's row even when it correctly denies the response. Defense-in-depth assertions on the fetched object are welcome *in addition to* the scoped query, never instead of it.
- The correct response when the scoped query returns nothing is `404 NOT_FOUND` (per `11-api-architecture.md` §10) — indistinguishable, from the outside, between "doesn't exist" and "exists but isn't yours."
- This pattern is uniform across STUDENT-to-STUDENT isolation, CONSULTANT's booking-scoped reads (`WHERE consultantId = :actor.id AND bookingId IN (actor's active/recent bookings)`), and ADMIN/SUPER_ADMIN's broader-but-still-conditional-and-audited reads. "Elevated role" changes which scoped-query variant a permission unlocks; it never means "skip the scoping."

### 5.3 Worked examples

| Scenario | What must happen |
|---|---|
| Student A requests `GET /applications/{Student B's applicationId}` | `404 NOT_FOUND` — the scoped query `WHERE id=? AND studentId=A` returns zero rows. |
| Student A requests `GET /vault/documents/{Student B's documentId}/view-url` | `404 NOT_FOUND` — a signed URL is never generated for a document the actor doesn't own; the authorization check happens *before* any call to S3, not after (see `14-security-architecture.md` §File Upload/Vault Security). |
| Consultant X requests a Student's profile via a booking they don't hold | `404 NOT_FOUND` — booking-scope query finds no matching active/recent booking for `(consultantId=X, studentId=that student)`. |
| Consultant X requests a Student's profile via a booking they *do* hold, 45 days after the session | `404 NOT_FOUND` if past the defined post-session access window (`02-personas-and-roles.md` §3 Decision: booking-scoped access is time-bound, not persistent) — enforced as part of the same scoped query (`AND booking.endAt > now() - retentionWindow`), not a separate manual check. |
| Admin requests `GET /admin/users/{id}` for support purposes | `200`, permission `user:read:any` confirmed, **and** an `AuditLog` row is written recording the access — this is a broader scoped query (permission-gated), not an unscoped one. |
| Anyone requests a locked TARGET/SAFE university's identity fields without the entitlement | Not a 404/403 case at all — it's the entitlement-filtering case in `12-api-contracts.md` §6–7: the object is legitimately visible as "a locked slot," but its identifying fields are omitted at serialization time. Object-level authorization (this section) and entitlement-based field filtering (`11-api-architecture.md` §10, `14-security-architecture.md`) are two distinct controls that both apply to the assessment/universities endpoints — a request can pass object-level authorization (it's the actor's own assessment run) and still have fields withheld by entitlement filtering. |

---

## 6. Account Lifecycle State Machine

**Canonical source:** `31-state-machines.md` §2 is the single source of truth for this state machine (state names, transitions, actors, side effects) — this section reproduces it for authentication-flow context, and per that document's own authority rule, if anything here ever drifts from `31-state-machines.md`, that document wins and this one is the bug to fix.

### 6.1 States

`REGISTERED → EMAIL_UNVERIFIED → VERIFIED → ONBOARDING → ACTIVE → SUSPENDED → DEACTIVATED → DELETED`

**Decision:** this state machine is the canonical model of account status, stored on the `User` row as a single `status` enum column (per `10-database-schema.md`'s `User` entity — **note:** as of this writing `10-database-schema.md` §2.1 lists `status: Enum(ACTIVE, SUSPENDED, DEACTIVATED)`, a narrower 3-value enum; this is a drift against the binding `31-state-machines.md` §2 eight-state machine that the database-schema documentation needs to reconcile — see the cross-doc note at the end of this document). Convenience booleans (`emailVerified`, `onboardingComplete`) may still exist as **denormalized read-optimizations** updated transactionally alongside a state transition, but no code branches on a boolean where it should branch on `User.status` — the boolean is a query/index convenience, not a second source of truth that can drift from the state machine.

### 6.2 Transition Table

Reproduced verbatim from `31-state-machines.md` §2 (see that document for the full actor-legend and side-effect notes):

| # | From | Event / Trigger | To | Actor | Side effects |
|---|---|---|---|---|---|
| A1 | *(none)* | Signup form submitted, `User` row created | `REGISTERED` | `STUDENT` (self-signup) or `ADMIN` (staff-created consultant/admin account) | `AuditLog` entry (`user.registered`) |
| A2 | `REGISTERED` | Same transaction as A1 — every new account is immediately unverified | `EMAIL_UNVERIFIED` | `SYSTEM` | Enqueue `email-send` job for `WELCOME` + verification link/OTP |
| A3 | `EMAIL_UNVERIFIED` | Student completes verification (`EMAIL_VERIFICATION_CONFIRMED` — link click or correct OTP, see §3.1) | `VERIFIED` | `STUDENT` | `EMAIL_VERIFIED` notification, `AuditLog` entry, verification artifacts invalidated (single-use), full session issued |
| A4 | `VERIFIED` | Immediate system advance — no useful resting state between "email confirmed" and "must complete onboarding" | `ONBOARDING` | `SYSTEM` | None (informational status only, gates route access to the onboarding wizard) |
| A5 | `ONBOARDING` | Student completes the minimum required profile/questionnaire sections (`ONBOARDING_COMPLETED`) | `ACTIVE` | `STUDENT` | `AuditLog` entry, unlocks full product surface |
| A6 | `ACTIVE` | Admin suspends account for cause — **reason field mandatory** | `SUSPENDED` | `ADMIN` | All active sessions revoked immediately, `AuditLog` entry with reason, student notified (email) with appeal contact path |
| A7 | `SUSPENDED` | Admin lifts suspension after review | `ACTIVE` | `ADMIN` | Notification, `AuditLog` entry; user must log in again (no session survives a suspension) |
| A8 | `ACTIVE` | Student requests account closure, or admin deactivates for a non-punitive reason | `DEACTIVATED` | `STUDENT` or `ADMIN` | Sessions revoked, notification with reactivation-window explanation, `AuditLog` entry |
| A9 | `SUSPENDED` | Suspension escalates to permanent removal (severe ToS violation, legal request) — bypasses `DEACTIVATED` | `DELETED` | `ADMIN` (requires `SUPER_ADMIN` for the actual anonymization execution) | Same as A10, immediate |
| A10 | `DEACTIVATED` | Retention grace period elapses (**30 days**) with no reactivation, or a right-to-erasure request is formally fulfilled | `DELETED` | `SYSTEM` (scheduled job) or `ADMIN` (erasure request) | PII scrub/anonymize (never a hard `DELETE`), `AuditLog` entry, irreversible from this point |
| A11 | `DEACTIVATED` | Student or admin reactivates within the grace period | `ACTIVE` | `STUDENT` or `ADMIN` | Notification, `AuditLog` entry |

**Decision (from `31-state-machines.md`):** `EMAIL_UNVERIFIED` accounts do **not** auto-delete. A scheduled hygiene job may flag (never delete) accounts unverified after 30 days for support follow-up. This document's earlier drafts considered an auto-purge transition for stale unverified accounts; that idea is explicitly rejected by the canonical state machine and must not be implemented.

Every transition that isn't purely user-self-service and system-timed writes an `AuditLog` entry, and where an admin is involved a mandatory `reason` — this is the same audit discipline as `12-api-contracts.md` §13's Admin endpoints, applied to the account record itself.

### 6.3 Notes

- `SUSPENDED` and `DEACTIVATED` are deliberately distinct: `SUSPENDED` is punitive/investigative and admin-initiated; `DEACTIVATED` is neutral and can be user-initiated. Both fully revoke sessions; they differ in *why*, in who can reverse them, and in what's shown to the user.
- `DELETED` is a terminal state with no outbound transitions. Re-registering with the same email after deletion creates a **new** `User` row (new `id`) rather than resurrecting the old one, so historical references (e.g., an anonymized application record kept for financial retention) don't silently become "live" again.
- No state transition ever re-enables an existing session — every transition into `SUSPENDED`/`DEACTIVATED`/`DELETED` revokes all sessions as part of the same transaction that changes `status`, and every transition back to `ACTIVE` requires a fresh authentication.
- **Cross-doc consistency note:** `10-database-schema.md` §2.1 currently models `User.status` as a 3-value enum (`ACTIVE, SUSPENDED, DEACTIVATED`), which does not carry the full 8-state machine `31-state-machines.md` §2 declares canonical and binding for every consuming document (this one included). The database-schema/migration documentation should be updated to the full 8-value enum so the actual column matches the state machine every API/auth doc builds against — see the summary at the end of this document.

---

## 7. Related Documents

- `11-api-architecture.md` §10 — the object-level authorization rule as an API-contract-level requirement
- `12-api-contracts.md` — per-endpoint `Auth`/`Permission` requirements built on this model
- `14-security-architecture.md` — cookie/session security hardening detail, CSRF, and the broader security architecture this auth model sits inside
- `02-personas-and-roles.md` — the product-level persona/role definitions this document implements
- `00-project-charter.md` §10 — the non-negotiables (object-level data isolation, security-first) this document exists to satisfy
