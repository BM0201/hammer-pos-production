# H.A.M.M.E.R. — Matriz de Permisos RBAC (V2)

> Fuente de verdad sincronizada entre **backend** (`hammer-api/src/modules/rbac/policies.ts`)
> y **frontend** (`hammer-frontend/src/modules/rbac/policies.ts`).
> Ambos archivos definen los mismos `CAPABILITIES` (mismos valores string) y las mismas
> `ROLE_CAPABILITIES` por rol. Cualquier cambio debe aplicarse en **los dos** archivos.

## Roles base (`RoleCode`)

| Rol | Descripción |
|-----|-------------|
| `SYSTEM_ADMIN` | Administración técnica del sistema (todo excepto producción). |
| `OWNER` | Dueño: todo excepto configuración técnica del sistema y producción. |
| `MASTER` | Operación total del negocio (incluye producción). |
| `BRANCH_ADMIN` | Supervisión de sucursal: vende, cobra, opera caja, asigna operadores, aprueba diferencias. |
| `SALES` | Vendedor: crea/edita borradores y **envía a caja**. No cobra. |
| `CASHIER` | Cajero: **cobra**, opera sesión de caja, solicita cierre. |
| `WAREHOUSE` | Bodega: despacho e inventario. |

> **Vendedor-Cajero** no es un `RoleCode` nativo: se modela como **membresía combinada `SALES` + `CASHIER`**
> en la misma sucursal (`UserBranchRole`). Así obtiene POS completo + cobro directo.

## Capacidades clave V2

### POS
`pos.view`, `pos.create_draft`, `pos.edit_draft`, `pos.cancel_own_draft`,
`pos.send_to_cashier`, `pos.direct_collect`, `pos.print_quote`, `pos.print_delivery_order`

### Caja
`cash_box.view`, `cash_box.manage`, `cash_session.open`, `cash_session.assign_operator`,
`cash_session.use`, `cash_session.close_request`, `cash_session.reconcile`, `cash_session.close_final`

### Cobros
`payment.queue.view`, `payment.collect`, `payment.collect.direct`,
`payment.void`, `payment.refund`, `payment.print_receipt`

### Movimientos de caja
`cash_movement.create`, `cash_movement.approve`, `cash_movement.view`

### Pricing (unificado V2)
`pricing.view`, `pricing.edit_branch`, `pricing.edit_global`
> ⚠️ Antes el frontend usaba `pricing.edit.branch` / `pricing.edit.global`.
> En V2 se unificó al formato del backend: `pricing.edit_branch` / `pricing.edit_global`.

## Matriz operativa (capacidades V2 por rol)

| Capacidad | MASTER | BRANCH_ADMIN | SALES | CASHIER | WAREHOUSE | SALES+CASHIER |
|-----------|:------:|:------------:|:-----:|:-------:|:---------:|:-------------:|
| pos.view | ✅ | ✅ | ✅ | — | — | ✅ |
| pos.create_draft | ✅ | ✅ | ✅ | — | — | ✅ |
| pos.edit_draft | ✅ | ✅ | ✅ | — | — | ✅ |
| pos.cancel_own_draft | ✅ | ✅ | ✅ | — | — | ✅ |
| **pos.send_to_cashier** | ✅ | ✅ | ✅ | — | — | ✅ |
| **pos.direct_collect** | ✅ | ✅ | — | — | — | (vía CASHIER cobra) |
| pos.print_quote | ✅ | ✅ | ✅ | — | — | ✅ |
| cash_box.view | ✅ | ✅ | — | ✅ | — | ✅ |
| cash_box.manage | ✅ | ✅ | — | — | — | — |
| cash_session.open | ✅ | ✅ | — | — | — | — |
| cash_session.assign_operator | ✅ | ✅ | — | — | — | — |
| **cash_session.use** | ✅ | ✅ | — | ✅ | — | ✅ |
| cash_session.close_request | ✅ | ✅ | — | ✅ | — | ✅ |
| cash_session.reconcile | ✅ | ✅ | — | — | — | — |
| cash_session.close_final | ✅ | ✅ | — | — | — | — |
| payment.queue.view | ✅ | ✅ | — | ✅ | — | ✅ |
| **payment.collect** | ✅ | ✅ | — | ✅ | — | ✅ |
| **payment.collect.direct** | ✅ | ✅ | — | ✅ | — | ✅ |
| payment.void | ✅ | ✅ | — | — | — | — |
| payment.refund | ✅ | ✅ | — | — | — | — |
| payment.print_receipt | ✅ | ✅ | — | ✅ | — | ✅ |
| cash_movement.create | ✅ | ✅ | — | — | — | — |
| cash_movement.approve | ✅ | ✅ | — | — | — | — |
| cash_movement.view | ✅ | ✅ | — | ✅ | — | ✅ |
| dispatch.view / dispatch.mark | ✅ | ✅ | — | — | ✅ | — |
| inventory.view / inventory.adjust | ✅ | ✅ | — | — | ✅ | — |

✅ = otorgada · — = no otorgada

## Perfiles operativos (UI Master > Usuarios)

| Perfil | Membresías | Puede vender | Enviar a caja | Cobrar directo | Operar caja | Abrir/Cerrar caja | Asignar operadores | Despachar |
|--------|-----------|:-----------:|:-------------:|:--------------:|:-----------:|:----------------:|:------------------:|:---------:|
| Vendedor | SALES | ✅ | ✅ | — | — | — | — | — |
| Cajero | CASHIER | — | — | ✅ | ✅ | solicita cierre | — | — |
| Vendedor-Cajero | SALES + CASHIER | ✅ | ✅ | ✅* | ✅ | solicita cierre | — | — |
| Bodega | WAREHOUSE | — | — | — | — | — | — | ✅ |
| Administrador de Sucursal | BRANCH_ADMIN | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Operador completo | MASTER | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

\* El vendedor-cajero solo cobra directo si está **asignado como operador activo** de una sesión de caja abierta.

## Regla central de caja

La caja física y la caja chica **NO pertenecen al usuario**:
1. La `PhysicalCashBox` abre una `CashSession` con monto inicial (caja chica).
2. Los usuarios autorizados se asignan como `CashSessionOperator` (OWNER_OPERATOR, CASHIER_OPERATOR, SALES_DIRECT_OPERATOR, SUPERVISOR_OPERATOR).
3. Una misma sesión puede tener **varios operadores** activos.
4. Cada `Payment` registra **qué usuario cobró**, pero el dinero pertenece a la **sesión**.
5. Si un usuario se desactiva, la caja **no se cierra**. Si se revoca un operador, **ya no puede cobrar**.
