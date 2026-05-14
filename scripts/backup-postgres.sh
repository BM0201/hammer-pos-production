#!/usr/bin/env bash
# =============================================================================
# H.A.M.M.E.R. POS — Backup de PostgreSQL (producción)
# =============================================================================
# Uso:
#   ./scripts/backup-postgres.sh                   # Backup con valores por defecto
#   ./scripts/backup-postgres.sh --retain 30       # Mantener últimos 30 backups
#   ./scripts/backup-postgres.sh --dir /ruta/bkp   # Directorio destino personalizado
#
# Requisitos:
#   - Docker y Docker Compose instalados
#   - Contenedor 'db' corriendo (docker-compose.production.yml)
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuración por defecto (sobreescribible con flags o variables de entorno)
# ---------------------------------------------------------------------------
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETAIN_COUNT="${RETAIN_COUNT:-30}"           # Número de backups a mantener
DB_SERVICE="${DB_SERVICE:-db}"               # Nombre del servicio Docker
TIMESTAMP="$(date +%Y-%m-%d_%H-%M-%S)"
LOG_FILE="${BACKUP_DIR}/backup.log"

# ---------------------------------------------------------------------------
# Parseo de argumentos
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --retain)  RETAIN_COUNT="$2"; shift 2 ;;
    --dir)     BACKUP_DIR="$2";   shift 2 ;;
    --file)    COMPOSE_FILE="$2"; shift 2 ;;
    --env)     ENV_FILE="$2";     shift 2 ;;
    --help|-h)
      echo "Uso: $0 [--retain N] [--dir /ruta] [--file compose.yml] [--env .env]"
      echo ""
      echo "Opciones:"
      echo "  --retain N    Número de backups a conservar (default: 30)"
      echo "  --dir PATH    Directorio de backups (default: ./backups)"
      echo "  --file FILE   Archivo docker-compose (default: docker-compose.production.yml)"
      echo "  --env FILE    Archivo de variables de entorno (default: .env.production)"
      echo "  -h, --help    Mostrar esta ayuda"
      exit 0
      ;;
    *) echo "⚠️  Argumento desconocido: $1"; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Funciones de utilidad
# ---------------------------------------------------------------------------
log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
  echo "$msg"
  echo "$msg" >> "$LOG_FILE"
}

die() {
  log "❌ ERROR: $1"
  exit 1
}

# ---------------------------------------------------------------------------
# Validaciones previas
# ---------------------------------------------------------------------------
mkdir -p "$BACKUP_DIR"

# Construir comando base de docker compose
COMPOSE_CMD="docker compose -f ${COMPOSE_FILE}"
if [[ -f "$ENV_FILE" ]]; then
  COMPOSE_CMD="${COMPOSE_CMD} --env-file ${ENV_FILE}"
fi
if [[ -n "$COMPOSE_PROJECT" ]]; then
  COMPOSE_CMD="${COMPOSE_CMD} -p ${COMPOSE_PROJECT}"
fi

# Verificar que el contenedor db está corriendo
if ! $COMPOSE_CMD ps --status running "$DB_SERVICE" 2>/dev/null | grep -q "$DB_SERVICE"; then
  die "El contenedor '${DB_SERVICE}' no está corriendo. Inicia los servicios primero."
fi

# Leer credenciales desde el archivo .env o variables de entorno
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE" 2>/dev/null || true; set +a
fi
PG_USER="${POSTGRES_USER:-hammer}"
PG_DB="${POSTGRES_DB:-hammer_pos}"

# ---------------------------------------------------------------------------
# Crear backup
# ---------------------------------------------------------------------------
BACKUP_FILENAME="hammer_pos_${TIMESTAMP}.sql.gz"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_FILENAME}"

log "🔄 Iniciando backup de PostgreSQL..."
log "   Base de datos: ${PG_DB}"
log "   Usuario:       ${PG_USER}"
log "   Destino:       ${BACKUP_PATH}"

if $COMPOSE_CMD exec -T "$DB_SERVICE" \
  pg_dump -U "$PG_USER" -d "$PG_DB" \
    --no-owner \
    --no-privileges \
    --clean \
    --if-exists \
    --verbose 2>>"$LOG_FILE" \
  | gzip -9 > "$BACKUP_PATH"; then

  BACKUP_SIZE=$(du -h "$BACKUP_PATH" | cut -f1)
  log "✅ Backup completado: ${BACKUP_FILENAME} (${BACKUP_SIZE})"
else
  # Limpiar archivo vacío/corrupto
  rm -f "$BACKUP_PATH"
  die "pg_dump falló. Revisa el log: ${LOG_FILE}"
fi

# Verificar que el archivo no está vacío
if [[ ! -s "$BACKUP_PATH" ]]; then
  rm -f "$BACKUP_PATH"
  die "El archivo de backup está vacío. Algo salió mal con pg_dump."
fi

# ---------------------------------------------------------------------------
# Retención: eliminar backups antiguos
# ---------------------------------------------------------------------------
BACKUP_COUNT=$(find "$BACKUP_DIR" -name "hammer_pos_*.sql.gz" -type f | wc -l)

if [[ "$BACKUP_COUNT" -gt "$RETAIN_COUNT" ]]; then
  EXCESS=$((BACKUP_COUNT - RETAIN_COUNT))
  log "🧹 Limpiando ${EXCESS} backup(s) antiguo(s) (retención: ${RETAIN_COUNT})..."
  find "$BACKUP_DIR" -name "hammer_pos_*.sql.gz" -type f -printf '%T+ %p\n' \
    | sort \
    | head -n "$EXCESS" \
    | awk '{print $2}' \
    | while read -r old_file; do
        rm -f "$old_file"
        log "   Eliminado: $(basename "$old_file")"
      done
fi

# ---------------------------------------------------------------------------
# Resumen
# ---------------------------------------------------------------------------
REMAINING=$(find "$BACKUP_DIR" -name "hammer_pos_*.sql.gz" -type f | wc -l)
log "📊 Backups en disco: ${REMAINING} / máximo ${RETAIN_COUNT}"
log "📁 Directorio: $(realpath "$BACKUP_DIR")"

# ---------------------------------------------------------------------------
# [FUTURO] Sincronización remota con rclone / AWS S3
# ---------------------------------------------------------------------------
# Descomenta y configura las siguientes líneas para enviar backups a la nube.
#
# --- Opción A: rclone (Google Drive, S3, Backblaze, etc.) ---
# RCLONE_REMOTE="mi_remote:hammer-pos-backups"
# log "☁️  Subiendo backup a ${RCLONE_REMOTE}..."
# rclone copy "$BACKUP_PATH" "$RCLONE_REMOTE" --progress
# log "✅ Backup subido a ${RCLONE_REMOTE}"
#
# --- Opción B: AWS CLI (S3 directo) ---
# S3_BUCKET="s3://mi-bucket-backups/hammer-pos"
# log "☁️  Subiendo backup a ${S3_BUCKET}..."
# aws s3 cp "$BACKUP_PATH" "${S3_BUCKET}/${BACKUP_FILENAME}"
# log "✅ Backup subido a ${S3_BUCKET}"
#
# --- Opción C: Retención remota ---
# Para limpiar backups remotos antiguos:
# rclone delete "$RCLONE_REMOTE" --min-age 30d
# aws s3 ls "$S3_BUCKET" | awk '{print $4}' | head -n -${RETAIN_COUNT} | \
#   xargs -I {} aws s3 rm "${S3_BUCKET}/{}"
# ---------------------------------------------------------------------------

log "🏁 Proceso de backup finalizado."
exit 0
