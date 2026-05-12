# CHANGES.md

## 2026-04-16 - Production hardening Railway + Auth fixes

### 1) Correcciones de autenticación y login

- **Fix crítico** en `src/app/api/auth/login/route.ts`:
  - Se agregó manejo explícito de errores de base de datos antes y durante autenticación.
  - `checkRateLimit()` ahora está protegido con `try/catch` para evitar `500` genérico cuando `DATABASE_URL` está mal configurada o DB no responde.
  - Ahora responde `503` con mensaje claro cuando la DB no está disponible/mal configurada.
  - Se mejoró logging de errores inesperados en login.

### 2) Manejo global de errores de base de datos

- `src/lib/prisma.ts`:
  - Se añadió helper `isDatabaseConnectionError(error)`.
  - Se detectan errores de inicialización/conectividad de Prisma.

- `src/lib/http.ts`:
  - Se añadió mapeo global de errores de DB a `503` con mensaje operacional claro para Railway.

### 3) Password reset / verification flow

- `src/modules/users/service.ts`:
  - Al resetear/cambiar contraseña por administración (`updateUser` con `password`), ahora se establece `mustChangePassword=true`.
  - Esto fuerza al usuario a pasar por `/app/change-password` en el siguiente login.

### 4) Configuración Railway

- `railway.json`:
  - Se añadió `preDeployCommand: npm run prisma:migrate:deploy`.
  - Se mantiene `startCommand: npm run start:railway` y healthcheck `/health`.

### 5) Variables de entorno

- `.env.example` regenerado:
  - Ejemplo compatible con Railway (`DATABASE_URL` no local por defecto).
  - `NODE_ENV` y `APP_ENV` en `production` por defecto.
  - Secret placeholder seguro/documentado (no usar tal cual).
  - Comentarios y guía de generación de secreto.

### 6) Scripts

- Se creó `scripts/ensure-local-sqlite.mjs` para corregir script roto (`npm run local:prepare-sqlite`) y mantener compatibilidad sin romper pipelines locales.

### 7) Documentación de despliegue

- Se creó `RAILWAY_SETUP.md` con:
  - variables requeridas,
  - configuración de PostgreSQL en Railway,
  - comandos de migración,
  - pasos de deployment,
  - validación post-deploy,
  - troubleshooting rápido.

## Problemas identificados originalmente

1. `DATABASE_URL` apuntando a `127.0.0.1` en Railway (inválido para entorno cloud).
2. `AUTH_SESSION_SECRET` con placeholder inseguro.
3. `NODE_ENV` y `APP_ENV` en `development` en producción.
4. Login devolviendo error genérico por excepción no controlada al consultar rate limit con DB caída/mal configurada.
5. Flujo de reset de contraseña por admin no forzaba cambio de contraseña al siguiente login.
6. Script referenciado en `package.json` faltante (`scripts/ensure-local-sqlite.mjs`).
