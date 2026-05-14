#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

run_step() {
  local label="$1"
  shift
  echo "[release:check] ${label}"
  "$@"
}

run_optional_unit_tests() {
  if [[ -d "tests/unit" ]] && compgen -G "tests/unit/*.test.ts" > /dev/null; then
    if npx --yes tsx --version > /dev/null 2>&1; then
      run_step "unit tests" npx --yes tsx --test tests/unit/*.test.ts
    else
      echo "[release:check] unit tests skipped (tsx no disponible)"
    fi
  else
    echo "[release:check] unit tests skipped (no se encontraron tests/unit/*.test.ts)"
  fi
}

run_step "1/11 env:validate" npm run env:validate
run_step "2/11 prisma:validate" npm run prisma:validate
run_step "3/11 prisma:generate" npm run prisma:generate
run_step "4/11 typecheck" npm run typecheck
run_step "5/11 build" npm run build
run_step "6/11 verify:sales" npm run verify:sales
run_step "7/11 verify:payments" npm run verify:payments
run_step "8/11 verify:phase6" npm run verify:phase6
run_step "9/11 verify:phase7" npm run verify:phase7

run_optional_unit_tests

if [[ "${RUN_E2E:-0}" == "1" ]]; then
  run_step "11/11 e2e" npm run test:e2e
else
  echo "[release:check] e2e skipped (RUN_E2E!=1)"
fi

echo "RELEASE_CHECK_PASSED"
