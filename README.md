# H.A.M.M.E.R. POS (Next.js + Prisma + PostgreSQL)

Aplicación ERP/POS multi-sucursal lista para ejecutar en local y desplegar en Railway.

> Guía recomendada de despliegue: revisa [`DEPLOYMENT.md`](./DEPLOYMENT.md).

## Stack base
- Next.js 15
- Prisma ORM
- PostgreSQL (única base soportada para despliegue)
- Node.js 22 + npm

## Requisitos
- Node.js 22+
- npm 11+
- PostgreSQL 15+ (local o gestionado)

## Variables mínimas requeridas
Copia plantilla:

```bash
cp .env.example .env
```

Variables obligatorias:
- `DATABASE_URL` (PostgreSQL, `postgresql://...`)
- `AUTH_SESSION_SECRET` (mínimo 32 caracteres)

Variables recomendadas:
- `AUTH_SESSION_TTL_HOURS` (default: `12`)
- `APP_ENV` (`development`, `staging`, `production`)

## Flujo local rápido
```bash
npm install
npm run env:validate
npm run prisma:generate
npm run prisma:migrate:deploy
npm run seed
npm run dev
```

## Prisma y migraciones (coherente con PostgreSQL)
- `prisma/schema.prisma` usa `provider = "postgresql"`.
- El historial de migraciones está normalizado para PostgreSQL desde una base limpia.
- Comandos operativos:

```bash
npm run prisma:generate
npm run prisma:migrate:deploy
```

## Docker (runtime de producción)
El contenedor:
1. valida entorno en modo flexible (`auto`),
2. ejecuta `prisma generate` + `prisma migrate deploy` **si** existe `DATABASE_URL`,
3. registra logs claros de arranque para debugging,
4. expone Next.js en `0.0.0.0` usando `PORT` (fallback `3000`) y usa `exec` para proceso principal correcto.

Construcción local:
```bash
docker build -t hammer-pos .
```

Ejecución local:
```bash
docker run --rm -p 3000:3000 \
  -e APP_ENV=production \
  -e DATABASE_URL="postgresql://postgres:postgres@host.docker.internal:5432/hammer?schema=public" \
  -e AUTH_SESSION_SECRET="<SECRET_32+>" \
  hammer-pos
```

---

## Deploy en Railway (paso a paso real)

### 1) Subir repo a GitHub
```bash
git add .
git commit -m "Prepare production deploy for Railway + PostgreSQL"
git push origin <tu-rama>
```

### 2) Crear proyecto en Railway
- Railway Dashboard → **New Project** → **Deploy from GitHub repo**.
- Selecciona este repositorio y rama.

### 3) Agregar PostgreSQL gestionado
- Dentro del proyecto: **New** → **Database** → **PostgreSQL**.
- Railway inyectará variables del servicio DB.

### 4) Configurar variables del servicio web
En el servicio de la app (no en DB), define al menos:
- `DATABASE_URL=${{Postgres.DATABASE_URL}}` (o referencia equivalente de Railway)
- `AUTH_SESSION_SECRET=<valor aleatorio fuerte, 32+ chars>`
- `AUTH_SESSION_TTL_HOURS=12`
- `APP_ENV=production`
- `NODE_ENV=production`

### 4.1) Healthcheck recomendado
Asegura en `railway.json`:

- `startCommand: npm run start:railway`
- `healthcheckPath: /health`

`/health` responde `200` sin depender de autenticación ni consultas a base de datos, para evitar falsos negativos en los healthchecks.
### 5) Pre-deploy command para migraciones
En Railway, configura exactamente:

```bash
npm run prisma:migrate:deploy
```

> Nota: el entrypoint también ejecuta migraciones al iniciar. Mantener el pre-deploy evita arrancar una release si la migración falla.

### 6) Generar dominio público
- Servicio web → **Settings** → **Networking**.
- Click en **Generate Domain**.
- (Opcional) agrega dominio custom y apunta DNS según Railway.

### 7) Primer acceso / seed
- Producción **no** ejecuta seed automático.
- Si necesitas datos iniciales en staging o primer bootstrap manual:

```bash
npm run seed
```

Ejecuta este comando sólo cuando sea intencional poblar datos de prueba/iniciales.

---

## Comandos útiles
```bash
npm run env:validate
npm run prisma:generate
npm run prisma:migrate:deploy
npm run build
npm run start
```