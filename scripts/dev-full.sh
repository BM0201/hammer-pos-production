#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -d node_modules ]]; then
  echo "[dev:full] Installing dependencies"
  npm ci --no-audit --no-fund
else
  echo "[dev:full] Dependencies already installed"
fi

echo "[dev:full] Running local doctor (env + PostgreSQL validation)"
npm run local:doctor

echo "[dev:full] Running bootstrap check"
npm run bootstrap:check

echo "[dev:full] Seeding database"
npm run seed

echo "[dev:full] Installing Playwright Chromium browser"
npx playwright install chromium

echo "[dev:full] Preparing authenticated E2E state"
npm run e2e:prepare

echo "[dev:full] Starting development server"
npm run dev -- --hostname 0.0.0.0 --port 3000
