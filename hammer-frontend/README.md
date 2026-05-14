# hammer-frontend — Frontend H.A.M.M.E.R. POS/ERP

Cliente web (Next.js App Router – sólo UI) que consume la API REST de **`hammer-api`**. Está pensado para desplegarse como **proyecto independiente** en Vercel.

> **Diseño:** ver `/home/ubuntu/designs/hammer_backend_frontend_separation_design.md`.

---

## 🚀 Stack

- **Next.js 15.5.x** (App Router – todas las páginas son Client Components, `"use client"`)
- **React 19**
- **TailwindCSS 4** (con `@tailwindcss/postcss`)
- **lucide-react** (iconos)
- **TypeScript estricto**
- **0 dependencias de servidor** (sin Prisma, sin iron-session, sin DB).
- Runtime: **Node.js 22** (Vercel)

---

## 📁 Estructura

```
hammer-frontend/
├── public/
├── src/
│   ├── app/
│   │   ├── app/              # Rutas autenticadas (CSR)
│   │   │   ├── layout.tsx    # Guard de sesión → /api/auth/session
│   │   │   ├── owner/
│   │   │   ├── master/
│   │   │   ├── branch/
│   │   │   └── system-admin/
│   │   ├── login/
│   │   ├── forbidden/
│   │   ├── unauthorized/
│   │   ├── health/
│   │   └── layout.tsx        # Root layout
│   ├── components/           # 40 componentes UI (POS, inventario, RBAC, etc.)
│   ├── lib/
│   │   ├── client/
│   │   │   ├── api.ts        # apiFetch() — wrapper CSRF + cookies
│   │   │   └── session.ts    # useSession() hook
│   │   ├── pos-ui.ts
│   │   ├── role-colors.ts
│   │   ├── telemetry.ts      # métricas POS client-side
│   │   ├── http/             # helpers fetch
│   │   └── realtime/         # SSE / WebSocket helpers
│   ├── modules/              # Sólo módulos puros copiados del backend
│   │   ├── rbac/
│   │   │   ├── policies.ts   # Mapa de capabilities → roles (sin Prisma)
│   │   │   └── role-routing.ts
│   │   └── timber/
│   │       └── calculator.ts # Pure-function (sin Prisma)
│   ├── types/
│   │   └── auth.ts           # RoleCode = local string union (sin @prisma/client)
│   └── middleware.ts         # 0 lógica – sólo headers
├── next.config.ts             # Rewrites `/api/* → BACKEND_URL/api/*`
├── vercel.json
├── tsconfig.json
└── package.json
```

---

## ⚙️  Variables de entorno

Ver `.env.example`.

| Variable | Obligatoria | Descripción |
|---|---|---|
| `BACKEND_URL` | ✅ | URL del proyecto `hammer-api` (ej. `https://hammer-api.vercel.app`). Usada por `next.config.ts` para rewrites server-side. |
| `NEXT_PUBLIC_BACKEND_URL` | opcional | Por si algún componente lo necesita (no recomendado – usa rewrites). |

> **NO** definir `DATABASE_URL`, `SESSION_PASSWORD`, etc. El frontend NUNCA toca la DB.

---

## 🔁 Rewrites (cookie + CSRF same-origin)

`next.config.ts` reescribe **todas las llamadas** `/api/*` al backend, manteniendo el mismo origen del navegador. Esto permite:

1. **Cookies de sesión funcionan** (no se necesita `withCredentials: 'include'` cross-origin).
2. **CSRF double-submit funciona** (las cookies CSRF se setean same-origin).
3. **Sin CORS** (no hay preflights ni headers extra).

```ts
// next.config.ts
async rewrites() {
  return [
    { source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` },
  ];
}
```

---

## 🔐 Autenticación – flujo client-side

1. **Boot:** todas las páginas bajo `/app/*` se montan en cliente y llaman a `useSession()` (que hace `fetch('/api/auth/session')`).
2. **Login:** `LoginForm` hace `POST /api/auth/login` con `username + password`. Si OK, el backend set-ea la cookie `iron-session`. El frontend redirige según `RoleCode`.
3. **Logout:** `POST /api/auth/logout` (con CSRF). El backend invalida la sesión.
4. **CSRF:** `apiFetch()` lee la cookie `hammer-csrf` y añade `x-csrf-token` en los métodos no-GET.

### `useSession()` (en `lib/client/session.ts`)

```ts
const session = useSession();
// session: { status: "loading" } | { status: "authenticated", session: SessionPayload } | { status: "unauthenticated" } | { status: "error", error: Error }
```

---

## 🧠 Pages SSR → CSR

Las páginas del monolito hacían `getSessionContext()` server-side y luego pasaban datos a un Client Component. En este frontend:

- **Patrón único:** `'use client'` + `useSession()` + `apiFetch()`.
- Si la sesión es `loading`: renderiza un placeholder.
- Si es `unauthenticated`: redirige a `/login` con `router.replace`.
- Si es `authenticated`: hace `apiFetch(...)` a los endpoints que necesite (incluidos los nuevos `/api/master/dashboard` y `/api/branch/dashboard?role=...`).

---

## 🛠️  Comandos

```bash
# Instalación (Node 22 / npm 11)
npm install --legacy-peer-deps

# Comprobar tipos
npm run typecheck

# Build
BACKEND_URL=https://hammer-api.vercel.app npm run build

# Dev local (apuntando al backend local)
BACKEND_URL=http://localhost:4000 npm run dev
```

---

## 🌐 Despliegue en Vercel

1. Crear nuevo proyecto Vercel apuntando a la carpeta `hammer-frontend/`.
2. Variables de entorno:
   - `BACKEND_URL` → URL del backend Vercel (p. ej. `https://hammer-api.vercel.app`).
3. Build command: `next build`.
4. Output: standalone (configurado en `next.config.ts`).
5. Region: cualquiera (CDN). Sugerencia: `gru1` (proximidad backend).

> **No hay crons en el frontend**. Todo el cron job está en `hammer-api`.

---

## 📑 Documentación relacionada

- `/home/ubuntu/hammer-pos-erp/hammer-api/README.md` – backend.
- `/home/ubuntu/hammer-pos-erp/DEPLOYMENT.md` – guía completa.
- `/home/ubuntu/hammer-pos-erp/CHANGELOG.md` – cambios.
