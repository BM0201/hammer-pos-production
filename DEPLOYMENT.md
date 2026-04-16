# Deploy en Railway (guía de operación y debugging)

## 1) Configuración de arranque recomendada

Este proyecto está preparado para Railway con:

- `railway.json` usando `startCommand: npm run start:railway`
- `start:railway` forzando `--hostname 0.0.0.0` y `--port ${PORT:-3000}`
- `healthcheckPath: /health` (endpoint liviano sin dependencia de DB/auth)

## 2) Variables de entorno

### OBLIGATORIAS para funcionalidad completa

- `DATABASE_URL` (PostgreSQL)
- `AUTH_SESSION_SECRET` (mínimo 32 caracteres)
- `AUTH_SESSION_TTL_HOURS=12` (o cualquier entero >= 1)

### OPCIONALES para boot y operación base

- `NODE_ENV=production` (recomendado)
- `APP_ENV=production` (recomendado)
- `PORT` (Railway la inyecta automáticamente)

### ¿Qué pasa si faltan variables críticas?

- La app **no debe caerse por validación Zod en runtime**.
- `/health` sigue respondiendo `200`.
- Endpoints/pantallas que requieren DB o sesión pueden entrar en **modo degradado**:
  - auth/login responde `503` con mensaje claro si falta `DATABASE_URL` o `AUTH_SESSION_SECRET`.
  - funcionalidades con Prisma pueden devolver errores controlados.

## 3) Validación de entorno (comportamiento real)

`scripts/validate-env.mjs` soporta:

- `strict` → bloquea con `exit 1`
- `warn` → solo warning, no bloquea
- `auto` → estricto en build/dev, warning en runtime de producción

En runtime (`prestart`) usamos `--mode=auto` para no bloquear el contenedor por inyección tardía de variables.

Controles opcionales:

- `ENV_VALIDATION_MODE=strict|warn|auto`
- `SKIP_ENV_VALIDATION=true`

## 4) Prisma en runtime

- Prisma se inicializa de forma perezosa (lazy) al usarlo por primera vez.
- Si `DATABASE_URL` falta, se evita romper import/render de páginas y se emite error controlado al intentar usar DB.
- La capa de sesión/revocación degrada sin crash cuando DB no está disponible.

### Warning de OpenSSL de Prisma

En Railway puede aparecer un warning relacionado con OpenSSL. Generalmente es **no bloqueante** mientras Prisma pueda operar y el servicio inicie correctamente.

## 5) Entrypoint Docker (si despliegas por Dockerfile)

`docker/entrypoint.sh`:

1. registra logs claros con timestamp,
2. ejecuta `env:validate` en modo no bloqueante,
3. corre `prisma generate` + `prisma migrate deploy` solo si existe `DATABASE_URL`,
4. usa `exec` para que Node/Next quede correctamente como proceso principal.

## 6) Healthcheck y troubleshooting

### Endpoint de salud

- Ruta: `GET /health`
- Respuesta esperada: `200` con JSON `{ status: "ok", ... }`
- No depende de autenticación ni base de datos.

### Si Railway marca `service unavailable`

1. Verifica que `railway.json` tenga `healthcheckPath: /health`.
2. Verifica logs de arranque y confirma que aparezca `next start` escuchando en `0.0.0.0`.
3. Revisa que `startCommand` sea `npm run start:railway`.
4. Confirma variables críticas (`DATABASE_URL`, `AUTH_SESSION_SECRET`) para funcionalidad completa.
5. Fuerza `Redeploy` luego de cambiar variables.

## 7) Checklist rápido previo a deploy

```bash
npm ci
npm run build
PORT=3000 NODE_ENV=production APP_ENV=production npm run start:railway
curl -i http://127.0.0.1:3000/health
```

Si `/health` responde `200`, el servicio está listo para healthchecks de Railway.
