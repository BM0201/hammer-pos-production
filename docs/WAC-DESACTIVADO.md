# WAC desactivado de la cadena de costo/margen

Decisión del usuario (2026-09-04): sacar el WAC (costo promedio ponderado)
de la ecuación de costo/margen visible en **todo** el sistema, de
inmediato, de forma reversible — sin borrar código ni datos, sin perder
historial de cálculo. Se reimplementará más adelante, después de reparar
los datos contaminados que motivaron esta salida (ver "Qué revisar antes
de reactivar" abajo).

**Nada de `wac.ts`, `unit-conversion.ts`, `recalculateWeightedAverage` ni
la columna `InventoryBalance.weightedAverageCost` se tocó.** El WAC se
sigue calculando exactamente igual en cada movimiento de inventario — solo
se dejó de LEER como entrada de costo/margen. Los módulos que sí dependen
de que el WAC se siga calculando (`createInventoryMovementTx` y, a través
de él, timber) no se vieron afectados.

## Dónde está el flag

`SystemSetting` (tabla genérica de configuración, sin migración) con
`key = "wac_drives_cost_chain"`, valor `"true"`/`"false"`. Módulo dedicado:
[`hammer-api/src/modules/catalog/cost-chain-config.ts`](../hammer-api/src/modules/catalog/cost-chain-config.ts)
— mismo patrón que `cash-session/auto-close-config.ts` (cache TTL de 60s,
`get`/`set` con auditoría). **Default: `false`** desde este cambio — si la
fila no existe, el WAC no participa.

Se togglea sin redeploy vía `PUT /api/system-admin/settings` con
`{ "key": "wac_drives_cost_chain", "value": "true" }` (o `"false"`) —
mismo endpoint genérico que ya usan los demás settings globales, gateado a
SYSTEM_ADMIN. También hay un helper programático,
`setWacDrivesCostChainEnabled(enabled, actorUserId)`, para un script o un
botón de administración futuro.

## Qué quedó apagado (con el flag en `false`)

### 1. La cadena de resolución de costo

`resolveCostChain` (`catalog/effective-pricing.ts`) prioriza
`branchCost → WAC(>0) → averageCost → globalCost → lastPurchaseCost`. Se le
agregó un segundo parámetro **obligatorio**, `wacEnabled: boolean` — a
propósito no es opcional ni lee la config por su cuenta, para que `tsc`
obligara a revisar cada llamador uno por uno en vez de confiar en un grep.
Con `wacEnabled=false`, el paso del WAC se salta entero (como si el
balance no tuviera WAC calculado): cae directo a
`averageCost → globalCost → lastPurchaseCost`. El escalado por factor de
`resolveFusionMemberCost` para presentaciones derivadas no se tocó — sigue
igual, solo que ahora recibe el costo del canónico ya resuelto sin WAC.

`resolveEffectivePricing`/`resolveEffectivePricingFromParts` (misma
archivo) heredan el mismo parámetro obligatorio y lo pasan a sus dos
llamadas internas a `resolveCostChain` (fusión y no-fusión).

Quién lee el flag y se lo pasa a estas dos funciones (todos vía
`isWacDrivesCostChainEnabled()`, con el cliente de base de datos en scope
cuando existe uno, para no forzar una conexión nueva dentro de una
transacción):

- `getEffectiveProductPricing` / `getEffectiveProductPricingBatch`
  (`catalog/effective-pricing.ts`) — el motor único de precio/costo
  efectivo: catálogo, Precios vigentes, Bandeja de Brain, motor de venta.
- `batchMapProductsWithBranchInventory` → `mapSingleProductWithBranchInventory`
  y `updateProduct` (`catalog/service.ts`) — catálogo e inventario, y el
  guard de desvío de precio al editar `standardSalePrice` de un derivado.
- `listStockGroups` (`catalog/stock-group-crud.ts`) — Fusiones (sin
  `branchId`, agrega el WAC entre sucursales cuando está activo).
- `checkStockGroupPricingHealth` (`catalog/fusion-pricing-health.ts`) —
  auditoría de salud de precio/costo de fusiones (script y detector de
  Brain).
- `createInventoryMovementTx` (`inventory/service.ts`) — Kardex: además de
  leer el flag para las guardas (punto 2 abajo), no cambia cómo el WAC se
  calcula ni se guarda, solo dejó de compararse contra él.
- `executeUnifiedCatalogInventoryImport` (`catalog-inventory/import-service.ts`)
  — importación masiva desde Excel (misma guarda que Kardex, punto 2).

### 2. Guardas que comparaban contra el WAC

Estas dos siguen existiendo tal cual en `inventory/wac.ts` — solo se
envolvió cada invocación en `if (wacEnabled) { ... }`, sin tocar su
lógica interna:

- **`detectPackageCostAsUnitCost`** — "el costo que tecleaste parece ser
  el del paquete completo, no el de una unidad" (compara contra
  `existingWac`). Gateada en `catalog/service.ts` (`updateProduct`),
  `inventory/service.ts` (`createInventoryMovementTx`) y
  `catalog-inventory/import-service.ts` (importación masiva, ruta
  STANDARD).
- **`detectExcessiveWacJump`** — bloquea (409, reintentable con
  `allowLargeWacJump`) un movimiento cuyo WAC resultante saltaría >50%
  contra el actual. Gateada en `inventory/service.ts`
  (`createInventoryMovementTx`), incluyendo el re-chequeo diagnóstico que
  arma `wacJumpAuthorized` para el log de auditoría.

**`detectSuspectedPackageCostOnFirstEntry` NO se tocó** — a pesar del
nombre parecido, no compara contra el WAC: usa
`canonicalStandardSalePrice` como referencia para el caso "primera entrada,
sin WAC todavía". No depende de este flag.

### 3. Avisos que citaban el WAC como fuente del margen

- **Fusiones** (`fusion-pricing-panel.tsx`): el backend ahora manda
  `wacDrivesCostChain` en cada grupo de `GET /api/inventory/stock-groups`
  (mismo valor en todos, un solo read por request). Con el flag apagado:
  - El aviso de la fila ("Costo real: ... (WAC de compras) — el margen se
    calculó con este, no con el de arriba.") deja de dispararse aunque
    `costDivergent` siga siendo `true` — el cálculo no se borró, solo se
    envolvió en `wacDrivesCostChain && costDivergent`.
  - El toast de éxito al guardar "Costo global" deja de agregar la
    cláusula "el margen usa el WAC de compras real" (el resto del toast
    sigue igual).
  - El tooltip del encabezado "Costo global" cambia de texto (deja de
    citar el WAC como fuente del margen; explica que el costo deriva del
    canónico).
- **Kardex / Movimientos de inventario** (`inventory-admin.tsx`) y
  **catálogo** (`catalog-inventory-admin.tsx`): los `window.confirm` de
  `SUSPECTED_PACKAGE_COST_AS_UNIT_COST` y `EXCESSIVE_WAC_JUMP` no se
  tocaron — ya no hace falta, porque el backend nunca vuelve a mandar esos
  códigos de error con el flag apagado (punto 2). Dejan de dispararse por
  la misma razón que cualquier guard apagado: nunca llega el error que los
  activa.
- La **vista previa "WAC actual → WAC nuevo"** del formulario de
  Movimientos (`GET /api/inventory/movements/preview`,
  `previewInventoryMovement`) **NO se tocó a propósito**: no cita costo ni
  bloquea nada, solo muestra el efecto mecánico del movimiento sobre el
  campo WAC — que se sigue calculando igual. Es información honesta, no
  parte de la cadena de costo/margen.

## Qué se dejó fuera a propósito (no es parte de esta cadena)

- **Valuación de inventario para contabilidad** (`finance/service.ts`,
  `reports/service.ts`) — usa el WAC como valor de inventario (concepto
  contable estándar), no como fuente de costo/margen de venta. No pasa por
  `resolveCostChain`.
- **Costeo estándar de Producción de Materiales** (`production/service.ts`,
  `production-recommendation-service.ts`, recetas y lotes) — lee
  `weightedAverageCost` directo del balance como ancla deliberada del
  costeo estándar ("costeo estándar al WAC", ver
  `docs/` histórico del módulo), un primitivo propio y separado, no la
  cadena de prioridad que este flag gobierna.
- **Historial de costo en Producto 360** (`product-360.tsx`, tab
  "Historial de costo") — reconstrucción/auditoría del WAC pasado, no
  cadena de costo activa. Debe seguir visible: es el historial que esta
  salida explícitamente no debía perder.
- **Snapshots de venta ya cerrada** (dashboard de ventas, reportes) — el
  costo mostrado ahí es el que se guardó al momento de la venta, nunca se
  recalcula con el WAC actual.
- **Timber** — no se tocó nada; usa su propia fórmula, no depende de esta
  cadena.

## Qué revisar/reparar antes de reactivar (`wacEnabled=true` de nuevo)

1. **Reparación de datos contaminados en arena/piedrín — empezar por acá.**
   `hammer-api/scripts/check-arena-piedrin-balances.ts` (solo lee) y
   `hammer-api/scripts/fix-arena-piedrin-units-and-factors.ts` (corrige)
   documentan que el `conversionFactor` real de los derivados "METRO
   GRANDE"/"METRO PEQUEÑA" de ARENA_2 y PIEDRIN_3 es 25/55, no el 5 que
   tenían cargado. No hay evidencia en este repo (ni commit, ni entrada de
   `AuditLog` verificable desde acá) de que `fix-arena-piedrin-units-and-factors.ts`
   se haya corrido contra la base de datos real — **confirmarlo antes de
   reactivar el flag.** Si el factor sigue mal en producción,
   `resolveFusionMemberCost(costoDelCanónico, factor)` va a volver a
   multiplicar el WAC real del canónico por un factor equivocado en cuanto
   el WAC vuelva a participar — exactamente el desfase (18.6×, el caso
   documentado en `docs/AUDITORIA-MOTOR-PRECIOS-COSTOS.md` §3) que este
   ciclo existe para no repetir.
2. **`globalCost`/`averageCost` de relleno.** Mientras el WAC ganaba,
   valores de relleno tecleados a mano en `globalCost` (el caso arena
   histórico: `globalCost=1.00` en la LATA) quedaban tapados. Con el flag
   apagado ahora mismo, esos valores de relleno pueden estar resolviéndose
   como el costo efectivo real (vía `averageCost`/`globalCost`) — antes de
   reactivar, es buen momento para auditar con
   `checkStockGroupPricingHealth` (`PLACEHOLDER_COST`) qué productos están
   mostrando un costo de relleno ahora mismo, y corregirlos, para no
   simplemente re-tapar el mismo problema al reactivar.
3. **Ejecutar `checkStockGroupPricingHealth` sobre todos los grupos**
   (script de auditoría o detector de Brain) tanto con el flag apagado
   (para ver qué se está resolviendo distinto ahora) como inmediatamente
   después de reactivarlo (para confirmar que no reaparecen los mismos
   `COST_BASIS_CONFLICT`/`MARGIN_OUTLIER` de antes).
4. **Revertir la UI de Fusiones.** El tooltip de "Costo global" y el aviso
   de fila en `fusion-pricing-panel.tsx` vuelven solos a su texto original
   en cuanto `wacDrivesCostChain` sea `true` en la respuesta del backend
   (no hace falta tocar código de nuevo) — solo confirmar visualmente que
   el aviso "Costo real: ... (WAC de compras)" vuelve a aparecer donde
   corresponde.
5. **`tsc`/suite completa.** Los tests que predatan este flag pasan `true`
   explícito como `wacEnabled` para conservar su intención original (WAC
   activo) — no hace falta tocarlos para reactivar en producción, el
   default del `SystemSetting` es lo único que cambia. Si se agrega lógica
   nueva a la cadena de costo más adelante, seguir el mismo patrón: agregar
   pruebas para AMBOS valores del flag, no solo el que esté activo por
   default en ese momento.
