#!/usr/bin/env bash
set -Eeuo pipefail

cd /app

log() {
  echo "[entrypoint][$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*"
}

APP_ENV="${APP_ENV:-production}"
NODE_ENV="${NODE_ENV:-production}"
PORT="${PORT:-3000}"
HOST="${HOST:-0.0.0.0}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-true}"

log "Booting container (APP_ENV=${APP_ENV}, NODE_ENV=${NODE_ENV}, HOST=${HOST}, PORT=${PORT})"

log "Validating environment (strict mode)"
npm run env:validate -- --mode=strict

log "Generating Prisma client"
npm run prisma:generate

if [[ "${NODE_ENV}" == "production" && "${RUN_MIGRATIONS}" == "true" ]]; then
  log "Running prisma migrate deploy (fail-fast enabled)"
  npm run prisma:migrate:deploy
else
  log "Skipping migrations (NODE_ENV=${NODE_ENV}, RUN_MIGRATIONS=${RUN_MIGRATIONS})"
fi

if [[ "$#" -eq 0 ]]; then
  log "No command passed to entrypoint; starting Next.js default command."
  set -- sh -c "npm run start -- --hostname ${HOST} --port ${PORT}"
fi

log "Executing command: $*"
exec "$@"
