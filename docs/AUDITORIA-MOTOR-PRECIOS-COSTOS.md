# Auditoría del motor de precios y costos

Pedido: "el motor actual está hecho de partes, quiero rehacerlo asegurando
todo bien". Antes de reescribir nada, se hizo una auditoría completa,
archivo por archivo, función por función, **sin tocar lógica** — es lo que
se pidió explícitamente. Fecha: 2026-08-31, rama `Hammer-V1`, sobre el
commit `654f9ec`.

## Veredicto

**No reescribir.** El motor está repartido en varios archivos — eso es lo
que se lee como "hecho de partes" — pero repartido no es lo mismo que
roto. Cada pieza existe porque corrigió un incidente real, documentado, y
la mayoría tiene su propio test con datos reales de producción. Reescribir
significa volver a aprender, a los golpes, todo lo que ya está aprendido y
escrito en estos comentarios y tests.

Se encontraron **2 huecos reales, verificados, no corregidos en este
ciclo** (sección "Hallazgos"). Ninguno de los dos justifica una
reescritura — los dos son extensiones puntuales de guards que ya existen.

---

## 1. Mapa del motor

| Pieza | Archivo | Qué hace |
|---|---|---|
| Costo — cascada del catálogo | `catalog-inventory/service.ts` → `resolveCatalogDisplayCost` / `resolveCatalogDisplayCostBatch` | El costo que muestra el catálogo y Precios vigentes. Prioridad: WAC > averageCost > globalCost > lastPurchaseCost. |
| Costo — cascada del motor de venta | `catalog/effective-pricing.ts` → `resolveCostChain` | El costo que usa el POS para cobrar. Prioridad: **branchCost** > WAC > averageCost > globalCost > lastPurchaseCost. |
| Precio efectivo | `catalog/effective-pricing.ts` → `resolveEffectivePricing` | `branchPrice ?? standardSalePrice`, con `priceSource` BRANCH/STANDARD/FUSION_DERIVED/MISSING. |
| Fusión — costo del derivado | `catalog/effective-pricing.ts` → `resolveFusionMemberCost` | Costo del canónico × factor. Nunca campos propios del derivado. |
| Fusión — conversión | `inventory/unit-conversion.ts` | Resuelve qué producto es el canónico de un grupo y a qué producto redirigir cualquier movimiento (`resolveInventoryProductForMovement`). |
| Guards de escritura | `pricing/price-guard.ts`, `inventory/wac.ts` | `assertPriceNotBelowCost`, `assertNotFusionMemberCostWrite`, `detectPackageCostAsUnitCost`. |
| Cálculo de precio sugerido | `pricing/calculator.ts` | Margen, prorrateo (por cantidad/valor/manual), pisos (margen/utilidad mínima/mercado), redondeo. Pura, sin DB. |
| Config y política | `pricing/service.ts`, `pricing/category-policy-service.ts` | Config por sucursal, política por categoría, aplicar precio (`applySuggestedPriceTx`). |
| Excepciones de precio por sucursal | `pricing/branch-price-exception-service.ts` | `setBranchPriceTx` — el escritor central de `branchPrice`. |
| Ajuste dentro de banda (Admin de Sucursal) | `pricing/branch-band-service.ts` | `setBranchPriceInBand`, `applyApprovedPriceOverride`. |
| Vista "lo que hay" | `pricing/current-prices-service.ts` | Precios vigentes — usa el motor, no reimplementa nada. |
| Vista "lo que está mal" | `pricing/tray-service.ts` | Bandeja — lee decisiones ya calculadas por Brain. |
| Detección automática | `brain/detectors/pricing-detector.ts`, `catalog/fusion-pricing-health.ts` | Corre en cada ciclo de Brain; genera las decisiones que la Bandeja muestra. |
| Compras | `purchase-orders/service.ts` | Recibe una orden, actualiza costo/WAC. |
| Importación masiva | `catalog-inventory/import-service.ts` | Mismo camino de escritura, vía Excel. |

**34 archivos de test** cubren estas piezas (`pricing/`, `catalog/`,
`catalog-inventory/`, `inventory/`, `purchase-orders/`,
`brain/detectors/`) — listado completo al final.

---

## 2. Por qué hay DOS cascadas de costo distintas (y es correcto que las haya)

`resolveCatalogDisplayCost` (catálogo) y `resolveCostChain` (venta/POS)
tienen **prioridades distintas a propósito**:

- Catálogo: WAC primero — el costo real medido por compras, antes que
  cualquier campo tecleado a mano.
- Venta: `branchCost` primero — una sucursal puede declarar un costo
  propio (flete, condiciones locales) que debe ganarle al WAC de la red.

No es inconsistencia — son dos preguntas distintas ("¿qué costo tiene este
producto en general?" vs "¿a qué costo se vende hoy en ESTA sucursal?").
Confirmado en el código: cada función tiene su propio comentario
explicando por qué, y ninguna es un accidente de copiar-pegar (son
implementaciones independientes, con parámetros distintos: una recibe
`factor` para fusión, la otra no lo necesita porque quien la llama ya
resolvió el costo del canónico antes).

## 3. Por qué el costo de un derivado de fusión SIEMPRE sale del canónico

`resolveFusionMemberCost(canonicalEffectiveCost, conversionFactor)` — sin
excepción, sin fallback a los campos propios del derivado.

Esto existe por el incidente de la arena: la LATA (canónica) tenía
`globalCost=1.00` (relleno) mientras el METRO (derivado) calculaba
correctamente C$463.84 desde el WAC real. El sistema, antes de esto, dejaba
que el campo propio del derivado (relleno) le ganara al WAC real —
desfase de **18.6×**. `assertNotFusionMemberCostWrite` bloquea a nivel de
código escribir un costo a mano en un derivado, precisamente para que esto
no pueda volver a pasar por otra vía.

**Verificado hoy, a pedido explícito ("¿cómo audita cada producto el
costo, no deberían vivir de forma autónoma?"):** el motor YA unifica
correctamente compras mixtas (a veces suelto, a veces en bulto).
`resolveInventoryProductForMovement` redirige CUALQUIER movimiento —
venga del canónico o de un derivado — al mismo balance de inventario,
convirtiendo cantidad y costo por el factor. Rastreado en
`purchase-orders/service.ts` (`updateGlobalProductCostForReceiptTx` +
`createInventoryMovementTx`): comprar 1 bulto de 30 o 30 sueltas termina
actualizando el mismo WAC real, correctamente convertido. No hacía falta
"que gane el último actualizado" — eso es exactamente el bug de la arena
otra vez, con otro nombre.

## 4. Los guards de escritura — qué bug real corrigió cada uno

| Guard | Bloquea | Incidente que corrige | Test |
|---|---|---|---|
| `assertPriceNotBelowCost` | Guardar un precio menor al costo interno, en catálogo/importación (checkout tiene su propio guard, con override para Master) | Auditoría 2026-07-22: 3 de 5 caminos de edición dejaban guardar precio bajo costo sin aviso | `price-guard.test.ts` |
| `assertNotFusionMemberCostWrite` | Escribir `globalCost` en un miembro DERIVADO de fusión | El bug de la arena (18.6×) | `price-guard.test.ts` |
| `detectPackageCostAsUnitCost` | Un costo por unidad que en realidad es el costo del PAQUETE completo | Incidente real de producción **"Finanzas todo en negativo"** — con HIERRO 3/8 y HIERRO 1/2 como casos documentados con datos reales | `wac.test.ts`, `package-cost-guard.test.ts` (con cifras de producción) |

El tercer guard es la pieza central de esta conversación. Estaba
**verificado y probado con casos reales de HIERRO** — pero solo protegía
movimientos de inventario (compras, ajustes), nunca la edición directa de
"Costo de compra" en Precios y costos. El HIERRO DE 1/4 5.5MM de la
captura casi seguro es el mismo tipo de error (costo de bulto tecleado
como costo de unidad) que ya causó el incidente de 2026, entrando por una
puerta que el guard no cubría todavía. Se cerró hoy (commit `654f9ec`):
mismo guard, mismo umbral (factor≥4), reutilizado sin reescribir nada,
con reintento explícito (`allowHighUnitCost`) para cuando el costo alto
sí es real.

## 5. Las puertas de escritura de `branchPrice`

Ya documentado en `docs/PUERTAS-DE-PRECIO.md` (Fase 4.3 de un ciclo
anterior) — sigue vigente, re-verificado hoy:

- **3 caminos declarados** (Bandeja, Calculadora, editor de catálogo) pasan
  por `setBranchPriceTx` — el único que escribe `branchPrice` JUNTO con
  `priceExceptionReason`/`priceExceptionAt` de forma consistente.
- **2 caminos NO pasan por ahí**: `setBranchPriceInBand` (ajuste de Admin
  de Sucursal dentro de banda) y `applyApprovedPriceOverride` (ejecución
  de aprobación de Master) — cada uno con su propio `upsert` directo,
  sin las columnas de excepción. **Este hueco sigue abierto** — no se
  tocó hoy, sigue siendo cierto lo que dice ese documento.

## 6. Detección automática — hallazgo nuevo

`brain/detectors/pricing-detector.ts` corre en cada ciclo de Brain
(registrado en `brain/engine.ts`) y cubre:

- Margen bajo la política / precio bajo costo (por balance de inventario).
- Costo de sucursal ≥ precio, con detección de costo dudoso
  (`evaluateBranchCostAgainstReference`, umbral 2×).
- Precio sin actualizar después de que el costo cambió
  (`isPriceStaleAgainstCost`).
- Inconsistencia de precio entre sucursales (>25% de diferencia).
- Prorrateo sospechoso (gasto mezclado con unidades de otro ámbito).
- **Coherencia de fusión** (`checkStockGroupPricingHealth`, en
  `catalog/fusion-pricing-health.ts`): `UNSELLABLE` (precio < costo
  efectivo), `MARGIN_OUTLIER` (margen negativo o >90%), `PLACEHOLDER_COST`
  (costo de relleno tipo C$0/C$1 en el canónico con stock real),
  `COST_BASIS_CONFLICT`/`PRICE_BASIS_CONFLICT` (dos presentaciones del
  mismo grupo implican una base de costo o precio distinta más allá de
  5% de tolerancia).

**Este último bloque es exactamente lo que debería haber atrapado el caso
de HIERRO DE 1/4** (precio 1650 < costo efectivo 2,234.89 → `UNSELLABLE`
de manual). Se verificó que el detector SÍ corre — pero:

**Hallazgo:** los tipos que genera `checkStockGroupPricingHealth`
(`REVIEW_FUSION_UNSELLABLE`, `REVIEW_FUSION_MARGIN_OUTLIER`, etc.) **no
están en la lista `APPLICABLE_TYPES` de `tray-service.ts`** — la Bandeja
de la zona Precios. Existen como decisión de Brain (visibles en Centro de
Decisiones) pero nunca llegan a la Bandeja, que es la pantalla que Master
realmente revisa para precios. Es plausible que el caso de HIERRO haya
estado detectado por Brain todo este tiempo, sin que nadie lo viera en el
lugar donde se espera verlo.

## 7. El motor de cálculo (`calculator.ts`) — verificado matemáticamente

Función pura, sin base de datos, ampliamente validada (`calculator.test.ts`):

- `priceByMargin = totalInternalCost / (1 - margen/100)` — margen definido
  como % del PRECIO de venta (no del costo), consistente con
  `grossMarginPercent` en el resultado.
- El precio final es el **máximo** entre: precio por margen, precio por
  utilidad mínima fija, y precio mínimo de mercado (si está declarado) —
  correcto: se quiere satisfacer la restricción más exigente, no
  cualquiera de las tres.
- Redondeo NUNCA baja el precio por debajo del piso calculado
  (`rounded.lt(minPrice) ? minPrice : rounded`) — protege contra que un
  redondeo tipo "terminado en 9" tire el precio bajo el mínimo rentable.
- Guards de entrada: margen debe estar en (0%, 95%) exclusive — evita
  división por cero (margen=100%) y valores absurdos.
- Conflicto de mercado (precio mínimo rentable > precio máximo de
  mercado) bloquea aplicar, con motivo explícito.

Sin hallazgos — esta pieza está sólida.

## 8. Compras e importación — mismos guards, cobertura desigual

- **Compras** (`purchase-orders/service.ts`): pasa por
  `createInventoryMovementTx`, que SÍ tiene `detectPackageCostAsUnitCost`.
  Protegida.
- **Importación Excel** (`catalog-inventory/import-service.ts`): tiene
  `assertPriceNotBelowCost` y `assertNotFusionMemberCostWrite`, pero
  **NO llama a `detectPackageCostAsUnitCost`**. Una fila de Excel con el
  costo del bulto en la columna de costo del canónico pasaría sin aviso.
  No se tocó hoy (fuera del alcance "sin lógica nueva"), queda anotado.

---

## Hallazgos — priorizados, NO corregidos en este ciclo

1. **[Cerrado hoy, commit `654f9ec`]** `detectPackageCostAsUnitCost` no
   protegía la edición directa de "Costo de compra" — la puerta por la
   que casi seguro entró el HIERRO DE 1/4 de la captura.
2. **[Abierto, prioridad alta]** Los issues de `checkStockGroupPricingHealth`
   (fusión: UNSELLABLE, MARGIN_OUTLIER, PLACEHOLDER_COST,
   COST_BASIS_CONFLICT, PRICE_BASIS_CONFLICT) no llegan a la Bandeja —
   solo a Centro de Decisiones. Agregar sus `proposedActionType` a
   `APPLICABLE_TYPES` (con su propio `reason`/grupo, ya que no todos
   traen `suggestedPrice` aplicable en un clic) haría visible en la
   Bandeja exactamente el tipo de problema que esta conversación empezó
   destapando.
3. **[Abierto, ya documentado en `docs/PUERTAS-DE-PRECIO.md`]**
   `setBranchPriceInBand` / `applyApprovedPriceOverride` siguen sin pasar
   por `setBranchPriceTx` — precios fijados por esos dos caminos quedan
   sin `priceExceptionReason`.
4. **[Abierto, prioridad baja]** La importación Excel no tiene el guard
   de "costo de paquete tecleado como costo de unidad" — mismo hueco que
   el punto 1, pero para importación masiva en vez de edición manual.

Ninguno de estos 4 puntos se implementó en este ciclo — es auditoría, no
ejecución, tal como se pidió.
