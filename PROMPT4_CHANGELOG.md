# Prompt 4 — Changelog: Despliegue de Producción con Docker + Caddy HTTPS

**Fecha:** 2025-05-12
**Objetivo:** Crear un setup de producción completo, seguro y listo para desplegar con HTTPS automático.

---

## Archivos creados

### `docker-compose.production.yml`
- **Servicio `db`** (PostgreSQL 15 Alpine):
  - Sin puerto expuesto al host (solo red interna)
  - Volumen persistente `postgres_data`
  - Healthcheck con `pg_isready`
  - Credenciales via variables de entorno (sin valores hardcodeados)
  - Límite de memoria: 512MB
- **Servicio `app`** (Next.js):
  - Build desde Dockerfile existente
  - Depende de `db` (condition: service_healthy)
  - Solo `expose: 3000` (no puertos al host)
  - Healthcheck via `/health` endpoint
  - Migraciones automáticas via entrypoint
  - Límite de memoria: 1GB
- **Servicio `caddy`** (Caddy 2 Alpine):
  - Reverse proxy hacia `app:3000`
  - Puertos 80, 443 (TCP) y 443 (UDP para HTTP/3)
  - Depende de `app` (condition: service_healthy)
  - Volúmenes persistentes para certificados SSL y config
- **Red interna:** `hammer_pos_internal` (bridge)
- **Volúmenes nombrados:** `hammer_pos_postgres_data`, `hammer_pos_caddy_data`, `hammer_pos_caddy_config`

### `Caddyfile`
- Reverse proxy hacia `app:3000`
- HTTPS automático con Let's Encrypt
- Health check del backend
- Headers de seguridad:
  - X-Frame-Options: SAMEORIGIN
  - X-Content-Type-Options: nosniff
  - Referrer-Policy: strict-origin-when-cross-origin
  - Permissions-Policy (restringir APIs)
  - HSTS (1 año, includeSubDomains, preload)
- Compresión gzip + zstd
- Logs JSON a stdout

### `.env.production.example`
- Variables obligatorias documentadas con comentarios
- Comandos para generar contraseñas/secretos seguros
- Sin credenciales reales (todo marcado como CHANGE_ME)
- Secciones: dominio, PostgreSQL, sesión, aplicación, bootstrap

### `DEPLOYMENT.md` (reescrito completo)
- Requisitos previos (hardware, software, Docker)
- Arquitectura de producción (diagrama ASCII)
- Configuración de DNS paso a paso
- Preparación del servidor (firewall UFW)
- Configuración de variables de entorno
- Despliegue paso a paso (build, up, logs)
- Seed inicial para primer despliegue
- Verificación post-despliegue (checks automáticos y manuales)
- Actualización de la aplicación
- Backup y restauración (manual + cron automático)
- Mantenimiento (comandos útiles, monitoreo, limpieza)
- Troubleshooting (SSL, DB, 502, pantalla blanca, migraciones, disco)
- Despliegue alternativo en Railway
- Checklist de despliegue

## Archivos modificados

### `.gitignore`
- Agregado `.env.production` para evitar commit accidental de credenciales

## Archivos NO modificados
- `docker-compose.yml` (dev/test) — sin cambios
- `Dockerfile` — sin cambios (reutilizado tal cual)
- `docker/entrypoint.sh` — sin cambios

## Validación

```bash
# ✅ Configuración válida
POSTGRES_PASSWORD=test AUTH_SESSION_SECRET=test_32chars_minimum_here_ok docker compose -f docker-compose.production.yml config

# ✅ PostgreSQL NO expone puerto 5432
# ✅ Caddy expone puertos 80 y 443
# ✅ Volúmenes persistentes configurados
# ✅ Red interna para comunicación entre servicios
# ✅ Healthchecks en los 3 servicios
# ✅ Dependencias correctas (db → app → caddy)
```

## Criterios de aceptación cumplidos

| Criterio | Estado |
|----------|--------|
| `docker compose -f docker-compose.production.yml config` pasa | ✅ |
| PostgreSQL NO expone puerto 5432 al host | ✅ |
| Caddy expone puertos 80 y 443 | ✅ |
| Volúmenes persistentes configurados | ✅ |
| Red interna para comunicación | ✅ |
| Variables de entorno sin contraseñas reales | ✅ |
| DEPLOYMENT.md con instrucciones completas | ✅ |
