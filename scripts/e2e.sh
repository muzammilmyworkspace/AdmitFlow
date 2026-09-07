#!/usr/bin/env bash
#
# AdmitFlow end-to-end suite.
#
# Walks the whole student journey against a running dev server and a real database, then
# attacks it with the security cases from docs/36-security-testing.md. Every assertion is
# on the actual HTTP response, not on what the UI would have shown.
#
# Usage:  BASE=http://127.0.0.1:3001 bash scripts/e2e.sh
#         (requires: dev server running, dev Postgres running, seed applied)

set -uo pipefail
BASE="${BASE:-http://127.0.0.1:3001}"
LOG="${DEV_LOG:-/tmp/dev.log}"
TS=$(date +%s)
PASS=0
FAIL=0
FAILURES=()

pass() { PASS=$((PASS+1)); printf "  \033[32m✓\033[0m %s\n" "$1"; }
fail() { FAIL=$((FAIL+1)); FAILURES+=("$1"); printf "  \033[31m✗\033[0m %s\n     expected: %s\n     actual:   %s\n" "$1" "$2" "$3"; }

# assert <name> <expected-substring> <actual>
assert_contains() {
  if [[ "$3" == *"$2"* ]]; then pass "$1"; else fail "$1" "contains '$2'" "$(echo "$3" | head -c 220)"; fi
}
assert_not_contains() {
  if [[ "$3" != *"$2"* ]]; then pass "$1"; else fail "$1" "must NOT contain '$2'" "$(echo "$3" | head -c 220)"; fi
}
assert_eq() {
  if [[ "$3" == "$2" ]]; then pass "$1"; else fail "$1" "$2" "$3"; fi
}

section() { printf "\n\033[1m%s\033[0m\n" "$1"; }

jarA=$(mktemp); jarB=$(mktemp); jarAdmin=$(mktemp)
PASSWORD="CorrectHorse42!"

api() { # api <jar> <method> <path> [body]
  local jar=$1 method=$2 path=$3 body=${4:-}
  if [[ -n "$body" ]]; then
    curl -s -b "$jar" -c "$jar" -X "$method" "$BASE$path" -H "Content-Type: application/json" -d "$body"
  else
    curl -s -b "$jar" -c "$jar" -X "$method" "$BASE$path"
  fi
}
status_of() { # status_of <jar> <method> <path> [body]
  local jar=$1 method=$2 path=$3 body=${4:-}
  if [[ -n "$body" ]]; then
    curl -s -o /dev/null -w "%{http_code}" -b "$jar" -X "$method" "$BASE$path" -H "Content-Type: application/json" -d "$body"
  else
    curl -s -o /dev/null -w "%{http_code}" -b "$jar" -X "$method" "$BASE$path"
  fi
}
json_field() { echo "$1" | grep -o "\"$2\":\"[^\"]*\"" | head -1 | cut -d'"' -f4; }

register() { # register <email> <jar>  -> verifies and leaves an authenticated session
  local email=$1 jar=$2
  curl -s -X POST "$BASE/api/v1/auth/signup" -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$PASSWORD\",\"firstName\":\"E2E\",\"lastName\":\"User\"}" > /dev/null
  sleep 1
  local token
  token=$(grep -o 'verify-email?token=[A-Za-z0-9_-]*' "$LOG" | tail -1 | cut -d= -f2)
  curl -s -c "$jar" -X POST "$BASE/api/v1/auth/verify-email" -H "Content-Type: application/json" \
    -d "{\"token\":\"$token\"}" > /dev/null
}

onboard() { # onboard <jar>  -> completes the profile so the account reaches ACTIVE
  local jar=$1
  local countries gb ca
  countries=$(api "$jar" GET /api/v1/reference/countries)
  gb=$(echo "$countries" | grep -o '{"id":"[^"]*","isoCode2":"GB"' | cut -d'"' -f4)
  ca=$(echo "$countries" | grep -o '{"id":"[^"]*","isoCode2":"CA"' | cut -d'"' -f4)
  api "$jar" PATCH /api/v1/onboarding "{\"step\":\"personal\",\"firstName\":\"E2E\",\"lastName\":\"User\",\"dateOfBirth\":\"2002-01-01\"}" > /dev/null
  api "$jar" PATCH /api/v1/onboarding "{\"step\":\"addEducation\",\"level\":\"BACHELORS\",\"institutionName\":\"Test Uni\",\"countryId\":\"$gb\",\"fieldOfStudy\":\"Computer Science\",\"isCurrent\":false,\"gradingScale\":\"GPA_4\",\"gradeValue\":3.4}" > /dev/null
  api "$jar" PATCH /api/v1/onboarding "{\"step\":\"destination\",\"countryIds\":[\"$gb\",\"$ca\"],\"targetIntake\":\"Fall 2027\"}" > /dev/null
  api "$jar" PATCH /api/v1/onboarding "{\"step\":\"budget\",\"budgetMax\":40000,\"currency\":\"GBP\"}" > /dev/null
  api "$jar" PATCH /api/v1/onboarding "{\"step\":\"addLanguageTest\",\"testType\":\"IELTS\",\"overallScore\":7.5,\"testDate\":\"2026-03-01\"}" > /dev/null
  api "$jar" PATCH /api/v1/onboarding "{\"step\":\"preferences\",\"studyMode\":\"ON_CAMPUS\",\"campusSizePreference\":\"NO_PREFERENCE\",\"scholarshipPriority\":\"HIGH\"}" > /dev/null
  api "$jar" PATCH /api/v1/onboarding '{"step":"complete"}'
}

# =============================================================================
section "1. Authentication"
# =============================================================================
EMAIL_A="e2e-a-$TS@example.com"
SIGNUP=$(curl -s -X POST "$BASE/api/v1/auth/signup" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL_A\",\"password\":\"$PASSWORD\",\"firstName\":\"E2E\",\"lastName\":\"User\"}")
assert_contains "signup returns EMAIL_UNVERIFIED" '"status":"EMAIL_UNVERIFIED"' "$SIGNUP"

DUP=$(curl -s -X POST "$BASE/api/v1/auth/signup" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL_A\",\"password\":\"$PASSWORD\",\"firstName\":\"E2E\",\"lastName\":\"User\"}")
assert_contains "duplicate signup is refused" "EMAIL_ALREADY_REGISTERED" "$DUP"

WEAK=$(curl -s -X POST "$BASE/api/v1/auth/signup" -H "Content-Type: application/json" \
  -d "{\"email\":\"weak-$TS@example.com\",\"password\":\"short\",\"firstName\":\"A\",\"lastName\":\"B\"}")
assert_contains "weak password is rejected" "VALIDATION_ERROR" "$WEAK"

UNVERIFIED_LOGIN=$(curl -s -X POST "$BASE/api/v1/auth/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL_A\",\"password\":\"$PASSWORD\"}")
assert_contains "unverified account cannot sign in" "AUTH_EMAIL_NOT_VERIFIED" "$UNVERIFIED_LOGIN"

sleep 1
TOKEN=$(grep -o 'verify-email?token=[A-Za-z0-9_-]*' "$LOG" | tail -1 | cut -d= -f2)
VERIFY=$(curl -s -c "$jarA" -X POST "$BASE/api/v1/auth/verify-email" -H "Content-Type: application/json" -d "{\"token\":\"$TOKEN\"}")
assert_contains "verification advances to ONBOARDING" '"status":"ONBOARDING"' "$VERIFY"

REPLAY=$(curl -s -X POST "$BASE/api/v1/auth/verify-email" -H "Content-Type: application/json" -d "{\"token\":\"$TOKEN\"}")
assert_contains "verification token is single-use" "ALREADY_VERIFIED" "$REPLAY"

WRONG_PW=$(curl -s -X POST "$BASE/api/v1/auth/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL_A\",\"password\":\"WrongPassword99!\"}")
NO_USER=$(curl -s -X POST "$BASE/api/v1/auth/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"nobody-$TS@example.com\",\"password\":\"WrongPassword99!\"}")
assert_eq "wrong password and unknown email are indistinguishable" \
  "$(echo "$WRONG_PW" | grep -o '"code":"[^"]*"')" "$(echo "$NO_USER" | grep -o '"code":"[^"]*"')"

assert_eq "unauthenticated /users/me is 401" "401" "$(status_of /dev/null GET /api/v1/users/me)"

# =============================================================================
section "2. Onboarding"
# =============================================================================
assert_eq "assessment is blocked before onboarding completes" "403" "$(status_of "$jarA" POST /api/v1/assessment/run)"

BAD_GRADE=$(api "$jarA" PATCH /api/v1/onboarding '{"step":"addEducation","level":"BACHELORS","institutionName":"X","countryId":"00000000-0000-0000-0000-000000000000","isCurrent":false,"gradingScale":"GPA_4","gradeValue":9.9}')
assert_contains "an out-of-range GPA is refused" "VALIDATION_ERROR" "$BAD_GRADE"

BAD_IELTS=$(api "$jarA" PATCH /api/v1/onboarding '{"step":"addLanguageTest","testType":"IELTS","overallScore":11,"testDate":"2026-01-01"}')
assert_contains "an impossible IELTS score is refused" "VALIDATION_ERROR" "$BAD_IELTS"

ONBOARDED=$(onboard "$jarA")
assert_contains "onboarding completes" '"isComplete":true' "$ONBOARDED"

# =============================================================================
section "3. Assessment engine"
# =============================================================================
RUN=$(api "$jarA" POST /api/v1/assessment/run)
assert_contains "assessment runs" '"assessmentId"' "$RUN"
ASSESSMENT_ID=$(json_field "$RUN" assessmentId)

RESULTS=$(api "$jarA" GET /api/v1/assessment/results)
assert_contains "results include a free REACH tier" '"REACH"' "$RESULTS"
assert_contains "TARGET results are locked before payment" '"lockedCounts"' "$RESULTS"
assert_contains "entitlements report no access yet" '"target":false' "$RESULTS"

# =============================================================================
section "4. Paywall — the platform's most important invariant"
# =============================================================================
LOCKED_ENTRIES=$(echo "$RESULTS" | grep -o '"locked":true[^}]*}')
assert_not_contains "locked entries carry no university name" "university" "$LOCKED_ENTRIES"
assert_not_contains "locked entries carry no score" "overallScore" "$LOCKED_ENTRIES"
assert_not_contains "locked entries carry no tuition" "tuition" "$LOCKED_ENTRIES"
assert_not_contains "locked entries carry no reasoning" "reasoning" "$LOCKED_ENTRIES"
assert_not_contains "locked entries carry no real programme id" "programId" "$LOCKED_ENTRIES"

# =============================================================================
section "5. Payments"
# =============================================================================
CHECKOUT=$(api "$jarA" POST /api/v1/billing/checkout "{\"productKey\":\"TARGET_UNLOCK\",\"assessmentId\":\"$ASSESSMENT_ID\"}")
assert_contains "checkout session is created" '"checkoutUrl"' "$CHECKOUT"
PURCHASE_ID=$(json_field "$CHECKOUT" purchaseId)

UNSIGNED=$(curl -s -X POST "$BASE/api/v1/billing/webhook" -H "Content-Type: application/json" -d '{"id":"forged","type":"checkout.session.completed","data":{}}')
assert_contains "an unsigned webhook is rejected" "WEBHOOK_INVALID" "$UNSIGNED"

BADSIG=$(curl -s -X POST "$BASE/api/v1/billing/webhook" -H "Content-Type: application/json" \
  -H "x-admitflow-signature: 00000000" -d '{"id":"forged2","type":"checkout.session.completed","data":{}}')
assert_contains "a forged signature is rejected" "WEBHOOK_INVALID" "$BADSIG"

PAID=$(api "$jarA" POST /api/v1/billing/dev-complete "{\"purchaseId\":\"$PURCHASE_ID\",\"outcome\":\"SUCCEEDED\"}")
assert_contains "payment is processed via the signed webhook" '"status":"PROCESSED"' "$PAID"

DUPE=$(api "$jarA" POST /api/v1/billing/dev-complete "{\"purchaseId\":\"$PURCHASE_ID\",\"outcome\":\"SUCCEEDED\"}")
assert_contains "a second webhook for the same purchase does not re-grant" '"status":"DUPLICATE"' "$DUPE"

ENTITLEMENTS=$(api "$jarA" GET /api/v1/billing/entitlements)
assert_eq "exactly one entitlement was granted" "1" "$(echo "$ENTITLEMENTS" | grep -o '"productKey"' | wc -l | tr -d ' ')"

UNLOCKED=$(api "$jarA" GET /api/v1/assessment/results)
assert_contains "results are unlocked after payment" '"target":true' "$UNLOCKED"
assert_contains "unlocked results now carry programme detail" '"university"' "$UNLOCKED"
assert_eq "nothing remains locked" "0" "$(echo "$UNLOCKED" | grep -o '"locked":true' | wc -l | tr -d ' ')"

# =============================================================================
section "6. Document vault"
# =============================================================================
PDF=$(mktemp); printf '%%PDF-1.4\ntest document\n%%%%EOF\n' > "$PDF"
SIZE=$(wc -c < "$PDF" | tr -d ' ')
INIT=$(api "$jarA" POST /api/v1/vault/documents "{\"type\":\"PASSPORT\",\"filename\":\"p.pdf\",\"mimeType\":\"application/pdf\",\"sizeBytes\":$SIZE}")
DOC_ID=$(json_field "$INIT" documentId)
UPLOAD_URL=$(echo "$INIT" | grep -o '"uploadUrl":"[^"]*"' | cut -d'"' -f4 | sed 's/\\u0026/\&/g')
assert_contains "upload is authorized with a signed URL" "local-object" "$UPLOAD_URL"

assert_eq "bytes upload to the signed URL" "204" "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$UPLOAD_URL" -H 'Content-Type: application/pdf' --data-binary "@$PDF")"

CONFIRM=$(api "$jarA" POST "/api/v1/vault/documents/$DOC_ID/confirm")
assert_contains "confirmed upload awaits review" "PENDING_REVIEW" "$CONFIRM"

FAKE=$(mktemp); printf 'MZ\x90\x00 not a pdf' > "$FAKE"
FSIZE=$(wc -c < "$FAKE" | tr -d ' ')
INIT2=$(api "$jarA" POST /api/v1/vault/documents "{\"type\":\"CV\",\"filename\":\"cv.pdf\",\"mimeType\":\"application/pdf\",\"sizeBytes\":$FSIZE}")
DOC2=$(json_field "$INIT2" documentId)
URL2=$(echo "$INIT2" | grep -o '"uploadUrl":"[^"]*"' | cut -d'"' -f4 | sed 's/\\u0026/\&/g')
curl -s -X PUT "$URL2" -H 'Content-Type: application/pdf' --data-binary "@$FAKE" -o /dev/null
FAKE_RESULT=$(api "$jarA" POST "/api/v1/vault/documents/$DOC2/confirm")
assert_contains "an executable renamed .pdf is rejected" "FILE_INVALID" "$FAKE_RESULT"

DL=$(api "$jarA" GET "/api/v1/vault/documents/$DOC_ID")
SIGNED=$(echo "$DL" | grep -o '"url":"[^"]*"' | cut -d'"' -f4 | sed 's/\\u0026/\&/g')
assert_eq "owner can download via a signed URL" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$SIGNED")"
assert_eq "a tampered signature is refused" "403" "$(curl -s -o /dev/null -w '%{http_code}' "$(echo "$SIGNED" | sed 's/sig=./sig=0/')")"

# =============================================================================
section "7. Object-level authorization (IDOR)"
# =============================================================================
EMAIL_B="e2e-b-$TS@example.com"
register "$EMAIL_B" "$jarB"
# B must be fully onboarded, otherwise the onboarding guard rejects them first and these
# assertions would pass without ever reaching the ownership check they exist to test.
onboard "$jarB" > /dev/null

assert_eq "another student cannot read your document" "403" "$(status_of "$jarB" GET "/api/v1/vault/documents/$DOC_ID")"
RESULT_ID=$(echo "$UNLOCKED" | grep -o '"resultId":"[^"]*"' | head -1 | cut -d'"' -f4)
assert_eq "another student cannot read your assessment" "404" "$(status_of "$jarB" GET "/api/v1/assessment/results?id=$RESULT_ID")"
assert_eq "a student cannot reach the admin API" "403" "$(status_of "$jarB" GET /api/v1/admin/users)"
assert_eq "a student cannot reach the audit log" "403" "$(status_of "$jarB" GET /api/v1/admin/audit)"
assert_eq "a student cannot reach the document queue" "403" "$(status_of "$jarB" GET /api/v1/admin/documents)"

# =============================================================================
section "8. Applications"
# =============================================================================
PROGRAM_ID=$(echo "$UNLOCKED" | grep -o '"programId":"[^"]*"' | head -1 | cut -d'"' -f4)
PROGRAM=$(curl -s "$BASE/api/v1/programs/$PROGRAM_ID")
INTAKE_ID=$(echo "$PROGRAM" | grep -o '"id":"[^"]*","term"' | head -1 | cut -d'"' -f4)

APP=$(api "$jarA" POST /api/v1/applications "{\"programId\":\"$PROGRAM_ID\",\"intakeId\":\"$INTAKE_ID\"}")
assert_contains "an application starts in DRAFT" '"status":"DRAFT"' "$APP"
APP_ID=$(json_field "$APP" id)

DUP_APP=$(api "$jarA" POST /api/v1/applications "{\"programId\":\"$PROGRAM_ID\",\"intakeId\":\"$INTAKE_ID\"}")
assert_contains "a duplicate application is refused" "CONFLICT" "$DUP_APP"

PREMATURE=$(api "$jarA" POST "/api/v1/applications/$APP_ID/submit")
assert_contains "submission is blocked while requirements are unmet" "APPLICATION_INVALID_STATE" "$PREMATURE"

DETAIL=$(api "$jarA" GET "/api/v1/applications/$APP_ID")
assert_contains "readiness explains what is outstanding" '"readiness"' "$DETAIL"
assert_eq "another student cannot read your application" "404" "$(status_of "$jarB" GET "/api/v1/applications/$APP_ID")"

# =============================================================================
section "9. Consultations"
# =============================================================================
SLOTS=$(api "$jarA" GET /api/v1/consultation/slots)
assert_contains "slots are published in UTC" '"timezone":"UTC"' "$SLOTS"
SLOT_ID=$(echo "$SLOTS" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [[ -n "$SLOT_ID" ]]; then
  HOLD=$(api "$jarA" POST /api/v1/consultation/bookings "{\"slotId\":\"$SLOT_ID\"}")
  assert_contains "a slot can be held" '"status":"HELD"' "$HOLD"
  RACE=$(api "$jarB" POST /api/v1/consultation/bookings "{\"slotId\":\"$SLOT_ID\"}")
  assert_contains "a held slot cannot be double-booked" "BOOKING_SLOT_TAKEN" "$RACE"
else
  fail "consultation slots are seeded" "at least one slot" "none returned"
fi

# =============================================================================
section "10. Rate limiting"
# =============================================================================
RL_EMAIL="rl-$TS@example.com"
RL_HIT=""
for _ in $(seq 1 12); do
  RL_HIT=$(curl -s -X POST "$BASE/api/v1/auth/login" -H "Content-Type: application/json" \
    -d "{\"email\":\"$RL_EMAIL\",\"password\":\"WrongPassword99!\"}")
done
assert_contains "repeated failed logins are rate limited" "RATE_LIMITED" "$RL_HIT"

# =============================================================================
section "11. Notifications"
# =============================================================================
NOTIFS=$(api "$jarA" GET /api/v1/notifications)
assert_contains "notifications endpoint responds" '"unreadCount"' "$NOTIFS"

# =============================================================================
section "12. Public catalog"
# =============================================================================
PROGRAMS=$(curl -s "$BASE/api/v1/programs?pageSize=5")
assert_contains "catalog search is paginated" '"pagination"' "$PROGRAMS"
# dataFreshness appears exactly once per programme; "id"/"name" also match the nested
# university object, which is what made an earlier version of this assertion double-count.
assert_eq "page size is respected" "5" "$(echo "$PROGRAMS" | grep -o '"dataFreshness"' | wc -l | tr -d ' ')"
HUGE=$(curl -s "$BASE/api/v1/programs?pageSize=100000")
assert_contains "an unbounded page size is capped" '"pageSize":50' "$HUGE"

# =============================================================================
section "13. Input validation"
# A student typing a five-digit year into the date picker found this: the field took it,
# and the validator then crashed on it, so the answer was a 500 rather than "enter a real
# date". Every case below must come back 400 VALIDATION_ERROR — a 500 here means bad input
# is reaching code that assumed it was already clean.
bad_input() { # bad_input <name> <body>
  local body code
  body=$(api "$jarA" PATCH /api/v1/onboarding "$2")
  code=$(echo "$body" | grep -o '"code":"[A-Z_]*"' | head -1 | cut -d'"' -f4)
  assert_eq "$1" "VALIDATION_ERROR" "$code"
}
bad_input "DOB with a five-digit year is refused"  '{"step":"personal","firstName":"A","lastName":"B","dateOfBirth":"99999-01-01"}'
bad_input "DOB of 31 February is refused"          '{"step":"personal","firstName":"A","lastName":"B","dateOfBirth":"2002-02-31"}'
bad_input "DOB in the future is refused"           '{"step":"personal","firstName":"A","lastName":"B","dateOfBirth":"2030-01-01"}'
bad_input "a blank name is refused"                '{"step":"personal","firstName":"   ","lastName":"B"}'
bad_input "a phone number with letters is refused" '{"step":"personal","firstName":"A","lastName":"B","phone":"call-me"}'
bad_input "a stray-zero budget is refused"         '{"step":"budget","budgetMax":9000000000000000,"currency":"EUR"}'
bad_input "a zero budget is refused"               '{"step":"budget","budgetMax":0,"currency":"EUR"}'
bad_input "a budget minimum above its maximum is refused" '{"step":"budget","budgetMin":50000,"budgetMax":10000,"currency":"EUR"}'
bad_input "a five-letter currency is refused"      '{"step":"budget","budgetMax":10000,"currency":"EUROS"}'
bad_input "a test sat in the future is refused"    '{"step":"addLanguageTest","testType":"IELTS","overallScore":7,"testDate":"2030-01-01"}'
bad_input "an out-of-range IELTS score is refused" '{"step":"addLanguageTest","testType":"IELTS","overallScore":47,"testDate":"2026-03-01"}'
bad_input "an expiry before the test date is refused" '{"step":"addLanguageTest","testType":"IELTS","overallScore":7,"testDate":"2026-03-01","expiryDate":"2020-01-01"}'

# The account must still be usable afterwards: rejecting bad input must not have written
# a partial profile.
VALID_AFTER=$(api "$jarA" PATCH /api/v1/onboarding '{"step":"personal","firstName":"E2E","lastName":"User","dateOfBirth":"2002-01-01"}')
assert_contains "a valid save still succeeds after the rejections" '"success":true' "$VALID_AFTER"

# =============================================================================
printf "\n\033[1mResults\033[0m\n"
printf "  passed: \033[32m%d\033[0m\n" "$PASS"
printf "  failed: \033[31m%d\033[0m\n" "$FAIL"
if (( FAIL > 0 )); then
  printf "\nFailures:\n"
  for f in "${FAILURES[@]}"; do printf "  - %s\n" "$f"; done
  exit 1
fi
printf "\n\033[32mAll end-to-end checks passed.\033[0m\n"
