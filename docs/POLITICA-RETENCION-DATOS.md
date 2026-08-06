# Política de Retención de Datos — H.A.M.M.E.R. POS/ERP

**Vigente desde:** 2026-07-02
**Requisito del negocio:** todo dato con valor de registro se conserva **mínimo 3 años**.
**Implementación:** `hammer-api/src/modules/retention/` (política + sweep) · cron diario `/api/cron/cleanup` (3:00 am Managua) · panel en **Security Center → Retención de datos**.

---

## 1. Clasificación de datos

Todo dato del sistema pertenece a una de tres clases. La clase determina cuánto vive y quién lo borra.

### Clase A — TRANSACCIONAL (el libro del negocio) → **nunca se purga**

Son el registro contable y operativo. No existe purga automática para ellos, sin excepción:

| Datos | Tablas principales |
|---|---|
| Ventas | `SaleOrder`, `SaleOrderLine` |
| Pagos y cobros | `Payment`, `PaymentTender` |
| Devoluciones y anulaciones | `SaleReturn`, `SaleReturnItem`, `SaleCancellation`, `Refund`, `CreditNote` |
| Inventario | `InventoryMovement`, `InventoryBalance`, `Transfer`, `TransferLine` |
| Caja y operación | `CashSession`, `CashMovement`, `OperationalDay` |
| Compras | `PurchaseOrder`, `PurchaseOrderLine`, `Supplier` |
| Planilla y RRHH | `PayrollRun`, `PayrollLine`, `Employee*`, `EmployeeLoan*` |
| Clientes y catálogo | `Customer*`, `Product`, `Category`, `BranchProductSetting` |
| Aprobaciones | `ApprovalRequest` |

### Clase B — ARCHIVO (auditoría y derivados) → **3 años (1095 días), luego purga automática**

Tienen valor de registro/forense pero no son el libro contable. El sweep diario los purga cuando superan los 3 años. Un registro **abierto o en curso jamás se purga** aunque sea viejo (solo estados cerrados).

| Tabla | Qué guarda | Condición de purga |
|---|---|---|
| `AuditLog` | Bitácora de auditoría de todo el sistema | `occurredAt` > 3 años |
| `BrainDecision` (+ actionLogs, outcomes) | Decisiones del módulo Brain | Solo estados EXECUTED / DISMISSED / EXPIRED / FAILED, sin actividad > 3 años |
| `SecurityAlert` | Alertas de seguridad | Solo RESOLVED / DISMISSED, creadas > 3 años |
| `ReorderAlert` | Alertas de reposición | Solo DISMISSED / CONVERTED_*, creadas > 3 años |
| `ProductPricing` | Snapshots de cálculos de precio | `calculatedAt` > 3 años |
| `ProductAnalytics` | Agregados mensuales ABC-XYZ (recalculables desde ventas) | `month` > 3 años |
| `InventoryImportBatch` (+ líneas) | Lotes de importación Excel | `createdAt` > 3 años |
| `ReplenishmentDraft` (+ ítems) | Borradores de reposición | `createdAt` > 3 años |
| `DocumentPrintLog` | Bitácora de impresión | `printedAt` > 3 años |

### Clase C — EFÍMERO (artefactos de seguridad) → **TTL corto propio**

No son datos del negocio; son mecánica de autenticación/sesión:

| Tabla | Retención | Razón |
|---|---|---|
| `CsrfToken` | Hasta su `expiresAt` | Token de un solo uso |
| `MfaPendingToken` | Hasta su `expiresAt` (10 min) | Challenge de login MFA |
| `RevokedSession` | Hasta su `expiresAt` | Solo sirve mientras el token original viviría |
| `LoginAttempt` | **90 días** | Telemetría de seguridad. El rate-limiter usa ventana de 15 min y el Security Center de 24 h; 90 días da margen forense amplio |

---

## 2. Cómo funciona la purga

- **Cuándo:** cron diario `0 9 * * *` UTC (3:00 am Managua) en `/api/cron/cleanup`, agendado en `hammer-api/vercel.json`.
- **Cómo:** borrado **por lotes de 1,000 IDs** con tope de 20,000 filas por tabla por corrida — nunca un `DELETE` masivo que bloquee la base. Si una tabla tiene más filas vencidas que el tope, el resto sale en las corridas siguientes (`capped: true` en la respuesta).
- **Trazabilidad:** cada corrida que borra algo escribe un evento `RETENTION_SWEEP_EXECUTED` en `AuditLog` con el detalle de conteos por tabla — la purga misma queda auditada.
- **Manual:** un Master puede consultar el estado (dry-run, sin borrar) y ejecutar la purga desde **Security Center → Retención de datos**, o vía API: `GET /api/master/retention` (estado) y `POST /api/master/retention` (ejecutar).

## 3. Archivo previo a la purga (exportación)

El único dato de Clase B con volumen relevante es `AuditLog`. Antes de que un período cruce los 3 años, puede exportarse a **CSV** desde **Reportes → Auditoría** (`/api/reports/audit`) filtrando por rango de fechas, y guardarse donde el negocio prefiera (Drive, disco, etc.).

**¿Por qué CSV y no PDF?** Se evaluó comprimir a PDF: para datos tabulares masivos el PDF es más pesado, no es consultable ni re-importable, y su generación consumiría cómputo de Vercel sin beneficio. CSV comprime mejor (es texto plano, un ZIP lo reduce ~90%), se abre en Excel y conserva los datos como datos. Si en el futuro se desea archivo automático externo (ej. S3/R2 con exportación mensual automática), este módulo es el punto de integración.

## 4. Invariantes protegidos por tests

`hammer-api/src/modules/retention/policy.test.ts` corre en la suite de CI y **falla si alguien baja `ARCHIVE_RETENTION_DAYS` de 1095** — el mínimo de 3 años del negocio no puede reducirse por accidente.

## 5. Qué hacer si cambia el requisito

- Cambiar el número de días → editar **solo** `ARCHIVE_RETENTION_DAYS` en `hammer-api/src/modules/retention/policy.ts` (y el test si el nuevo mínimo del negocio es distinto).
- Agregar una tabla nueva a la purga → agregar una regla en `buildRules()` de `retention/service.ts` siguiendo el patrón existente (count + findBatchIds + deleteByIds), cuidando dependencias sin `onDelete: Cascade`.
- Nunca agregar tablas de Clase A (transaccionales) al sweep.
