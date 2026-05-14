#!/bin/sh
set -eu

log() {
  echo "[railway:migrate][$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

if [ -z "${DATABASE_URL:-}" ]; then
  fail "DATABASE_URL no está definido. En Railway debes agregar PostgreSQL y definir DATABASE_URL usando la referencia de la DB en el servicio web."
fi

case "${DATABASE_URL}" in
  *localhost*|*127.0.0.1*)
    fail "DATABASE_URL apunta a localhost/127.0.0.1. En Railway debes usar la URL interna de PostgreSQL del proyecto."
    ;;
esac

MAX_ATTEMPTS="${PRISMA_DB_WAIT_ATTEMPTS:-20}"
SLEEP_SECONDS="${PRISMA_DB_WAIT_SLEEP_SECONDS:-3}"

log "Generando cliente Prisma"
npm run prisma:generate

log "Verificando conectividad de base de datos antes de migrar (intentos=${MAX_ATTEMPTS}, espera=${SLEEP_SECONDS}s)"
connected="false"
attempt=1

while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  set +e
  status_output=$(npx prisma migrate status 2>&1)
  status_code=$?
  set -e

  if [ "$status_code" -eq 0 ]; then
    connected="true"
    log "Conexión a base de datos validada."
    break
  fi

  if echo "$status_output" | grep -Eiq "P1001|P1002|Can't reach database server|ECONNREFUSED|timed out|connection"; then
    log "Base de datos aún no disponible (intento ${attempt}/${MAX_ATTEMPTS}). Reintentando en ${SLEEP_SECONDS}s..."
    sleep "$SLEEP_SECONDS"
    attempt=$((attempt + 1))
    continue
  fi

  log "Salida no recuperable de prisma migrate status:"
  echo "$status_output"
  fail "No se puede continuar con migraciones por error no recuperable."
done

if [ "$connected" != "true" ]; then
  fail "No se logró conectar a PostgreSQL después de ${MAX_ATTEMPTS} intentos. Verifica que el servicio de DB esté corriendo y vinculado al servicio web."
fi

log "Ejecutando migraciones Prisma (deploy)"
if ! npm run prisma:migrate:deploy; then
  fail "Falló prisma migrate deploy. Revisa logs para errores de esquema o permisos en base de datos."
fi

log "Migraciones completadas correctamente"
