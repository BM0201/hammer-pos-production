# Deployment Guide — H.A.M.M.E.R. POS/ERP (dos proyectos Vercel)

Esta guía describe el despliegue de los dos proyectos resultantes del split del monolito:

- `hammer-api/`       — Backend (Route Handlers + Prisma + Neon)
- `hammer-frontend/`  — Frontend (Next.js sólo UI, CSR)

> **Original (intacto)**: `hammer-pos-production-feature-security-hardening-complete/` — se mantiene como referencia y NO se despliega.

---

## 🎯 Visión general

```
Browser ──▶ [hammer-frontend.vercel.app]
                  │
                  │ /api/*  (rewrites, mismo origen)
                  ▼
              [hammer-api.vercel.app]
                  │
                  │ Prisma + @prisma/adapter-neon
                  ▼
              [Neon PostgreSQL]  (region aws-sa-east-1)
```

### Beneficios del split
1. **Frontend cacheable en edge CDN** (Vercel) sin pasar por Node SSR.
2. **Backend escala separado** (cron, region São Paulo, Driver Adapter Neon serverless).
3. **Deploys independientes** (un push a UI no reinicia el backend).
4. **Mismo dominio para el navegador** (rewrites) – mantiene cookies + CSRF intactos.

---

## 📋 Pre-requisitos

- Cuenta Vercel con plan que permita 2 proyectos.
- Cuenta Neon con DB creada (`aws-sa-east-1` recomendado).
- Acceso a un repositorio Git que contenga ambas carpetas.
- Node 22 y npm 11 para desarrollo local.

---

## 1️⃣  Provisionar Neon

1. Crear proyecto Neon → región **AWS sa-east-1 (São Paulo)**.
2. Database `hammer_prod` (o cualquier nombre).
3. Anotar el **pooler connection string** (driver adapter HTTP no necesita PgBouncer):

   ```
   postgresql://USER:PASS@ep-xxx.aws-sa-east-1.neon.tech/hammer_prod?sslmode=require
   ```

4. Aplicar el esquema:

   ```bash
   cd hammer-api
   DATABASE_URL="postgresql://..." npx prisma migrate deploy
   ```

   > El esquema (`prisma/schema.prisma`) tiene 1249 líneas e incluye todos los modelos, incluyendo Reorder.

---

## 2️⃣  Desplegar `hammer-api`

### A. Crear proyecto en Vercel

- **Root directory**: `hammer-api/`
- **Framework**: Next.js
- **Build command**: `npx prisma generate && next build`  (Vercel detecta automáticamente)
- **Output directory**: `.next` (estándar)
- **Region**: `gru1` (São Paulo) – ya definido en `vercel.json`.

### B. Variables de entorno (Project Settings → Environment Variables)

| Variable | Valor | Notas |
|---|---|---|
| `DATABASE_URL` | `postgresql://…?sslmode=require` | Connection string Neon. |
| `AUTH_SESSION_SECRET` | random ≥ 32 chars | `openssl rand -hex 32`. |
| `SESSION_PASSWORD` | random ≥ 32 chars | Iron-session. |
| `CSRF_SECRET` | random ≥ 16 chars | Recomendado. |
| `CRON_TOKEN` | random ≥ 32 chars | Para cron Vercel. |
| `ADMIN_EMAIL` | `admin@…` | Opcional. |
| `NODE_ENV` | `production` | Vercel ya lo setea. |

### C. Cron

Vercel registra automáticamente el cron de `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/cleanup", "schedule": "0 3 * * *" }
  ]
}
```

Vercel envía un `Authorization: Bearer ${CRON_TOKEN}` que el endpoint valida.

### D. Verificación

```bash
curl https://hammer-api.vercel.app/health   # → 200
curl https://hammer-api.vercel.app/ready    # → 200 + DB OK
```

---

## 3️⃣  Desplegar `hammer-frontend`

### A. Crear proyecto en Vercel

- **Root directory**: `hammer-frontend/`
- **Framework**: Next.js
- **Build command**: `next build`
- **Output**: estándar.
- **Region**: cualquiera (edge CDN servirá la UI). Recomendado: `gru1` para reducir latencia SSR de los rewrites.

### B. Variables de entorno

| Variable | Valor | Notas |
|---|---|---|
| `BACKEND_URL` | `https://hammer-api.vercel.app` | URL completa del proyecto backend. Usada por rewrites. |

### C. Rewrites

Ya configurados en `next.config.ts`:

```ts
async rewrites() {
  return [
    { source: "/api/:path*", destination: `${process.env.BACKEND_URL}/api/:path*` },
  ];
}
```

Resultado:

- El navegador hace `GET /api/auth/session` al dominio del frontend.
- El **servidor Next.js del frontend** reescribe la petición a `${BACKEND_URL}/api/auth/session`.
- Para el navegador, todo es **mismo origen** → cookies + CSRF funcionan sin CORS.

### D. Verificación

```bash
curl https://hammer-frontend.vercel.app/api/auth/session  # debe responder lo mismo que el backend
```

Visitar `https://hammer-frontend.vercel.app/login` y probar el flujo completo.

---

## 4️⃣  Configurar dominio personalizado (opcional)

Recomendado:

- `app.hammer-pos.com` → `hammer-frontend.vercel.app`
- `api.hammer-pos.com` → `hammer-api.vercel.app`
- Actualizar `BACKEND_URL` en el frontend a `https://api.hammer-pos.com` para que los rewrites apunten al subdominio.

---

## 5️⃣  Variables de entorno locales

### `hammer-api/.env`
```
DATABASE_URL="postgresql://user:pass@localhost:5432/hammer_dev"
AUTH_SESSION_SECRET="dev_secret_at_least_32_chars_xxxxx"
SESSION_PASSWORD="dev_session_password_at_least_32_chars"
CSRF_SECRET="dev_csrf"
CRON_TOKEN="dev_token"
NODE_ENV="development"
```

### `hammer-frontend/.env.local`
```
BACKEND_URL=http://localhost:4000
```

### Correr ambos
```bash
# Terminal 1
cd hammer-api && PORT=4000 npm run dev

# Terminal 2
cd hammer-frontend && npm run dev   # default :3000
```

---

## 6️⃣  Rollback / promoción

- Cada proyecto tiene su propio historial de deployments en Vercel.
- Se puede revertir el frontend **sin** revertir el backend (y viceversa).
- Para coordinar releases con cambios de schema:
  1. Desplegar backend con la nueva versión (compatible con la UI vieja).
  2. Aplicar migración Neon.
  3. Desplegar frontend.

---

## 7️⃣  Monitoreo

- **Vercel Analytics** en frontend.
- **Vercel Logs** en backend (filtrar por path).
- **Neon Insights** para latencia y slow queries.
- Health checks externos (UptimeRobot, BetterStack) apuntando a:
  - `https://hammer-frontend.vercel.app/health`
  - `https://hammer-api.vercel.app/ready`

---

## 🆘 Troubleshooting

| Síntoma | Causa | Solución |
|---|---|---|
| `401 Unauthorized` tras login | `BACKEND_URL` mal puesto → cookies de otro origen | Verificar rewrites + variable `BACKEND_URL`. |
| `503` en `/ready` | Neon dormido o connection string mal | Despertar Neon, revisar string. |
| `CSRF token mismatch` | Cookies inter-domain bloqueadas | Asegurar mismo origen vía rewrites. |
| Build error “AUTH_SESSION_SECRET es obligatoria” | Falta variable en Vercel | Añadirla y redeployar. |
| Cron no ejecuta | `CRON_TOKEN` mal o cron deshabilitado | Verificar `vercel.json` + variable. |

---

## 📚 Referencias

- `/home/ubuntu/designs/hammer_backend_frontend_separation_design.md` – diseño formal.
- `/home/ubuntu/hammer-pos-erp/CHANGELOG.md` – cambios versión a versión.
- [Vercel Rewrites](https://vercel.com/docs/edge-network/rewrites)
- [Neon Driver Adapter](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/neon)
