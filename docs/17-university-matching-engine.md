# 17 — University Matching Engine

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering (Assessment/Matching subsystem)
**Depends on:** `16-assessment-engine.md` (sub-scores and Overall Match Score consumed here), `26-university-data-management.md` (catalog + freshness metadata), `00-project-charter.md`
**Read alongside:** `18-paywall-and-entitlements.md` (post-matching output filtering)
**Applies to:** All engineering work on candidate selection, ranking, and result assembly

---

## 1. Purpose

`16-assessment-engine.md` defines *how a single program is scored* for a student. This document defines *which programs get scored at all*, *how scored programs are ranked into a result set*, and *how the engine behaves gracefully when data is missing or stale* — the parts of the pipeline that sit around the scoring math.

The matching engine is a pipeline with four stages, run fresh every time a new `AssessmentResult` is generated:

```
1. Candidate Generation  →  2. Scoring  →  3. Zone Assignment  →  4. Ranking & Assembly
   (which programs even     (16-assessment-  (REACH/TARGET/SAFE   (order within each
    get considered)          engine.md)        per 16 §5)          zone, tie-breaks)
```

---

## 2. Stage 1 — Candidate Generation

Scoring every program in the catalog against every student would be wasteful and — more importantly — misleading: showing a Fine Arts PhD to a student who wants an MBA isn't a low score, it's a wrong category. Candidate generation is a set of **hard filters applied before scoring**, distinct from the hard eligibility *gates* in `16-assessment-engine.md` §5 (which run after scoring, per-program, based on computed sub-scores). Candidate generation gates are about *relevance*, not *eligibility*.

A `Program` × `Intake` pair enters the scoring stage only if **all** of the following hold:

| Gate | Rule | Rationale |
|---|---|---|
| Degree level | `Program.degreeLevel` matches `student.targetDegreeLevel`, or is an adjacent level explicitly allowed by a `DegreeLevelAdjacency` table (e.g., a Bachelor's-holder is also shown relevant Postgraduate Diplomas if they opted into "open to alternative pathways") | A pure degree-level mismatch isn't a compatibility question, it's a category error |
| Field of study | `Program.fieldTaxonomyId` is the student's stated field, or within the field's configured adjacency radius (`FieldTaxonomy.adjacentFields`) | Keeps "related field" recommendations (used for Program/Field Fit scoring in `16-assessment-engine.md` §3.4) without showing wholly unrelated disciplines |
| Country | `Program.university.countryCode` is not in `student.excludedCountries`, **and** either `student.preferredCountries` is non-empty and contains the country, is in the same region as a preferred country, or `student.preferredCountries` is empty (open to anywhere) | Respects an explicit "no" absolutely; an explicit or implicit "yes" both proceed to scoring, where `16-assessment-engine.md` §3.5 then scores *how well* it matches preference |
| Intake availability | The program has at least one `Intake` whose `applicationDeadline` is in the future (or `admissionType = ROLLING`) within `student.targetIntakeWindow` (default: next 3 published intakes if unspecified) | No point scoring/showing a program with no way to actually apply within the student's horizon |
| Delivery mode | If the student expressed a **hard** preference (e.g., "on-campus only"), programs whose only delivery mode is fully online are excluded; if the student expressed no hard preference, all delivery modes proceed | A hard preference is a relevance filter; a soft preference is scored, not filtered (folded into Country/Preference Score's secondary signals) |
| Explicit blacklist | Program/university not on the student's "not interested" list (a lightweight per-student exclusion the student can set from a result they've seen before) | Respects prior explicit student feedback |

**Decision:** candidate generation gates are binary (in/out), never partially scored — softening any of them into a scored factor would blur the line between "this program is not relevant to what you asked for" and "this program is relevant but you may not get in," which are different messages requiring different UI treatment (the latter is exactly what REACH/TARGET/SAFE communicates). Keeping generation binary and scoring probabilistic is what keeps the two concerns separable and each one explainable on its own terms.

**Cardinality control:** for very broad students (e.g., "open to any country, any field adjacent to Business"), candidate generation can still produce a large set. **Decision:** candidate generation caps at the 300 highest-relevance `Program × Intake` pairs (ranked first by field/degree exactness, then country preference rank, then intake proximity) before scoring runs, to bound compute cost; this cap is configurable per environment and is a performance safeguard, not a business rule — it is documented here so it's never mistaken for a hidden ranking bias. In practice, given realistic catalog sizes and questionnaire specificity, the cap is expected to rarely bind.

---

## 3. Stage 2 — Scoring

Every surviving candidate is scored exactly as defined in `16-assessment-engine.md` §3–§4, using the `AssessmentRule` version that is ACTIVE at the moment the assessment is generated. This stage is a pure function of (student profile snapshot, questionnaire snapshot, one candidate's catalog data, the active `AssessmentRule`) → one scored result. Stage 2 does not know about, or need to know about, ranking or zones — it is deliberately kept as a per-candidate pure computation so it's independently testable and so a bug in ranking can never corrupt a score, or vice versa.

---

## 4. Stage 3 — Zone Assignment

Applied per-candidate immediately after scoring, exactly per `16-assessment-engine.md` §5 (hard-gate exclusion, then REACH 20–57 / TARGET 58–77 / SAFE ≥78-with-guardrails). This document does not restate the thresholds — see that section for the authoritative table. What's added here is what happens **across** candidates once every candidate has a zone.

---

## 5. Stage 4 — Ranking and Tie-Breaking

### 5.1 Ranking order

Within each zone, candidates are ordered by `matchScore` descending. Zones themselves are always presented in a fixed order in the API response and UI: REACH, then TARGET, then SAFE (matching the ambition gradient the product communicates, not a score-driven order across zones — a 95-score SAFE program is not "better" than a 55-score REACH program in a single flattened list; they answer different questions for the student).

**Decision:** result sets are capped at a configurable maximum per zone for the initial response (default: top 10 REACH, top 15 TARGET, top 15 SAFE) with pagination/"show more" for the rest, to keep the payload and UI scannable; the cap is a presentation limit, not a change to what was computed — the full scored candidate set (including anything below the REACH floor of 20, retained only for admin/debug tooling, never shown to the student) remains attached to the `AssessmentResult` for audit purposes.

### 5.2 Tie-breaking rules

Two candidates are considered tied when their `matchScore` values are within **0.5 points** of each other (`AssessmentRule.tieEpsilon`, default 0.5 — configurable). Ties are broken, in order, by:

1. **Document/Deadline actionability** — higher `deadlineStatus.score` wins (favor what the student can act on soonest; this deliberately does *not* use raw days-remaining directly, reusing the already-computed Deadline Score keeps this consistent with §3.7 of the assessment engine doc).
2. **University/program ranking** (from `UniversityRanking`, `26-university-data-management.md`), **used only as a tiebreaker, never as a primary scoring input.** This is intentional and worth stating plainly: letting external rankings drive primary match score would reintroduce exactly the kind of unexamined bias (prestige/marketing-driven, not fit-driven) the charter's "Unbiased" principle rejects. Rankings only decide order between two programs the engine has already judged equally compatible.
3. **Data freshness** — the candidate with the more recently `verifiedAt` core requirement data wins (see §6) — prefer showing the student the program AdmitFlow is more current on.
4. **Deterministic final tiebreak** — sort by `programId` ascending. This guarantees that given identical inputs (same student snapshot, same rules version, same catalog version), the ranking is **always** byte-identical across repeated runs — never a source of nondeterminism that would undermine the reproducibility guarantee in `16-assessment-engine.md` §6.

### 5.3 Explicit non-goals for ranking

- Ranking never factors in whether a university pays AdmitFlow a referral/commission fee. There is no such input to the pipeline at all — not "weighted at zero," genuinely absent from the schema, so it cannot be silently reintroduced by a future PR that just "adds a small boost."
- Ranking never factors in an AI-generated "likelihood" independent of the deterministic sub-scores (see `16-assessment-engine.md` §9).

---

## 6. Handling Missing or Stale University Data

The matching engine must never silently treat absent or stale catalog data as if it were current, confirmed information — both because it's factually wrong and because a student could make a real financial/visa decision on it.

### 6.1 Missing data (a required field simply isn't populated)

Per `16-assessment-engine.md` §4's weight-redistribution rule: if a program has no `EnglishRequirement` on file at all, no `TuitionFee` on file, or no `ProgramRequirement.minAcademicIndex`, that sub-score is excluded (not scored as 0 or 100) and its weight is redistributed across the remaining computed sub-scores. The result surfaces this plainly:

```json
"missingRequirements": [
  "Tuition fee not on file for this program — estimated cost unavailable, confirm with the university before applying"
],
"dataGaps": ["TUITION_FEE_MISSING"]
```

A program is **never excluded from candidate generation purely because a non-critical field is missing** — that would penalize well-fitting programs for a data-entry gap rather than an actual student-fit problem. It is excluded only if a field required for a *candidate-generation gate* (degree level, field taxonomy, country, at least one intake) is missing, since those aren't scoreable-around by definition.

### 6.2 Stale data (a field exists but hasn't been reverified recently)

Every catalog record relevant to scoring carries `verifiedAt`, `verifiedBy`, `confidence` (per `26-university-data-management.md` §4). The matching engine applies this staleness policy, consistent with the thresholds defined there:

| Field group | Staleness threshold (default, `26-university-data-management.md` §4) | Engine behavior when stale |
|---|---|---|
| Core requirements: GPA/English minimums, tuition fee, application deadlines | `verifiedAt` > 6 months ago | Program **is still scored and shown** (never silently dropped — a stale-but-probably-still-correct program is more useful to a student than an invisible one). Result carries `dataFreshness: "STALE"` and the `reasoning` string appends: "This program's requirements were last verified over 6 months ago — confirm current details directly with the university before applying." Deprioritized in tie-breaking only (§5.2 step 3); `matchScore` itself is **not** numerically penalized. |
| Rankings, general descriptive metadata | `verifiedAt` > 12 months ago | Same pattern: shown, flagged `dataFreshness: "STALE"` on the metadata block specifically, not on the whole result, since it doesn't affect eligibility scoring inputs. |

**Decision — why staleness never changes `matchScore` numerically:** conflating "how well does this student fit this program" with "how confident are we the underlying data is still accurate" would make the score mean two different things depending on the program, breaking comparability between two results with the same score. Freshness is therefore modeled as an **independent confidence signal** (`dataFreshness`, surfaced per-field and rolled up to a result-level `overallDataConfidence: "CURRENT" | "STALE" | "MIXED"`), used for tie-breaking and UI messaging, never blended into the compatibility number itself.

**Decision — `confidence = LOW` combined with staleness:** if a record's admin-set `confidence` field is `LOW` *and* it's also past its staleness threshold, the matching engine deprioritizes it below all otherwise-tied `MEDIUM`/`HIGH`-confidence candidates in tie-breaking (inserted as tie-break step 3a, before the freshness-date check), and the UI note upgrades from "may be outdated" to "please verify directly with the university before relying on this information" — still shown, never hidden, just clearly caveated.

### 6.3 Handling missing student data gracefully (cross-reference)

Covered in full in `16-assessment-engine.md` §3.2 (English test not yet taken → provisional estimate, capped, SAFE-blocked) — restated here only to make the general principle explicit for matching-pipeline authors: **a missing input is a "the true score is currently unknown, here is our best conservative estimate" case, never a false-negative "this student fails this program" case, and never a false-positive "treat it as if it were confirmed" case either.** The same pattern (conservative estimate, explicit flag, SAFE-tier ineligible while estimated) is the template for any future input the questionnaire might add that a student can legitimately skip or not yet have (e.g., a standardized test not yet taken, a financial document not yet available).

---

## 7. University Matching Transparency

Every recommendation returned to a student — regardless of zone — includes a plain-language breakdown a non-technical user can read top to bottom without needing to understand the underlying scoring math. This is generated directly from the structured fields in `16-assessment-engine.md` §7 (never a separate, potentially-inconsistent AI summary):

```
Academic compatibility: Strong (exceeds requirement)
English requirement: Met (IELTS 6.5, verified)
Budget compatibility: Tight but covered
Preferred country: Match (your #1 choice)
Intake: Available (Spring 2027, 45 days to apply)
Documents: 1 missing (Statement of Purpose)
Data last verified: 14 days ago
```

or, for a stale/estimated example:

```
Academic compatibility: Meets requirement
English requirement: Estimated — no test on file yet (take IELTS/TOEFL/PTE to confirm)
Budget compatibility: Small gap
Preferred country: Match
Intake: Available (Fall 2027, 40 days to apply)
Documents: 3 of 5 verified
Data last verified: 8 months ago — confirm details directly with the university
```

**Rule:** this breakdown is mandatory output for every result object, not an optional UI nicety layered on top later — `academicFit.label`, `englishFit.label`, `budgetFit.label`, the country-match flag, `deadlineStatus.label`, the document-missing count, and `dataFreshness` are all fields on the result object itself (`16-assessment-engine.md` §7), so any client (web, future mobile, admin tooling) renders the same transparent breakdown from the same API response without reimplementing scoring logic client-side.

---

## 8. What This Document Does Not Cover

- The scoring formulas themselves — see `16-assessment-engine.md`.
- The catalog schema and data-quality workflow — see `26-university-data-management.md`.
- How TARGET/SAFE results are filtered out of the API response for unentitled students — see `18-paywall-and-entitlements.md` §4 (the matching engine always computes the full result set internally; entitlement filtering is a separate, later step, never conditional logic inside the matching pipeline itself).

## 9. Related Documents

- `16-assessment-engine.md` — sub-score formulas, Overall Match Score, zone thresholds, versioning, AI constraints
- `26-university-data-management.md` — normalized catalog schema, `verifiedAt`/`confidence`/staleness definitions
- `18-paywall-and-entitlements.md` — entitlement-based response filtering applied after this pipeline produces its result set
