# hammer-frontend — Frontend H.A.M.M.E.R. POS/ERP

Cliente web construido con Next.js App Router que consume la API REST de `hammer-api`. Todas las páginas son Client Components (`"use client"`) — no tiene acceso directo a la base de datos. Se despliega como proyecto independiente.

---

## Stack

| Tecnología | Versión | Propósito |
|-----------|---------|-----------|
| Next.js | 15.5.18 | App Router (Client Components) |
| React | 19.1.0 | UI |
| TailwindCSS | 4.1.18 | Estilos |
| lucide-react | 1.7.0 | Iconos |
| TypeScript | 5.9.3 | Strict mode |
| Node.js | 22 | Runtime |

> **Sin dependencias de servidor.** No usa Prisma ni acceso directo a DB.

---

## Variables de Entorno

Copiar `.env.example` a `.env` y configurar:

| Variable | Obligatoria | Descripción |
|----------|:-----------:|-------------|
| `BACKEND_URL` | ✅ | URL del backend (ej. `http://localhost:4000` en dev, `https://hammer-api.vercel.app` en prod) |
| `NEXT_PUBLIC_SITE_URL` | — | URL pública del sitio (para metadata y canonical links) |

> **No definir** `DATABASE_URL`, `SESSION_PASSWORD` ni secretos de backend. El frontend nunca toca la DB.

---

## Comandos

```bash
# Instalar dependencias
npm install

# Servidor de desarrollo (puerto 3000)
npm run dev

# Verificar tipos TypeScript
npm run typecheck

# Build de producción
BACKEND_URL=https://hammer-api.vercel.app npm run build

# Iniciar servidor de producción
npm start

# Auditoría de seguridad
npm run security:audit
```

---

## Cómo Funciona la Comunicación con el Backend

### Rewrites (same-origin)

`next.config.ts` reescribe todas las llamadas `/api/*` al backend:

```typescript
// next.config.ts
async rewrites() {
  return [
    { source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` },
  ];
}
```

Esto permite:
- **Cookies de sesión** funcionan sin `withCredentials` cross-origin
- **CSRF double-submit** funciona en same-origin
- **Sin CORS** — no hay preflights ni configuración extra

### Flujo de Autenticación

1. **Login:** `POST /api/auth/login` → backend setea cookie de sesión firmada
2. **Sesión:** `useSession()` hace `GET /api/auth/session` para obtener el estado
3. **CSRF:** `apiFetch()` obtiene token desde `/api/auth/csrf`, lo cachea y lo envía como `x-csrf-token`
4. **Logout:** `POST /api/auth/logout` → backend invalida sesión

### `useSession()` hook

```typescript
const session = useSession();
// Posibles estados:
// { status: "loading" }
// { status: "authenticated", session: SessionPayload }
// { status: "unauthenticated" }
// { status: "error", error: Error }
```

### `apiFetch()` wrapper

Todas las llamadas a la API usan `apiFetch()` que automáticamente:
- Obtiene y cachea el token CSRF
- Adjunta `x-csrf-token` en métodos no-GET
- Envía cookies de sesión
- Parsea la respuesta `{ ok, data }` o `{ ok, error }`

---

## Estructura de Componentes

```
src/
├── app/
│   ├── login/                         # Página de login
│   ├── forbidden/                     # Página 403
│   ├── unauthorized/                  # Página 401
│   ├── health/                        # Health check del frontend
│   └── app/                           # ★ Rutas autenticadas
│       ├── layout.tsx                 # Guard de sesión (redirige si no autenticado)
│       ├── owner/
│       │   └── module-config/         # Configuración de módulos por sucursal
│       ├── master/
│       │   ├── ai-insights/           # Panel de análisis inteligente
│       │   ├── analytics/             # Analytics y ABC-XYZ
│       │   ├── catalog/               # Catálogo maestro (productos, categorías)
│       │   ├── inventory/             # Inventario global
│       │   ├── sales/                 # Ventas multi-sucursal
│       │   ├── purchase-orders/       # Órdenes de compra
│       │   ├── transfers/             # Transferencias entre sucursales
│       │   ├── reorder/               # Reorden automático
│       │   ├── users/                 # Gestión de usuarios
│       │   ├── discounts/             # Descuentos
│       │   ├── cash-boxes/            # Administración de cajas
│       │   ├── employees/             # Empleados
│       │   ├── expenses/              # Gastos
│       │   ├── timber/                # Módulo de madera
│       │   ├── reports/               # Reportes
│       │   ├── approvals/             # Aprobaciones
│       │   ├── audit/                 # Auditoría
│       │   └── cash-closure-reports/  # Reportes de cierre de caja
│       ├── branch/
│       │   ├── sales/                 # POS — Punto de venta
│       │   ├── cashier/               # Caja y pagos
│       │   ├── warehouse/             # Despacho
│       │   ├── catalog/               # Catálogo de sucursal
│       │   ├── inventory/             # Inventario de sucursal
│       │   ├── reports/               # Reportes de sucursal
│       │   ├── approvals/             # Aprobaciones de sucursal
│       │   └── audit/                 # Auditoría de sucursal
│       ├── system-admin/
│       │   ├── role-config/           # Configuración RBAC
│       │   └── settings/              # Settings del sistema
│       └── change-password/           # Cambio de contraseña
│
├── components/                        # ~40 componentes React
│   ├── pos/
│   │   ├── branch-pos.tsx            # ★ POS con flujo dual (con/sin caja)
│   │   └── PosShellWrapper.tsx       # Wrapper del shell POS
│   ├── payments/
│   │   └── cashier-payments.tsx      # Panel de pagos del cajero
│   ├── dispatch/
│   │   └── dispatch-workspace.tsx    # Workspace de despacho
│   ├── catalog/
│   │   ├── products-admin.tsx        # Admin de productos
│   │   ├── products-viewer.tsx       # Visor de productos
│   │   └── categories-admin.tsx      # Admin de categorías
│   ├── inventory/
│   │   ├── inventory-admin.tsx       # Admin de inventario
│   │   └── inventory-import-admin.tsx # Importación de inventario
│   ├── sales/
│   │   └── orders-admin.tsx          # Admin de órdenes
│   ├── dashboard/
│   │   ├── kpi-card.tsx              # Tarjeta KPI
│   │   └── role-summary.tsx          # Resumen por rol
│   ├── owner/
│   │   ├── branch-module-config.tsx  # Config de módulos (Owner)
│   │   └── owner-dashboard.tsx       # Dashboard del Owner
│   ├── users/
│   │   └── users-admin.tsx           # Admin de usuarios
│   ├── navigation/
│   │   ├── app-sidebar.tsx           # Sidebar principal
│   │   └── app-role-nav.tsx          # Navegación por rol
│   ├── layout/
│   │   ├── app-shell-router.tsx      # Shell de la aplicación
│   │   ├── app-footer.tsx            # Footer
│   │   └── breadcrumbs.tsx           # Breadcrumbs
│   ├── reports/
│   │   └── reports-hub.tsx           # Hub de reportes
│   ├── analytics/
│   │   └── analytics-dashboard.tsx   # Dashboard de analytics
│   ├── cash-session/
│   │   └── cash-session-panel.tsx    # Panel de sesión de caja
│   ├── cash-boxes/
│   │   └── master-cash-boxes.tsx     # Admin de cajas
│   ├── expenses/
│   │   └── expense-manager.tsx       # Gestión de gastos
│   ├── payroll/
│   │   └── employee-manager.tsx      # Gestión de empleados
│   ├── approvals/
│   │   └── approvals-queue.tsx       # Cola de aprobaciones
│   ├── audit/
│   │   └── audit-log-viewer.tsx      # Visor de auditoría
│   ├── timber/                        # Componentes de madera
│   ├── login-form.tsx                # Formulario de login
│   └── ui/                            # Componentes base
│       ├── button.tsx
│       ├── card.tsx
│       ├── input.tsx
│       ├── table.tsx
│       ├── badge.tsx
│       ├── role-badge.tsx
│       └── toast.tsx
│
├── lib/
│   ├── client/
│   │   ├── api.ts                    # apiFetch() — wrapper CSRF + cookies
│   │   └── session.ts               # useSession() hook
│   ├── http/                          # Helpers fetch
│   ├── realtime/                      # SSE / WebSocket helpers
│   ├── pos-ui.ts                     # Helpers UI del POS
│   ├── role-colors.ts                # Colores por rol
│   └── telemetry.ts                  # Métricas POS client-side
│
├── modules/                           # Módulos puros (sin dependencias de servidor)
│   ├── rbac/
│   │   ├── policies.ts              # Capabilities → roles (sin Prisma)
│   │   └── role-routing.ts          # Routing basado en rol
│   └── timber/
│       └── calculator.ts            # Calculadora de madera (función pura)
│
├── types/
│   └── auth.ts                       # RoleCode (string union, sin @prisma/client)
│
└── styles/                            # Estilos globales
```

---

## Patrón de Páginas

Todas las páginas siguen el mismo patrón CSR:

```typescript
"use client";

export default function MiPagina() {
  const session = useSession();

  if (session.status === "loading") return <Placeholder />;
  if (session.status === "unauthenticated") {
    router.replace("/login");
    return null;
  }

  // Fetch data con apiFetch() y renderizar
}
```

---

## Despliegue en Vercel

1. Crear proyecto Vercel apuntando a `hammer-frontend/`
2. Variable de entorno: `BACKEND_URL` → URL del backend
3. Build command: `next build`
4. Output: standalone
5. Region sugerida: `gru1` (proximidad al backend)

> No hay cron jobs en el frontend. Todo está en `hammer-api`.
