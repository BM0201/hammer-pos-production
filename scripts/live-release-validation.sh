#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p artifacts/release artifacts/smoke artifacts/metrics
RESULT_JSON="artifacts/release/live-validation-result.json"
BUNDLE_PATH="artifacts/release/live-validation-artifacts.tar.gz"

REQUIRED_ARTIFACTS=(
  "artifacts/release/release-check-result.json"
  "artifacts/release/readiness-contract.json"
  "artifacts/smoke/infra-smoke.json"
  "artifacts/smoke/functional-smoke.json"
  "artifacts/metrics/e2e-latency.json"
  "artifacts/metrics/e2e-latency-comparison.json"
)

write_result() {
  local overall="$1"
  local reason="${2:-null}"
  cat > "$RESULT_JSON" <<JSON
{
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "overall": "${overall}",
  "reason": ${reason},
  "artifacts": {
    "releaseCheck": "artifacts/release/release-check-result.json",
    "readinessContract": "artifacts/release/readiness-contract.json",
    "infraSmoke": "artifacts/smoke/infra-smoke.json",
    "functionalSmoke": "artifacts/smoke/functional-smoke.json",
    "metrics": "artifacts/metrics/e2e-latency.json",
    "metricsComparison": "artifacts/metrics/e2e-latency-comparison.json"
  }
}
JSON
}

bundle_artifacts() {
  tar -czf "$BUNDLE_PATH" \
    artifacts/release/live-validation-result.json \
    artifacts/release/release-check-result.json \
    artifacts/release/readiness-contract.json \
    artifacts/smoke/infra-smoke.json \
    artifacts/smoke/functional-smoke.json \
    artifacts/metrics/e2e-latency.json \
    artifacts/metrics/e2e-latency-comparison.json \
    2>/dev/null || true
}

missing_artifacts() {
  local missing=()
  for artifact in "${REQUIRED_ARTIFACTS[@]}"; do
    [[ -f "$artifact" ]] || missing+=("$artifact")
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    printf '%s\n' "${missing[*]}"
    return 1
  fi
  return 0
}

readiness_ok() {
  python3 - <<'PY'
import json
from pathlib import Path
p=Path('artifacts/release/readiness-contract.json')
if not p.exists():
    raise SystemExit(1)
data=json.loads(p.read_text())
result=data.get('result', {})
if result.get('readyForStaging') is True and result.get('readyForPilot') is True:
    raise SystemExit(0)
raise SystemExit(1)
PY
}

if ! command -v docker >/dev/null 2>&1; then
  write_result "failed" '"docker_unavailable"'
  bundle_artifacts
  echo "docker is required for live release validation"
  exit 1
fi

echo "[live] starting postgres"
docker compose up -d db

echo "[live] running full release check in isolated container"
if ! docker compose run --rm release-check; then
  local_reason='release_check_failed'
  if [[ -f artifacts/release/release-check-result.json ]]; then
    stage_reason=$(python3 - <<'PY'
import json
from pathlib import Path
p=Path('artifacts/release/release-check-result.json')
if p.exists():
    data=json.loads(p.read_text())
    reason=data.get('reason') or 'release_check_failed'
    print(reason)
else:
    print('release_check_failed')
PY
)
    local_reason="$stage_reason"
  fi
  write_result "failed" "\"${local_reason}\""
  bundle_artifacts
  echo "[live] release-check failed"
  exit 1
fi

if ! missing=$(missing_artifacts); then
  write_result "failed" "\"artifacts_missing:${missing}\""
  bundle_artifacts
  echo "[live] missing required artifacts: ${missing}"
  exit 1
fi

if ! readiness_ok; then
  write_result "failed" '"readiness_contract_failed"'
  bundle_artifacts
  echo "[live] readiness contract did not certify readyForStaging/readyForPilot"
  exit 1
fi

write_result "passed"
bundle_artifacts
echo "[live] release check completed. Artifacts available in ./artifacts"
