# CHANGELOG — H.A.M.M.E.R. POS/ERP

Histórico de cambios entre el monolito original y la versión separada (`hammer-api` + `hammer-frontend`).

---

## [2.0.0] – Split Backend/Frontend  (2026-05-14)

### Resumen

Se separó el monolito Next.js `hammer-pos-production-feature-security-hardening-complete/` en **dos proyectos Vercel independientes** según el diseño aprobado en `/home/ubuntu/designs/hammer_backend_frontend_separation_design.md`:

- **`hammer-api/`** – Sólo Route Handlers + Prisma + Neon (sin páginas).
- **`hammer-frontend/`** – Sólo UI Next.js (sin DB, sin Prisma, sin iron-session).

> El monolito original **NO** se eliminó. Sigue íntegro como referencia en `hammer-pos-production-feature-security-hardening-complete/`.

---

### 🆕 Añadido

#### Proyecto `hammer-api`
- **2 endpoints nuevos** que exponen lógica que antes era SSR-only:
  - `GET /api/master/dashboard` → `getMasterDashboardSummary()` (`byBranch`, `alerts`) con `assertMaster()` guard.
  - `GET /api/branch/dashboard?role={SALES|CASHIER|WAREHOUSE|BRANCH_ADMIN}` → variantes de resumen por rol + `listPendingTransports()`.
- `vercel.json` con `region: gru1` y cron diario para `/api/cron/cleanup`.
- `next.config.ts` con `output: standalone` y `serverExternalPackages: ['@prisma/client']`.
- `src/app/health/route.ts` y `src/app/ready/route.ts` (readiness con ping a Neon).
- Driver Adapter Neon (`@prisma/adapter-neon`) en `src/lib/prisma.ts`.

#### Proyecto `hammer-frontend`
- **`src/lib/client/session.ts`** – Hook `useSession()` que llama `/api/auth/session` y devuelve un discriminated union `{status: 'loading'|'authenticated'|'unauthenticated'|'error', ...}`.
- **`src/lib/client/api.ts`** – Wrapper `apiFetch()` que añade `x-csrf-token` automáticamente (lee cookie `hammer-csrf`).
- **`src/types/auth.ts`** – `RoleCode` como **local string-union** (no depende de `@prisma/client`).
- **`next.config.ts`** – Rewrites `/api/*` → `${BACKEND_URL}/api/*` para mantener mismo-origen.
- `.env.example` con `BACKEND_URL`.
- `vercel.json` mínimo.

#### Documentación
- `hammer-api/README.md`
- `hammer-frontend/README.md`
- `/home/ubuntu/hammer-pos-erp/DEPLOYMENT.md` – Guía completa de despliegue de dos proyectos.
- `/home/ubuntu/hammer-pos-erp/CHANGELOG.md` (este archivo).

---

### 🔄 Cambiado

#### Páginas SSR → CSR (frontend)
Todas las páginas de `app/app/**` pasaron de Server Components (`getSessionContext()` server-side) a Client Components (`"use client"` + `useSession()`):

| Página | Cambio principal |
|---|---|
| `app/app/layout.tsx` | Guard de sesión client-side → redirect a `/login`. |
| `app/app/page.tsx` | `resolveRoleHome(session.session.user.roleCode)` + redirect. |
| `app/login/page.tsx` | Check de sesión en mount; redirige si ya está autenticado. |
| `app/app/owner/page.tsx` | `useSession()` + `<OwnerDashboard />`. |
| `app/app/owner/module-config/page.tsx` | Sólo guard – panel maneja datos vía `apiFetch`. |
| `app/app/master/page.tsx` | `apiFetch('/api/master/dashboard')` → renderiza KPIs. |
| `app/app/master/{users,analytics,expenses,approvals,cash-boxes,catalog/products,catalog/categories,reports,audit,timber,timber/catalog}/page.tsx` | Guard + componente cliente (que ya hace su fetch). |
| `app/app/master/timber/new/page.tsx` | `apiFetch('/api/catalog/categories')` y pasa a `<TimberForm>`. |
| `app/app/master/timber/[id]/edit/page.tsx` | `use(params)` (React 19) + `apiFetch('/api/timber/${id}')`. |
| `app/app/master/inventory/page.tsx` | `apiFetch('/api/branches')` + `apiFetch('/api/catalog/categories')`. |
| `app/app/master/sales/orders/page.tsx` | `apiFetch('/api/branches')` + `useSearchParams`. |
| `app/app/branch/page.tsx` | `apiFetch('/api/branch/dashboard?role=...')` + switch por rol. |
| `app/app/branch/{approvals,audit,reports,catalog/products}/page.tsx` | Guard + componente cliente. |
| `app/app/branch/{cashier/payments,warehouse/dispatch,sales/orders}/page.tsx` | `useSession()` para extraer `branchId`. |
| `app/app/branch/inventory/page.tsx` | `useSession()` + `apiFetch('/api/branches')` para matching. |

#### Módulos copiados (sólo los puros, sin Prisma)
Frontend incluye **únicamente** módulos que no tocan DB:

- `src/modules/rbac/policies.ts` – capability map (import de `RoleCode` local).
- `src/modules/rbac/role-routing.ts` – `resolveRoleHome`, etc. (sin cambios).
- `src/modules/timber/calculator.ts` – fórmulas geométricas puras.

> NO se copiaron `auth.ts`, `dashboard.ts`, `transport.ts`, `inventory/`, etc. (servidor-only).

#### Esquema Prisma
- Se importó el esquema **completo** (1249 líneas) que se generó en runtime en el monolito (a partir de `node_modules/.prisma/client/schema.prisma`). Incluye todos los modelos: `ReorderPolicy`, `ReorderAlert`, `ReorderBatch`, etc.

---

### 🗑️ Removido (sólo en `hammer-frontend`)

- Toda dependencia de `@prisma/client`, `prisma`, `iron-session`, `@neondatabase/serverless`.
- `src/lib/prisma.ts` (no existe en frontend).
- `src/lib/session/*` server-side.
- Todos los Server Components convertidos.

---

### ⚠️ Breaking changes

1. **Antes:** El frontend llamaba a las páginas SSR que cargaban datos directos vía Prisma.
   **Ahora:** Las páginas son CSR; cada una hace `apiFetch(...)` a un endpoint REST.
   → **Nuevos endpoints requeridos**: `/api/master/dashboard` y `/api/branch/dashboard?role=…` (añadidos en este release).

2. **Variables de entorno**: el frontend ya no necesita `DATABASE_URL` ni `AUTH_SESSION_SECRET`. Sólo `BACKEND_URL`.

3. **Cookies y CSRF**: Funciona sólo si el frontend hace los rewrites a `BACKEND_URL`. Si se sirve el frontend desde otro dominio sin rewrites, hay que configurar CORS + `SameSite=None` (no recomendado).

4. **Crons**: Se mueven 100 % a `hammer-api/vercel.json`.

---

### ✅ Verificación

- `hammer-api`: `tsc --noEmit` 0 errores; `next build` 76 routes generadas.
- `hammer-frontend`: `tsc --noEmit` 0 errores; `next build` 48 routes generadas.

---

## [1.x] – Monolito original

(Documentado en `hammer-pos-production-feature-security-hardening-complete/CHANGELOG.md` si existe.)
