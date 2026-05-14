# PROMPT 5 — Changelog: Sistema de Backup/Restore PostgreSQL

**Fecha:** 2025-05-12
**Objetivo:** Crear un sistema robusto de backup y restauración para PostgreSQL en producción.

---

## Archivos creados

### `scripts/backup-postgres.sh`
- Script de backup usando `pg_dump` dentro del contenedor Docker
- Compresión gzip (-9) automática
- Nombres de archivo con timestamp (`hammer_pos_YYYY-MM-DD_HH-MM-SS.sql.gz`)
- Sistema de retención configurable (default: 30 backups)
- Backups guardados en directorio montado del host (`./backups`)
- Logging de operaciones en `backups/backup.log`
- Opciones por línea de comandos: `--retain`, `--dir`, `--file`, `--env`
- Sección comentada para rclone/S3 (futuro)
- Validaciones: contenedor corriendo, archivo no vacío, credenciales

### `scripts/restore-postgres.sh`
- Confirmación interactiva antes de restaurar
  - DB temporal: confirmación simple (s/N)
  - DB producción: requiere escribir `RESTAURAR PRODUCCION`
- Verificación de que el archivo existe y no está vacío
- Descompresión y restauración con `psql`
- Opción `--temp` para restaurar a base de datos temporal (`hammer_pos_restore_temp`)
- Opción `--list` para listar backups disponibles con tamaño y fecha
- Advertencias claras y coloreadas sobre restaurar en producción
- Verificación post-restauración (conteo de tablas)
- Instrucciones para inspeccionar y limpiar DB temporal

### `docs/BACKUPS.md`
- Guía completa de uso de los scripts
- Procedimientos de backup manual y automático (cron)
- Procedimientos de restauración (temporal y producción)
- Sistema de retención y estrategias recomendadas
- Instrucciones para backup remoto (rclone/S3)
- Mejores prácticas de seguridad, verificación y almacenamiento
- Sección de troubleshooting con soluciones a problemas comunes

### `backups/.gitkeep`
- Directorio de backups incluido en el repositorio (vacío)

## Archivos modificados

### `docker-compose.production.yml`
- Agregado volumen bind mount `./backups:/backups` al servicio `db`
- Los backups se almacenan fuera del contenedor en el host

### `.gitignore`
- Agregadas reglas para excluir archivos de backup (`backups/*.sql.gz`, `backups/backup.log`)

## Archivos NO modificados
- Lógica de aplicación (src/)
- Prisma schema
- Dockerfile / docker-compose.yml (dev)
- Caddyfile

---

## Criterios de aceptación

| Criterio                                        | Estado |
|-------------------------------------------------|--------|
| Se puede crear backup ejecutando el script      | ✅     |
| Se puede restaurar backup en DB temporal        | ✅     |
| Backups se guardan fuera del contenedor         | ✅     |
| Sistema de retención funcional                  | ✅     |
| Confirmación antes de restaurar en producción   | ✅     |
| Documentación completa                          | ✅     |
| Scripts ejecutables (chmod +x)                  | ✅     |
| Sección rclone/S3 comentada                     | ✅     |

---

## Validación

```bash
# Verificar scripts ejecutables
ls -la scripts/backup-postgres.sh scripts/restore-postgres.sh

# Ver ayuda
./scripts/backup-postgres.sh --help
./scripts/restore-postgres.sh --help

# Listar backups
./scripts/restore-postgres.sh --list

# Crear backup (requiere servicios corriendo)
./scripts/backup-postgres.sh

# Restaurar en DB temporal (requiere servicios corriendo)
./scripts/restore-postgres.sh --temp backups/<archivo>.sql.gz
```
