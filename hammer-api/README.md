# hammer-api — Backend H.A.M.M.E.R. POS/ERP

Backend API-only construido con Next.js Route Handlers, Prisma ORM y PostgreSQL. Expone la API REST completa del sistema POS/ERP, incluyendo lógica de negocio, RBAC, workflow guards y cron jobs. Se despliega como proyecto independiente.

---

## Stack

| Tecnología | Versión | Propósito |
|-----------|---------|-----------|
| Next.js | 15.5.18 | App Router (solo Route Handlers, sin páginas UI) |
| Prisma | 6.19.3 | ORM + migraciones |
| @prisma/adapter-neon | 6.19.3 | Driver serverless para Neon (producción) |
| Zod | 3.25.76 | Validación de request bodies |
| TypeScript | 5.9.3 | Strict mode |
| Node.js | 22 | Runtime |

---

## Variables de Entorno

Copiar `.env.example` a `.env` y configurar:

### Obligatorias

| Variable | Descripción |
|----------|-------------|
| `DATABASE_URL` | Connection string PostgreSQL (pooled para Neon, directa para local) |
| `DIRECT_URL` | Conexión directa (no pooled) para `prisma migrate` |
| `AUTH_SESSION_SECRET` | Secreto para firmar cookies — mín. 32 chars (`openssl rand -hex 32`) |

### Producción

| Variable | Descripción |
|----------|-------------|
| `CRON_SECRET` | Bearer token para autenticar cron jobs de Vercel |
| `PRISMA_USE_NEON_ADAPTER` | `"true"` para usar driver serverless de Neon |

### Opcionales

| Variable | Descripción |
|----------|-------------|
| `NODE_ENV` | `development` \| `production` |
| `AUTH_SESSION_TTL_HOURS` | TTL de sesión en horas (default: 12) |
| `ENABLE_CASH_CLOSURE_SCHEDULER` | Habilitar cierre automático de caja |
| `MASTER_INITIAL_USERNAME` | Username del master (default: `master`) |
| `MASTER_INITIAL_PASSWORD` | Password del master (REQUERIDA en producción; dev: `ElChele1234!`) |
| `BOOTSTRAP_BRANCH_CODE` | Código de sucursal inicial (default: `MGA`) |
| `BOOTSTRAP_BRANCH_NAME` | Nombre de sucursal inicial (default: `Managua Central`) |
| `BOOTSTRAP_CREATE_CASH_BOX` | Crear caja física en seed (default: `true`) |
| `RESET_MASTER_PASSWORD` | Si `true`, resetea password del master en próximo seed |

---

## Comandos

```bash
# Instalar dependencias
npm install

# Generar Prisma Client
npx prisma generate

# Aplicar migraciones a la base de datos
npx prisma migrate deploy

# Verificar tipos TypeScript
npm run typecheck

# Build de producción
npm run build

# Servidor de desarrollo (puerto 4000)
npm run dev

# Ejecutar tests (59 tests unitarios)
npm test

# Seed inicial (crear Owner + sucursal + caja)
npm run db:seed

# UI visual de la base de datos
npx prisma studio

# Crear nueva migración
npx prisma migrate dev --name <nombre>

# Auditoría de seguridad
npm run security:audit
```

---

## Estructura de Módulos

```
src/
├── app/
│   ├── api/                       # ~90 Route Handlers
│   │   ├── auth/                  # Login, logout, sesión, CSRF, cambio de password
│   │   ├── sales/orders/          # CRUD de órdenes + submit + direct-sale
│   │   ├── cashier/               # Cajas, sesiones de caja, pagos
│   │   ├── warehouse/dispatch/    # Despacho: pending, history, mark dispatched
│   │   ├── transport/             # Servicios de transporte: CRUD + status
│   │   ├── catalog/               # Productos y categorías
│   │   ├── inventory/             # Balances, movimientos, ajustes
│   │   ├── branch-config/         # Configuración de módulos por sucursal
│   │   ├── system-admin/          # Configuración RBAC + settings
│   │   ├── master/                # Panel maestro
│   │   │   ├── dashboard/         # Resumen multi-sucursal
│   │   │   ├── reorder/           # Políticas, evaluación, alertas, lotes
│   │   │   ├── purchase-orders/   # Órdenes de compra
│   │   │   ├── transfers/         # Transferencias entre sucursales
│   │   │   ├── users/             # Gestión de usuarios y membresías
│   │   │   ├── discounts/         # Descuentos
│   │   │   ├── cash-boxes/        # Administración de cajas
│   │   │   ├── catalog/           # Catálogo maestro
│   │   │   ├── inventory/         # Importación de inventario
│   │   │   └── analytics/         # Clasificación ABC-XYZ
│   │   ├── branch/dashboard/      # Dashboard por sucursal y rol
│   │   ├── ai-insights/           # Análisis inteligente (anomalías, patrones, etc.)
│   │   ├── reports/               # Reportes (ventas, pagos, auditoría, etc.)
│   │   ├── expenses/              # Gastos
│   │   ├── employees/             # Empleados
│   │   ├── payroll/               # Nómina
│   │   ├── pricing/               # Precios dinámicos
│   │   ├── timber/                # Módulo de madera
│   │   ├── approvals/             # Aprobaciones
│   │   ├── audit/                 # Log de auditoría
│   │   ├── cash-closure/          # Cierre de caja
│   │   ├── cron/                  # Jobs programados
│   │   └── branches/              # Listado de sucursales
│   ├── health/                    # GET /health → 200 OK
│   └── ready/                     # GET /ready → 200 + DB check
│
├── modules/                       # 30 módulos de lógica de negocio
│   ├── rbac/
│   │   ├── effective-permissions.ts   # ★ Puerta de permisos real (BranchRoleConfig)
│   │   ├── guards.ts                 # Guards HTTP delegados a effective-permissions
│   │   ├── policies.ts               # Mapa de capabilities → roles
│   │   ├── permissions.ts            # Definición de permisos
│   │   └── role-routing.ts           # Routing por rol
│   ├── workflow/
│   │   └── branch-workflow.ts        # ★ Guards de workflow (BranchModuleConfig)
│   ├── auth/                          # Login, sesión, passwords
│   ├── sales/                         # Órdenes, totales, validadores
│   ├── payments/                      # Pagos + transporte auto post-pago
│   ├── transport/                     # Transporte idempotente + validadores
│   ├── branch-config/                 # Servicio BranchModuleConfig
│   ├── system-admin/                  # BranchRoleConfig + session version
│   ├── dashboard/                     # Lógica de dashboards
│   ├── dispatch/                      # Despacho + políticas
│   ├── inventory/                     # Inventario + WAC + importación
│   ├── catalog/                       # Catálogo de productos
│   ├── reorder/                       # Motor de reorden automático
│   ├── ai-insights/                   # Motor de análisis inteligente
│   ├── analytics/                     # ABC-XYZ, pricing dinámico
│   ├── cash-session/                  # Sesiones de caja
│   ├── cash-closure/                  # Cierre de caja
│   ├── reports/                       # Generación de reportes
│   ├── security/                      # CSRF, rate-limit, token revocation
│   ├── audit/                         # Auditoría
│   ├── discounts/                     # Descuentos
│   ├── purchase-orders/               # Órdenes de compra
│   ├── transfers/                     # Transferencias
│   ├── users/                         # Usuarios y validadores
│   ├── approvals/                     # Flujo de aprobaciones
│   ├── pricing/                       # Precios y cálculos
│   ├── payroll/                       # Nómina
│   ├── timber/                        # Módulo de madera
│   ├── expenses/                      # (implícito en routes)
│   └── shared/                        # Validadores compartidos
│
├── lib/
│   ├── api/
│   │   ├── errors.ts                 # Mapeo centralizado de errores → HTTP responses
│   │   └── response.ts               # Helpers ok(), created(), fail()
│   ├── http/                          # Helpers HTTP
│   └── prisma.ts                      # Instancia Prisma singleton
│
├── types/                             # Tipos TypeScript compartidos
│   └── auth.ts                        # SessionPayload, BranchMembership, RoleCode
│
└── middleware.ts                      # CSRF + autenticación global
```

---

## Seguridad

| Mecanismo | Implementación |
|-----------|---------------|
| Autenticación | Cookies `httpOnly + secure + sameSite=lax` firmadas con HMAC-SHA256 |
| RBAC | 2 niveles: roles globales + roles por sucursal filtrados via `BranchRoleConfig` |
| CSRF | Double-submit token (`x-csrf-token` header vs cookie) en métodos no-GET |
| Hashing | PBKDF2, 600k iteraciones, salt 32 bytes, SHA-512 |
| Rate Limit | In-memory con backoff exponencial en login |
| Auditoría | Todas las mutaciones → `AuditLog` (actor, acción, IP, UA, snapshot) |
| Headers | HSTS, X-Content-Type-Options, X-Frame-Options, CSP, Referrer-Policy |

---

## Testing

```bash
npm test   # Ejecuta 59 tests unitarios
```

| Archivo de test | Qué valida |
|----------------|------------|
| `modules/dashboard/access.test.ts` | Control de acceso al dashboard por rol |
| `modules/rbac/effective-permissions.test.ts` | RBAC: roles, capacidades, permisos efectivos |
| `modules/workflow/branch-workflow.test.ts` | Workflow guards: acciones por configuración de módulos |
| `modules/transport/validators.test.ts` | Schemas Zod de transporte + transiciones de estado |
| `lib/api/errors.test.ts` | Mapeo de errores a respuestas HTTP estándar |

**Framework de testing:** `node:test` + `node:assert/strict` (nativo, sin dependencias externas).

---

## Despliegue en Vercel

1. Crear proyecto Vercel apuntando a `hammer-api/`
2. Configurar variables de entorno (ver tabla arriba)
3. Build command: `npx prisma generate && next build`
4. Region: `gru1` (São Paulo — proximidad a Neon `aws-sa-east-1`)
5. Output: standalone (configurado en `next.config.ts`)

### Cron job

Definido en `vercel.json`: `GET /api/cron/cleanup` cada día a las 3:00 AM — limpia sesiones expiradas y datos temporales.

---

## Prisma

- **Schema:** `prisma/schema.prisma` (1254 líneas) — fuente de verdad del modelo de datos
- **Migraciones activas:** 2 migraciones PostgreSQL en `prisma/migrations/`
- **Migraciones archivadas:** `prisma/migrations_archived/` (historial pre-consolidación)

Para detalles sobre la reparación y consolidación de migraciones, ver [`PRISMA_MIGRATION_REPAIR_PLAN.md`](./PRISMA_MIGRATION_REPAIR_PLAN.md).
