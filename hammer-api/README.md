# hammer-api — Backend H.A.M.M.E.R. POS/ERP

Servicio backend (Next.js Route Handlers + Prisma + Neon PostgreSQL) que expone la API REST y los crons del sistema POS/ERP H.A.M.M.E.R. Está pensado para desplegarse como **proyecto independiente** en Vercel, junto con su gemelo `hammer-frontend`.

> **Diseño:** ver `/home/ubuntu/designs/hammer_backend_frontend_separation_design.md`.

---

## 🚀 Stack

- **Next.js 15.1.4** (App Router – sólo Route Handlers, sin páginas)
- **Prisma 6.7.0** + adaptador `@prisma/adapter-neon` (driver HTTP serverless)
- **Neon PostgreSQL** (con pooling Driver Adapter; sin pgBouncer)
- **iron-session 8.x** (cookies firmadas)
- **PBKDF2** para hashing de contraseñas (Node `crypto`)
- **TypeScript estricto**
- Runtime: **Node.js 22** (Vercel)

---

## 📁 Estructura

```
hammer-api/
├── prisma/
│   └── schema.prisma         # 1249 líneas – todos los modelos (incluido Reorder)
├── src/
│   ├── app/
│   │   ├── api/              # 99 Route Handlers (POS, ERP, AI, cron, etc.)
│   │   ├── health/route.ts   # GET /health  → 200 OK
│   │   └── ready/route.ts    # GET /ready   → 200 OK + DB check
│   ├── modules/              # 30 módulos de servicio (auth, dashboard, ai-insights, …)
│   ├── lib/                  # prisma, env, http, security, csrf, audit, …
│   ├── types/                # tipos compartidos
│   └── middleware.ts         # CSRF + autenticación de Route Handlers
├── next.config.ts
├── vercel.json               # Crons y region (sa-east-1)
├── tsconfig.json
└── package.json
```

### Endpoints nuevos en esta versión (no existían en el monolito)

Estos endpoints exponen funciones de servicio que antes eran **sólo SSR**:

| Endpoint | Descripción |
|---|---|
| `GET /api/master/dashboard` | Resumen del dashboard MASTER (`byBranch`, `alerts`). |
| `GET /api/branch/dashboard?role=SALES\|CASHIER\|WAREHOUSE\|BRANCH_ADMIN` | Resumen para sucursal por rol del usuario. |

---

## ⚙️  Variables de entorno

Ver `.env.example`. Las críticas son:

| Variable | Obligatoria | Descripción |
|---|---|---|
| `DATABASE_URL` | ✅ | Connection string Neon (`postgresql://user:pass@ep-xxx.neon.tech/db?sslmode=require`). |
| `AUTH_SESSION_SECRET` | ✅ (prod) | Mínimo 32 caracteres. Firma las cookies de sesión. |
| `SESSION_PASSWORD` | ✅ (prod) | Mínimo 32 caracteres. Iron-session. |
| `CSRF_SECRET` | recomendado | Sales del double-submit token. |
| `ADMIN_EMAIL` | opcional | Recibe alertas de cron / health. |
| `CRON_TOKEN` | ✅ (prod) | Bearer token para los crons de Vercel. |
| `CORS_ALLOWED_ORIGINS` | opcional | Si el frontend está en otro dominio sin rewrites. |

### `vercel.json`

- **Region:** `gru1` (Vercel São Paulo, mismo continente que Neon `aws-sa-east-1`).
- **Cron:** `0 3 * * *` → `GET /api/cron/cleanup` (limpia sesiones expiradas, rate-limit hits, etc.).

---

## 🛠️  Comandos

```bash
# Instalación (Node 22 / npm 11)
npm install --legacy-peer-deps

# Generar Prisma Client (lee prisma/schema.prisma)
npx prisma generate

# Comprobar tipos
npm run typecheck            # tsc --noEmit

# Compilar (Next.js)
npm run build                # next build

# Migración manual a Neon (única vez)
npx prisma migrate deploy

# Dev local (puerto 4000 sugerido)
PORT=4000 npm run dev
```

---

## 🔒 Seguridad

- **Autenticación:** `iron-session` con `httpOnly + secure + sameSite=lax`.
- **RBAC 2 niveles:** roles globales (`OWNER`/`SYSTEM_ADMIN`/`MASTER`) + roles por sucursal (`BRANCH_ADMIN`/`SALES`/`CASHIER`/`WAREHOUSE`).
- **CSRF:** double-submit token (`x-csrf-token` header vs cookie) en todos los métodos no-GET.
- **PBKDF2:** 600k iteraciones, salt 32 bytes, output 64 bytes (SHA-512).
- **Rate-limit:** in-memory en `/api/auth/login` con backoff exponencial.
- **Auditoría:** todas las mutaciones registran en `AuditLog` (actor, acción, target, IP, UA, snapshot).
- **Headers:** `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy`.

---

## 🌐 Despliegue en Vercel

1. Crear nuevo proyecto Vercel apuntando a la carpeta `hammer-api/`.
2. Variables de entorno (ver tabla arriba).
3. Build command: `npx prisma generate && next build`.
4. Output: standalone (configurado en `next.config.ts`).
5. Region: `gru1` (ya en `vercel.json`).
6. Cron job se registra automáticamente.

### Health checks
- `GET /health` → 200 si el proceso está vivo.
- `GET /ready` → 200 + ping a Neon (úsalo para readiness probe).

---

## 📑 Documentación relacionada

- `/home/ubuntu/hammer-pos-erp/DEPLOYMENT.md` – guía completa de despliegue de los dos proyectos.
- `/home/ubuntu/hammer-pos-erp/CHANGELOG.md` – historia del split y cambios entre versiones.
- `/home/ubuntu/designs/hammer_backend_frontend_separation_design.md` – diseño formal aprobado.
