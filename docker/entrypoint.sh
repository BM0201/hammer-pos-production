#!/usr/bin/env bash
set -euo pipefail

cd /app

APP_ENV="${APP_ENV:-production}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required"
  exit 1
fi

if [[ -z "${AUTH_SESSION_SECRET:-}" ]]; then
  echo "AUTH_SESSION_SECRET is required"
  exit 1
fi

echo "[entrypoint] APP_ENV=${APP_ENV}"
npm run env:validate
npm run prisma:generate
npm run prisma:migrate:deploy

if [[ "${APP_ENV}" == "development" ]]; then
  echo "[entrypoint] Development mode: running seed"
  npm run seed
else
  echo "[entrypoint] ${APP_ENV} mode: skipping automatic seed"
fi

exec "$@"
