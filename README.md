# H.A.M.M.E.R. POS (Next.js 15 + Prisma + PostgreSQL)

Sistema POS/ERP multi-sucursal para flujo: **POS → pendiente de pago → caja/pago → despacho**.

## Requisitos de runtime (producción)

- Node.js `22.x`
- npm `11.x`
- PostgreSQL `15+`

El proyecto valida engines en `package.json` y el contenedor usa `node:22-alpine`.

## Variables de entorno obligatorias en producción

- `NODE_ENV=production`
- `DATABASE_URL` (PostgreSQL válida: `postgresql://` o `postgres://`)
- `AUTH_SESSION_SECRET` (mínimo 32 caracteres, sin placeholders)
- `AUTH_SESSION_TTL_HOURS` (entero >= 1)

Variables recomendadas:

- `APP_ENV=production`
- `PORT=3000`
- `RUN_MIGRATIONS=true`
- `ENABLE_CASH_CLOSURE_SCHEDULER=false`

## Generar AUTH_SESSION_SECRET

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Bootstrap productivo (`seed:production`)

Variables requeridas para bootstrap de cuentas privilegiadas:

- `BOOTSTRAP_OWNER_EMAIL` (o `BOOTSTRAP_ADMIN_EMAIL` para compatibilidad)
- `BOOTSTRAP_OWNER_NAME` (o `BOOTSTRAP_ADMIN_NAME` para compatibilidad)
- `BOOTSTRAP_OWNER_PASSWORD`
- `BOOTSTRAP_SYSADMIN_PASSWORD`
- `BOOTSTRAP_BRANCH_CODE`
- `BOOTSTRAP_BRANCH_NAME`

Opcionales:

- `BOOTSTRAP_SYSADMIN_EMAIL` (si no se define, se deriva del owner)
- `BOOTSTRAP_SYSADMIN_NAME`
- `BOOTSTRAP_CREATE_CASH_BOX=true|false`

Reglas hardening del seed de producción:

- Owner y SysAdmin usan contraseñas separadas
- Contraseñas iguales están prohibidas
- Política mínima: 12+ chars, mayúscula, minúscula, número y símbolo
- No se imprimen secretos en logs
- `mustChangePassword=true` para cuentas privilegiadas nuevas
- Si el usuario ya existe, no se sobrescribe su contraseña/datos

## Comandos definitivos de producción

### Build/validación previa

```bash
npm ci
npm run env:validate -- --mode=strict
npm run prisma:generate
npm run typecheck
npm run build
```

### Migraciones (fail-fast)

```bash
npm run prisma:migrate:deploy
```

### Seed productivo (una sola vez por entorno, bajo control)

```bash
npm run seed:production
```

### Arranque

```bash
npm run start:railway
```

## Docker (producción)

- El `entrypoint` ejecuta en orden y con fail-fast:
  1. `env:validate --mode=strict`
  2. `prisma:generate`
  3. `prisma:migrate:deploy` (si `NODE_ENV=production` y `RUN_MIGRATIONS=true`)
  4. `next start`
- Si migraciones fallan, el contenedor termina con `exit 1`.
- No se usa `prisma db push` en producción.

## Railway

- Deploy por `Dockerfile`
- Migraciones centralizadas en `docker/entrypoint.sh`
- `railway.json` no duplica migraciones via `preDeployCommand`
- Healthcheck: `GET /health`

## CI (`.github/workflows/ci.yml`)

Pipeline mínimo:

1. `npm ci`
2. `npm run env:validate -- --mode=strict`
3. `npm run prisma:generate`
4. `npm run typecheck`
5. `npm run lint` (si existe script)
6. `npm run test` (si existe script)
7. `npm run build`

Node y npm alineados a `22.x` y `11.4.2` con cache de npm.

## Checklist antes de deploy

- [ ] `AUTH_SESSION_SECRET` generado de forma segura (32+ chars)
- [ ] `DATABASE_URL` apunta a PostgreSQL de producción (no localhost)
- [ ] `npm ci && npm run prisma:generate && npm run typecheck && npm run build` OK
- [ ] `npm run prisma:migrate:deploy` aplicado sin errores
- [ ] `npm run seed:production` ejecutado con passwords fuertes y distintas
- [ ] Verificado que no se imprimen secretos en logs
- [ ] Healthcheck `/health` responde correctamente
- [ ] Variables críticas configuradas en Railway/Docker antes de iniciar
