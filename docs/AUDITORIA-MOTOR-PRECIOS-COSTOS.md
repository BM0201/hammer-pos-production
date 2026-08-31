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

Se encontraron **4 huecos reales, verificados** (sección "Hallazgos", el
punto 1 ya venía cerrado de un ciclo anterior). Ninguno justificaba una
reescritura — los 4 son extensiones puntuales de guards que ya existen, y
los 4 quedaron cerrados en el ciclo siguiente a esta auditoría.

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
- **2 caminos NO pasaban por ahí**: `setBranchPriceInBand` (ajuste de Admin
  de Sucursal dentro de banda) y `applyApprovedPriceOverride` (ejecución
  de aprobación de Master) — cada uno con su propio `upsert` directo,
  sin las columnas de excepción. **[Cerrado, commit `4388eb5`]** — ambos
  caminos ahora pasan por `setBranchPriceTx`; sus cuerpos transaccionales
  se extrajeron a `setBranchPriceInBandTx`/`applyApprovedPriceOverrideTx`
  (mismo patrón que `upsertBranchProductSettingTx`) para poder probar con
  un `tx` en memoria que `priceExceptionReason`/`priceExceptionAt` sí
  quedan escritos. `docs/PUERTAS-DE-PRECIO.md` queda desactualizado por
  este cierre — pendiente de una pasada rápida para reflejarlo.

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

**Hallazgo [Cerrado, commit `2aec606`]:** los tipos que genera
`checkStockGroupPricingHealth` (`REVIEW_FUSION_UNSELLABLE`,
`REVIEW_FUSION_MARGIN_OUTLIER`, etc.) no estaban en la lista
`APPLICABLE_TYPES` de `tray-service.ts` — la Bandeja de la zona Precios.
Existían como decisión de Brain (visibles en Centro de Decisiones) pero
nunca llegaban a la Bandeja, que es la pantalla que Master realmente
revisa para precios. Es plausible que el caso de HIERRO haya estado
detectado por Brain todo este tiempo, sin que nadie lo viera en el lugar
donde se espera verlo. Se agregó SOLO `REVIEW_FUSION_UNSELLABLE` (mismo
síntoma que `REVIEW_PRICE_BELOW_COST`, con un precio/costo de un solo
producto limpio) — los otros cuatro `FusionPricingIssueKind` quedan fuera
a propósito: no tienen un precio/costo de un solo producto que una fila
de la Bandeja sepa mostrar (`COST_BASIS_CONFLICT`/`PRICE_BASIS_CONFLICT`
implican varios `productId` a la vez). Como `checkStockGroupPricingHealth`
nunca calcula un precio sugerido, estas filas entran como informativas
(`applicable: false`, mismo tratamiento visual que `costLooksWrong`) — se
ven, no se aplican con un clic.

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
- **Importación Excel** (`catalog-inventory/import-service.ts`): tenía
  `assertPriceNotBelowCost` y `assertNotFusionMemberCostWrite`, pero no
  llamaba a `detectPackageCostAsUnitCost`. Una fila de Excel con el costo
  del bulto en la columna de costo del canónico pasaría sin aviso.
  **[Cerrado, commit `726ccef`]** — mismo guard, mismo umbral (factor≥4),
  cableado en el mismo bloque que ya resolvía `assertNotFusionMemberCostWrite`,
  solo para el CANÓNICO. Sin columna de "reintentar con costo alto" en el
  Excel (a diferencia de `updateProduct`) — si el costo del bulto es
  correcto, se corrige la celda y se reimporta, o se carga desde Precios y
  costos, que sí tiene el reintento.

---

## Hallazgos — priorizados

1. **[Cerrado, commit `654f9ec`]** `detectPackageCostAsUnitCost` no
   protegía la edición directa de "Costo de compra" — la puerta por la
   que casi seguro entró el HIERRO DE 1/4 de la captura.
2. **[Cerrado, commit `2aec606`]** Los issues de `checkStockGroupPricingHealth`
   (fusión: UNSELLABLE, MARGIN_OUTLIER, PLACEHOLDER_COST,
   COST_BASIS_CONFLICT, PRICE_BASIS_CONFLICT) no llegaban a la Bandeja —
   solo a Centro de Decisiones. Se agregó `REVIEW_FUSION_UNSELLABLE` a
   `APPLICABLE_TYPES` (bucket `BELOW_COST`, informativa/no aplicable con
   un clic) — ver §6.
3. **[Cerrado, commit `4388eb5`]** `setBranchPriceInBand` /
   `applyApprovedPriceOverride` ya pasan por `setBranchPriceTx` —
   `docs/PUERTAS-DE-PRECIO.md` documentaba este hueco, pendiente de una
   pasada rápida para reflejar el cierre.
4. **[Cerrado, commit `726ccef`]** La importación Excel ya tiene el guard
   de "costo de paquete tecleado como costo de unidad" en el canónico —
   mismo guard que el punto 1, cableado también en importación masiva.

Los 4 puntos quedaron implementados y verificados (tsc limpio, suite
completa sin regresiones — la única falla es la preexistente de
`fusion-composition.test.ts`, sin relación con ninguno de estos cambios)
en el ciclo posterior a esta auditoría, a pedido explícito: "Mejor esos
bugs que estan busca repararlos y ejecutarlos bien".
