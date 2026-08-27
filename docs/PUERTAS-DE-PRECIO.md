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

## Dos caminos MÁS que existen y NO pasan por ahí — hueco real, verificado al escribir esta nota

Verificado en el código actual (2026-08-27, rama `Hammer-V1`, sobre el commit
`207356d`) — **no es hipotético, ya está en producción**:

4. **`setBranchPriceInBand`** (`branch-band-service.ts`, camino `IN_BAND`) —
   el ajuste que hace el Admin de Sucursal dentro de la banda de su
   categoría (`POST /api/branch/pricing/set-price`, Fase 4 de
   prompt-motor-precios-lote-herencia-gobierno.md). Escribe `branchPrice` /
   `priceSource` / `lastPriceUpdateAt` / `priceUpdatedByUserId` /
   `marginPercent` con un `tx.branchProductSetting.upsert` propio —
   **nunca toca `priceExceptionReason` ni `priceExceptionAt`**.
5. **`applyApprovedPriceOverride`** (mismo archivo) — ejecuta el precio
   pedido cuando Master aprueba una solicitud `PRICE_OVERRIDE`. Mismo
   patrón: upsert propio, sin las columnas de excepción.

**Consecuencia concreta:** un precio fijado por cualquiera de estos dos
caminos queda con `branchPrice != null` y `priceExceptionReason = null` —
exactamente el estado que `BranchPricingBlock` (`product-360.tsx`) marca
como "Excepción sin motivo registrado" (`hasUnexplainedException: true`).
Es la misma divergencia silenciosa que la Fase 3 de
prompt-motor-precios-lote-herencia-gobierno.md dice haber eliminado
(ver el comentario de cabecera de `setBranchPriceTx`, que afirma "los TRES
caminos que escriben branchPrice... no hay un cuarto lugar donde puedan
desincronizarse" — afirmación cierta cuando se escribió, ya no cierta desde
que la Fase 4 del mismo prompt agregó estos dos sin pasar por acá).

**No se corrigió en este ciclo** — `prompt-mudanza-zona-precios.md` es una
mudanza de UI (dónde vive la calculadora, la bandeja y las políticas), no
una corrección del motor de precios; tocar `branch-band-service.ts` es una
decisión aparte que nadie pidió acá. Queda anotado para que quien lo
corrija sepa exactamente los dos puntos a tocar (hacer que ambos caminos
pasen por `setBranchPriceTx`, con un motivo por defecto tipo "Ajuste dentro
de banda" / "Aprobado por Master" para el `exceptionReason` obligatorio), y
para que nadie vuelva a escribir "los tres caminos pasan por
setBranchPriceTx" sin haber visto esta nota primero.
