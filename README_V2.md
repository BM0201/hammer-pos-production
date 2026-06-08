# H.A.M.M.E.R. POS/ERP — Arquitectura V2

Rediseño limpio del flujo operativo de **POS · Caja · Cobros · Usuarios** + módulo **Hierro**.
Todas las funcionalidades V2 están **activas por defecto** e **integradas en las rutas existentes**
(no hay rutas `/v2` separadas). El código V2 está marcado con comentarios `[V2]`.

## 1. Separación de dominio

```
Usuario ─< UserBranchRole >─ Sucursal
                              │
                              ├─ BranchModuleConfig (paymentWorkflowMode, dispatchWorkflowMode, …)
                              ├─ PhysicalCashBox ─< CashSession ─< CashSessionOperator >─ Usuario
                              │                         │
                              │                         ├─< CashMovement (CASH_IN/OUT, CHANGE_IN, …)
                              │                         └─< Payment ─< PaymentTender (CASH/CARD/TRANSFER/CREDIT)
                              └─ SaleOrder ─< SaleOrderLine
```

Regla central: **la caja física y la caja chica no pertenecen al usuario**. La caja abre una
**sesión** con monto inicial; los usuarios autorizados se asignan como **operadores** de esa sesión.
Cada pago registra **quién cobró**, pero el dinero pertenece a la **sesión**.

## 2. Modos de operación por sucursal (`BranchModuleConfig`)

| Campo | Valores | Default |
|-------|---------|---------|
| `paymentWorkflowMode` | `QUEUE_ONLY` · `DIRECT_ONLY` · `HYBRID` | **HYBRID** |
| `dispatchWorkflowMode` | `DISABLED` · `ENABLED` | `ENABLED` |
| `requireOpenCashSessionForDirectSale` | boolean | `true` |
| `allowSellerDirectPayment` | boolean | `true` |
| `allowCashierQueue` | boolean | `true` |

- **QUEUE_ONLY**: el POS solo puede *Enviar a caja*.
- **DIRECT_ONLY**: el POS solo puede *Cobrar aquí*.
- **HYBRID** (recomendado): ambas, según permisos del usuario.

La lógica de guardia vive en `hammer-api/src/modules/workflow/branch-workflow.ts`
(`assertBranchWorkflowAction`, `requireBranchWorkflowCapability`).

## 3. Flujo POS (frontend `components/pos/branch-pos.tsx`)

Dos acciones separadas:
- **Enviar a caja**: `DRAFT → PENDING_PAYMENT`. No requiere ser cajero. No toca la sesión de caja.
- **Cobrar aquí**: requiere `pos.direct_collect`/`payment.collect.direct`, una caja con sesión abierta
  y que el usuario sea **operador activo**. Registra `Payment` + `PaymentTender` y descuenta inventario.

El POS carga el **borrador activo por usuario** (`branchId + status DRAFT + createdByUserId`)
vía `?activeDraft=mine` → `getOrCreateActiveDraftSaleOrder`. **No** toma cualquier DRAFT de la sucursal.

## 4. Cobros y cierre de caja (`cash-session/service.ts`, `payments/service.ts`)

- `PaymentTender` permite **pago mixto real** (efectivo + tarjeta + transferencia + crédito),
  monto recibido y **vuelto** en efectivo.
- Cálculo de **caja esperada** (`calculateExpectedCashForSessionTx`):
  ```
  expectedCash = openingAmount
               + Σ tenders CASH (pagos POSTED)
               + Σ cashMovements (CASH_IN/CHANGE_IN positivos; CASH_OUT/EXPENSE_OUT/REFUND_OUT/BANK_DEPOSIT_OUT negativos)
               − Σ changeAmount (vueltos)
  ```
  No se usan pagos negativos para representar movimientos de caja: existe `CashMovement` con auditoría.

## 5. Módulo Hierro (stock compartido quintal/varilla)

- Categoría física **"Hierro"** (`Category.code = 'HIERRO'`) — **se crea manualmente** en `/app/master` (no la crea el seed ni una migración; ver Corrección 3 en `PRODUCTION_FIXES.md`).
- Un **grupo de stock** por calibre (`ProductStockGroup`), unidad base = **varilla** (canónica):
  - `HIERRO_3_8`: 1 quintal = **14** varillas
  - `HIERRO_1_2`: 1 quintal = **8** varillas
  - `HIERRO_1_4`: 1 quintal = **30** varillas
- `ProductStockGroupMember` liga cada producto (quintal/varilla) con su `conversionFactor`.
- Lógica en `hammer-api/src/modules/inventory/unit-conversion.ts`
  (`detectIronSaleUnit`, `getIronBarsPerQuintal`, `convertSaleQtyToBaseQty`, `getSharedInventoryBalance`).
- Vender una **varilla** descuenta del mismo stock base del **quintal**, y viceversa.
- Bootstrap automático: el seed crea los grupos en modo *apply*. Para productos importados
  posteriormente: `POST /api/catalog/stock-groups/bootstrap-iron { "apply": true }` (rol MASTER).

## 6. RBAC unificado

`hammer-api/src/modules/rbac/policies.ts` y `hammer-frontend/src/modules/rbac/policies.ts`
definen **los mismos** `CAPABILITIES` (mismos valores) y `ROLE_CAPABILITIES`.
Detalle en [`RBAC_MATRIX.md`](./RBAC_MATRIX.md).

Perfiles operativos (UI Master > Usuarios): Vendedor, Cajero, **Vendedor-Cajero** (= SALES + CASHIER),
Bodega, Administrador de Sucursal, Operador completo.

## 7. Modelos V2 nuevos

| Modelo | Propósito |
|--------|-----------|
| `CashSessionOperator` | Operadores asignados a una sesión (OWNER/CASHIER/SALES_DIRECT/SUPERVISOR). |
| `CashMovement` | Movimientos de caja con auditoría (CASH_IN/OUT, CHANGE_IN, EXPENSE_OUT, REFUND_OUT, …). |
| `PaymentTender` | Desglose de un pago por método; soporta mixto, recibido y vuelto. |
| `ProductStockGroup` / `ProductStockGroupMember` | Stock compartido convertible (hierro quintal/varilla). |

## 8. Puesta en marcha

Ver [`DEPLOYMENT_GUIDE.md`](./DEPLOYMENT_GUIDE.md) y [`TESTING_CHECKLIST.md`](./TESTING_CHECKLIST.md).

```bash
cd hammer-api
npm install
npx prisma migrate deploy
npm run seed
npm test            # 75 pruebas verdes
```
