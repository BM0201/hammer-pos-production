#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p artifacts/release artifacts/smoke artifacts/metrics

REPORT_PATH="artifacts/release/release-check-result.json"
STAGE_RESULTS=()
APP_PID=""

record_stage() {
  local stage="$1"
  local status="$2"
  local reason="${3:-null}"
  if [[ "$reason" != "null" ]]; then
    local escaped
    escaped=$(printf '%s' "$reason" | sed 's/"/\\"/g')
    reason="\"${escaped}\""
  fi
  STAGE_RESULTS+=("{\"stage\":\"${stage}\",\"status\":\"${status}\",\"reason\":${reason}}")
}

write_report() {
  local overall="$1"
  local reason="${2:-null}"
  local joined reason_json
  joined=$(IFS=, ; echo "${STAGE_RESULTS[*]}")
  reason_json="null"

  if [[ "$reason" != "null" ]]; then
    local reason_escaped
    reason_escaped=$(printf '%s' "$reason" | sed 's/"/\\"/g')
    reason_json="\"${reason_escaped}\""
  fi

  cat > "$REPORT_PATH" <<JSON
{
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "overall": "${overall}",
  "reason": ${reason_json},
  "stages": [${joined}]
}
JSON
}

cleanup() {
  if [[ -n "$APP_PID" ]] && ps -p "$APP_PID" >/dev/null 2>&1; then
    kill "$APP_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

fail_stage() {
  local stage="$1"
  local reason="$2"
  record_stage "$stage" "failed" "$reason"
  write_report "failed" "$reason"
  echo "[release:check] FAILED at ${stage}: ${reason}"
  exit 1
}

run_stage() {
  local stage="$1"
  local failure_reason="$2"
  shift 2
  echo "[release:check] ${stage}"
  if "$@"; then
    record_stage "$stage" "passed"
  else
    fail_stage "$stage" "$failure_reason"
  fi
}

if [[ -z "${DATABASE_URL:-}" || -z "${AUTH_SESSION_SECRET:-}" ]]; then
  fail_stage "preflight" "missing_env"
fi

if [[ ! -x "./node_modules/.bin/prisma" ]]; then
  fail_stage "preflight" "prisma_cli_missing"
fi

if [[ ! -x "./node_modules/.bin/playwright" ]]; then
  fail_stage "preflight" "playwright_cli_missing"
fi

run_stage "env_validation" "env_validation_failed" npm run env:validate
run_stage "prisma_generate" "prisma_generate_failed" npm run prisma:generate
run_stage "prisma_migrate_deploy" "prisma_migrate_failed" npm run prisma:migrate:deploy

if [[ "${RELEASE_SEED:-true}" == "true" ]]; then
  run_stage "seed" "seed_failed" npm run seed
fi

run_stage "typecheck" "typecheck_failed" npm run typecheck
run_stage "build" "build_failed" npm run build
run_stage "verify_sales" "verify_sales_failed" npm run verify:sales
run_stage "verify_payments" "verify_payments_failed" npm run verify:payments
run_stage "verify_phase6" "verify_phase6_failed" npm run verify:phase6
run_stage "verify_phase7" "verify_phase7_failed" npm run verify:phase7

PORT="${RELEASE_PORT:-3000}"
SMOKE_BASE_URL="${SMOKE_BASE_URL:-http://127.0.0.1:${PORT}}"

echo "[release:check] start app for e2e+smoke on ${SMOKE_BASE_URL}"
npm run start -- --hostname 127.0.0.1 --port "$PORT" > artifacts/release/release-start.log 2>&1 &
APP_PID=$!

READY=0
for _ in {1..60}; do
  if curl -fsS "${SMOKE_BASE_URL}/login" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done

if [[ "$READY" -ne 1 ]]; then
  fail_stage "app_readiness_wait" "app_readiness_timeout"
fi
record_stage "app_readiness_wait" "passed"

run_stage "e2e" "e2e_failed" env E2E_BASE_URL="$SMOKE_BASE_URL" npm run test:e2e
run_stage "metrics_compare" "metrics_regression_failed" env PREVIOUS_METRICS_PATH="${PREVIOUS_METRICS_PATH:-config/metrics/e2e-latency-baseline.json}" npm run metrics:compare
run_stage "smoke_infra" "smoke_infra_failed" env SMOKE_BASE_URL="$SMOKE_BASE_URL" SMOKE_REPORT_PATH="artifacts/smoke/infra-smoke.json" npm run smoke:infra
run_stage "smoke_functional" "smoke_functional_failed" env SMOKE_BASE_URL="$SMOKE_BASE_URL" SMOKE_REPORT_PATH="artifacts/smoke/functional-smoke.json" npm run smoke:functional

write_report "in_progress"
run_stage "readiness_contract" "readiness_contract_failed" node scripts/release-contract.mjs

write_report "passed"
echo "RELEASE_CHECK_PASSED"
