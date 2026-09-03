# Costo efectivo — una sola fuente

Objetivo: dejar `resolveCostChain` + `resolveFusionMemberCost`
(`modules/catalog/effective-pricing.ts`) como la ÚNICA resolución de costo
del sistema. Hoy convive una segunda cascada,
`resolveCatalogDisplayCost` (`modules/catalog-inventory/service.ts:56`),
que NO mira `branchCost` y por lo tanto puede devolver un número distinto
al costo efectivo real de la sucursal — la misma fila de un endpoint
termina llevando dos costos.

## Las dos cascadas

```
resolveCostChain (motor correcto, usado por getEffectiveProductPricing/Batch):
  branchCost → WAC → averageCost → globalCost → lastPurchaseCost

resolveCatalogDisplayCost (la que sobra):
              WAC → averageCost → globalCost → lastPurchaseCost   (sin branchCost)
              baseCost × factor                                   (inline, no resolveFusionMemberCost)
```

## Inventario de los 7 llamadores (Parte A, antes de tocar nada)

| # | Ubicación | Qué alimenta | Pantalla | ¿Convive con effectiveCost en la misma respuesta? |
|---|---|---|---|---|
| 1 | `catalog-inventory/service.ts:169` (dentro de `resolveCatalogDisplayCostBatch`) | `Map<productId, number>` que devuelve la función batch | **Ninguna** — confirmado con knip y grep de invocaciones (`resolveCatalogDisplayCostBatch(`): la función no tiene NINGÚN llamador, ni cross-file ni dentro de su propio archivo. Su comentario (línea 89-103) ya lo decía: "sin más llamadores hoy". | No aplica — código muerto |
| 2 | `catalog-inventory/service.ts:177` (dentro de `resolveCatalogDisplayCostBatch`) | Igual que #1 | Igual que #1 | No aplica — código muerto |
| 3 | `catalog-inventory/service.ts:239` (dentro de `enrichProduct`) | `productCost` → `baseCost`/`hasNoCost` de cada fila de `allMetricRows`, que alimenta los KPIs `productsWithoutCost` y el filtro `NO_COST` de "Catálogo e Inventario" | Catálogo e Inventario — KPI "Sin costo" y filtro NO_COST | **Sí, indirectamente**: la misma respuesta trae `branchEffectivePricing` (correcto) en `products[]`, mientras el KPI/filtro se calculan con esta cascada distinta. Un producto puede figurar "sin costo" en el KPI mientras `branchEffectivePricing` ya le resuelve un costo vía `branchCost`. **Urgente.** |
| 4 | `catalog-inventory/service.ts:534` | `productCost` para miembros DERIVADOS de fusión → `baseCost` de la fila | Catálogo e Inventario — el campo `baseCost` del tipo `ProductRow` en el frontend (`catalog-inventory-admin.tsx:34`) | **Sí, directamente**: la misma fila trae `branchEffectivePricing[]` (correcto, con `branchCost`) Y `baseCost` (esta cascada, sin `branchCost`). Verificado que `baseCost` NO se renderiza hoy como número en el frontend (solo vive en el tipo y en comentarios), pero sigue siendo la fuente de `hasNoCost` de la fila. **Urgente.** |
| 5 | `catalog-inventory/service.ts:543` | `productCost` para el canónico / productos sin fusión, en el mismo bloque que #4 | Igual que #4 | Igual que #4. **Urgente.** |
| 6 | `catalog/service.ts:801` | `effectiveCostRaw` usado SOLO para validar (no persistir ni mostrar) si un `standardSalePrice` nuevo se desvía >20% del precio implícito de fusión, dentro de `updateProduct` | Ninguna pantalla directa — es un guard de escritura, dispara un error que el frontend traduce a un toast | No convive con `effectiveCost` en una respuesta — es un cálculo interno de validación en un `PATCH`. Pero SÍ es la misma cascada equivocada: **`updateProduct` no recibe `branchId`** (edita `standardSalePrice`/`globalCost`, campos de RED, no por sucursal) — `getEffectiveProductPricingBatch` no se puede invocar acá sin inventarle una sucursal que no existe en este contexto. |
| 7 | `stock-group-crud.ts:1002` (dentro de `listStockGroups`) | `effectiveCost` y `marginPercent` de cada `members[]` | Fusiones (`fusion-pricing-panel.tsx`) — compara `effectiveCost` contra `globalCost` y avisa cuando divergen | **Sí, directamente**: es la pantalla que el spec original señala como "la que más te está fallando". `listStockGroups()` no tiene `branchId` (Fusiones no tiene selector de sucursal — decisión de diseño ya documentada en el propio archivo) y agrega el WAC entre TODAS las sucursales a propósito. **Urgente**, pero tampoco puede usar `getEffectiveProductPricingBatch` tal cual (no hay una sola sucursal que pasarle). |

## Plan de migración por llamador

- **#1, #2** (Parte B.4): `resolveCatalogDisplayCostBatch` no tiene llamadores reales — se borra entera, sin necesidad de migrar nada primero.
- **#3, #4, #5** (Parte B.1+B.2, un solo commit — ver nota abajo): migran a `branchPricingByKey`/`getEffectiveProductPricingBatch`, que YA se calcula en esta misma función para `branchEffectivePricing`. Sucursal en contexto: `params.branchId` cuando está seteado; si no, la sucursal por defecto = `branches[0]` (la primera por código, el mismo orden ya usado en toda la función) — NO un promedio entre sucursales, tal como pide la Parte B.1. Al ser `getEffectiveProductPricingBatch` fusión-aware, la rama `isDerivedFusionMember`/`canonicalCostByProductId` deja de hacer falta para el costo (se mantiene para lo que SÍ le es propio: la resolución de stock físico compartido, que es un problema distinto).
- **#6, #7** (Parte B.3): **excepción documentada, no migran a `getEffectiveProductPricingBatch`** — ninguno de los dos tiene un `branchId` en su contexto (uno edita un campo de red, el otro es una pantalla explícitamente sin selector de sucursal). Migran en cambio a los dos primitivos correctos directamente: `resolveCostChain({ branchCost: null, ... })` + `resolveFusionMemberCost(costo, factor)` — la MISMA lógica que `resolveEffectivePricing` usa internamente para el caso de fusión, sin forzar una sucursal que no existe en ninguno de los dos contextos. Esto cumple el objetivo real de la Parte C (ninguna multiplicación por factor fuera de `resolveFusionMemberCost`) sin inventar una sucursal falsa.

### Por qué B.1 y B.2 son un solo commit, no dos

El spec los lista por separado, pero al investigar quedó claro que no se
pueden migrar por separado sin dejar un estado intermedio roto o
duplicado: `branchPricingByKey` (la fuente correcta) se calculaba
DESPUÉS de `enrichProduct` (línea 239, B.2) en el orden original de la
función — `enrichProduct` corre sobre `allMetricProducts` para construir
los KPIs, antes de que exista ninguna sucursal en contexto. Migrar solo
la línea 534/543 (B.1) sin tocar la 239 (B.2) habría dejado el KPI
"Sin costo" y el filtro NO_COST calculados con la cascada vieja mientras
la fila ya mostraba el costo nuevo — la MISMA clase de inconsistencia
que este documento existe para cerrar, solo que movida de lugar en vez
de resuelta. La solución real fue mover el cálculo de
`branchPricingByKey` ANTES de `enrichProduct` (para TODOS los productos
que matchean el filtro, no solo la página actual) y pasárselo como
parámetro — un cambio que toca las dos líneas a la vez.

## Parte C — verificación de terceras vías

Tras B.1-B.5, la única multiplicación por `conversionFactor` sobre un
costo en todo `hammer-api/src/modules/` es la de `resolveFusionMemberCost`
mismo. Verificado con:
```
grep -rn "conversionFactor" src/modules --include="*.ts" | grep -iE "cost|precio|price" | grep -v ".test.ts"
```
(resultado documentado en el commit de Parte C).
