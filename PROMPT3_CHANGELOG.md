# Prompt 3 — Eliminar SQLite del entorno local

## Objetivo
Eliminar completamente SQLite del flujo de desarrollo local y asegurar que solo se use PostgreSQL.

## Archivos modificados

### `scripts/ensure-local-dev-env.mjs`
- **Eliminado**: constante `CANONICAL_SQLITE_URL = "file:./dev.db"` y toda lógica que escribía SQLite en `.env`.
- **Agregado**: función `isSqliteUrl()` que detecta URLs SQLite (`file:` o `sqlite`).
- **Agregado**: función `isValidPostgresUrl()` que valida el formato `postgresql://` o `postgres://`.
- **Comportamiento nuevo**:
  - Si `DATABASE_URL` apunta a SQLite → muestra error claro, la reemplaza automáticamente con URL PostgreSQL local.
  - Si `DATABASE_URL` está ausente o inválida → la configura con URL PostgreSQL por defecto.
  - Validación final: si después de todo `DATABASE_URL` no es PostgreSQL válida, falla con `process.exit(1)` y muestra instrucciones de Docker.
  - URL por defecto: `postgresql://hammer:hammer@localhost:5432/hammer_pos_dev`

### `scripts/ensure-local-sqlite.mjs`
- **Reescrito completamente**: ahora falla con `process.exit(1)` y muestra un mensaje claro explicando que SQLite ya no es soportado, con instrucciones para configurar PostgreSQL.

### `package.json`
- `local:doctor` ya no ejecuta `local:prepare-sqlite`. Solo ejecuta `local:prepare-env`.
- `local:prepare-sqlite` se conserva como script pero ahora falla inmediatamente con mensaje informativo.

### `scripts/dev-full.sh`
- Mensaje de log actualizado: "env + PostgreSQL validation" en lugar de "env + sqlite preflight/repair".

### `.env.example`
- Sin cambios necesarios — ya usaba URLs PostgreSQL correctamente.

### `.env.local.example` (NUEVO)
- Archivo de ejemplo específico para desarrollo local.
- Contiene URL PostgreSQL por defecto con comentarios explicativos.
- Incluye instrucciones de Docker para levantar PostgreSQL rápidamente.
- El script `ensure-local-dev-env.mjs` lo prefiere sobre `.env.example` al crear `.env`.

## Archivos NO modificados (prohibido)
- ✅ `prisma/schema.prisma` — `provider = "postgresql"` intacto.
- ✅ Ninguna migración Prisma fue tocada.

## Validación

### Comando de verificación
```bash
rg 'file:./dev.db|sqlite' scripts package.json .env*
```
**Resultado**: Solo referencias no-funcionales (mensajes de error y función de detección).

### Tests funcionales
1. `node scripts/ensure-local-sqlite.mjs` → Exit code 1 con mensaje claro ✅
2. `node scripts/ensure-local-dev-env.mjs` con URL PostgreSQL → Exit code 0 ✅
3. `node scripts/ensure-local-dev-env.mjs` con `file:./dev.db` → Detecta, reemplaza, exit 0 ✅
4. Prisma schema sigue con `provider = "postgresql"` ✅

## Guía para desarrolladores

### Configurar PostgreSQL local

**Opción 1: Docker (recomendado)**
```bash
docker run -d --name hammer-pg \
  -e POSTGRES_USER=hammer \
  -e POSTGRES_PASSWORD=hammer \
  -e POSTGRES_DB=hammer_pos_dev \
  -p 5432:5432 \
  postgres:16-alpine
```

**Opción 2: PostgreSQL nativo**
```bash
# macOS
brew install postgresql@16 && brew services start postgresql@16

# Ubuntu/Debian
sudo apt install postgresql-16
sudo -u postgres createuser -s hammer
sudo -u postgres createdb hammer_pos_dev -O hammer
```

### Iniciar desarrollo
```bash
# 1. Copiar configuración local
cp .env.local.example .env

# 2. Validar entorno (genera secretos automáticamente)
npm run local:prepare-env

# 3. Ejecutar migraciones
npx prisma migrate dev

# 4. Iniciar servidor
npm run dev
```

### Variables de entorno clave
| Variable | Valor local por defecto |
|----------|------------------------|
| `DATABASE_URL` | `postgresql://hammer:hammer@localhost:5432/hammer_pos_dev` |
| `AUTH_SESSION_SECRET` | Auto-generado por `local:prepare-env` |
| `NODE_ENV` | `development` |
