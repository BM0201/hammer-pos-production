# Auditoría Hammer POS — 2026-07-22

## Resumen ejecutivo

El sistema tiene una base técnica sólida en las partes que ya recibieron trabajo dedicado (día operativo, sesión/roles, ejecución de decisiones del Brain), pero la auditoría de los 12 módulos restantes encontró **9 hallazgos críticos** — la mayoría patrones nuevos, no variaciones de bugs ya conocidos. Los tres más graves:

1. **El borrado masivo de "productos" en Catálogo borra en cascada todo el historial de ventas e inventario de la empresa entera** (`SaleOrder`, `InventoryMovement`, `InventoryBalance` incluidos), protegido solo por escribir una frase de confirmación. Es el hallazgo de mayor severidad de toda la auditoría: irreversible y de radio de explosión mucho mayor al que su nombre sugiere.
2. **El sistema de Aprobaciones es, para 3 de sus 4 tipos reales, un callejón sin salida**: aprobar un ajuste de inventario o un override de despacho no ejecuta ninguna acción de negocio, y la cola genérica puede "resolver" devoluciones/cancelaciones sin tocar su estado real — el negocio cree que resolvió algo que en realidad sigue sin resolverse.
3. **El bug de timezone (UTC vs America/Managua) que ya se corrigió en Ventas/Día Operativo nunca se propagó a Reportes, KPIs ni Analytics** — los tres siguen calculando "hoy" con hasta 6 horas de corte equivocado, y lo mismo aparece de forma independiente en Descuentos (vigencia de campañas).

A esto se suman dos rutas de fraude interno trivial en Ventas/POS (sincronización offline sin CSRF/RBAC/política de descuento, y pagos `CREDIT` sin límite ni ledger de cobro) y una contradicción real entre el motor de descuentos sugeridos y el motor de riesgo de venta que puede dejar productos con promoción activa **invendibles en caja** para cualquier rol no-Master.

Riesgo global: **ALTO**. Ningún hallazgo crítico compromete la integridad ya corregida de Día Operativo/Compras/Reposición/Planilla — son módulos nuevos, no regresiones.

---

## Hallazgos por severidad

### 🔴 CRÍTICO — dinero o datos se corrompen hoy

**C1 · Borrado masivo de productos borra en cascada TODO el historial de ventas e inventario**
Catálogo e Inventario · `hammer-api/src/modules/catalog-inventory/service.ts:480-520` (`massDeleteAllProducts`), ruta `hammer-api/src/app/api/master/catalog-inventory/route.ts:48-62`.
La transacción borra `SaleOrder`, `SaleOrderLine`, `InventoryMovement`, `InventoryBalance`, `Transfer`, `TransferLine` junto con el catálogo. Única protección: escribir la frase "Borrar los &lt;N&gt; productos" siendo MASTER — sin backup previo, sin soft-delete.
Repro: MASTER → Catálogo e Inventario → borrado masivo → escribir la frase → confirmar.
Impacto: pérdida irreversible de historial de ventas (con implicancia legal/fiscal) e inventario completo, con una sola llamada HTTP.
Fix: separar "borrar catálogo de prueba" de "borrar histórico real"; exigir export/backup automático previo; considerar doble-approval para cualquier operación que toque `SaleOrder`.

**C2 · Aprobar un ajuste de inventario o un override de despacho no ejecuta ninguna acción real**
Aprobaciones · `hammer-api/src/modules/approvals/service.ts:95-146` (`resolveRequest`), `hammer-api/src/modules/inventory/service.ts:1577-1620` (`requestStockAdjustment`).
`resolveRequest` solo actualiza `ApprovalRequest.status`; no existe código que, al aprobar un `STOCK_ADJUSTMENT`, cree el `InventoryMovement` correspondiente, ni que reintente `markOrderDispatched` tras aprobar un override de despacho.
Repro: solicitar ajuste de stock → Master aprueba en `/app/master/approvals` → el stock nunca cambia.
Impacto: descuadres de inventario que el negocio cree resueltos y no lo están, indefinidamente.
Fix: `resolveRequest` debe ramificar por `type`/`referenceType` y ejecutar la acción real dentro de la misma transacción antes de marcar `APPROVED`.

**C3 · La cola genérica de Aprobaciones puede "resolver" devoluciones y cancelaciones sin ejecutar su flujo real**
Aprobaciones · `hammer-api/src/modules/approvals/service.ts:66-87` (`listRequests`, no filtra por tipo), `hammer-api/src/app/api/approvals/[id]/route.ts:37-42`.
Devoluciones (`SaleReturn`) y cancelaciones tienen su propio flujo especializado con su propio estado — pero la cola genérica los mezcla y los "aprueba" sin tocar ese estado real.
Repro: un revisor con `APPROVAL_REQUEST_REVIEW` aprueba un item `type: RETURN` desde la cola genérica → desaparece de pendientes, pero `SaleReturn.status` sigue `REQUESTED`: nunca se reintegra stock ni se emite reembolso.
Impacto: devoluciones/cancelaciones "fantasma aprobadas" que quedan congeladas sin que nadie lo note.
Fix: el endpoint genérico debe rechazar/redirigir tipos con flujo especializado propio hacia sus endpoints reales.

**C4 · Sincronización offline de ventas sin CSRF, sin RBAC de sucursal y sin política de descuento**
Órdenes/POS · `hammer-api/src/app/api/sales/sync-offline/route.ts` (archivo completo), `hammer-api/src/modules/sales/offline-sync.service.ts:31-236`.
No llama `requireCsrf`; solo exige que `operatorUserId === session.userId` (sin verificar pertenencia a la sucursal); las líneas aceptan `unitPrice` libre sin pasar por `validateDiscountForRole` ni el chequeo de venta bajo costo.
Repro: cualquier usuario autenticado hace POST directo con `unitPrice: 0.01` a cualquier sucursal.
Impacto: fraude interno trivial — "vender" cualquier producto a cualquier precio sin ningún control.
Fix: agregar `requireCsrf`, `canInBranch(..., SALES_DRAFT_MANAGE)`, y reutilizar la validación de descuento/costo por línea.

**C5 · Pagos `CREDIT` sin límite de crédito ni ledger de cobro**
Órdenes/POS · `hammer-api/src/modules/payments/service.ts:288-530`, `hammer-api/src/modules/payments/validators.ts:6,16`.
`/api/cashier/payments` acepta `method: "CREDIT"` sin exigir referencia ni cliente; la orden se marca como pagada, se descuenta inventario, y `CustomerCreditProfile.creditLimit` nunca se consulta en todo el flujo de ventas.
Repro: cualquier cajero con `CASH_PAYMENTS_COLLECT` postea un pago `CREDIT` por el total.
Impacto: mercadería sale sin que entre dinero ni quede deuda cobrable registrada en ningún lado; Finanzas cuenta ese pago como venta bruta real.
Fix: bloquear `CREDIT` en el endpoint de cajero (igual que ya se bloquea en venta directa) o implementar el ledger de crédito antes de habilitarlo.

**C6 · "Gastos Mensuales" en Finanzas acumula sin fin — dos motores de agregación con reglas de vigencia distintas**
Finanzas & Contabilidad · `hammer-api/src/modules/pricing/service.ts:164-284` vs `hammer-api/src/modules/finance/service.ts:191-219`.
`getExpenseSummaryByBranch`/`getExpenseSummaryAllBranches` suman todos los `OperatingExpense` activos sin filtrar vigencia; la sincronización de planilla crea un registro por empleado por mes y nunca lo desactiva.
Repro: 12 meses de planilla en una sucursal → "Gastos operativos" muestra ~12× el gasto mensual real.
Impacto: la tarjeta más visible del módulo desborda con el tiempo, y ese número alimenta por defecto la calculadora de precios sugeridos, inflándolos progresivamente. Contradice al tab Resumen (que sí filtra bien) dentro de la misma pantalla.
Fix: aplicar el mismo filtro de vigencia de `finance/service.ts::computeOperatingExpenses` en ambas funciones de `pricing/service.ts` (o unificarlas).

**C7 · Timezone UTC crudo en todos los filtros de fecha de Reportes, KPIs y Analytics**
Reportes/Analytics · `hammer-api/src/modules/reports/validators.ts:4-5`, `hammer-api/src/app/api/reports/kpi-summary/route.ts:21-23,45-47` (comentario propio: "Cobrado hoy (UTC)"), `hammer-api/src/modules/reports/sales-analytics.ts` (todo `$queryRaw`).
`z.coerce.date()` sobre un `&lt;input type="date"&gt;` interpreta medianoche UTC, no Managua (UTC-6) — el mismo bug ya corregido en Ventas/Día Operativo, nunca propagado aquí.
Repro: generar reporte "hasta hoy" → excluye las últimas 6 horas del día en Managua.
Impacto: cifras de reportes que no cuadran ni con el dashboard principal ni con el cierre de día operativo para el mismo rango.
Fix: usar el mismo helper ya probado (`getOperationalWindowForManaguaDate`, de `realtime-sales-summary.ts`) en vez de `z.coerce.date()` crudo, en los tres puntos.

**C8 · El motor de descuentos sugeridos contradice al motor de riesgo de venta — bloquea en caja productos con promoción activa**
Descuentos · `hammer-api/src/modules/discounts/service.ts:254-268` (sugiere 15% para clase CZ) vs `hammer-api/src/modules/sales/discount-policy.ts:68-91` (bloquea CUALQUIER descuento &gt;0% en CZ salvo Master+justificación).
Repro: Master crea campaña desde la sugerencia "CZ → 15%" → un cajero intenta vender ese producto (sin tocar nada de descuento manual) → `DISCOUNT_LIMIT_EXCEEDED`, porque el flujo automático de campaña nunca puede enviar `overrideReason`.
Impacto: el producto queda invendible en caja para cualquier rol no-Master mientras la campaña esté activa, sin que nadie entienda por qué.
Fix: simular la política de riesgo al crear/activar la campaña, o resolver el chequeo de rol contra el creador de la campaña en vez del cajero que vende.

**C9 · Contador de ventas de emergencia con carrera + reapertura de cierre sin transacción**
Cajas y Cierres / Transversal · `hammer-api/src/modules/cash-closure/service.ts:168-246` (`reopenCashClosure`, `recordEmergencySale`).
Ambas funciones hacen `update` + `cashClosureLog.create` + `logAuditEvent` sin `$transaction`; `recordEmergencySale` además hace lectura-luego-escritura del contador (`closure.emergencySalesCount + 1`) sin `{increment:1}` ni lock, a diferencia de `reopenCashClosure` que sí lo hace bien.
Impacto: dos ventas de emergencia concurrentes pueden pisarse el contador (lost update) y dejar pasar más ventas de emergencia que el máximo configurado; un fallo a mitad de camino deja el cierre modificado sin su entrada de bitácora.
Fix: envolver en `$transaction` y usar `{increment:1}` también en `recordEmergencySale`.

---

### 🟠 ALTO — funcionalidad rota o riesgo latente de dinero

- **Finanzas**: reportes de meses ya cerrados cambian retroactivamente al anular una venta que cruza el corte de mes — el COGS de la reversión cae en el mes de la anulación, no en el de la venta original (`finance/service.ts:293-336` vs `sales/service.ts:1186-1298`).
- **Finanzas**: registrar un gasto operativo con salida de caja no valida que el actor sea el operador asignado de esa sesión (`pricing/service.ts:57-84` vs el patrón correcto en `cash-session/service.ts:345-378`).
- **Catálogo**: carga inicial de existencias en modo "solo cantidad"/"fijar costo" puede dejar costo 0 permanente, saltándose el guard `ZERO_COST_INBOUND` que sí protege compras normales (`inventory/service.ts:1220-1329`).
- **Catálogo**: la reversión de una venta anulada con costo 0 (encadenado con el hallazgo anterior) no resuelve el producto canónico en fusiones y no sincroniza empaque cerrado/suelto (`sales/service.ts:1220-1255`).
- **Catálogo**: falta el bloqueo de "precio bajo costo" en 3 de 5 caminos de edición (editar producto global, editar precio inline por sucursal, importación Excel) — la misma protección sí existe en carga masiva y en el motor de pricing (`catalog/service.ts:531-590`, `catalog-inventory-admin.tsx:526-562`, `import-service.ts:930-999`).
- **Órdenes/POS**: pasar `unitPrice` manual en vez de `discountAmount` evade por completo el límite de descuento por rol/riesgo (`sales/service.ts:261-267,419-429`).
- **Órdenes/POS**: estados `RETURN_*` de `SaleOrderStatus` nunca se usan; el detalle de orden para Master no incluye `saleReturns` — una orden totalmente devuelta se ve como pagada/completa (`sales/service.ts:1481-1514`).
- **Órdenes/POS**: devoluciones liquidadas con `CREDIT_NOTE` nunca generan un `Refund` → Finanzas nunca las resta de ventas brutas/margen (`sales-returns/service.ts:474-620` vs `finance/service.ts:293-336`).
- **Producción**: no se puede completar un lote con pérdida total (`producedGoodQuantity=0` rechazado por Zod) — los insumos consumidos físicamente nunca se deducen del sistema en ese caso (`production/validators.ts:90`).
- **Madera**: `confirmTimberTrip` sin lock ni `updateMany` condicionado por estado — doble clic o retry puede duplicar la inyección de inventario de madera (`timber/service.ts:598-685`).
- **Reportes**: paginación del Historial Maestro duplica/salta registros al mezclar 4 fuentes con paginación independiente (`master/history/route.ts:52-239`).
- **Transversal**: `reorder/service.ts` (motor legado, deprecado pero **todavía invocado activamente desde Brain**) puede duplicar una orden de compra si el proceso falla entre crear el PO y marcar la alerta como convertida — sin transacción (`reorder/service.ts:588-650,655`).
- **Security**: reset de MFA de otro usuario sin protección CSRF (`master/users/[id]/mfa/route.ts:16-39`).
- **Descuentos**: vigencia de campañas (`startDate`/`endDate`) calculada en UTC crudo — recorte de hasta 6 horas al inicio/fin real (`discounts/service.ts:75-76,132-133,167-183`).
- **Descuentos**: descuento `FIXED_AMOUNT` se multiplica por cantidad sin que la UI aclare que es "por unidad" — puede regalar mercancía en compras grandes (`discounts/service.ts:189-233`).
- **Aprobaciones**: `resolveRequest` no es atómico — dos aprobadores concurrentes pueden ambos "ganar" (aprobar y rechazar a la vez), sin el patrón `updateMany` condicionado que sí se usa en `sales-returns/service.ts` (`approvals/service.ts:95-119`).
- **Cajas y Cierres**: una venta offline puede sincronizarse contra una sesión de caja YA CERRADA (arqueo ya entregado) sin recalcular el snapshot ni marcar alerta, si el día operativo sigue abierto (`offline-sync.service.ts:33-46,155-199`).

---

### 🟡 MEDIO — deuda que frena o confunde la operación

- Finanzas: sin backfill del WAC tras el fix de recepción de compras (riesgo abierto, no verificado contra datos reales); sin modelado de IVA por pagar/crédito fiscal en el reporte; diferencias de caja (`CashSession.differenceAmount`) nunca entran a la utilidad operativa reportada.
- Catálogo: prioridad de "costo efectivo" para margen favorece `averageCost`/`globalCost` (solo se actualiza en recepción de PO) por encima del WAC real por sucursal; consolidaciones de fusión de inventario no dejan `InventoryMovement` (solo `AuditLog`, rompe el invariante "suma de movimientos = saldo"); devoluciones a "dañado" no aplican conversión de unidad de fusión/empaque; no se puede registrar un conteo físico de cero.
- Producción: `ProductionBatch` no tiene `operationalDayId` — un lote en progreso puede cruzar cierres de día sin ninguna señal.
- Madera: costo de compra-en-pie y de aserrado se fusionan en un único total (imposible analizar por separado); el GET de un viaje individual no exige rol Master ni scoping de sucursal (expone márgenes/proveedores a cualquier autenticado).
- Reportes: agrupación "por día" en el dashboard de ventas usa `DATE()` de Postgres (zona del servidor, no Managua); clasificación XYZ de Analytics agrupa por día UTC; criterio de "inventario crítico" difiere entre el reporte (incluye agotado) y el KPI (lo excluye).
- Transversal: ~24 usos de `confirm()`/`alert()` nativos en 12 archivos (concentrados en Catálogo, Gastos, Timber, Producción — los módulos sin rediseño reciente); 277 colores hardcodeados (peor ofensor: `expense-manager.tsx` con 120, luego `catalog-inventory-admin.tsx` con 59); 8 archivos con `fetch` crudo en vez de `apiFetch` (todos GET — el riesgo real es que no redirigen a login si la sesión expira); 3 endpoints sin try/catch (`master/security/route.ts`, `master/security/permissions/route.ts`, `cron/cleanup/route.ts`).
- Security: varias rutas de MFA propio y alertas de seguridad sin CSRF (mitigado por `SameSite=Lax` pero inconsistente); IDOR de bajo impacto en logs de impresión (cualquier autenticado lee/escribe logs de cualquier orden); defecto de diseño latente en `canUseBranchCapability` (resuelve SYSTEM_ADMIN sin importar el rol real — no explotado hoy, pero es una bomba de tiempo para código futuro).
- Brain: dos detectores (`purchasing-detector.ts`, `inventory-detector.ts`) no excluyen miembros derivados de fusión de stock, a diferencia de `reorder-detector.ts` ya migrado — pueden generar decisiones falsas de "stock crítico"; link roto a `/app/master/pricing` (ya no existe, debería ser `/app/master/finance`).
- Aprobaciones: sin expiración ni escalamiento de solicitudes huérfanas; combinado con el bloqueo de auto-aprobación, una sucursal de un solo Admin puede quedar sin nadie que resuelva sus propias solicitudes.
- Cajas: sin arqueo por denominaciones en ningún punto del sistema; diferencia de caja sin "dueño" registrado a nivel de sesión individual (solo a nivel de Día Operativo); movimientos generados por el sistema (gastos, planilla) usan "la sesión más reciente" en vez de la caja física exacta.
- Descuentos: sin trazabilidad de qué campaña específica se aplicó a cada línea de venta (varias se apilan sin tope configurable ni registro de cuál contribuyó cuánto).

---

### 🟢 BAJO — inconsistencias menores, deuda visual, limpieza

- Finanzas: aritmética con `Number` en vez de `Prisma.Decimal` en agregaciones de gastos (no material al volumen actual, pero inconsistente con el resto del código).
- Catálogo: no se puede registrar cantidad 0 en un ajuste manual/conteo físico aunque el modo sea de fijación absoluta; una devolución con costo efectivo 0 bloquea toda la transacción en vez de solo esa línea.
- Aprobaciones: 3 tipos declarados (`PRICE_OVERRIDE`, `CREDIT_EXCEPTION`, `TRANSFER_EXCEPTION`) nunca se usan en ningún flujo — código vestigial.
- Cajas: la política de "una sola caja activa por sucursal" está bien implementada y verificada — el frontend hardcodea `boxes[0]`, inofensivo bajo esa política pero frágil si algún día se permite más de una.
- Descuentos: sin validación preventiva contra política de categoría al crear un descuento (el choque solo se descubre en checkout — ver C8).

---

## Por módulo

**1. Finanzas & Contabilidad** — EN RIESGO. Motor de "utilidad real" (tab Resumen) bien diseñado; conviven dos motores de gasto con reglas de vigencia distintas (C6) y reportes de meses cerrados no estables ante anulaciones tardías. No revisado: estado real de datos en producción, `pricing/calculator.ts` línea por línea, `commercial-intelligence.ts`/`category-policy-service.ts`, devoluciones parciales (solo se confirmó cancelación total), Fletes internos, tests existentes, concurrencia.

**2. Catálogo e Inventario** — EN RIESGO. El motor central de conversión/WAC (`unit-conversion.ts`+`wac.ts`+`createInventoryMovementTx`) está bien diseñado; el riesgo está en los caminos que lo evitan (carga inicial, reversión con costo 0) y en la ausencia de guard de margen en las rutas de edición más usadas, más el borrado masivo (C1). No revisado: `product-360.tsx` completo, `payments/service.ts`, construcción de línea de venta en el POS frontend, `import-excel/service.ts` genérico, contenido de tests, migraciones aplicadas vs pendientes.

**3. Órdenes / Ventas Master** — EN RIESGO. Rutas de bypass reales y explotables (offline-sync sin CSRF/RBAC, `CREDIT` sin control) por cualquier usuario autenticado, no solo teóricas. Positivo: anulaciones revierten al costo original correcto, no al WAC actual; bloqueos de caja/día operativo respetados. No revisado: dispatch module completo, `transport/service.ts` en profundidad, `commercial-intelligence.ts`, concurrencia real contra Postgres.

**4. Producción de Materiales** — CON OBSERVACIONES (bordeando EN RIESGO). El costeo depende de un input manual sin piso contra el WAC real; el modelo no contempla mermas totales ni el ciclo de vida frente a cierres de día. No revisado: `production-recommendation-service.ts`, permisos del módulo, reconciliación física vs sistema.

**5. Madera** — CON OBSERVACIONES. Aritmética de pies tablares y exclusión de reposición (`isTimber`) sanas y verificadas; el riesgo real es la falta de atomicidad en confirmar un viaje y la ausencia de scoping en el GET individual. No revisado: cruce con `production-recommendation-service.ts`, concurrencia real ejecutada, frontend de Madera.

**6. Descuentos** — EN RIESGO. El motor de sugerencias choca con el motor de políticas de venta, generando bloqueos silenciosos de venta en productos con promoción activa (C8) — problema de negocio real, no teórico. No revisado: `ai-insights/discount-optimizer.ts`, impacto exacto en reportes/analytics.

**7. Aprobaciones** — EN RIESGO. Apariencia de flujo de gobierno completo, pero para 3 de 4 tipos reales "aprobar" no completa la acción de negocio o puede desincronizarse de la fuente de verdad real (C2, C3). No revisado: `approveSaleCancellation`/`rejectSaleCancellation` línea por línea, notificaciones push/email.

**8. Cajas y Cierres** — CON OBSERVACIONES. Arquitectura online (locks `FOR UPDATE`, invariante de una sola caja activa, guardas de sesión) sólida; el hueco real es la sincronización offline tardía contra sesiones ya cerradas (ALTO) y el contador de ventas de emergencia sin atomicidad (C9). No revisado: `auto-close-service.ts`/`auto-close-config.ts` completos, agregación entre sucursales de `cash-closure-reports`, cobertura real de los tests existentes.

**9. Security Center + Auditoría** — CON OBSERVACIONES. Cimientos (sesión HMAC+timingSafeEqual, jerarquía de roles, auditoría de dinero, ejecución de decisiones del Brain) sólidos y ya reflejan hardening previo. Hallazgos: huecos puntuales de CSRF, un IDOR de bajo impacto, un defecto de diseño latente no explotado. No revisado: `mfa-service.ts` en detalle, `token-revocation.ts` completo, `api-rate-limiter.ts`, las ~280 rutas individualmente (se hizo muestreo dirigido), frontend de Security/Audit.

**10. Brain / Centro de Decisiones** — CON OBSERVACIONES. Control de acceso sobre ejecución de decisiones ejemplar (mejor que el promedio de la API); problemas encontrados son de calidad de datos (2 detectores no migrados post-fix de fusión) y un link roto, ninguno permite bypass de permisos. No revisado: `dispatch-detector.ts`, `sales-detector.ts`, `system-detector.ts` en profundidad, `scoring.ts`, módulos de `prediction/`, orquestación de `engine.ts`.

**11. Reportes & KPIs + Analytics ABC-XYZ + Historial** — EN RIESGO. El mismo bug de timezone ya corregido en Ventas/Día Operativo nunca se propagó aquí (C7), más paginación rota en Historial. Positivo: exportación CSV/JSON/PDF consistente, sin N+1 detectado. No revisado: RBAC de cada endpoint de reportes, generación real del binario PDF, tests existentes.

**12. Transversales** — riesgo repartido: patrón de timezone repetido en 3+ lugares (ver C7 y Descuentos), huecos de atomicidad concretos y explotables (C9, reorder legado), y deuda de UI dispareja (colores/confirm nativos) concentrada casi enteramente en los módulos que no pasaron por el rediseño reciente (Gastos, Catálogo, Timber, Producción). No revisado: `brain/service.ts` y `retention/service.ts` línea por línea (detectados por conteo, no abiertos), `catalog/service.ts`/`print/service.ts` en profundidad, tests existentes, servidor real levantado.

---

## Matriz de integraciones

| Origen | Destino | Dato que fluye | Estado del contrato |
|---|---|---|---|
| Pedidos de Compra (recibido) | Catálogo/Inventario (WAC) | Costo final por unidad | OK (ya corregido) |
| Catálogo/Inventario (WAC) | Finanzas (márgenes/P&L) | `averageCost`/`globalCost` | **Frágil** — sin backfill tras el fix; prioridad de costo desactualizada frente al WAC real por sucursal |
| Planilla (posteo mensual) | Finanzas (gastos operativos) | `OperatingExpense` auto-generado | **Roto** — nunca se desactiva, acumula sin fin (C6) |
| Ventas (anulación) | Finanzas (reportes mensuales) | Reversión de COGS | **Frágil** — cae en el mes de la anulación, no el de la venta (retroactivo) |
| Devoluciones (`CREDIT_NOTE`) | Finanzas (ventas netas) | Monto devuelto | **Roto** — nunca se resta (no genera `Refund`) |
| Descuentos (sugerencia ABC-XYZ) | Ventas (política de riesgo) | % de descuento por clase | **Roto** — contradicción directa, bloquea venta (C8) |
| Aprobaciones (ajuste stock / override despacho) | Inventario / Despacho | Resolución de la solicitud | **Roto** — no ejecuta ninguna acción (C2) |
| Aprobaciones (cola genérica) | Devoluciones / Cancelaciones (flujo especializado) | Estado de resolución | **Roto** — puede desincronizarse (C3) |
| Ventas offline | Sesión de caja / Día Operativo | Pago + movimiento de inventario | **Frágil** — sin CSRF/RBAC/política (C4); puede sincronizar sobre sesión ya cerrada (ALTO) |
| Motor de Reposición v2 | Brain (`purchasing-detector`/`inventory-detector`) | Balance de inventario | **Frágil** — 2 de 3 detectores no excluyen miembros derivados de fusión |
| Ventas/Reportes (Managua) | Reportes/KPIs/Analytics | Rango de fechas | **Roto** — UTC crudo, no propagó el fix ya hecho (C7) |
| Cierre de caja (arqueo) | Utilidad operativa (Finanzas) | `differenceAmount` | **Ausente** — nunca se incorpora al estado de resultados |

---

## Recomendación de orden de corrección

Los hallazgos 🔴 CRÍTICOS son, todos, candidatos directos a nuevos pasos de **Bloque 0** (dinero/datos que se corrompen hoy), siguiendo la compuerta ya establecida en el plan maestro. Orden sugerido por riesgo/urgencia:

1. **C1 (borrado masivo)** — el de mayor severidad real: irreversible y de radio de explosión enorme. Requiere prompt nuevo, chico: separar el alcance del borrado o exigir backup previo. Puede resolverse en una sesión corta.
2. **C4 + C5 (fraude de POS: offline-sync sin control, `CREDIT` sin límite)** — ambos son rutas de fraude interno activo hoy. Ameritan un prompt nuevo dedicado a "endurecimiento de POS/pagos", separado del resto.
3. **C6 (gastos acumulados sin fin) + C7 (timezone en Reportes)** — ambos caben como una extensión corta del trabajo ya hecho: C6 es aplicar un filtro que ya existe en otra función; C7 es reusar un helper ya escrito y probado (`getOperationalWindowForManaguaDate`). Bajo esfuerzo, alto impacto — buenos candidatos para ir juntos en un solo prompt de "propagar el fix de timezone + vigencia de gastos".
4. **C2 + C3 (Aprobaciones no ejecutan nada)** — requiere una sesión dedicada de diseño: decidir, por tipo de solicitud, qué acción real debe dispararse al aprobar. Es trabajo nuevo, no un fix de una línea.
5. **C8 (descuentos vs política de riesgo)** — decisión de negocio primero (¿debería el creador de la campaña ser quien manda, o el motor de sugerencias no debería sugerir descuentos en CZ?), luego código.
6. **C9 (cierre de caja sin transacción)** — fix acotado y mecánico (envolver en `$transaction`, usar `increment`), cabe en el mismo prompt que atienda Cajas y Cierres.

Los hallazgos 🟠 ALTOS de Catálogo (costo 0 en carga inicial/reversión, precio bajo costo sin alerta) y de Órdenes (descuento evadible vía `unitPrice`, estados huérfanos, `CREDIT_NOTE` sin `Refund`) deberían agruparse en **dos prompts de corrección por módulo** (Catálogo e Inventario; Órdenes/Ventas), siguiendo el mismo patrón de las sesiones ya completadas para Compras/Reposición. Los 🟡 MEDIOS y 🟢 BAJOS pueden agendarse como deuda técnica normal, priorizando los que ya tienen módulos rediseñados cerca (Brain, Security) sobre los que requieren tocar módulos aún no tocados (Producción, Madera).

**Nota de alcance de esta auditoría**: fue realizada 100% por lectura estática de código (6 agentes en paralelo, sin ejecutar la aplicación ni acceso a base de datos de producción). Ningún hallazgo fue verificado contra datos reales — la severidad asignada refleja el riesgo estructural del código, no una confirmación de que el problema ya se materializó en producción.
