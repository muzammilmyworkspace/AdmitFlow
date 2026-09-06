# 16 — Assessment Engine

**Product:** AdmitFlow by SNZ Ventures
**Document status:** Foundational — v1.0
**Owner:** SNZ Ventures Engineering (Assessment/Matching subsystem)
**Depends on:** `00-project-charter.md`, `02-personas-and-roles.md`
**Read alongside:** `17-university-matching-engine.md` (candidate generation/ranking that consumes this engine's per-factor scores), `26-university-data-management.md` (the catalog data these scores are computed against), `18-paywall-and-entitlements.md` (how results are filtered before leaving the API)
**Applies to:** All engineering work on scoring, versioning, and result generation; binding on any future refactor

---

## 1. Purpose and Non-Negotiables

The assessment engine turns a student's profile and questionnaire answers into an **explainable, reproducible, versioned** compatibility read against university programs. It is the core IP of AdmitFlow and the thing students are ultimately paying to unlock (TARGET/SAFE zones), so it must earn trust every time it's shown.

Binding rules for this document (restated from the charter, made concrete here):

1. **Configurable, not hardcoded.** The scoring model is a set of `AssessmentRule` records (weights, bands, thresholds) editable by SUPER_ADMIN and versioned. This is explicitly **not** `if GPA >= minGPA AND IELTS >= minIELTS THEN match` — see §3 for why a hard cutoff is rejected in favor of tolerance-band scoring.
2. **Snapshot everything.** Every `AssessmentResult` freezes exactly what it saw: `studentProfileSnapshot`, `questionnaireSnapshot`, `matchingEngineVersion`, `universityDataVersion`, `rulesVersion`, `generatedAt`, `results`. Nothing about a past result is recomputed when rules or catalog data later change (§6).
3. **Never an unexplained score.** Every per-university result carries a plain-language `reasoning` string and structured per-factor breakdowns (`academicFit`, `englishFit`, `budgetFit`, `deadlineStatus`, `strengths`, `weaknesses`, `missingRequirements`). A bare number with no context is a defect, not a shippable result — see §8 for the rejected "AI black box" anti-pattern.
4. **Hard eligibility gates stay deterministic.** Minimum GPA/English/budget-ceiling/deadline/required-document gates are rule-based, computed by this engine, and never delegated to an AI model as the sole source of truth (§9).
5. **No guarantee language, anywhere.** Zone names, copy, variable names, and reasoning strings must never say or imply "guaranteed." See §5 for approved language.

---

## 2. Inputs

### 2.1 Student Profile Snapshot

Captured from the student's `OnboardingProfile` and `Document Vault` state at assessment time. Conceptually:

| Field | Example | Used by |
|---|---|---|
| `academicRecords[]` | degree level, GPA/CGPA/percentage + scale, institution country, graduation year, backlogs/repeats/gaps | Academic Score, Risk Score |
| `englishTest` | test type (IELTS/TOEFL/PTE/Duolingo/none), scores per band, test date | English Score |
| `mediumOfInstruction` | whether prior education was in English | English Score (waiver logic) |
| `targetDegreeLevel` | Bachelor's / Master's / PhD / Diploma / Foundation | Candidate generation (doc 17) |
| `targetFields[]` | ranked fields of study/specializations | Program/Field Fit Score |
| `preferredCountries[]`, `excludedCountries[]` | ranked preference list, explicit blacklist | Country/Preference Score, candidate generation |
| `budget` | amount, currency, per-year or total, funding sources declared (self/family/loan/scholarship-dependent) | Budget Score |
| `targetIntakeWindow` | e.g. "next 3 intakes" or a specific term | Deadline Score, candidate generation |
| `documentVaultStatus[]` | per document-type: MISSING / UPLOADED / VERIFIED | Document Readiness Score |
| `riskFactors` | study gaps (months, explained/unexplained), backlogs count, repeated years, prior visa refusals (self-declared) | Risk Score |

**Decision:** the snapshot stores the *resolved, normalized* values (e.g., GPA already converted to the common Academic Index defined in §3.1) alongside the raw student-entered values, not just the raw values. Rationale: if the conversion table itself is later edited, a past result must still show exactly what index value it scored against — normalization is part of what gets frozen, not something recomputed on read.

### 2.2 Questionnaire Snapshot

The full set of `QuestionnaireResponse` records tied to the `Questionnaire` version the student completed, including that version's id. The questionnaire is itself versioned independently of the scoring engine (a wording/branching change to the questionnaire does not require a new engine version, and vice versa).

### 2.3 University/Program Catalog

Read from the normalized catalog (`26-university-data-management.md`) at the `universityDataVersion` current at generation time. The engine scores against `Program`, `ProgramRequirement`, `EnglishRequirement`, `Intake`, `TuitionFee`, and `UniversityMetadata` (verification/freshness) records.

---

## 3. Sub-Scores

Every sub-score is normalized to **0–100**. All bands, tolerances, and conversion tables below are **default v1 seed data** living in `AssessmentRule` (or a table it references), editable by SUPER_ADMIN and versioned — not constants in code.

### 3.1 Academic Score

**Why not a hard cutoff:** a student at 3.4 GPA against a 3.5 minimum is meaningfully different from a student at 2.0 GPA against the same minimum, and many programs admit somewhat below their stated minimum with holistic review or a foundation year. A boolean `gpa >= minGPA` throws away exactly the information a student is paying for.

**Step 1 — normalize to a common Academic Index (0–100).** Student GPA/CGPA/percentage/grading-scheme and the program's stated minimum are both converted via an admin-editable `GPAConversionTable` (illustrative default, seed data):

| Source scale | Value | Academic Index |
|---|---|---|
| 4.0 GPA | 4.0 / 3.7 / 3.3 / 3.0 / 2.7 / 2.0 | 100 / 92 / 85 / 78 / 70 / 50 |
| 10-point CGPA | 9.5 / 9.0 / 8.0 / 7.0 / 6.0 / 5.0 | 100 / 92 / 80 / 68 / 55 / 40 |
| Percentage | 95% / 85% / 75% / 65% / 55% | 98 / 88 / 75 / 60 / 42 |
| UK honours | First / 2:1 / 2:2 / Third | 92 / 80 / 65 / 48 |

(Interpolated linearly between listed anchor points; values outside the table's range clamp to the nearest anchor.)

**Step 2 — compute Δ (delta):**

```
Δ = studentAcademicIndex − program.minAcademicIndex
```

**Step 3 — apply the tolerance-band scoring table** (default v1, versioned in `AssessmentRule.academicBands`):

| Δ (index points) | Academic Score | Meaning |
|---|---|---|
| ≥ +8 | 100 | Comfortably exceeds requirement |
| +4 to +7.9 | 90 | Exceeds requirement |
| 0 to +3.9 | 80 | Meets requirement |
| −3.9 to −0.1 | `80 + 6.4×Δ` → 55–79.6 | Slightly below, within normal tolerance band |
| −7.9 to −4.0 | `40 + 3.75×(Δ+4)` → 25–54.9 | Below requirement; only viable if program allows conditional/foundation admission |
| ≤ −8 | 0 | Below extended tolerance — **hard-gate fail** unless the program has a published conditional/foundation pathway (`Program.conditionalAdmissionAvailable = true`), in which case Academic Score floors at 15 and `missingRequirements` records "Academic index below standard entry — foundation/pathway route only" |

**Worked example:** Student's GPA is 3.2/4.0 → Academic Index ≈ 82 (interpolated between 78 and 85). Program's `minAcademicIndex` = 78 (equivalent to ~3.0/4.0). Δ = +4 → Academic Score = 90 ("Exceeds requirement").

A second program requires `minAcademicIndex` = 90 (≈3.7/4.0). Δ = 82 − 90 = −8 → Academic Score = 0, hard-gate fail *unless* that program allows conditional admission, in which case Academic Score = 15 and the result explicitly says so rather than silently omitting the program.

### 3.2 English Score

Same tolerance-band approach, using an `EnglishConversionTable` mapping each accepted test (IELTS/TOEFL iBT/PTE Academic/Duolingo) to a common English Index (0–100), and the program's `EnglishRequirement.minEnglishIndex` (per test type, since equivalencies aren't perfectly linear — the table is seeded per test, not derived by simple ratio).

Illustrative default IELTS → English Index anchors: 5.0→45, 5.5→58, 6.0→70, 6.5→78, 7.0→86, 7.5→93, 8.0+→100.

Band table (same shape as Academic, default v1):

| Δ (English Index points) | English Score |
|---|---|
| ≥ +6 | 100 |
| 0 to +5.9 | 80–99 (linear) |
| −5.9 to −0.1 | 55–79 (linear) |
| −11.9 to −6.0 | 20–54 (linear); viable only with a pre-sessional/foundation English pathway |
| ≤ −12 | 0 — hard-gate fail unless waived |

**Waiver:** if `mediumOfInstruction = English` for the student's most recent qualification and the program accepts a medium-of-instruction (MOI) waiver, English Score = 100 regardless of test status, and `englishFit = "Waived — prior education in English"`.

**Decision — missing English test (no score on file):** English Score is **never defaulted to 0**, because that would misrepresent a student who simply hasn't tested yet as failing every English-sensitive program — a false negative the charter explicitly warns against. Instead:

- The engine computes a **Provisional English Score** from the questionnaire's self-reported proficiency band (a required question: "How would you rate your English ability?" mapped conservatively, e.g. "Advanced" → English Index 72, "Intermediate" → 55, "Basic" → 35) or the MOI waiver check above, whichever is more favorable to the student's true chances (MOI waiver, if applicable, wins).
- Provisional English Score is **capped at 70** regardless of self-report, so an untested student can never be scored as if they had a strong verified result.
- The result carries `englishFit: "ESTIMATED_PENDING_TEST"` and `dataGaps: ["ENGLISH_TEST_MISSING"]`.
- **SAFE zone eligibility is blocked whenever English Score is provisional** (§5) — an estimate is not grounds for the platform's highest-confidence tier.

### 3.3 Budget Score

```
totalEstimatedCost = programCurrencyConverted(TuitionFee.annualAmount × programDurationYears) + livingCostEstimate(country/city)
budgetRatio = student.budget.convertedToProgramCurrency / totalEstimatedCost
```

FX conversion uses a daily-refreshed rate table (see `33-caching-strategy.md` for cache mechanics); the rate-table version used is part of the snapshot's derived data, same rationale as GPA normalization.

| `budgetRatio` | Budget Score | Meaning |
|---|---|---|
| ≥ 1.3 | 100 | Comfortable margin, including buffer for FX/living-cost variance |
| 1.1–1.29 | 90 | Covered with margin |
| 1.0–1.09 | 80 | Covered, tight margin |
| 0.9–0.99 | 60 | Small gap — bridgeable via scholarship/part-time work in many cases |
| 0.75–0.89 | 35 | Significant gap |
| < 0.75 | 10 | Large gap |

**Decision:** Budget Score is **never a hard gate by default** — a large financial gap materially lowers the score and blocks SAFE (§5) but does not exclude the program outright, because scholarships, loans, and family support are real and outside the platform's visibility. Rationale: excluding on budget alone would hide options a student might still pursue, contradicting the "never oversimplify" mission. Exception: a `ProgramRequirement.budgetHardCeiling = true` flag (admin-set, used for programs/countries with strict visa-linked proof-of-funds rules and no flexibility) makes budget a hard gate for that specific program only.

### 3.4 Program/Field Fit Score

Computed only for candidates that already passed the degree-level/field candidate-generation gate (§ in `17-university-matching-engine.md`) — this sub-score measures *closeness* of fit, not eligibility:

| Match type | Score |
|---|---|
| Exact field + exact specialization keyword match to stated preference | 100 |
| Exact field, no specialization match | 85 |
| Adjacent field per `FieldTaxonomy` adjacency table (e.g., Data Science ↔ Computer Science) | 65 |
| Same broad discipline group only (e.g., both "Engineering") | 45 |

### 3.5 Country/Preference Score

| Match type | Score |
|---|---|
| Student's #1 ranked preferred country | 100 |
| Student's #2–3 ranked preferred country | 85 |
| Preferred region, not a top-ranked country | 60 |
| No country preference stated (open to anywhere) | 70 (neutral default — **Decision:** an unstated preference is treated as neutral-favorable, not penalized, since requiring a preference to score well would bias against genuinely flexible students) |
| Country explicitly excluded by student | Not scored — excluded at candidate generation, never reaches this sub-score |

Secondary preference signals from the questionnaire (climate, post-study work rights, diaspora/community size, campus setting urban/rural) apply a bounded adjustment of up to ±10 points on top of the base country match.

### 3.6 Risk Score (higher = lower risk)

Starts at 100; deductions apply per declared risk factor (default v1, `AssessmentRule.riskDeductions`):

| Risk factor | Deduction | If documented/explained (upload + note) |
|---|---|---|
| Unexplained study gap 12–24 months | −15 | −7 |
| Unexplained study gap > 24 months | −30 | −15 |
| Each backlog/failed course (up to 3 counted) | −10 each | −5 each |
| Repeated academic year | −15 | −8 |
| Prior visa refusal (any country, self-declared) | −25 | −25 (documentation doesn't reduce this one — it's disclosed for transparency, not "explained away") |

Floors at 0. Risk Score never turns into a hard gate on its own (a high-risk profile is still shown, just scored and explained honestly) — it factors into the SAFE-zone guardrail (§5) because SAFE is specifically AdmitFlow's "higher-confidence" tier and a materially risky profile shouldn't sit there even if other sub-scores are strong.

### 3.7 Deadline Score

Compares days-until-deadline for the *next viable intake* (see candidate generation in doc 17 for how "next viable intake" is chosen) against `Program.recommendedPrepDays` (default 30 if unset):

| Days until deadline | Deadline Score |
|---|---|
| ≥ 90 | 100 |
| 60–89 | 85 |
| 30–59 | 65 |
| 15–29 | 40 |
| 5–14 | 20 |
| < 5, and no rolling admission / later intake exists | 0 — hard-gate fail (excluded; see §5) |

If the nearest intake's deadline has passed but a later intake exists within the student's `targetIntakeWindow`, the engine automatically scores against that later intake rather than failing the program — see `17-university-matching-engine.md` §"Missing/Stale Data Handling."

### 3.8 Document Readiness Score

```
DocumentReadinessScore = 100 × (verifiedCount + 0.5 × pendingCount) / totalRequiredDocuments
```

using the program's required-document list (`26-university-data-management.md`) cross-referenced against the student's Document Vault status. A document that's uploaded but not yet verified counts at half weight — present but not yet trustworthy.

---

## 4. Overall Match Score

```
OverallMatchScore = round(
    w_academic  × AcademicScore +
    w_english   × EnglishScore +
    w_budget    × BudgetScore +
    w_program   × ProgramFitScore +
    w_country   × CountryScore +
    w_risk      × RiskScore +
    w_deadline  × DeadlineScore +
    w_document  × DocumentReadinessScore
)
```

**Default v1 weights** (`AssessmentRule.weights`, sum to 100%):

| Sub-score | Default weight |
|---|---|
| Academic | 25% |
| English | 20% |
| Budget | 15% |
| Program/Field Fit | 15% |
| Country/Preference | 10% |
| Risk | 10% |
| Deadline | 3% |
| Document Readiness | 2% |

**Decision — weight redistribution on missing inputs:** if a sub-score cannot be computed at all because the *catalog* has no data for that factor (e.g., no `EnglishRequirement` on file for a program — not the same as "student hasn't tested," which is handled in §3.2), that sub-score is excluded and its weight is redistributed proportionally across the remaining sub-scores for that program's calculation only. The result flags `missingRequirements: ["English requirement not on file — verify directly with the university"]`. This is different from scoring it as 0 (would falsely tank a program) or 100 (would falsely inflate it) — an unknown input is surfaced as unknown, never silently guessed.

**Worked example** (values from the Academic/English/Budget examples above, illustrative remaining sub-scores):

| Sub-score | Value | Weight | Contribution |
|---|---|---|---|
| Academic | 90 | 25% | 22.5 |
| English | 78 (verified IELTS 6.5 vs required 6.5, Δ=0) | 20% | 15.6 |
| Budget | 80 | 15% | 12.0 |
| Program Fit | 100 | 15% | 15.0 |
| Country | 85 | 10% | 8.5 |
| Risk | 100 (no risk factors) | 10% | 10.0 |
| Deadline | 85 (45 days out) | 3% | 2.55 |
| Document Readiness | 80 (4/5 verified) | 2% | 1.6 |
| **Overall Match Score** | | | **87.75 → 88** |

---

## 5. Zone Mapping (REACH / TARGET / SAFE)

Zone thresholds live in `AssessmentRule.zoneThresholds`, versioned together with the weights they were tuned against (changing one without the other is a new version regardless — see §6).

**Step 1 — Hard-gate exclusion** (deterministic; a program failing any of these is not scored/returned at all, not even as a low-score REACH entry):

1. Academic Score = 0 **and** program has no conditional/foundation pathway.
2. English Score = 0 (below extended tolerance, no waiver, no pre-sessional pathway).
3. No viable intake — nearest deadline passed, no rolling admission, and no later intake within the student's target window.
4. `budgetHardCeiling = true` on the program and `budgetRatio < 1.0`.
5. Candidate-generation gates from `17-university-matching-engine.md` (degree level, field, explicit country exclusion) never reached scoring in the first place.

**Step 2 — Zone bands** (default v1, on the rounded `OverallMatchScore`):

| Zone | Score range | Additional guardrails |
|---|---|---|
| **EXCLUDED** (not returned) | < 20 | — |
| **REACH** (free) | 20–57 | none — REACH is deliberately the "ambitious, here's the honest picture" tier |
| **TARGET** (paywalled) | 58–77 | none |
| **SAFE** (paywalled) | ≥ 78 | **all** of: Academic Score ≥ 70, English Score ≥ 70 or waived **and not** `ESTIMATED_PENDING_TEST`, Deadline Score ≥ 40, Risk Score ≥ 50 |

If a program scores ≥ 78 but fails a SAFE guardrail, it is **demoted to TARGET**, not silently upgraded — e.g., a student with a provisional (untested) English estimate can never land in SAFE no matter how high the rest of the profile scores. This is the concrete mechanism behind the legal/brand rule: SAFE is reserved for cases where the platform's own inputs are verified, not estimated.

**Decision — approved zone/status language:** *Strong Match*, *High Confidence*, *Ambitious Match*, *Meets Requirement*, *Below Typical Range*. Never: "Guaranteed," "100% Admission," "Sure Shot," or any internal variable/comment implying certainty (e.g. `isGuaranteed`, `guaranteedAdmit` are banned identifiers — see `14-security-architecture.md` code-review checklist, referenced there for enforcement).

---

## 6. Versioning Model

### 6.1 What gets versioned, and by what

| Concept | Versioned entity | Who publishes | What a version change means |
|---|---|---|---|
| Scoring weights, bands, zone thresholds | `AssessmentRule` (status: DRAFT → ACTIVE → ARCHIVED) | SUPER_ADMIN only (`scoring_rules:publish` permission, per `02-personas-and-roles.md` §8) | New `rulesVersion`; all *future* assessments use it. Past `AssessmentResult` rows are untouched. |
| University/program catalog content | `University`/`Program`/... version counter (see `26-university-data-management.md`) | ADMIN/SUPER_ADMIN/future UNIVERSITY_MANAGER, DATA_MANAGER | New `universityDataVersion`; future assessments read the new data. |
| Assessment engine code itself (sub-score formulas, e.g. adding a new sub-score) | `matchingEngineVersion` (deploy-time constant, not admin-edited) | Engineering, via release | A structural change to *how* scoring is computed, distinct from weight tuning — even a pure config change to weights still gets a new `rulesVersion`, but a new sub-score or changed formula shape requires a `matchingEngineVersion` bump because old snapshots may not have all the same fields. |

**Non-negotiable:** editing `AssessmentRule.weights` or `.zoneThresholds` never mutates an existing ACTIVE or ARCHIVED row. Publishing creates a new row with a new version number and (optionally) an `effectiveFrom` timestamp; the previous version moves to ARCHIVED and remains queryable forever for audit/explainability of historical results. Only one `AssessmentRule` version is ACTIVE at a time in v1 (**Decision:** no per-market/per-country rule variants yet — flagged as a future extension point, not built now, to avoid speculative complexity).

### 6.2 The snapshot contract

Every `AssessmentResult` persists, verbatim, at generation time:

- `studentProfileSnapshot` — resolved profile inputs used (§2.1), including normalized indices.
- `questionnaireSnapshot` — the questionnaire responses + questionnaire version id.
- `matchingEngineVersion` — the code version that ran.
- `universityDataVersion` — the catalog version read.
- `rulesVersion` — the `AssessmentRule` version applied (weights + bands + thresholds).
- `generatedAt` — timestamp.
- `results` — the array of per-university outcomes (§7).

**Rule:** if any of `matchingEngineVersion`, `universityDataVersion`, or `rulesVersion` change after a result exists, that old result is *never* recalculated, re-scored, or re-labeled. A student looking at an assessment from three months ago sees exactly what the engine told them three months ago, with a visible version stamp. Re-running the questionnaire (or a student-initiated "re-assess me" action) creates a **new** `AssessmentResult` under the then-current versions — it does not edit the old one. This is what makes disputes, support tickets, and "why did my score change" conversations resolvable: the answer is always "compare which `rulesVersion`/`universityDataVersion` each result used," never "the algorithm just changed under you."

---

## 7. Example `AssessmentResult` (illustrative JSON shape)

```json
{
  "assessmentId": "asmt_9f2c1a",
  "studentId": "stu_4471",
  "matchingEngineVersion": "2.3.0",
  "universityDataVersion": "cat_2026_08_v14",
  "rulesVersion": "rules_v7",
  "generatedAt": "2026-09-06T10:12:00Z",
  "studentProfileSnapshot": {
    "academicIndex": 82,
    "academicIndexSource": "GPA 3.2/4.0 via GPAConversionTable v3",
    "englishTest": { "type": "IELTS", "overall": 6.5, "testDate": "2026-05-14" },
    "englishIndex": 78,
    "budget": { "amount": 24000, "currency": "EUR", "period": "PER_YEAR" },
    "targetDegreeLevel": "MASTERS",
    "targetFields": ["Data Science", "Computer Science"],
    "preferredCountries": ["Germany", "Netherlands", "Ireland"],
    "riskFactors": []
  },
  "questionnaireSnapshot": {
    "questionnaireVersion": "q_2026_06",
    "responseSetId": "qr_88213"
  },
  "results": [
    {
      "universityId": "univ_1042",
      "programId": "prog_5581",
      "intakeId": "intake_2027_spring",
      "matchScore": 88,
      "zone": "SAFE",
      "eligibilityStatus": "ELIGIBLE",
      "academicFit": { "score": 90, "label": "Exceeds requirement", "delta": 4 },
      "englishFit": { "score": 78, "label": "Meets requirement", "status": "VERIFIED" },
      "budgetFit": { "score": 80, "label": "Covered, tight margin", "ratio": 1.04 },
      "deadlineStatus": { "score": 85, "daysRemaining": 45, "label": "Comfortable window" },
      "estimatedCompatibility": "Strong",
      "strengths": [
        "GPA exceeds the program's minimum requirement",
        "English score meets requirement with a verified test",
        "Matches your top preferred country and target field"
      ],
      "weaknesses": [
        "Budget covers the estimated cost with only a small margin"
      ],
      "missingRequirements": [
        "1 of 5 required documents not yet uploaded: Statement of Purpose"
      ],
      "reasoning": "This is a Safe match with 88% overall compatibility. Your academic profile exceeds this program's minimum requirement, and your verified IELTS score meets the English requirement. Your budget covers the estimated annual cost with a modest margin. The application deadline is 45 days away, which is a comfortable window, and you're missing one document (Statement of Purpose). This is an indicative assessment based on the information you provided — not an admission decision; the university makes the final decision."
    },
    {
      "universityId": "univ_2207",
      "programId": "prog_7790",
      "intakeId": "intake_2027_fall",
      "matchScore": 64,
      "zone": "TARGET",
      "eligibilityStatus": "ELIGIBLE",
      "academicFit": { "score": 80, "label": "Meets requirement", "delta": 1 },
      "englishFit": { "score": 70, "label": "Estimated — test not yet taken", "status": "ESTIMATED_PENDING_TEST" },
      "budgetFit": { "score": 60, "label": "Small gap", "ratio": 0.94 },
      "deadlineStatus": { "score": 65, "daysRemaining": 40, "label": "Adequate window" },
      "estimatedCompatibility": "Good, pending English test",
      "strengths": ["Meets the academic requirement", "Preferred field of study"],
      "weaknesses": [
        "Budget shows a small gap versus estimated total cost",
        "English score is an estimate — take a recognized English test to confirm"
      ],
      "missingRequirements": ["English test score not on file"],
      "reasoning": "This is a Target match with 64% overall compatibility. Your academic profile meets the requirement, but your English score is currently an estimate based on your self-reported proficiency — taking a recognized test (IELTS/TOEFL/PTE) will sharpen this result and may improve your zone placement. Your budget shows a modest gap versus the estimated annual cost. This is an indicative assessment, not an admission decision."
    },
    {
      "universityId": "univ_3390",
      "programId": "prog_9012",
      "intakeId": "intake_2027_fall",
      "matchScore": 41,
      "zone": "REACH",
      "eligibilityStatus": "ELIGIBLE_WITH_GAPS",
      "academicFit": { "score": 55, "label": "Slightly below requirement", "delta": -3.2 },
      "englishFit": { "score": 78, "label": "Meets requirement", "status": "VERIFIED" },
      "budgetFit": { "score": 35, "label": "Significant gap", "ratio": 0.81 },
      "deadlineStatus": { "score": 40, "daysRemaining": 18, "label": "Tight window" },
      "estimatedCompatibility": "Ambitious",
      "strengths": ["English requirement met"],
      "weaknesses": [
        "Academic profile is below this program's typical entry range",
        "Significant budget gap versus estimated total cost",
        "Application window is closing soon"
      ],
      "missingRequirements": [],
      "reasoning": "This is a Reach match with 41% overall compatibility — an ambitious option. Your academic profile is somewhat below this program's typical range, and there's a significant gap between your stated budget and the estimated total cost. The application window is tightening, with 18 days remaining. This is shown as a Reach option because ambitious goals are still worth knowing about — not because admission is likely. This is an indicative assessment, not an admission decision."
    }
  ]
}
```

Note the shape above is the **unfiltered/entitled** view. What an unentitled student actually receives over the API for the TARGET/SAFE entries is covered in `18-paywall-and-entitlements.md` §4 — locked entries are omitted, not sent-and-blurred.

---

## 8. Explainability Requirement — What We Reject

**Rejected pattern:** returning a single `matchScore` (or an AI-generated blurb) with no structured factor breakdown, no `missingRequirements`, and no way for the student (or support, or an auditor) to see *why* that number came out. This fails the charter's transparency principle and non-negotiable #5 (reproducibility) on its face — a number alone is not reproducible-feeling even if it technically is.

Every `AssessmentResult.results[]` entry **must** include, at minimum: `matchScore`, `zone`, `eligibilityStatus`, `strengths[]`, `weaknesses[]`, `missingRequirements[]`, `estimatedCompatibility`, `budgetFit`, `englishFit`, `academicFit`, `deadlineStatus`, and a human-readable `reasoning` string built from the structured factors (not a free-floating AI summary that could drift from the actual computed numbers — see §9).

---

## 9. Role of AI (Present and Future)

AdmitFlow does not require AI to compute this engine's core output. If a natural-language generation layer is introduced later to make `reasoning` strings friendlier or to answer a student's follow-up question ("why is this a Target and not a Safe?"), the following are binding constraints, not suggestions:

- **AI is never the source of truth for a hard eligibility gate.** Minimum GPA/English, budget ceilings, deadlines, and required-document checks are computed exclusively by the deterministic rules in §3–§5. An AI layer may *describe* these outcomes in natural language; it may never *decide* them, override them, or produce a `matchScore`/`zone` of its own.
- **AI-touched output must be clearly labeled.** Any AI-assisted phrasing carries a visible framing such as "Based on the information you provided..." and the standing disclaimer "This is an indicative assessment, not an admission decision." — never presented as if it were the platform's own authoritative determination distinct from the rule engine.
- **AI output must be traceable back to the structured factors.** If an AI model is used to phrase `reasoning`, it is given the already-computed structured result (scores, fits, missing requirements) as grounding input and constrained to describe those — it does not independently infer new eligibility facts. This keeps the reasoning string auditable: any claim in it must map to a field actually computed above.
- **No AI-only zone.** REACH/TARGET/SAFE assignment (§5) is 100% rule-based. This is restated because it is the single highest legal/brand risk surface in the product — a probabilistic model quietly influencing SAFE placement would undermine the "never guaranteed" guarantee.

---

## 10. Related Documents

- `17-university-matching-engine.md` — candidate generation, ranking, tie-breaking, and how these per-factor scores become an ordered set of recommendations
- `26-university-data-management.md` — the catalog schema and freshness/versioning this engine reads
- `18-paywall-and-entitlements.md` — how `results[]` is filtered server-side based on entitlement before it reaches the student
- `02-personas-and-roles.md` — who may publish `AssessmentRule` versions (SUPER_ADMIN only)
- `14-security-architecture.md` (separate doc) — banned-identifier/code-review checklist for guarantee-language leakage
