#!/usr/bin/env bash
set -euo pipefail

# Requires: app running, seeded DB, session cookies captured beforehand.
# This script is intentionally explicit for reproducible manual/CI execution.

BASE_URL="${BASE_URL:-http://localhost:3000}"
MASTER_COOKIE_FILE="${MASTER_COOKIE_FILE:-/tmp/hammer-master.cookies}"
CASHIER_COOKIE_FILE="${CASHIER_COOKIE_FILE:-/tmp/hammer-cashier.cookies}"
WAREHOUSE_COOKIE_FILE="${WAREHOUSE_COOKIE_FILE:-/tmp/hammer-warehouse.cookies}"

if [[ ! -f "$CASHIER_COOKIE_FILE" || ! -f "$WAREHOUSE_COOKIE_FILE" ]]; then
  echo "Missing cookie files. Authenticate first and export cookie jars."
  exit 1
fi

echo "E2E_PLAYBOOK_READY"
echo "1) Open cash session"
echo "2) Validate active cash session"
echo "3) Post payment for pending order"
echo "4) Validate status DISPATCH_PENDING"
echo "5) Dispatch order"
echo "6) Validate ticket + DISPATCHED"
echo "7) Request/close cash session"
echo "8) Validate audit trail matrix"
echo "Use endpoint contracts in docs/operational-hardening.md"
