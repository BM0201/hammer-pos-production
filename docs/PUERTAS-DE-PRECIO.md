# Puertas de precio — quién escribe `branchPrice`

Registro de los caminos que escriben el precio de un producto por sucursal
(`BranchProductSetting.branchPrice`), para que no se abra una puerta nueva
sin pasar por la existente. Escrito en la Fase 4.3 de
`prompt-mudanza-zona-precios.md`, al enlazar la zona Precios
(`/app/master/pricing`) con el editor de precio por sucursal en Catálogo.

## Los tres caminos "declarados" en la zona Precios y el catálogo

1. **Bandeja** (`POST /api/master/pricing/tray/apply` →
   `applyPricingTraySelection` en `tray-service.ts` → `applySuggestedPriceTx`)
2. **Calculadora** (`POST /api/pricing/apply` → `applySuggestedPrice` en
   `pricing/service.ts` → `applySuggestedPriceTx`)
3. **Editor de catálogo, excepción declarada** (`POST /api/master/pricing/
   product/{id}/branches/{id}/set-price` → `setBranchPriceException`)

Los tres terminan en `setBranchPriceTx` (`branch-price-exception-service.ts`),
el único lugar que escribe `branchPrice` JUNTO con `priceExceptionReason` /
`priceExceptionAt` de forma consistente, y exige motivo (≥3 caracteres)
cuando `branchPrice != null`. Es la garantía de que "sigue el general" vs
"excepción declarada" no diverjan en silencio (prompt-motor-precios-lote-
herencia-gobierno.md, Fase 3).

## Dos caminos MÁS que existían y NO pasaban por ahí — [Cerrado, commit `4388eb5`]

Verificado en el código actual (2026-08-27, rama `Hammer-V1`, sobre el commit
`207356d`) — **no era hipotético, estaba en producción**. Cerrado el
2026-08-31 (`docs/AUDITORIA-MOTOR-PRECIOS-COSTOS.md`, hallazgo #3):

4. **`setBranchPriceInBand`** (`branch-band-service.ts`, camino `IN_BAND`) —
   el ajuste que hace el Admin de Sucursal dentro de la banda de su
   categoría (`POST /api/branch/pricing/set-price`, Fase 4 de
   prompt-motor-precios-lote-herencia-gobierno.md). Escribía `branchPrice` /
   `priceSource` / `lastPriceUpdateAt` / `priceUpdatedByUserId` /
   `marginPercent` con un `tx.branchProductSetting.upsert` propio —
   **nunca tocaba `priceExceptionReason` ni `priceExceptionAt`**.
5. **`applyApprovedPriceOverride`** (mismo archivo) — ejecuta el precio
   pedido cuando Master aprueba una solicitud `PRICE_OVERRIDE`. Mismo
   patrón: upsert propio, sin las columnas de excepción.

**Consecuencia concreta (ya no vigente):** un precio fijado por cualquiera
de estos dos caminos quedaba con `branchPrice != null` y
`priceExceptionReason = null` — exactamente el estado que
`BranchPricingBlock` (`product-360.tsx`) marca como "Excepción sin motivo
registrado" (`hasUnexplainedException: true`). Era la misma divergencia
silenciosa que la Fase 3 de prompt-motor-precios-lote-herencia-gobierno.md
decía haber eliminado.

**Cómo quedó cerrado:** ambos caminos ahora llaman a `setBranchPriceTx`.
`setBranchPriceInBand` usa el motivo del cajero si vino, o
`"Ajuste dentro de la banda de la categoría"` por defecto (el flujo no pide
motivo obligatorio — es un ajuste cotidiano). `applyApprovedPriceOverride`
lee el motivo que viajó en `payloadJson` desde que se pidió la excepción
(agregado ahí mismo para que sobreviva hasta la ejecución), con
`"Precio bajo el margen mínimo de la categoría (aprobado)"` como respaldo
para solicitudes viejas sin ese campo. Los cuerpos transaccionales se
extrajeron a `setBranchPriceInBandTx`/`applyApprovedPriceOverrideTx` (mismo
patrón que `upsertBranchProductSettingTx`) para poder probarlos con un `tx`
en memoria — `branch-band.test.ts` confirma que las columnas de excepción
sí quedan escritas.

Ahora son **cinco** los caminos que pasan por `setBranchPriceTx` — el
comentario de cabecera de `setBranchPriceTx` se actualizó en el mismo
cierre para reflejarlo.
