# Actualizaciones del Sistema — Julio 2026

Registro de los cambios aplicados a H.A.M.M.E.R. (hammer-api + hammer-frontend) durante las sesiones de trabajo del 2026-07-01/02. Verificación en cada bloque: `tsc --noEmit` limpio, 357 tests API y 13 tests frontend en verde, ESLint sin warnings.

---

## 1. Precio de venta obligatorio por sucursal (cambio de modelo de negocio)

**Antes:** si una sucursal no tenía precio (`branchPrice`), el sistema vendía silenciosamente al precio global (`standardSalePrice`).
**Ahora:** el precio de venta es **obligatorio por sucursal, sin fallback**. `standardSalePrice` queda solo como "precio semilla" para prellenar al crear producto.

- Backfill ejecutado en producción: 3,157 registros `BranchProductSetting` creados (1,108 productos × 3 sucursales) — 0 pares sin precio.
- El POS **bloquea** la venta de productos sin precio de sucursal (error `PRODUCT_HAS_NO_BRANCH_PRICE`, HTTP 422), tanto online como en el flujo offline (el catálogo offline ya no cae al precio global y el carrito rechaza productos sin precio).
- Panel **Precios y costos** rediseñado: KPI "sin precio asignado", filtro "Solo sin precio", filas en rojo, botón Asignar/Guardar/Guardado por fila.
- Se eliminó el botón "Aplicar precio global" de la calculadora de precios (ya no correspondía al modelo).
- Módulos de reporting/detectores actualizados para tratar `effectivePrice = null` como "sin precio" (nunca reintroducir el fallback).

## 2. Corrección de bugs (2 pasadas de revisión)

- **13 bugs corregidos**, entre ellos: `timber-list` mostraba `C$NaN` para productos sin precio; los KPIs de Finanzas contaban mal los "sin precio"; el detector Brain de "producto sin precio" comparaba contra el precio semilla; auditoría faltante en MFA setup, despachos denegados e ítems de borrador de reposición; stale-closure en el catálogo POS al perder conexión; `resolveOpenOperationalDayForOperationTx` ignoraba el instante real de la operación (afectaba sincronización offline cruzando medianoche).
- **Dashboard de Analytics crasheaba al cargar** y la clasificación ABC-XYZ siempre reportaba "ABC=0": ambas rutas envolvían la respuesta dos veces (`ok({data:{…}})`). Corregidas.
- **~50 imports/variables/funciones muertas eliminadas** (verificado con `tsc --noUnusedLocals`).

## 3. Rendimiento (Neon + Vercel)

- **N+1 eliminados en los módulos pesados:** nuevas funciones batch (`getEffectiveProductPricingBatch`, `resolvePolicyForProductBatch`, `buildCommercialIntelligenceBatch`, `getProductStockConversionsBatch`) conectadas en el detector de precios de Brain, alertas comerciales y reposición inteligente. Medido contra producción: de miles de round-trips secuenciales (minutos/timeout) a **1.6–5 segundos**. Equivalencia validada contra la BD real (145 pares, 100% match).
- **4 índices nuevos aplicados a producción** (migración `20260702160000_hot_path_indexes`): `SaleOrderLine(productId)`, `Payment(status, paidAt)`, `SaleOrder(branchId, createdAt)`, `AuditLog(entityId, occurredAt)`.
- **Polling del frontend unificado** en `useOperationalPolling` (pausa con pestaña oculta, backoff con jitter): estado de caja pasó de setInterval crudo de 6s a 12s crítico; Command Center y panel de día operativo migrados.
- **Cron:** configs de automatización con cache TTL 60s; `take` sin límite en analytics acotado a 200 (riesgo de DoS); `maxDuration` en scan de Brain y cleanup.
- `/api/branches` con cache privado de navegador (5 min, 18 pantallas lo consumen).

## 4. Política de retención de datos (nueva)

Ver **[POLITICA-RETENCION-DATOS.md](./POLITICA-RETENCION-DATOS.md)** — resumen:

- **Transaccional** (ventas, pagos, inventario, caja, planilla): se conserva **para siempre**.
- **Archivo** (auditoría, decisiones Brain cerradas, alertas cerradas, snapshots): **mínimo 3 años**, luego purga automática diaria por lotes, auditada.
- **Efímero** (tokens CSRF/MFA, sesiones revocadas): TTL propio. Intentos de login: 90 días.
- El cron de limpieza **existía pero nunca estuvo agendado** — ahora corre diario a las 3 am Managua e incluye el sweep de retención.
- Nuevo panel **Security Center → Retención de datos**: estado en vivo (qué purgaría, tabla por tabla) y ejecución manual para Master.
- Exportación pre-purga: la auditoría se exporta a CSV desde Reportes → Auditoría (se eligió CSV sobre PDF: consultable, re-importable y ~90% más liviano comprimido).
- Test de CI que **impide bajar el mínimo de 3 años por accidente**.

## 5. Pendientes conocidos (decisiones de negocio, no tomadas unilateralmente)

- El cron de automatización corre cada 10 min 24/7 y evita el autosuspend de Neon; restringirlo a horas operativas ahorraría cómputo, pero los horarios de apertura/cierre son configurables en BD.
- Wiring de `operationalDayId` en transport/refund/dispatch y `businessDayEndsAt` por sucursal (fase menor pendiente del rediseño de Día Operativo).
- Archivo automático externo (S3/R2) para la auditoría purgada, si el negocio lo requiere algún día.

---

*Recordatorio de seguridad: las credenciales de la base de datos fueron compartidas en texto plano durante estas sesiones — se recomienda rotar la contraseña de Neon.*
