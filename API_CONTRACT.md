# API Contract — H.A.M.M.E.R. POS/ERP

Documentación del contrato API del sistema H.A.M.M.E.R. Todas las rutas usan el formato de respuesta estandarizado y validación Zod.

---

## Formato de Respuesta Estándar

Todas las rutas devuelven respuestas con la siguiente estructura:

### Éxito (200 OK | 201 Created)

```json
{
  "ok": true,
  "data": { }
}
```

### Error (4xx | 5xx)

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Descripción legible del error",
    "details": {}
  }
}
```

El campo `details` es opcional y se incluye principalmente en errores de validación Zod.

---

## Códigos de Error

| Código | HTTP | Descripción |
|--------|:----:|-------------|
| `VALIDATION_ERROR` | 400 | Datos de entrada inválidos (falla validación Zod) |
| `INVALID_INPUT` | 400 | Datos de negocio inválidos |
| `ORDER_EMPTY` | 400 | Orden sin líneas de producto |
| `PRODUCT_INACTIVE` | 400 | Producto desactivado |
| `INVALID_PAYMENT_AMOUNT` | 400 | Monto de pago inválido |
| `UNAUTHENTICATED` | 401 | No autenticado o sesión expirada |
| `NOT_AUTHENTICATED` | 401 | No autenticado |
| `INVALID_CSRF_TOKEN` | 403 | Token CSRF inválido o faltante |
| `FORBIDDEN` | 403 | Acceso denegado por RBAC |
| `FORBIDDEN_BRANCH` | 403 | Sin acceso a la sucursal |
| `FORBIDDEN_CAPABILITY` | 403 | Sin la capacidad requerida |
| `FORBIDDEN_MASTER_ONLY` | 403 | Solo usuarios Master |
| `FORBIDDEN_OWNER_OR_SYSTEM_ADMIN_ONLY` | 403 | Solo Owner o System Admin |
| `CASHIER_MODULE_DISABLED` | 403 | Módulo de caja desactivado en esta sucursal |
| `CASHIER_MODULE_ENABLED` | 403 | No se permite venta directa — módulo de caja activo |
| `DISPATCH_MODULE_DISABLED` | 403 | Módulo de despacho desactivado en esta sucursal |
| `NOT_FOUND` | 404 | Recurso no encontrado |
| `CONFLICT` | 409 | Conflicto de estado (ej. stock insuficiente) |
| `INSUFFICIENT_STOCK` | 409 | Stock insuficiente para la operación |
| `PAYMENT_ALREADY_POSTED` | 409 | El pago ya fue registrado |
| `BRANCH_CLOSED` | 409 | La sucursal está cerrada |
| `CASH_SESSION_ALREADY_OPEN` | 409 | Ya existe sesión de caja abierta |
| `UNIQUE_CONSTRAINT_VIOLATION` | 409 | Registro duplicado |
| `INTERNAL_SERVER_ERROR` | 500 | Error interno del servidor |
| `DATABASE_UNAVAILABLE` | 503 | Base de datos no disponible |

---

## Endpoints

### Autenticación

| Método | Ruta | Descripción |
|:------:|------|-------------|
| POST | `/api/auth/login` | Iniciar sesión (devuelve cookie iron-session) |
| POST | `/api/auth/logout` | Cerrar sesión |
| GET | `/api/auth/session` | Obtener sesión actual |
| GET | `/api/auth/csrf` | Obtener token CSRF |
| POST | `/api/auth/change-password` | Cambiar contraseña |

#### Ejemplo: Login

```bash
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin@empresa.com",
  "password": "mi-password"
}
```

```json
{
  "ok": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "admin@empresa.com",
      "name": "Admin",
      "globalRole": "OWNER"
    },
    "branchMemberships": [
      { "branchId": "uuid", "branchName": "Principal", "roleCode": "BRANCH_ADMIN" }
    ]
  }
}
```

---

### Ventas

| Método | Ruta | Guard | Descripción |
|:------:|------|-------|-------------|
| GET | `/api/sales/orders` | Authenticated | Listar órdenes de la sucursal |
| POST | `/api/sales/orders` | `CREATE_DRAFT_ORDER` | Crear borrador de orden |
| GET | `/api/sales/orders/:id` | Authenticated | Obtener orden por ID |
| POST | `/api/sales/orders/:id/submit` | `SUBMIT_TO_CASHIER` | Enviar orden a caja |
| POST | `/api/sales/orders/:id/direct-sale` | `DIRECT_SALE` | Venta directa (sin caja) |
| GET | `/api/sales/orders/:id/lines` | Authenticated | Listar líneas de una orden |
| POST | `/api/sales/orders/:id/lines` | Authenticated | Agregar línea a orden |
| PATCH | `/api/sales/orders/:id/lines/:lineId` | Authenticated | Actualizar línea |
| DELETE | `/api/sales/orders/:id/lines/:lineId` | Authenticated | Eliminar línea |

#### Ejemplo: Venta Directa

```bash
POST /api/sales/orders/abc123/direct-sale
x-csrf-token: <token>
Content-Type: application/json

{
  "paymentMethod": "CASH",
  "cashSessionId": "session-uuid"
}
```

```json
{
  "ok": true,
  "data": {
    "order": { "id": "abc123", "status": "DISPATCHED" },
    "transportCreated": true
  }
}
```

---

### Caja

| Método | Ruta | Guard | Descripción |
|:------:|------|-------|-------------|
| POST | `/api/cashier/payments` | `COLLECT_PAYMENT` | Registrar pago |
| GET | `/api/cashier/orders/pending-payment` | Authenticated | Órdenes pendientes de pago |
| GET | `/api/cashier/cash-boxes` | Authenticated | Listar cajas |
| POST | `/api/cashier/cash-sessions/open` | Authenticated | Abrir sesión de caja |
| POST | `/api/cashier/cash-sessions/close` | Authenticated | Cerrar sesión de caja |
| POST | `/api/cashier/cash-sessions/close-request` | Authenticated | Solicitar cierre de caja |
| GET | `/api/cashier/cash-sessions/active?branchId=...` | Authenticated | Obtener sesión activa (requiere `branchId`; opcionalmente `physicalCashBoxId`) |

#### Ejemplo: Registrar Pago

```bash
POST /api/cashier/payments
x-csrf-token: <token>
Content-Type: application/json

{
  "saleOrderId": "order-uuid",
  "amount": 1500.00,
  "paymentMethod": "CASH",
  "cashSessionId": "session-uuid"
}
```

```json
{
  "ok": true,
  "data": {
    "payment": { "id": "pay-uuid", "status": "POSTED", "amount": 1500.00 }
  }
}
```

---

### Despacho

| Método | Ruta | Guard | Descripción |
|:------:|------|-------|-------------|
| POST | `/api/warehouse/dispatch/:orderId/dispatch` | `MARK_DISPATCHED` | Marcar como despachado |
| GET | `/api/warehouse/dispatch/pending` | Authenticated | Listar despachos pendientes |
| GET | `/api/warehouse/dispatch/history` | Authenticated | Historial de despachos |

---

### Transporte

| Método | Ruta | Guard | Descripción |
|:------:|------|-------|-------------|
| GET | `/api/transport` | Authenticated | Listar servicios de transporte |
| POST | `/api/transport` | `CREATE_TRANSPORT` | Crear servicio de transporte |
| GET | `/api/transport/:id` | Authenticated | Obtener servicio por ID |
| PATCH | `/api/transport/:id` | `UPDATE_TRANSPORT_STATUS` | Actualizar estado |

#### Transiciones de Estado Válidas

```
PENDING ──► IN_TRANSIT ──► DELIVERED   (terminal)
   │             │
   └──► CANCELLED ◄──┘                (terminal)
```

- `DELIVERED` y `CANCELLED` son estados terminales — no se puede transicionar desde ellos.
- Transiciones inválidas devuelven error de validación.

#### Ejemplo: Actualizar Estado

```bash
PATCH /api/transport/transport-uuid
x-csrf-token: <token>
Content-Type: application/json

{
  "status": "IN_TRANSIT"
}
```

---

### Catálogo

| Método | Ruta | Descripción |
|:------:|------|-------------|
| GET | `/api/catalog/products` | Listar productos |
| GET | `/api/catalog/products/:id` | Obtener producto |
| GET | `/api/catalog/categories` | Listar categorías |
| GET | `/api/catalog/categories/:id` | Obtener categoría |

---

### Inventario

| Método | Ruta | Descripción |
|:------:|------|-------------|
| GET | `/api/inventory/balances` | Balances de inventario |
| GET | `/api/inventory/movements` | Movimientos de inventario |
| POST | `/api/inventory/adjustments` | Crear ajuste de inventario |

---

### Configuración de Sucursal

| Método | Ruta | Acceso | Descripción |
|:------:|------|--------|-------------|
| GET | `/api/branch-config` | Owner | Listar configuración de todas las sucursales |
| PUT | `/api/branch-config` | Owner | Actualizar módulos de sucursal (`enableCashier`, `enableDispatch`) |
| GET | `/api/branch-config/:branchId` | Authenticated | Obtener config de una sucursal |

---

### System Admin

| Método | Ruta | Acceso | Descripción |
|:------:|------|--------|-------------|
| PUT | `/api/system-admin/role-config` | System Admin | Actualizar BranchRoleConfig |
| GET | `/api/system-admin/settings` | System Admin | Obtener configuración del sistema |
| PUT | `/api/system-admin/settings` | System Admin | Actualizar configuración del sistema |

---

### Panel Maestro (Master)

#### Dashboard
| Método | Ruta | Descripción |
|:------:|------|-------------|
| GET | `/api/master/dashboard` | Resumen dashboard multi-sucursal |
| GET | `/api/branch/dashboard` | Dashboard por sucursal (query: `role`) |

#### Reorden Automático
| Método | Ruta | Descripción |
|:------:|------|-------------|
| GET | `/api/master/reorder/policies` | Listar políticas de reorden |
| POST | `/api/master/reorder/policies` | Crear/actualizar política |
| PATCH | `/api/master/reorder/policies` | Bulk upsert de políticas |
| POST | `/api/master/reorder/evaluate` | Evaluar necesidades de reorden |
| GET | `/api/master/reorder/alerts` | Listar alertas de reorden |
| POST | `/api/master/reorder/alerts/:id/dismiss` | Descartar alerta |
| POST | `/api/master/reorder/alerts/:id/convert-purchase-order` | Convertir alerta → orden de compra |
| POST | `/api/master/reorder/alerts/:id/convert-transfer` | Convertir alerta → transferencia |
| GET | `/api/master/reorder/batches` | Listar lotes de sugerencias |
| POST | `/api/master/reorder/batches/:id/convert` | Convertir lote completo |

#### Usuarios
| Método | Ruta | Descripción |
|:------:|------|-------------|
| GET | `/api/master/users` | Listar usuarios |
| POST | `/api/master/users` | Crear usuario |
| GET | `/api/master/users/:id` | Obtener usuario |
| PATCH | `/api/master/users/:id` | Actualizar usuario |
| GET | `/api/master/users/:id/memberships` | Listar membresías |
| POST | `/api/master/users/:id/memberships` | Crear membresía |
| DELETE | `/api/master/users/:id/memberships/:membershipId` | Eliminar membresía |

#### Órdenes de Compra

| Método | Ruta | Descripción |
|:------:|------|-------------|
| GET | `/api/master/purchase-orders` | Listar órdenes de compra |
| POST | `/api/master/purchase-orders` | Crear orden de compra (status: DRAFT) |
| GET | `/api/master/purchase-orders/:id` | Obtener orden de compra |
| POST | `/api/master/purchase-orders/:id/approve` | Aprobar orden (DRAFT → APPROVED) — solo cambia estado, **no** crea inventario |
| POST | `/api/master/purchase-orders/:id/receive` | Recibir mercadería (APPROVED → RECEIVED) — crea movimientos PURCHASE_IN |
| POST | `/api/master/purchase-orders/:id/cancel` | Cancelar orden (DRAFT o APPROVED → CANCELLED) |

##### Flujo de Estados — Orden de Compra

```
DRAFT ──► APPROVED ──► RECEIVED   (terminal)
  │           │
  └──► CANCELLED ◄──┘              (terminal)
```

- **Aprobar** solo cambia el estado a APPROVED. No se genera inventario.
- **Recibir** valida APPROVED, crea movimientos de inventario (PURCHASE_IN por línea), y marca RECEIVED.
- **Cancelar** solo es posible desde DRAFT o APPROVED (no desde RECEIVED).

#### Transferencias

| Método | Ruta | Descripción |
|:------:|------|-------------|
| GET | `/api/master/transfers` | Listar transferencias |
| POST | `/api/master/transfers` | Crear transferencia (status: DRAFT) |
| GET | `/api/master/transfers/:id` | Obtener transferencia |
| POST | `/api/master/transfers/:id/approve` | Aprobar (DRAFT → APPROVED) — solo cambia estado |
| POST | `/api/master/transfers/:id/dispatch` | Despachar (APPROVED → IN_TRANSIT) — crea TRANSFER_OUT en origen |
| POST | `/api/master/transfers/:id/receive` | Recibir (IN_TRANSIT → RECEIVED/PARTIALLY_RECEIVED) — crea TRANSFER_IN en destino |
| POST | `/api/master/transfers/:id/cancel` | Cancelar (DRAFT/REQUESTED/APPROVED → CANCELLED) |

##### Flujo de Estados — Transferencia

```
DRAFT ──► APPROVED ──► IN_TRANSIT ──► RECEIVED            (terminal)
  │           │                   └──► PARTIALLY_RECEIVED  (terminal)
  └──► CANCELLED ◄──┘
```

- **Aprobar** solo cambia estado. No toca inventario.
- **Despachar** valida stock en origen, crea movimientos TRANSFER_OUT, marca IN_TRANSIT.
- **Recibir** acepta líneas recibidas, crea TRANSFER_IN en destino, marca RECEIVED o PARTIALLY_RECEIVED.
- **Cancelar** solo es posible desde DRAFT, REQUESTED, o APPROVED (no desde IN_TRANSIT o RECEIVED).

#### Cajas (Master)
| Método | Ruta | Descripción |
|:------:|------|-------------|
| GET | `/api/master/cash-boxes` | Listar todas las cajas |
| POST | `/api/master/cash-boxes/:id/toggle` | Activar/desactivar caja |

#### Catálogo Maestro
| Método | Ruta | Descripción |
|:------:|------|-------------|
| GET | `/api/master/catalog/products` | Listar productos (maestro) |
| GET | `/api/master/catalog/products/:id` | Obtener producto |
| POST | `/api/master/catalog/products/:id/cleanup` | Limpiar producto |

#### Inventario Maestro
| Método | Ruta | Descripción |
|:------:|------|-------------|
| POST | `/api/master/inventory/import` | Importar inventario |

#### Descuentos
| Método | Ruta | Descripción |
|:------:|------|-------------|
| GET | `/api/master/discounts` | Listar descuentos |
| POST | `/api/master/discounts` | Crear descuento |
| GET | `/api/master/discounts/:id` | Obtener descuento |
| PATCH | `/api/master/discounts/:id` | Actualizar descuento |
| GET | `/api/master/discounts/active` | Descuentos activos |
| GET | `/api/master/discounts/suggestions` | Sugerencias de descuento |

#### Analytics
| Método | Ruta | Descripción |
|:------:|------|-------------|
| GET | `/api/master/analytics/abc-xyz` | Clasificación ABC-XYZ |
| GET | `/api/master/analytics/abc-xyz/:id` | Detalle ABC-XYZ |

---

### AI Insights

| Método | Ruta | Descripción |
|:------:|------|-------------|
| GET | `/api/ai-insights/discount-suggestions` | Sugerencias de descuentos inteligentes |
| GET | `/api/ai-insights/anomalies` | Anomalías detectadas |
| GET | `/api/ai-insights/discrepancies` | Discrepancias |
| GET | `/api/ai-insights/patterns` | Patrones y recomendaciones |
| POST | `/api/ai-insights/refresh` | Recalcular todos los insights |

---

### Reportes

| Método | Ruta | Descripción |
|:------:|------|-------------|
| GET | `/api/reports/sales` | Reporte de ventas |
| GET | `/api/reports/payments` | Reporte de pagos |
| GET | `/api/reports/dispatch` | Reporte de despachos |
| GET | `/api/reports/inventory-critical` | Inventario crítico |
| GET | `/api/reports/audit` | Reporte de auditoría |
| GET | `/api/reports/approvals` | Reporte de aprobaciones |

---

### Analytics

| Método | Ruta | Descripción |
|:------:|------|-------------|
| GET | `/api/analytics/dashboard` | Dashboard de analytics |
| GET | `/api/analytics/products` | Analytics por producto |
| POST | `/api/analytics/classify` | Clasificar productos |

---

### Otros Endpoints

| Método | Ruta | Descripción |
|:------:|------|-------------|
| GET | `/api/branches` | Listar sucursales |
| GET/POST | `/api/employees` | Listar/crear empleados |
| GET/PATCH | `/api/employees/:id` | Obtener/actualizar empleado |
| GET/POST | `/api/expenses` | Listar/crear gastos |
| GET/PATCH | `/api/expenses/:id` | Obtener/actualizar gasto |
| POST | `/api/payroll/calculate` | Calcular nómina |
| GET | `/api/payroll/history` | Historial de nómina |
| GET/POST | `/api/pricing/config` | Config de precios |
| GET | `/api/pricing/suggested` | Precios sugeridos |
| GET/POST | `/api/approvals` | Listar/crear aprobaciones |
| PATCH | `/api/approvals/:id` | Actualizar aprobación |
| GET | `/api/audit` | Consultar log de auditoría |
| GET/POST | `/api/cash-closure` | Cierre de caja |
| POST | `/api/cash-closure/reopen` | Reabrir cierre |
| GET | `/api/cash-closure/reports` | Reportes de cierre |
| GET | `/api/cash-closure/status` | Estado de cierre |
| GET/POST | `/api/timber` | Listar/crear registros de madera |
| GET/PATCH | `/api/timber/:id` | Obtener/actualizar registro |
| POST | `/api/timber/calculate` | Calcular cubicaje |
| GET/PUT | `/api/timber/pricing` | Precios de madera |
| GET/POST | `/api/timber/trips` | Viajes de madera |
| GET/PATCH | `/api/timber/trips/:id` | Obtener/actualizar viaje |
| GET | `/api/cron/cleanup` | Limpieza programada (CRON_SECRET) |
| GET | `/health` | Health check (200 OK) |
| GET | `/ready` | Readiness check (200 OK + DB) |

---

## Headers Requeridos

| Header | Cuándo | Descripción |
|--------|--------|-------------|
| `Content-Type: application/json` | POST/PUT/PATCH | Tipo de contenido |
| `x-csrf-token: <token>` | POST/PUT/PATCH/DELETE | Token CSRF (obtener de `GET /api/auth/csrf`) |
| `Cookie: iron-session=...` | Siempre (automático) | Cookie de sesión |

---

## Workflow Guards

Algunos endpoints están protegidos por workflow guards que verifican la configuración de módulos de la sucursal:

| Guard | Requiere | Error si falla |
|-------|----------|----------------|
| `SUBMIT_TO_CASHIER` | `enableCashier = true` | `CASHIER_MODULE_DISABLED` |
| `COLLECT_PAYMENT` | `enableCashier = true` | `CASHIER_MODULE_DISABLED` |
| `DIRECT_SALE` | `enableCashier = false` | `CASHIER_MODULE_ENABLED` |
| `MARK_DISPATCHED` | `enableDispatch = true` | `DISPATCH_MODULE_DISABLED` |
| `CREATE_TRANSPORT` | `enableDispatch = true` | `DISPATCH_MODULE_DISABLED` |
| `UPDATE_TRANSPORT_STATUS` | `enableDispatch = true` | `DISPATCH_MODULE_DISABLED` |
