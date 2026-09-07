# 18 — Paywall and Entitlements

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering (Entitlements/Paywall + Payments/Billing subsystems)
**Depends on:** `00-project-charter.md`, `02-personas-and-roles.md`, `06-system-architecture.md` (webhook/worker flow)
**Read alongside:** `16-assessment-engine.md`, `17-university-matching-engine.md` (the output shape being gated)
**Applies to:** All engineering work on monetization, payments, and API response filtering

---

## 1. Purpose and the Core Rule

AdmitFlow monetizes via unlocks, an application fee, and paid consultations (`00-project-charter.md` §5) — never a boolean flag bolted onto the student's account. This document defines the entitlement data model and, most importantly, the **exact point in the request lifecycle** where paywalling is enforced, because getting this wrong is both a security defect and a legal-risk defect (leaking a university's identity/fee/program data that hasn't been paid for is a data-leakage incident, not a UX bug).

**The non-negotiable rule (restated from the charter):** if a student lacks the entitlement required to see a TARGET or SAFE result, the API response for that result **omits** the locked university's identity, program, fee, and metadata entirely. The frontend never receives the locked data and blurs it — it never receives it, period. §4 makes this concrete with a before/after JSON example.

---

## 2. Why Not Boolean Flags

**Rejected pattern:** `student.isTargetUnlocked: boolean`, `student.isSafeUnlocked: boolean`, `student.hasAppliedThisMonth: boolean`. This looks simple at v1 scale and becomes unmaintainable the moment any of the following (all already anticipated by the charter and roadmap) happens: a promo grants temporary access, a refund needs to cleanly revoke access without touching an unrelated flag, a future subscription tier grants a bundle of entitlements at once, pricing needs to vary by market/currency, or an admin needs to grant one specific unlock without accidentally granting everything. A boolean model requires a new column and new logic for every one of those; a proper entitlement model requires only new data rows.

**AdmitFlow's model:**

```
Product ──has many──▶ Price (currency/amount, active date range)
Product ──grants────▶ Entitlement type(s) on purchase/subscription

Customer (1:1 with a paying User — student, or future org)
Customer ──has many──▶ Purchase (one-time) and/or Subscription (recurring, not launched v1)
Purchase / Subscription ──produces──▶ EntitlementGrant (the actual unlock record)

EntitlementGrant:
  - entitlementType (see §3)
  - scopeType: ASSESSMENT | ACCOUNT | APPLICATION | BOOKING   (what the grant applies to)
  - scopeRef: id of the specific assessment/application/booking, or null for ACCOUNT-scoped
  - grantedVia: PURCHASE | SUBSCRIPTION | ADMIN_OVERRIDE | PROMOTION
  - sourceRef: Purchase id / Subscription id / AdminOverride id / Promotion id
  - status: ACTIVE | REVOKED | EXPIRED
  - grantedAt, expiresAt (nullable — most v1 grants don't expire), revokedAt, revokedReason
```

This is deliberately Stripe/PayPal-agnostic: `Purchase`/`Payment` records reference which processor was used and its own transaction id, but `EntitlementGrant` — the thing every authorization check actually reads — has no processor-specific fields at all. Swapping or adding a payment processor never touches entitlement-checking code.

---

## 3. Entitlement Types

| `entitlementType` | What it unlocks | Default `scopeType` | Notes |
|---|---|---|---|
| `TARGET_RESULTS` | TARGET-zone results for a given assessment (identity/program/fee/metadata for those universities) | `ASSESSMENT` | See §3.1 for the scoping decision |
| `SAFE_RESULTS` | SAFE-zone results for a given assessment | `ASSESSMENT` | Often bundled with `TARGET_RESULTS` in a single Product (a "full results" unlock), but modeled as a distinct entitlement type so they can also be sold/granted independently (e.g., a promotion that only unlocks Target) |
| `APPLICATION_SUBMISSION` | Ability to formally submit an application package for one specific program through AdmitFlow (the per-application platform fee, `00-project-charter.md` §5.3) | `APPLICATION` | Granted per application, not per account — submitting a second application requires a second grant (or a bundle/subscription that pre-grants N) |
| `CONSULTATION` | One booked consultant session | `BOOKING` | Granted at successful booking payment; consumed/marked used when the session is conducted |
| `ADVANCED_ASSESSMENT` | A deeper/extended assessment pass (e.g., broader candidate pool, more detailed reasoning, future premium scoring features) | `ASSESSMENT` or `ACCOUNT` | Reserved for future premium-tier features; modeled now so it doesn't require a new entitlement type later |
| `ASSESSMENT_REVIEW` | A consultant’s written read of one assessment result — which options genuinely fit, and what to strengthen before applying | `ASSESSMENT` | Built in D-20. Sold as the `ASSESSMENT_REVIEW` product (€10). Asynchronous written work, so it is deliberately *not* a `CONSULTATION`: there is no slot and no call. The entitlement gates `requestReview()`; the `AssessmentReview` row is only ever created after the grant exists |
| `DOCUMENT_REVIEW` | A consultant/admin-performed review of a specific document or document set | `APPLICATION` or a dedicated `DOCUMENT_SET` scope | Distinct from `CONSULTATION` since it may be sold and fulfilled independently of a live session |

**Decision — §3.1 scoping of `TARGET_RESULTS`/`SAFE_RESULTS`:** the charter (§5.2) flags this as needing a resolved decision: per-assessment vs. account-wide. **Resolution: v1's default purchasable `Product` grants `TARGET_RESULTS`+`SAFE_RESULTS` scoped to `ASSESSMENT` (i.e., tied to one specific `AssessmentResult.assessmentId` via `EntitlementGrant.scopeRef`)** — not account-wide/lifetime. Rationale: each assessment is an immutable, versioned snapshot (`16-assessment-engine.md` §6); a student who re-runs the questionnaire (updated GPA, new test score, changed preferences) generates a *new* `AssessmentResult`, and it would be both confusing and commercially wrong to have a stale purchase silently unlock a materially different new result set for free. The entitlement model still supports an `ACCOUNT`-scoped grant type for a future bundle/subscription Product (e.g., "unlimited re-assessments this admissions cycle") — that's a different `Product` definition, not a different code path, which is exactly the point of modeling scope as data.

---

## 4. Enforcement Point: Server-Side, Before Assembly — Never Send-Then-Blur

**The rule, precisely:** the API layer resolves the requesting user's active `EntitlementGrant`s (matching `entitlementType` + `scopeType`/`scopeRef` to the assessment being fetched) **before** assembling the response body, and simply does not put locked fields into the JSON that gets serialized. There is no locked-field data anywhere in the HTTP response for a student without the grant — not encrypted, not obfuscated, not present-but-CSS-hidden. This is enforced in the assessment/results service layer (the same layer, per `06-system-architecture.md` §7, that is "the only subsystem allowed to decide whether Target/Safe match data is included in an Assessment API response").

**Why this is safer than "send everything, blur client-side":**

1. **A network tab defeats client-side blurring instantly.** Any student can open browser devtools, inspect the API response, and read the university name/program/fee in plaintext regardless of what CSS or JS blur effect the UI applies. Send-then-blur is not a security control at all — it's a UI treatment that happens to look like one.
2. **It fails the object-level data-leakage rule the charter treats as non-negotiable.** `00-project-charter.md` §10.4 and `02-personas-and-roles.md` §7 both establish that unauthorized data must never reach a client that isn't entitled to it, "regardless of role," and this applies identically here: an unentitled student is, with respect to TARGET/SAFE data, an unauthorized reader.
3. **It removes an entire class of bugs.** A CSS/component bug that fails to render a blur overlay in send-then-blur becomes an instant, silent data leak with no server-side signal anything went wrong. Omission-based filtering fails safe: a bug in the omission logic is far more likely to under-return (show nothing, a visible/obvious bug) than to leak the wrong field, and it's testable with a simple contract test ("response for an unentitled request must not contain any of these field names/values anywhere in the payload").
4. **It keeps the entitlement check in exactly one place.** Every future client (web, future mobile app, admin impersonation view, a partner API) inherits the same guarantee automatically, because none of them ever receive the data to begin with — there's no per-client responsibility to "remember to blur."

### 4.1 Before/After Example — Same University, Two Entitlement States

**Locked (student has no `TARGET_RESULTS` grant for this assessment):**

```json
{
  "assessmentId": "asmt_9f2c1a",
  "results": [
    {
      "resultId": "res_552",
      "zone": "TARGET",
      "locked": true,
      "unlockRequirement": {
        "entitlementType": "TARGET_RESULTS",
        "productId": "prod_target_unlock",
        "priceId": "price_target_eur_999"
      },
      "matchScorePreview": null,
      "teaser": "1 Target match found — unlock to see university, program, and full compatibility breakdown."
    }
  ]
}
```

**Unlocked (student purchased/was granted `TARGET_RESULTS` scoped to this assessment):**

```json
{
  "assessmentId": "asmt_9f2c1a",
  "results": [
    {
      "resultId": "res_552",
      "zone": "TARGET",
      "locked": false,
      "universityId": "univ_2207",
      "universityName": "Example Institute of Technology",
      "programId": "prog_7790",
      "programName": "MSc Data Science",
      "campus": "Main Campus, Berlin",
      "matchScore": 64,
      "academicFit": { "score": 80, "label": "Meets requirement", "delta": 1 },
      "englishFit": { "score": 70, "label": "Estimated — test not yet taken", "status": "ESTIMATED_PENDING_TEST" },
      "budgetFit": { "score": 60, "label": "Small gap", "ratio": 0.94 },
      "deadlineStatus": { "score": 65, "daysRemaining": 40, "label": "Adequate window" },
      "tuitionFee": { "amount": 18500, "currency": "EUR", "period": "PER_YEAR" },
      "strengths": ["Meets the academic requirement", "Preferred field of study"],
      "weaknesses": ["Budget shows a small gap versus estimated total cost", "English score is an estimate"],
      "missingRequirements": ["English test score not on file"],
      "reasoning": "This is a Target match with 64% overall compatibility. ..."
    }
  ]
}
```

**Note what's absent from the locked payload:** no `universityId`, no `universityName`, no `programId`/`programName`, no `campus`, no `tuitionFee`, no per-factor breakdown, no `reasoning` text. `matchScorePreview` is explicitly `null` rather than the real number — even the bare score is withheld, since a precise score can itself be identifying/valuable information (and REACH results, which are free, already demonstrate the platform's credibility without needing to leak a TARGET number as a teaser). The only thing the locked entry reveals is that a result exists in that zone and what it costs to unlock, so the paywall has something to sell without giving away what it's selling.

### 4.2 Implementation shape (conceptual, no code)

1. Matching engine (`17-university-matching-engine.md`) computes the **full** result set internally, always — entitlement status is never an input to scoring or ranking, to keep that pipeline pure and independently testable (`17-university-matching-engine.md` §3, §8).
2. The results API service layer resolves the requesting student's active, non-expired, non-revoked `EntitlementGrant`s scoped to this `assessmentId` (and any `ACCOUNT`-scoped grants that also apply).
3. For each result: if `zone == REACH`, always included in full (free tier). If `zone` is `TARGET` or `SAFE`, included in full **only if** a matching active grant exists; otherwise replaced with the minimal locked-teaser shape shown above.
4. The response is serialized from this already-filtered structure. There is no downstream step where the full data could still be attached (e.g., no "send full data with a `locked: true` flag and trust the client to check it" — that IS the send-then-blur anti-pattern and is explicitly rejected).

---

## 5. Admin-Granted and Revoked Entitlements

Entitlements are not exclusively payment-driven. An `ADMIN` (or `SUPER_ADMIN`) can grant or revoke an `EntitlementGrant` directly — e.g., a goodwill unlock for a support case, or a revocation tied to a refund — via `grantedVia: ADMIN_OVERRIDE`.

**Every admin override is:**

- **Permission-gated** — requires the `entitlement:grant` permission (per `02-personas-and-roles.md` §6/§8; ADMIN and SUPER_ADMIN hold it, a future narrower `SUPPORT_AGENT` role would not, consistent with that document's design intent to keep "adjust entitlement" a separable permission from general support access).
- **Reason-required** — the grant/revoke action has a mandatory free-text reason field; there is no code path to create or revoke an `EntitlementGrant` with `grantedVia: ADMIN_OVERRIDE` and no reason.
- **Audit-logged** — recorded in the same `AuditLogEntry` mechanism used platform-wide (`06-system-architecture.md` §6, `26-university-data-management.md` §5), capturing actor, timestamp, target student, entitlement type/scope, action (grant/revoke), and the reason text. This is the same override-and-audit pattern the platform applies consistently elsewhere (e.g., document verification overrides, application status overrides) — entitlements are not a special case with weaker logging.

**Decision:** an `ADMIN_OVERRIDE` grant and a `PURCHASE`-sourced grant are indistinguishable to the *enforcement* check in §4 (both are simply an `ACTIVE` `EntitlementGrant` matching the required type/scope) — the distinction only matters for reporting, support-history display, and refund logic. This keeps the enforcement path single and simple: it never needs to branch on how an entitlement came to exist, only on whether it currently exists and is active.

---

## 6. Pricing Is Data, Not Code

Every price referenced in this document (unlock ~€9.99, application fee ~€15, consultation ~€30/40 minutes — all illustrative defaults per `00-project-charter.md` §5) lives in `Product`/`Price` rows, never as a literal in application code or a hardcoded string in UI copy. `Price` supports multiple active rows per `Product` (for multi-currency and promotional pricing), each with its own effective date range, so a price change — including a market-specific or promotional price — is a data change deployed through the admin pricing tool, requiring no engineering release. `Price` records carry the same actor/timestamp audit trail as any other admin-editable data given their direct revenue impact.

**Decision:** only `SUPER_ADMIN` may create/edit `Product`/`Price` records (per `02-personas-and-roles.md` §5/§8, "Configure pricing" is SUPER_ADMIN-only), distinct from the `ADMIN`-level `entitlement:grant` permission in §5 — an ADMIN can grant an existing product's entitlement to a specific student as a goodwill gesture, but cannot change what that product costs for everyone else.

---

## 7. Related Documents

- `16-assessment-engine.md` — the assessment result shape being gated, including why REACH is always free
- `17-university-matching-engine.md` — confirms entitlement status is never an input to matching/scoring, only to response assembly
- `02-personas-and-roles.md` — permission model (`entitlement:grant`, pricing configuration) and role definitions
- `06-system-architecture.md` §4 — webhook-driven, idempotent entitlement-granting flow on successful payment (Stripe/PayPal), including why client-reported payment success never grants entitlement by itself
- `48-idempotency.md` (referenced, authored separately) — exact dedup/retry contract for the payment→entitlement grant path
