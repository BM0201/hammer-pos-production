#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

run_step() {
  echo
  echo "==> $1"
}

run_step "Node/npm diagnostics"
node --version
npm --version
npm config get registry || true

if [[ ! -f package-lock.json ]]; then
  run_step "Generating deterministic lockfile"
  if ! npm install --package-lock-only --ignore-scripts --no-audit --no-fund; then
    echo "LOCKFILE_GENERATION_FAILED"
    echo "If outbound registry access is blocked, use CI artifact strategy in docs/operational-hardening.md"
    exit 2
  fi
fi

if [[ ! -d node_modules ]]; then
  run_step "Installing dependencies"
  if ! npm ci --no-audit --no-fund; then
    echo "DEPENDENCY_INSTALL_FAILED"
    echo "If outbound registry access is blocked, use CI artifact strategy in docs/operational-hardening.md"
    exit 3
  fi
fi

run_step "Prisma validate"
npm run prisma:validate

run_step "Prisma generate"
npm run prisma:generate

run_step "Typecheck"
npm run typecheck

run_step "Build"
npm run build

run_step "Operational hardening static checks"
python3 scripts/verify-phase6-operational-hardening.py

echo
echo "BOOTSTRAP_VALIDATE_COMPLETE"
