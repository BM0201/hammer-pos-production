#!/usr/bin/env bash
# =============================================================================
# H.A.M.M.E.R. POS — Restaurar Backup de PostgreSQL
# =============================================================================
# Uso:
#   ./scripts/restore-postgres.sh backups/hammer_pos_2025-05-12_10-00-00.sql.gz
#   ./scripts/restore-postgres.sh --temp backups/hammer_pos_2025-05-12_10-00-00.sql.gz
#   ./scripts/restore-postgres.sh --list
#
# ⚠️  ADVERTENCIA: Restaurar sobre la base de datos de producción
#     DESTRUIRÁ todos los datos actuales. Use --temp para restaurar
#     en una base de datos temporal y verificar antes.
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
DB_SERVICE="${DB_SERVICE:-db}"
TEMP_DB_NAME="hammer_pos_restore_temp"
RESTORE_TO_TEMP=false
LIST_MODE=false
BACKUP_FILE=""
FORCE=false

# ---------------------------------------------------------------------------
# Colores para terminal
# ---------------------------------------------------------------------------
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# ---------------------------------------------------------------------------
# Parseo de argumentos
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --temp)     RESTORE_TO_TEMP=true; shift ;;
    --list)     LIST_MODE=true; shift ;;
    --force)    FORCE=true; shift ;;
    --file)     COMPOSE_FILE="$2"; shift 2 ;;
    --env)      ENV_FILE="$2"; shift 2 ;;
    --help|-h)
      echo "Uso: $0 [opciones] <archivo_backup.sql.gz>"
      echo ""
      echo "Opciones:"
      echo "  --temp       Restaurar en DB temporal (${TEMP_DB_NAME})"
      echo "  --list       Listar backups disponibles"
      echo "  --force      Saltar confirmación (¡PELIGROSO!)"
      echo "  --file FILE  Archivo docker-compose (default: docker-compose.production.yml)"
      echo "  --env FILE   Archivo .env (default: .env.production)"
      echo "  -h, --help   Mostrar esta ayuda"
      echo ""
      echo "Ejemplos:"
      echo "  $0 backups/hammer_pos_2025-05-12_10-00-00.sql.gz"
      echo "  $0 --temp backups/hammer_pos_2025-05-12_10-00-00.sql.gz"
      echo "  $0 --list"
      exit 0
      ;;
    -*)
      echo -e "${RED}⚠️  Opción desconocida: $1${NC}"; exit 1 ;;
    *)
      BACKUP_FILE="$1"; shift ;;
  esac
done

# ---------------------------------------------------------------------------
# Funciones
# ---------------------------------------------------------------------------
log()  { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠️  $1${NC}"; }
err()  { echo -e "${RED}[$(date '+%H:%M:%S')] ❌ $1${NC}"; exit 1; }

# Construir comando compose
build_compose_cmd() {
  local cmd="docker compose -f ${COMPOSE_FILE}"
  [[ -f "$ENV_FILE" ]] && cmd="${cmd} --env-file ${ENV_FILE}"
  [[ -n "$COMPOSE_PROJECT" ]] && cmd="${cmd} -p ${COMPOSE_PROJECT}"
  echo "$cmd"
}

# ---------------------------------------------------------------------------
# Modo lista
# ---------------------------------------------------------------------------
if [[ "$LIST_MODE" == true ]]; then
  echo -e "${BOLD}📁 Backups disponibles en ${BACKUP_DIR}:${NC}"
  echo ""
  if ! ls "$BACKUP_DIR"/hammer_pos_*.sql.gz 1>/dev/null 2>&1; then
    echo "   (ningún backup encontrado)"
    exit 0
  fi
  printf "%-45s %10s %s\n" "ARCHIVO" "TAMAÑO" "FECHA"
  printf "%-45s %10s %s\n" "-------" "------" "-----"
  find "$BACKUP_DIR" -name "hammer_pos_*.sql.gz" -type f -printf '%T+ %s %p\n' \
    | sort -r \
    | while read -r ts size filepath; do
        fname=$(basename "$filepath")
        hsize=$(numfmt --to=iec-i --suffix=B "$size" 2>/dev/null || echo "${size}B")
        fdate=$(echo "$ts" | cut -d'+' -f1 | tr 'T' ' ')
        printf "%-45s %10s %s\n" "$fname" "$hsize" "$fdate"
      done
  echo ""
  TOTAL=$(find "$BACKUP_DIR" -name "hammer_pos_*.sql.gz" -type f | wc -l)
  echo -e "Total: ${BOLD}${TOTAL}${NC} backup(s)"
  exit 0
fi

# ---------------------------------------------------------------------------
# Validaciones
# ---------------------------------------------------------------------------
[[ -z "$BACKUP_FILE" ]] && err "Debe especificar un archivo de backup. Use --help para ver opciones."
[[ ! -f "$BACKUP_FILE" ]] && err "Archivo no encontrado: ${BACKUP_FILE}"
[[ ! -s "$BACKUP_FILE" ]] && err "El archivo está vacío: ${BACKUP_FILE}"

# Verificar extensión
if [[ "$BACKUP_FILE" != *.sql.gz ]]; then
  warn "El archivo no tiene extensión .sql.gz — ¿está seguro de que es un backup válido?"
fi

COMPOSE_CMD=$(build_compose_cmd)

# Verificar que el contenedor está corriendo
if ! $COMPOSE_CMD ps --status running "$DB_SERVICE" 2>/dev/null | grep -q "$DB_SERVICE"; then
  err "El contenedor '${DB_SERVICE}' no está corriendo. Inicia los servicios primero."
fi

# Leer credenciales
if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE" 2>/dev/null || true; set +a
fi
PG_USER="${POSTGRES_USER:-hammer}"
PG_DB="${POSTGRES_DB:-hammer_pos}"

TARGET_DB="$PG_DB"
if [[ "$RESTORE_TO_TEMP" == true ]]; then
  TARGET_DB="$TEMP_DB_NAME"
fi

# ---------------------------------------------------------------------------
# Confirmación interactiva
# ---------------------------------------------------------------------------
BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║           RESTAURACIÓN DE BACKUP — H.A.M.M.E.R. POS       ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Archivo:    ${CYAN}$(basename "$BACKUP_FILE")${NC} (${BACKUP_SIZE})"
echo -e "  DB destino: ${CYAN}${TARGET_DB}${NC}"
echo -e "  Usuario:    ${CYAN}${PG_USER}${NC}"
echo ""

if [[ "$RESTORE_TO_TEMP" == true ]]; then
  echo -e "  ${GREEN}✓ Modo seguro: restaurando en base de datos temporal${NC}"
  echo -e "    La DB temporal '${TEMP_DB_NAME}' se creará si no existe."
else
  echo -e "  ${RED}${BOLD}⚠️  ¡¡ ATENCIÓN !! Restaurando sobre la DB de PRODUCCIÓN${NC}"
  echo -e "  ${RED}${BOLD}   Esto DESTRUIRÁ todos los datos actuales en '${PG_DB}'${NC}"
  echo -e "  ${YELLOW}   Se recomienda hacer un backup ANTES de restaurar.${NC}"
  echo -e "  ${YELLOW}   Considere usar --temp para restaurar en DB temporal primero.${NC}"
fi
echo ""

if [[ "$FORCE" != true ]]; then
  if [[ "$RESTORE_TO_TEMP" == true ]]; then
    read -rp "¿Continuar con la restauración en DB temporal? [s/N]: " CONFIRM
  else
    echo -e "${RED}Escriba exactamente 'RESTAURAR PRODUCCION' para confirmar:${NC}"
    read -rp "> " CONFIRM
    if [[ "$CONFIRM" != "RESTAURAR PRODUCCION" ]]; then
      log "Restauración cancelada por el usuario."
      exit 0
    fi
    CONFIRM="s"
  fi

  if [[ "${CONFIRM,,}" != "s" && "${CONFIRM,,}" != "si" && "${CONFIRM,,}" != "sí" && "${CONFIRM,,}" != "y" && "${CONFIRM,,}" != "yes" ]]; then
    log "Restauración cancelada por el usuario."
    exit 0
  fi
fi

# ---------------------------------------------------------------------------
# Crear DB temporal si es necesario
# ---------------------------------------------------------------------------
if [[ "$RESTORE_TO_TEMP" == true ]]; then
  log "Creando base de datos temporal '${TEMP_DB_NAME}'..."
  $COMPOSE_CMD exec -T "$DB_SERVICE" \
    psql -U "$PG_USER" -d "$PG_DB" \
    -c "DROP DATABASE IF EXISTS ${TEMP_DB_NAME};" 2>/dev/null || true
  $COMPOSE_CMD exec -T "$DB_SERVICE" \
    psql -U "$PG_USER" -d "$PG_DB" \
    -c "CREATE DATABASE ${TEMP_DB_NAME};" || err "No se pudo crear la DB temporal."
  log "✅ DB temporal creada."
fi

# ---------------------------------------------------------------------------
# Restaurar backup
# ---------------------------------------------------------------------------
log "🔄 Restaurando backup en '${TARGET_DB}'..."
log "   Esto puede tomar varios minutos dependiendo del tamaño..."

if gunzip -c "$BACKUP_FILE" | $COMPOSE_CMD exec -T "$DB_SERVICE" \
  psql -U "$PG_USER" -d "$TARGET_DB" \
    --single-transaction \
    --set ON_ERROR_STOP=off 2>&1 | tail -5; then
  log "✅ Restauración completada exitosamente en '${TARGET_DB}'."
else
  warn "La restauración terminó con algunos warnings (esto puede ser normal)."
  log "Verifica el estado de la base de datos manualmente."
fi

# ---------------------------------------------------------------------------
# Verificación rápida
# ---------------------------------------------------------------------------
log "🔍 Verificación rápida..."
TABLE_COUNT=$($COMPOSE_CMD exec -T "$DB_SERVICE" \
  psql -U "$PG_USER" -d "$TARGET_DB" -t \
  -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" \
  | tr -d ' ')
log "   Tablas en '${TARGET_DB}': ${TABLE_COUNT}"

if [[ "$RESTORE_TO_TEMP" == true ]]; then
  echo ""
  echo -e "${BOLD}📋 Próximos pasos para la DB temporal:${NC}"
  echo ""
  echo "  Conectarse a la DB temporal para inspección:"
  echo "    $COMPOSE_CMD exec $DB_SERVICE psql -U $PG_USER -d $TEMP_DB_NAME"
  echo ""
  echo "  Eliminar la DB temporal cuando ya no se necesite:"
  echo "    $COMPOSE_CMD exec $DB_SERVICE psql -U $PG_USER -d $PG_DB -c 'DROP DATABASE ${TEMP_DB_NAME};'"
  echo ""
fi

log "🏁 Proceso de restauración finalizado."
exit 0
