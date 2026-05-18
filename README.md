# H.A.M.M.E.R. — POS / ERP

**H**erramienta de **A**dministración **M**ulti-sucursal, **M**ódulos **E**mpresariales y **R**egistro — Sistema de punto de venta y gestión empresarial diseñado para operaciones multi-sucursal con control granular de permisos y flujos de trabajo configurables por sucursal.

---

## Tabla de Contenidos

- [Arquitectura General](#arquitectura-general)
- [Stack Técnico](#stack-técnico)
- [Requisitos](#requisitos)
- [Instalación](#instalación)
- [Desarrollo](#desarrollo)
- [Producción](#producción)
- [Arquitectura de Seguridad](#arquitectura-de-seguridad)
- [Flujos de Trabajo POS](#flujos-de-trabajo-pos)
- [Transporte Automático Idempotente](#transporte-automático-idempotente)
- [Respuesta API Estándar](#respuesta-api-estándar)
- [Testing](#testing)
- [CI/CD](#cicd)
- [Estructura del Proyecto](#estructura-del-proyecto)

---

## Arquitectura General

H.A.M.M.E.R. sigue una arquitectura de **dos proyectos independientes** que se comunican vía API REST:

```
┌─────────────────────┐        REST API        ┌─────────────────────┐
│   hammer-frontend   │ ◄────────────────────► │     hammer-api      │
│   Next.js 15 (UI)   │    /api/* rewrites     │  Next.js 15 (API)   │
│   Puerto 3000       │                        │  Puerto 4000        │
│   TailwindCSS 4     │                        │  Prisma 6.19        │
│   React 19          │                        │  Zod 3.25           │
└─────────────────────┘                        └────────┬────────────┘
                                                        │
                                                        ▼
                                               ┌─────────────────┐
                                               │   PostgreSQL 15+ │
                                               └─────────────────┘
```

- **`hammer-frontend/`** — Interfaz de usuario (100% Client Components). No tiene acceso directo a la base de datos.
- **`hammer-api/`** — Backend API-only con Route Handlers, lógica de negocio, RBAC y Prisma ORM.
- **`.github/workflows/`** — Pipeline CI/CD con GitHub Actions.

---

## Stack Técnico

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Runtime | Node.js | 22 |
| Package Manager | npm | 11 |
| Lenguaje | TypeScript (strict) | 5.9.3 |
| Framework (ambos) | Next.js (App Router) | 15.5.18 |
| ORM | Prisma | 6.19.3 |
| Validación | Zod | 3.25.76 |
| Base de datos | PostgreSQL | 15+ |
| UI Framework | React | 19.1.0 |
| CSS | TailwindCSS | 4.1.18 |
| Iconos | lucide-react | 1.7.0 |
| Sesiones | iron-session | 8.x |
| DB Serverless | @neondatabase/serverless | 0.10.4 |

---

## Requisitos

- **Node.js** 22+ (< 23)
- **npm** 11+ (< 12)
- **PostgreSQL** 15+ (local o Neon para producción)

---

## Instalación

### 1. Clonar el repositorio

```bash
git clone <repo-url> hammer-project
cd hammer-project
```

### 2. Configurar variables de entorno

```bash
# Backend
cp hammer-api/.env.example hammer-api/.env
# Editar hammer-api/.env con tu DATABASE_URL y secretos

# Frontend
cp hammer-frontend/.env.example hammer-frontend/.env
# Editar hammer-frontend/.env con BACKEND_URL
```

**Variables críticas del backend** (`hammer-api/.env`):

| Variable | Descripción |
|----------|-------------|
| `DATABASE_URL` | Connection string PostgreSQL |
| `AUTH_SESSION_SECRET` | Secreto para firmar cookies (mín. 32 chars) |
| `CRON_SECRET` | Bearer token para cron jobs |

**Variables del frontend** (`hammer-frontend/.env`):

| Variable | Descripción |
|----------|-------------|
| `BACKEND_URL` | URL del backend (ej. `http://localhost:4000`) |

### 3. Instalar dependencias e inicializar

```bash
# Backend
cd hammer-api
npm install
npx prisma generate
npx prisma migrate deploy   # Aplica migraciones a PostgreSQL
npm run build

# Frontend
cd ../hammer-frontend
npm install
npm run build
```

### 4. Seed inicial (opcional)

```bash
cd hammer-api
npm run db:seed              # Crea usuario Owner, sucursal y caja por defecto
```

---

## Desarrollo

```bash
# Terminal 1 — Backend (puerto 4000)
cd hammer-api
npm run dev

# Terminal 2 — Frontend (puerto 3000)
cd hammer-frontend
npm run dev
```

El frontend reescribe todas las llamadas `/api/*` al backend mediante `next.config.ts`, manteniendo cookies y CSRF en same-origin.

### Comandos útiles

| Proyecto | Comando | Descripción |
|----------|---------|-------------|
| hammer-api | `npm run dev` | Servidor de desarrollo (puerto 4000) |
| hammer-api | `npm run build` | Build de producción |
| hammer-api | `npm run typecheck` | Verificar tipos TypeScript |
| hammer-api | `npm test` | Ejecutar 59 tests unitarios |
| hammer-api | `npx prisma studio` | UI visual de la base de datos |
| hammer-api | `npx prisma migrate dev` | Crear nueva migración |
| hammer-frontend | `npm run dev` | Servidor de desarrollo (puerto 3000) |
| hammer-frontend | `npm run build` | Build de producción |
| hammer-frontend | `npm run typecheck` | Verificar tipos TypeScript |

---

## Producción

### Despliegue en Vercel

Ambos proyectos se despliegan como proyectos Vercel independientes:

**Backend (`hammer-api`):**
1. Crear proyecto apuntando a `hammer-api/`
2. Build command: `npx prisma generate && next build`
3. Region recomendada: `gru1` (São Paulo)
4. Configurar variables de entorno de producción

**Frontend (`hammer-frontend`):**
1. Crear proyecto apuntando a `hammer-frontend/`
2. Build command: `next build`
3. Variable `BACKEND_URL` → URL del backend desplegado

### Health checks

```
GET /health  → 200 OK (proceso vivo)
GET /ready   → 200 OK + verificación de conexión a DB
```

---

## Arquitectura de Seguridad

H.A.M.M.E.R. implementa un sistema de seguridad en dos capas: **RBAC** (control de acceso por roles) y **Workflow Guards** (control de flujo por módulos habilitados).

### BranchRoleConfig — RBAC por Sucursal

Controla qué roles están habilitados en cada sucursal. Implementado en `hammer-api/src/modules/rbac/effective-permissions.ts`.

**Roles globales** (nunca se filtran):
- `SYSTEM_ADMIN` — Administrador del sistema
- `OWNER` — Propietario
- `MASTER` — Gerente general

**Roles de sucursal** (filtrables por `BranchRoleConfig`):
- `BRANCH_ADMIN` — Administrador de sucursal
- `SALES` — Vendedor
- `CASHIER` — Cajero
- `WAREHOUSE` — Bodeguero

**Funcionamiento:**
1. Al hacer login, `getEffectiveBranchMemberships()` filtra los roles según `BranchRoleConfig`
2. Solo los roles habilitados se incluyen en el token de sesión
3. Si no existe configuración para un branch+role → **habilitado por defecto** (compatibilidad)
4. Al actualizar la configuración, se incrementa `sessionVersion` forzando re-autenticación

**Funciones clave:**
```typescript
canUseBranchRole(session, branchId, roleCode)       // ¿Tiene este rol en esta sucursal?
canUseBranchCapability(session, branchId, capability) // ¿Tiene esta capacidad?
requireEffectiveBranchCapability(session, branchId, cap) // Lanza error si no tiene
getBranchIdsWithEffectiveCapability(session, cap)    // Sucursales donde tiene la capacidad
```

### BranchModuleConfig — Guards de Workflow

Controla los flujos de trabajo disponibles por sucursal con dos flags: `enableCashier` y `enableDispatch`. Implementado en `hammer-api/src/modules/workflow/branch-workflow.ts`.

| enableCashier | enableDispatch | Flujo | Descripción |
|:---:|:---:|---|---|
| ✅ | ✅ | **Completo** | Venta → Caja → Despacho → Transporte |
| ✅ | ❌ | **Sin despacho** | Venta → Caja → Entregado |
| ❌ | ✅ | **Sin caja** | Venta+Cobro directo → Despacho → Transporte |
| ❌ | ❌ | **Directo** | Venta+Cobro+Entrega inmediata |

**Acciones de workflow:**

| Acción | Requiere Caja | Requiere Despacho |
|--------|:---:|:---:|
| `SUBMIT_TO_CASHIER` | ✅ | — |
| `COLLECT_PAYMENT` | ✅ | — |
| `DIRECT_SALE` | ❌ (caja deshabilitada) | — |
| `MARK_DISPATCHED` | — | ✅ |
| `CREATE_TRANSPORT` | — | ✅ |
| `UPDATE_TRANSPORT_STATUS` | — | ✅ |
| `CREATE_DRAFT_ORDER` | — (siempre permitido) | — |
| `VIEW_DISPATCH` | — (siempre permitido) | — |

### Seguridad adicional

- **Autenticación**: Cookies firmadas `httpOnly + secure + sameSite=lax` (iron-session)
- **CSRF**: Double-submit token en header `x-csrf-token` para métodos no-GET
- **Hashing**: PBKDF2 con 600k iteraciones, salt 32 bytes, SHA-512
- **Rate limiting**: In-memory con backoff exponencial en `/api/auth/login`
- **Auditoría**: Todas las mutaciones se registran en `AuditLog`
- **Security Headers**: HSTS, X-Content-Type-Options, X-Frame-Options, CSP, etc.

---

## Flujos de Trabajo POS

### Flujo Con Caja (`enableCashier = true`)

```
Vendedor                    Cajero                  Bodeguero
   │                          │                        │
   ├─ Crear borrador ─────────┤                        │
   │  POST /api/sales/orders  │                        │
   │                          │                        │
   ├─ Enviar a caja ──────────┤                        │
   │  POST /api/sales/        │                        │
   │  orders/:id/submit       │                        │
   │                          │                        │
   │                    Cobrar pago                     │
   │                    POST /api/cashier/payments      │
   │                          │                        │
   │                          │     Despachar (si habilitado)
   │                          │     POST /api/warehouse/
   │                          │     dispatch/:id/dispatch
   │                          │                        │
   │                          │     Transporte auto ───┤
   │                          │     (si aplica)        │
```

### Flujo Sin Caja (`enableCashier = false`)

```
Vendedor
   │
   ├─ Crear borrador
   │  POST /api/sales/orders
   │
   ├─ Venta directa (cobra y despacha en un paso)
   │  POST /api/sales/orders/:id/direct-sale
   │
   └─ Transporte automático (si aplica)
```

---

## Transporte Automático Idempotente

El servicio de transporte se crea automáticamente cuando se cumplen estas condiciones:

1. La orden tiene `requiresTransport = true`
2. El campo `transportAmount` es mayor a 0

La función `ensureTransportServiceForOrderTx()` verifica si ya existe un servicio de transporte antes de crear uno nuevo, garantizando idempotencia. Se invoca automáticamente:
- Después del cobro en caja (`payments/service.ts`)
- Después de una venta directa (`sales/service.ts`)

**Transiciones de estado del transporte:**

```
PENDING ──► IN_TRANSIT ──► DELIVERED (terminal)
   │             │
   └─► CANCELLED ◄─┘     (terminal)
```

---

## Respuesta API Estándar

Todas las rutas siguen el mismo formato:

```typescript
// Éxito (200 | 201)
{
  "ok": true,
  "data": { /* payload tipado */ }
}

// Error (4xx | 5xx)
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Descripción legible del error",
    "details": { /* opcional — detalles de validación Zod, etc. */ }
  }
}
```

Consulta [`API_CONTRACT.md`](./API_CONTRACT.md) para la lista completa de endpoints, códigos de error y ejemplos.

---

## Testing

El backend cuenta con **59 tests unitarios** que cubren los módulos críticos:

```bash
cd hammer-api
npm test
```

**Archivos de test:**

| Archivo | Cobertura |
|---------|-----------|
| `src/modules/dashboard/access.test.ts` | Control de acceso al dashboard |
| `src/modules/rbac/effective-permissions.test.ts` | RBAC: roles, capacidades, permisos efectivos |
| `src/modules/workflow/branch-workflow.test.ts` | Workflow guards: caja y despacho |
| `src/modules/transport/validators.test.ts` | Validación Zod de transporte y transiciones |
| `src/lib/api/errors.test.ts` | Mapeo de errores a respuestas HTTP estándar |

Los tests usan `node:test` y `node:assert/strict` (sin frameworks externos).

---

## CI/CD

El pipeline de GitHub Actions (`.github/workflows/ci.yml`) se ejecuta en cada push y PR a `main` y `develop`:

### Backend (`hammer-api`)
1. ✅ `npm ci` — Instalar dependencias
2. ✅ `npx prisma validate` — Validar schema
3. ✅ `npx prisma generate` — Generar Prisma Client
4. ✅ `npm run typecheck` — Verificación TypeScript
5. ✅ `npm test` — 59 tests unitarios
6. ✅ `npm run build` — Build de producción

### Frontend (`hammer-frontend`)
1. ✅ `npm ci` — Instalar dependencias
2. ✅ `npm run typecheck` — Verificación TypeScript
3. ✅ `npm run build` — Build de producción

**Control de concurrencia:** Solo un CI por rama a la vez (`cancel-in-progress: true`).

---

## Estructura del Proyecto

```
hammer-project/
├── README.md                          # ← Este archivo
├── API_CONTRACT.md                    # Contrato API: endpoints, errores, ejemplos
│
├── hammer-api/                        # Backend — API REST
│   ├── prisma/
│   │   ├── schema.prisma             # Schema completo (1254 líneas)
│   │   └── migrations/               # Migraciones PostgreSQL
│   ├── src/
│   │   ├── app/api/                  # ~90 Route Handlers
│   │   │   ├── auth/                 # Login, logout, sesión, CSRF
│   │   │   ├── sales/                # Órdenes de venta
│   │   │   ├── cashier/              # Caja, pagos, sesiones de caja
│   │   │   ├── warehouse/            # Despacho
│   │   │   ├── transport/            # Servicios de transporte
│   │   │   ├── catalog/              # Productos y categorías
│   │   │   ├── inventory/            # Inventario y ajustes
│   │   │   ├── master/               # Panel maestro (dashboard, reorder, etc.)
│   │   │   ├── branch-config/        # Configuración de módulos por sucursal
│   │   │   ├── system-admin/         # Configuración de roles (RBAC)
│   │   │   ├── reports/              # Reportes
│   │   │   ├── ai-insights/          # Análisis inteligente
│   │   │   └── ...                   # Más módulos
│   │   ├── modules/                  # Lógica de negocio (30 módulos)
│   │   │   ├── rbac/                 # RBAC y permisos efectivos
│   │   │   ├── workflow/             # Guards de workflow por sucursal
│   │   │   ├── auth/                 # Autenticación y sesión
│   │   │   ├── sales/                # Lógica de ventas
│   │   │   ├── payments/             # Lógica de pagos
│   │   │   ├── transport/            # Lógica de transporte
│   │   │   ├── ai-insights/          # Motor de análisis inteligente
│   │   │   └── ...                   # Más módulos
│   │   ├── lib/                      # Utilidades (Prisma, API helpers, seguridad)
│   │   └── types/                    # Tipos TypeScript compartidos
│   ├── package.json
│   └── .env.example
│
├── hammer-frontend/                   # Frontend — UI
│   ├── src/
│   │   ├── app/                      # Páginas (App Router)
│   │   │   └── app/                  # Rutas autenticadas
│   │   │       ├── owner/            # Panel del propietario
│   │   │       ├── master/           # Panel maestro
│   │   │       ├── branch/           # Panel de sucursal (ventas, caja, etc.)
│   │   │       └── system-admin/     # Panel de administrador
│   │   ├── components/               # ~40 componentes React
│   │   │   ├── pos/                  # Punto de venta (flujo dual)
│   │   │   ├── payments/             # Pagos y caja
│   │   │   ├── dispatch/             # Despacho
│   │   │   ├── inventory/            # Inventario
│   │   │   ├── catalog/              # Catálogo de productos
│   │   │   ├── ui/                   # Componentes base (Button, Card, etc.)
│   │   │   └── ...                   # Más componentes
│   │   ├── lib/                      # Utilidades cliente (API fetch, sesión)
│   │   ├── modules/                  # Módulos puros (RBAC policies, calculadora)
│   │   └── types/                    # Tipos TypeScript
│   ├── package.json
│   └── .env.example
│
└── .github/
    └── workflows/
        └── ci.yml                    # Pipeline CI/CD
```

---

## Changelog — v1.1.0 (2026-05-18) — Corrección de Flujos de Negocio

### Fase 3 — Transporte
- Modal de confirmación de transporte antes del pago (POS frontend).
- Validación cruzada backend: `requiresTransport=true` exige `transportAmount > 0`.
- Restricción `@@unique([saleOrderId])` en `TransportService` para evitar duplicados.

### Fase 4 — Sesión de Caja Activa
- Endpoint `GET /api/cashier/cash-sessions/active` ahora requiere `?branchId=...`.
- Frontend POS envía `branchId` al consultar sesión activa.

### Fase 5 — Órdenes de Compra
- **Aprobar** ya no crea inventario. Solo cambia status a APPROVED.
- Nuevo endpoint `POST /api/master/purchase-orders/:id/receive` crea movimientos PURCHASE_IN.
- Cancelar acepta DRAFT o APPROVED (no RECEIVED).

### Fase 6 — Transferencias
- **Aprobar** ya no mueve inventario. Solo marca APPROVED.
- Nuevo endpoint `POST /api/master/transfers/:id/dispatch` — valida stock, crea TRANSFER_OUT, marca IN_TRANSIT.
- Nuevo endpoint `POST /api/master/transfers/:id/receive` — crea TRANSFER_IN en destino, marca RECEIVED o PARTIALLY_RECEIVED.
- Cancelar acepta DRAFT/REQUESTED/APPROVED (no IN_TRANSIT ni RECEIVED).

### Fase 7 — Reorden
- Verificado: conversiones de alertas a PO/Transferencia crean documentos en DRAFT (default de schema).

### Fase 8 — Control de Acceso en Despacho
- Endpoints `dispatch/pending` y `dispatch/history` ahora filtran por sucursales asignadas al usuario.
- Usa `requireBranchCapability` / `getBranchIdsWithCapability` para acceso granular.

### Fase 9 — Respuestas Estandarizadas
- Rutas nuevas y modificadas usan `ok()` / `fail()` + `toApiErrorResponse()`.
- Nuevos códigos de error: `PURCHASE_ORDER_ALREADY_RECEIVED`, `TRANSPORT_ALREADY_EXISTS`, `INVALID_TRANSPORT_AMOUNT`, etc.

### Migración de Base de Datos
- `PurchaseOrder`: campos `approvedByUserId`, `approvedAt`, `receivedByUserId`, `receivedAt`.
- `Transfer`: campos `dispatchedByUserId`, `receivedByUserId`.
- `TransportService`: unique constraint en `saleOrderId`.
- Archivo: `prisma/migrations/20260518100000_phase2_to_phase6_schema_updates/migration.sql`

---

## Licencia

Proyecto privado — todos los derechos reservados.
