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

log "Booting container (APP_ENV=${APP_ENV}, NODE_ENV=${NODE_ENV}, HOST=${HOST}, PORT=${PORT})"

# Non-blocking runtime validation: warns in production/auto contexts.
if ! npm run env:validate -- --mode=auto; then
  log "WARNING: env validation command returned non-zero. Continuing startup."
fi

# Prisma tasks should not block the web process in dynamic environments.
if [[ -n "${DATABASE_URL:-}" ]]; then
  log "DATABASE_URL detected; running prisma generate"
  if ! npm run prisma:generate; then
    log "WARNING: prisma generate failed. Continuing startup."
  fi

  log "Running prisma migrate deploy"
  if ! npm run prisma:migrate:deploy; then
    log "WARNING: prisma migrate deploy failed. Continuing startup."
  fi
else
  log "WARNING: DATABASE_URL not set; skipping prisma generate/migrate."
fi

if [[ "$#" -eq 0 ]]; then
  log "No command passed to entrypoint; starting Next.js default command."
  set -- sh -c "npm run start -- --hostname ${HOST} --port ${PORT}"
fi

log "Executing command: $*"
exec "$@"
