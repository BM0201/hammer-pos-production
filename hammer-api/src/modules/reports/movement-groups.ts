import { InventoryMovementType } from "@prisma/client";

/**
 * CAMBIO 4 (prompt-reportes-v2): mapa único movementType → grupo para el
 * reporte de Movimientos de materiales. Único lugar donde se clasifica —
 * nadie debe hardcodear esta lista en la lógica del reporte ni en el filtro.
 *
 * Clasificación de los tipos que el prompt no menciona explícitamente
 * (verificada contra el uso real en inventory/service.ts y sales-returns/service.ts,
 * no adivinada):
 * - PACKAGE_IN: inventory/service.ts la usa como variante de PURCHASE_IN
 *   cuando el insumo llega ya empaquetado → Ingresos (junto a PURCHASE_IN).
 * - RETURN_IN_DAMAGED: sales-returns/service.ts, devolución de cliente a
 *   bodega de dañados — sigue siendo un ingreso físico → Ingresos.
 * - LOOSE_UNIT_RETURN_IN: inventory/service.ts, variante "suelta" de
 *   RETURN_IN → Ingresos.
 * - PACKAGE_OPENED / PACKAGE_AUTO_OPENED: conversión interna de paquete
 *   cerrado a unidades sueltas (mismo valor, cambia la forma) → Conteos/ajustes.
 * - PRODUCTION_CONSUME / PRODUCTION_WASTE: consumo y merma de un lote de
 *   producción — PRODUCTION_WASTE es literalmente la merma que el prompt pide
 *   distinguir dentro de "Conteos" vía `reason` → Conteos/ajustes.
 * - PRODUCTION_REVERSAL_IN / PRODUCTION_REVERSAL_OUT: reversan un lote ya
 *   completado — son correcciones, el otro caso que "Conteos" debe distinguir
 *   por `reason` → Conteos/ajustes.
 * - RETURN_OUT: inventory/policy.ts la agrupa junto a TRANSFER_IN/OUT bajo
 *   "WAREHOUSE" (movimiento manual de bodega) pero no es un traslado entre
 *   sucursales ni una venta — es una salida sin contrapartida comercial,
 *   misma naturaleza que un ajuste → Conteos/ajustes.
 */
export type MovementGroup = "envios" | "ingresos" | "conteos" | "ventas";

export const MOVEMENT_GROUP_LABEL: Record<MovementGroup, string> = {
  envios: "Envíos",
  ingresos: "Ingresos",
  conteos: "Conteos y ajustes",
  ventas: "Ventas de materiales",
};

export const MOVEMENT_TYPE_GROUP: Record<InventoryMovementType, MovementGroup> = {
  TRANSFER_OUT: "envios",
  TRANSFER_IN: "envios",

  PURCHASE_IN: "ingresos",
  PACKAGE_IN: "ingresos",
  TIMBER_INTAKE_IN: "ingresos",
  PRODUCTION_OUTPUT: "ingresos",
  RETURN_IN: "ingresos",
  RETURN_IN_DAMAGED: "ingresos",
  LOOSE_UNIT_RETURN_IN: "ingresos",

  ADJUSTMENT_IN: "conteos",
  ADJUSTMENT_OUT: "conteos",
  LOOSE_ADJUSTMENT: "conteos",
  PACKAGE_ADJUSTMENT: "conteos",
  PACKAGE_OPENED: "conteos",
  PACKAGE_AUTO_OPENED: "conteos",
  PRODUCTION_CONSUME: "conteos",
  PRODUCTION_WASTE: "conteos",
  PRODUCTION_REVERSAL_IN: "conteos",
  PRODUCTION_REVERSAL_OUT: "conteos",
  RETURN_OUT: "conteos",

  SALE_OUT: "ventas",
  PACKAGE_SALE_OUT: "ventas",
  LOOSE_UNIT_SALE_OUT: "ventas",
};

export function resolveMovementGroup(type: InventoryMovementType): MovementGroup {
  return MOVEMENT_TYPE_GROUP[type];
}

/**
 * Signo para la columna "cantidad" del reporte. `quantity` en InventoryMovement
 * se guarda SIEMPRE como magnitud absoluta (verificado: p.ej. el ajuste manual
 * usa `netBaseDelta.abs()` y decide ADJUSTMENT_IN/OUT por el signo); el signo
 * real lo da el `movementType`. PACKAGE_OPENED/PACKAGE_AUTO_OPENED no tienen
 * signo natural (quantity=1, cuenta de paquetes abiertos — el antes/después
 * real vive en closedPackageBefore/After); LOOSE_ADJUSTMENT/PACKAGE_ADJUSTMENT
 * no se crean en ningún flujo actual (verificado con grep) — se dejan neutras
 * en vez de adivinar.
 */
const OUTFLOW_TYPES = new Set<InventoryMovementType>([
  "SALE_OUT", "PACKAGE_SALE_OUT", "LOOSE_UNIT_SALE_OUT",
  "ADJUSTMENT_OUT", "TRANSFER_OUT", "RETURN_OUT",
  "PRODUCTION_CONSUME", "PRODUCTION_WASTE", "PRODUCTION_REVERSAL_OUT",
]);

export function signedMovementQuantity(type: InventoryMovementType, quantity: number): number {
  return OUTFLOW_TYPES.has(type) ? -Math.abs(quantity) : Math.abs(quantity);
}

export const MOVEMENT_TYPES_BY_GROUP: Record<MovementGroup, InventoryMovementType[]> = (() => {
  const byGroup = { envios: [], ingresos: [], conteos: [], ventas: [] } as Record<MovementGroup, InventoryMovementType[]>;
  (Object.keys(MOVEMENT_TYPE_GROUP) as InventoryMovementType[]).forEach((type) => {
    byGroup[MOVEMENT_TYPE_GROUP[type]].push(type);
  });
  return byGroup;
})();
