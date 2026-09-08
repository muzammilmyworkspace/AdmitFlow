#!/usr/bin/env bash
#
# The consultant assessment review — the paid human read of an automated assessment.
#
# Walks the whole thing against a running dev server: the offer, the refusal to open a
# review without paying, the purchase, the request, the consultant queue, delivery, and
# the boundaries around who may read what.
#
# Usage:  BASE=http://127.0.0.1:3001 bash scripts/review-e2e.sh

set -uo pipefail
BASE="${BASE:-http://127.0.0.1:3001}"
LOG="${DEV_LOG:-/tmp/dev.log}"
TS=$(date +%s)
PASS=0
FAIL=0
FAILURES=()

pass() { PASS=$((PASS+1)); printf "  \033[32m✓\033[0m %s\n" "$1"; }
fail() { FAIL=$((FAIL+1)); FAILURES+=("$1"); printf "  \033[31m✗\033[0m %s\n     expected: %s\n     actual:   %s\n" "$1" "$2" "$3"; }
assert_contains() {
  if [[ "$3" == *"$2"* ]]; then pass "$1"; else fail "$1" "contains '$2'" "$(echo "$3" | head -c 260)"; fi
}
assert_not_contains() {
  if [[ "$3" != *"$2"* ]]; then pass "$1"; else fail "$1" "must NOT contain '$2'" "$(echo "$3" | head -c 260)"; fi
}
assert_eq() {
  if [[ "$3" == "$2" ]]; then pass "$1"; else fail "$1" "$2" "$3"; fi
}
section() { printf "\n\033[1m%s\033[0m\n" "$1"; }

jarA=$(mktemp); jarB=$(mktemp); jarC=$(mktemp)
PASSWORD="CorrectHorse42!"
STAFF_PASSWORD="AdmitFlowDev42!"

api() { # api <jar> <method> <path> [body]
  local jar=$1 method=$2 path=$3 body=${4:-}
  if [[ -n "$body" ]]; then
    curl -s -b "$jar" -c "$jar" -X "$method" "$BASE$path" -H "Content-Type: application/json" -d "$body"
  else
    curl -s -b "$jar" -c "$jar" -X "$method" "$BASE$path"
  fi
}
status_of() {
  local jar=$1 method=$2 path=$3 body=${4:-}
  if [[ -n "$body" ]]; then
    curl -s -o /dev/null -w "%{http_code}" -b "$jar" -X "$method" "$BASE$path" -H "Content-Type: application/json" -d "$body"
  else
    curl -s -o /dev/null -w "%{http_code}" -b "$jar" -X "$method" "$BASE$path"
  fi
}
field() { echo "$1" | grep -o "\"$2\":\"[^\"]*\"" | head -1 | cut -d'"' -f4; }
code_of() { echo "$1" | grep -o '"code":"[A-Z_]*"' | head -1 | cut -d'"' -f4; }

register() { # register <email> <jar>
  local email=$1 jar=$2
  # A 429 here cascades into twenty AUTH_REQUIRED failures further down, which reads as
  # twenty broken features rather than as one exhausted bucket. The signup bucket is
  # relaxed outside production (src/lib/rate-limit.ts) and the store is in-memory, so this
  # should not fire -- but when it does, say so instead of burying it.
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/v1/auth/signup" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$PASSWORD\",\"firstName\":\"E2E\",\"lastName\":\"User\"}")
  if [[ "$code" == "429" ]]; then
    printf "\n\033[31mSignup is rate limited (429).\033[0m Restart the dev server to reset the\n"
    printf "in-memory bucket, then re-run. Aborting rather than reporting false failures.\n\n"
    exit 2
  fi
  sleep 1
  local token
  token=$(grep -o 'verify-email?token=[A-Za-z0-9_-]*' "$LOG" | tail -1 | cut -d= -f2)
  curl -s -c "$jar" -X POST "$BASE/api/v1/auth/verify-email" -H "Content-Type: application/json" \
    -d "{\"token\":\"$token\"}" > /dev/null
}

onboard() { # onboard <jar>
  local jar=$1 countries gb ca
  countries=$(api "$jar" GET /api/v1/reference/countries)
  gb=$(echo "$countries" | grep -o '{"id":"[^"]*","isoCode2":"GB"' | cut -d'"' -f4)
  ca=$(echo "$countries" | grep -o '{"id":"[^"]*","isoCode2":"CA"' | cut -d'"' -f4)
  api "$jar" PATCH /api/v1/onboarding "{\"step\":\"personal\",\"firstName\":\"E2E\",\"lastName\":\"User\",\"dateOfBirth\":\"2002-01-01\"}" > /dev/null
  api "$jar" PATCH /api/v1/onboarding "{\"step\":\"addEducation\",\"level\":\"BACHELORS\",\"institutionName\":\"Test Uni\",\"countryId\":\"$gb\",\"fieldOfStudy\":\"Computer Science\",\"isCurrent\":false,\"gradingScale\":\"GPA_4\",\"gradeValue\":3.4}" > /dev/null
  api "$jar" PATCH /api/v1/onboarding "{\"step\":\"destination\",\"countryIds\":[\"$gb\",\"$ca\"],\"targetIntake\":\"Fall 2027\"}" > /dev/null
  api "$jar" PATCH /api/v1/onboarding "{\"step\":\"budget\",\"budgetMax\":40000,\"currency\":\"GBP\"}" > /dev/null
  api "$jar" PATCH /api/v1/onboarding "{\"step\":\"addLanguageTest\",\"testType\":\"IELTS\",\"overallScore\":7.5,\"testDate\":\"2026-03-01\"}" > /dev/null
  api "$jar" PATCH /api/v1/onboarding "{\"step\":\"preferences\",\"studyMode\":\"ON_CAMPUS\",\"campusSizePreference\":\"NO_PREFERENCE\",\"scholarshipPriority\":\"HIGH\"}" > /dev/null
  api "$jar" PATCH /api/v1/onboarding '{"step":"complete"}' > /dev/null
}

buy() { # buy <jar> <productKey> <assessmentId> -> completes the purchase through the webhook
  local jar=$1 product=$2 assessment=$3 checkout purchaseId
  checkout=$(api "$jar" POST /api/v1/billing/checkout "{\"productKey\":\"$product\",\"assessmentId\":\"$assessment\"}")
  purchaseId=$(field "$checkout" purchaseId)
  curl -s -X POST "$BASE/api/v1/billing/dev-complete" -H "Content-Type: application/json" \
    -d "{\"purchaseId\":\"$purchaseId\",\"outcome\":\"SUCCEEDED\"}" > /dev/null
}

# =============================================================================
section "Setup"
register "review_a_$TS@example.com" "$jarA"
onboard "$jarA"
api "$jarA" POST /api/v1/assessment/run > /dev/null
RESULTS=$(api "$jarA" GET /api/v1/assessment/results)
RESULT_ID=$(field "$RESULTS" resultId)
ASSESSMENT_ID=$(field "$RESULTS" assessmentId)
[[ -n "$RESULT_ID" ]] && pass "student A has an assessment" || fail "student A has an assessment" "a resultId" "none"

# =============================================================================
section "1. The offer, before paying"
OFFER=$(api "$jarA" GET "/api/v1/assessment/review?resultId=$RESULT_ID")
assert_contains "the offer reports nothing purchased yet" '"isPurchased":false' "$OFFER"
assert_contains "and no review exists yet" '"review":null' "$OFFER"

# The whole point of the entitlement check: a request without a purchase is refused by
# the server, not merely hidden by the UI.
UNPAID=$(api "$jarA" POST /api/v1/assessment/review "{\"resultId\":\"$RESULT_ID\"}")
assert_eq "requesting a review without paying is refused" "PAYMENT_REQUIRED" "$(code_of "$UNPAID")"
assert_eq "  ...with 402, not a redirect or a 500" "402" \
  "$(status_of "$jarA" POST /api/v1/assessment/review "{\"resultId\":\"$RESULT_ID\"}")"

# =============================================================================
section "2. Paying for it"
buy "$jarA" "ASSESSMENT_REVIEW" "$ASSESSMENT_ID"
OFFER=$(api "$jarA" GET "/api/v1/assessment/review?resultId=$RESULT_ID")
assert_contains "the entitlement is live after the webhook" '"isPurchased":true' "$OFFER"
assert_contains "but no review is open until the student asks" '"review":null' "$OFFER"

REQUESTED=$(api "$jarA" POST /api/v1/assessment/review \
  "{\"resultId\":\"$RESULT_ID\",\"studentNote\":\"Torn between the UK and Canada.\"}")
assert_contains "the review request is accepted once paid" '"status":"REQUESTED"' "$REQUESTED"
REVIEW_ID=$(field "$REQUESTED" id)

DUPLICATE=$(api "$jarA" POST /api/v1/assessment/review "{\"resultId\":\"$RESULT_ID\"}")
assert_eq "a second request for the same assessment is a conflict" "CONFLICT" "$(code_of "$DUPLICATE")"

# =============================================================================
section "3. Another student cannot touch it"
register "review_b_$TS@example.com" "$jarB"
onboard "$jarB"
OTHER=$(api "$jarB" GET "/api/v1/assessment/review?resultId=$RESULT_ID")
assert_eq "student B reading A's review offer is refused" "RESOURCE_NOT_FOUND" "$(code_of "$OTHER")"
assert_not_contains "  ...and learns nothing about A's note" "Torn between" "$OTHER"
OTHER_POST=$(api "$jarB" POST /api/v1/assessment/review "{\"resultId\":\"$RESULT_ID\"}")
assert_eq "student B cannot open a review on A's assessment" "RESOURCE_NOT_FOUND" "$(code_of "$OTHER_POST")"

# A student must not reach the consultant queue at all.
assert_eq "a student is refused the consultant queue" "403" \
  "$(status_of "$jarA" GET /api/v1/admin/assessment-reviews)"

# =============================================================================
section "3b. A purchase cannot be scoped to something you do not own"
# Nothing downstream re-checks what the client put in the scope, so it is checked at
# checkout. A wrong-but-well-formed id (a client bug) and a foreign id (an attack) both
# end the same way otherwise: a grant no entitlement check will ever match, so the
# student pays and receives nothing, with a successful payment on record.
api "$jarB" POST /api/v1/assessment/run > /dev/null
B_ASSESSMENT=$(field "$(api "$jarB" GET /api/v1/assessment/results)" assessmentId)

FOREIGN=$(api "$jarB" POST /api/v1/billing/checkout \
  "{\"productKey\":\"ASSESSMENT_REVIEW\",\"assessmentId\":\"$ASSESSMENT_ID\"}")
assert_eq "buying against another student's assessment is refused" "VALIDATION_ERROR" "$(code_of "$FOREIGN")"

WRONG_ID=$(api "$jarA" POST /api/v1/billing/checkout \
  "{\"productKey\":\"ASSESSMENT_REVIEW\",\"assessmentId\":\"$RESULT_ID\"}")
assert_eq "a result id where an assessment id belongs is refused" "VALIDATION_ERROR" "$(code_of "$WRONG_ID")"

OWN=$(api "$jarB" POST /api/v1/billing/checkout \
  "{\"productKey\":\"ASSESSMENT_REVIEW\",\"assessmentId\":\"$B_ASSESSMENT\"}")
assert_contains "buying against your own assessment still works" "checkoutUrl" "$OWN"

# =============================================================================
section "4. The consultant side"
curl -s -c "$jarC" -X POST "$BASE/api/v1/auth/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@admitflow.example\",\"password\":\"$STAFF_PASSWORD\"}" > /dev/null
QUEUE=$(api "$jarC" GET /api/v1/admin/assessment-reviews)
assert_contains "the requested review appears in the queue" "$REVIEW_ID" "$QUEUE"
assert_contains "  ...with the student's question attached" "Torn between" "$QUEUE"

CLAIMED=$(api "$jarC" PATCH /api/v1/admin/assessment-reviews \
  "{\"action\":\"claim\",\"reviewId\":\"$REVIEW_ID\"}")
assert_contains "a consultant can claim it" '"status":"IN_REVIEW"' "$CLAIMED"

RECLAIM=$(api "$jarC" PATCH /api/v1/admin/assessment-reviews \
  "{\"action\":\"claim\",\"reviewId\":\"$REVIEW_ID\"}")
assert_eq "claiming it twice is a conflict" "CONFLICT" "$(code_of "$RECLAIM")"

# While it is being written, the draft is not the deliverable.
MID=$(api "$jarA" GET "/api/v1/assessment/review?resultId=$RESULT_ID")
assert_contains "the student sees it is in review" '"status":"IN_REVIEW"' "$MID"
assert_contains "  ...and no reviewer notes yet" '"reviewerNotes":null' "$MID"

TOO_SHORT=$(api "$jarC" PATCH /api/v1/admin/assessment-reviews \
  "{\"action\":\"complete\",\"reviewId\":\"$REVIEW_ID\",\"notes\":\"looks fine\"}")
assert_eq "an empty-gesture review cannot be delivered" "VALIDATION_ERROR" "$(code_of "$TOO_SHORT")"

api "$jarC" PATCH /api/v1/admin/assessment-reviews \
  "{\"action\":\"complete\",\"reviewId\":\"$REVIEW_ID\",\"notes\":\"Go with Canada: your budget covers the full programme there and two of your strong matches have January intakes you can still make.\"}" > /dev/null

# =============================================================================
section "5. Delivery"
DELIVERED=$(api "$jarA" GET "/api/v1/assessment/review?resultId=$RESULT_ID")
assert_contains "the student's review is marked complete" '"status":"COMPLETED"' "$DELIVERED"
assert_contains "  ...and now carries the written feedback" "Go with Canada" "$DELIVERED"
assert_contains "  ...attributed to the consultant who wrote it" '"reviewerName":' "$DELIVERED"

# The delivered text is the thing that was paid for; nobody else may read it.
LEAK=$(api "$jarB" GET "/api/v1/assessment/review?resultId=$RESULT_ID")
assert_not_contains "another student cannot read the delivered review" "Go with Canada" "$LEAK"

# =============================================================================
printf "\n\033[1mResults\033[0m\n"
printf "  passed: \033[32m%d\033[0m\n" "$PASS"
printf "  failed: \033[31m%d\033[0m\n" "$FAIL"
if (( FAIL > 0 )); then
  printf "\nFailures:\n"
  for f in "${FAILURES[@]}"; do printf "  - %s\n" "$f"; done
  exit 1
fi
printf "\n\033[32mAll consultant-review checks passed.\033[0m\n"
