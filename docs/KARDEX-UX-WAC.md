# Kardex/Movimientos — UX de conversión de unidad y WAC

## Paso 1 — Diagnóstico

**No hay acceso a base de datos en este entorno** (sin `DATABASE_URL`,
consistente con el resto de este repo en este momento — ver
`docs/COSTO-UNA-FUENTE.md` y `docs/CODIGO-MUERTO.md` para la misma
limitación en tareas anteriores). No se pudo consultar
`wac-history.ts`/`/api/master/inventory/wac-history` contra datos reales
para confirmar si el movimiento `PURCHASE_IN` de quantity=12/unitCost=470
del grupo ARENA existe, en qué producto, ni su resultado real.

Lo que sí se hizo: **diagnóstico estructural** — trazar el código real
(`hammer-frontend/src/components/inventory/inventory-admin.tsx` →
`POST /api/inventory/movements` → `createInventoryMovementTx`,
`inventory/wac.ts`) con esos números exactos, para acotar qué pudo haber
pasado matemáticamente.

### Hallazgo 1 — el formulario no distinguía el derivado del canónico

`loadProducts` llamaba a `/api/catalog/products` **sin `branchId`**:

```ts
const response = await fetch(`/api/catalog/products${q ? `?q=${encodeURIComponent(q)}` : ""}`);
```

`listProducts` (`catalog/service.ts`) solo agrega `stockConversion` al
resultado cuando recibe `branchId` (pasa por
`batchMapProductsWithBranchInventory`); sin él, devuelve el `Product`
crudo. El tipo `ProductOption` del formulario ni siquiera declaraba un
campo `stockConversion`. Resultado: el selector de producto mostraba
"AGG-ARE-STD-0002 · Arena" y "AGG-ARE-150P-0001 · Arena 150p" como dos
opciones idénticas en apariencia — nada indicaba cuál es el canónico
(LATA) y cuál el derivado (METRO, factor N), ni qué unidad se está
tecleando. **Esta es la causa más probable y más barata de corregir**:
si el usuario seleccionó el producto equivocado, ningún guard de WAC lo
iba a notar — un `PURCHASE_IN` posteado directo contra el canónico con
cantidad/costo que en realidad describían el derivado no pasa por
`convertSaleQtyToBaseQty`/`convertSaleUnitCostToBaseUnitCost` en
absoluto (esas conversiones solo aplican cuando `resolved.conversion`
existe para el producto post *tal cual se seleccionó*).

### Hallazgo 2 — el guard de "costo de paquete" no cubre esta dirección

`detectPackageCostAsUnitCost` (`wac.ts:85`) usa como `packageFactor` el
`conversionFactor` **del producto contra el que se postea el
movimiento**. Si se posteó directo contra el **canónico** (factor propio
= 1), el guard sale sin chequear nada (`packageFactor.lt(MIN_FACTOR)` es
cierto para factor=1) — es decir, este guard protege un movimiento mal
tecleado *contra el derivado*, pero no detecta un movimiento posteado
*contra el canónico* con un costo que en realidad correspondía al
derivado.

`detectExcessiveWacJump` sí es universal (no depende de qué producto se
seleccionó), pero solo se activa si el WAC actual es > C$2 y la
cantidad actual es > 0 — con un balance nuevo o casi vacío, tampoco
protege.

### Los números concretos (quantity=12, unitCost=470)

Con el WAC de referencia usado en ejemplos de este ciclo (~C$18.55/lata,
`docs/COSTO-UNA-FUENTE.md`) y un factor típico de fusión de arena (25 o
44, según la presentación):

- **Si se posteó correcto contra el derivado (metro)**: `unitCost` se
  divide por el factor antes de tocar el WAC
  (`convertSaleUnitCostToBaseUnitCost = saleUnitCost / factor`). Con
  factor=25: C$470 ÷ 25 ≈ **C$18.80/lata** — prácticamente igual al WAC
  de referencia. Con factor=44: C$470 ÷ 44 ≈ **C$10.68/lata** — una
  baja notable pero no bloqueada por ningún guard (`detectExcessiveWacJump`
  solo bloquea subidas, nunca bajadas). **En ninguno de los dos casos el
  guard de "costo de paquete" se activa** — el movimiento correcto
  probablemente sí se habría guardado.
- **Si se posteó por error contra el canónico (lata) directo**: sin
  conversión, C$470 queda como el costo POR LATA — **25×-44× el WAC de
  referencia**. `detectPackageCostAsUnitCost` no lo atrapa (factor propio
  del canónico = 1, ver Hallazgo 2). `detectExcessiveWacJump` sí
  probablemente lo atrapa (un salto de esa magnitud excede +50% salvo
  que el balance previo fuera prácticamente cero) — devolviendo
  `EXCESSIVE_WAC_JUMP` (409), que el formulario **no manejaba** (mostraba
  el mensaje del backend en un toast genérico, sin ninguna forma de
  reintentar autorizando). Si el balance previo SÍ era casi cero, ningún
  guard se activa y el WAC habría quedado corrompido en silencio con
  ~C$470/lata.

### Conclusión, con la evidencia disponible

El escenario más consistente con "un movimiento que no se guardó como se
esperaba" es: **se posteó contra el producto equivocado** (canónico en
vez de derivado, o viceversa — el selector no distinguía ninguno de los
dos) y, según qué tan lleno estuviera el balance en ese momento, o bien
quedó bloqueado por `EXCESSIVE_WAC_JUMP` sin manera de proceder desde la
pantalla, o bien se guardó con un WAC muy distorsionado sin que ningún
guard lo notara. **No se puede confirmar cuál de las dos sin acceso a la
base de datos real** — este documento queda como el mapa para verificarlo
en cuanto haya un entorno con datos: revisar `wac-history` del grupo
ARENA buscando exactamente `quantity=12`, `unitCost=470` o
`unitCost≈10.68/18.80` (el equivalente ya convertido), y si aparece un
`INVENTORY_MOVEMENT_DENIED`/`INVENTORY_MOVEMENT_REJECTED` en el audit log
alrededor de esa fecha con `reason` relacionado a WAC.

## Paso 2 — Arreglado

`inventory-admin.tsx`:
- `loadProducts` ahora pide `branchId` — `stockConversion` viaja en cada
  producto del selector.
- El propio `<option>` de cada producto muestra el sufijo
  `(METRO, ×44 LATA)` cuando es un miembro derivado — visible ANTES de
  seleccionarlo, no solo después.
- Con un derivado seleccionado, un texto bajo el formulario:
  "Guardando en METRO (= 44 LATA). Costo equivalente: C$X por LATA." —
  el mismo cálculo que hace el backend
  (`convertSaleUnitCostToBaseUnitCost`), mostrado antes de enviar.
- Vista previa del WAC (`GET /api/inventory/movements/preview`, nuevo —
  `previewInventoryMovement` en `inventory/service.ts`, reusa
  `recalculateWeightedAverage` sin escribir nada): "WAC actual: C$X →
  WAC nuevo: C$Y (+Z%)", debounced, se limpia sola con campos inválidos.
- `SUSPECTED_PACKAGE_COST_AS_UNIT_COST` y `EXCESSIVE_WAC_JUMP` ahora se
  manejan con el mismo patrón `confirm()`+reintento ya establecido en
  `fusion-pricing-panel.tsx` y `catalog-inventory-admin.tsx` — antes
  truncaban el flujo en un toast genérico sin salida.

## Paso 3 — Arreglado

`fusion-pricing-panel.tsx`: el encabezado "Costo global" tiene ahora un
`title` explícito ("Referencia manual editable. El margen... siempre usa
el WAC de compras real, no este número") y el toast de éxito al guardar
un costo global agrega una línea corta con el mismo recordatorio — antes
solo estaba en el banner superior, leído una vez y fácil de olvidar en
el momento de guardar.

## No tocado (a propósito)

`wac.ts` y `unit-conversion.ts` — su matemática ya estaba correcta y
verificada; todo el trabajo de este ciclo fue de visibilidad/UX en
`inventory-admin.tsx` y `fusion-pricing-panel.tsx`, más un endpoint de
vista previa nuevo que reusa esa matemática sin duplicarla.
