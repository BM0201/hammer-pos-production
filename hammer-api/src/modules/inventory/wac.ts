import { Prisma } from "@prisma/client";

const INBOUND_TYPES = new Set([
  "PURCHASE_IN",
  "RETURN_IN",
  "ADJUSTMENT_IN",
  "TRANSFER_IN",
  "TIMBER_INTAKE_IN",
  "PRODUCTION_OUTPUT",
  "PRODUCTION_REVERSAL_IN",
] as const);

export function isInboundMovement(movementType: string): boolean {
  return INBOUND_TYPES.has(movementType as never);
}

/* ────────────────────────────────────────────────────────────────
 * WAC-specific validation errors
 * ──────────────────────────────────────────────────────────────── */
export class WacValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WacValidationError";
  }
}

/* ────────────────────────────────────────────────────────────────
 * Validate movement inputs before WAC calculation
 * ──────────────────────────────────────────────────────────────── */
export function validateMovementInputs(input: {
  movementQty: Prisma.Decimal;
  movementUnitCost: Prisma.Decimal;
  inbound: boolean;
}) {
  const zero = new Prisma.Decimal(0);

  // Quantity must always be strictly positive
  if (input.movementQty.lte(zero)) {
    throw new WacValidationError(
      "INVALID_MOVEMENT_QUANTITY",
      "Movement quantity must be greater than zero.",
    );
  }

  // Unit cost must never be negative
  if (input.movementUnitCost.lt(zero)) {
    throw new WacValidationError(
      "NEGATIVE_UNIT_COST",
      "Unit cost cannot be negative.",
    );
  }

  // Inbound movements MUST have a positive unit cost (zero cost skews WAC)
  if (input.inbound && input.movementUnitCost.eq(zero)) {
    throw new WacValidationError(
      "ZERO_COST_INBOUND",
      "Inbound movements must have a positive unit cost to preserve WAC integrity.",
    );
  }
}

/* ────────────────────────────────────────────────────────────────
 * Guard: detect the "paquete cost entered as unit cost" mistake
 * ────────────────────────────────────────────────────────────────
 * Root cause of the "Finanzas todo en negativo" incident: staff typed
 * the cost of a WHOLE PACKAGE (e.g. a "HIERRO" = 14 varillas, a metro/
 * lata of arena/piedrín) into the per-unit cost field of an inbound
 * movement. That inflated the WAC ~conversionFactor× and ballooned COGS
 * on every subsequent sale, turning gross profit red.
 *
 * This guard fires ONLY on inbound movements for packaged products that
 * already have a real reference WAC. It flags a unit cost that looks like
 * it was multiplied by (roughly) the package factor. It is intentionally
 * conservative (RATIO 0.6, MIN_FACTOR 4) so normal price increases and
 * spikes pass; only clearly package-sized costs are blocked.
 *
 * Limitation: it cannot catch the FIRST entry of a brand-new product
 * (no reference WAC yet). It covers the common re-entry case seen in the
 * production data. A legitimate large jump can be forced through by
 * passing allowHighUnitCost = true.
 */
export function detectPackageCostAsUnitCost(input: {
  inbound: boolean;
  baseMovementUnitCost: Prisma.Decimal;
  existingWac: Prisma.Decimal;
  packageFactor: Prisma.Decimal;
  allowHighUnitCost?: boolean;
}): void {
  if (input.allowHighUnitCost) return;
  if (!input.inbound) return;

  const FLOOR = new Prisma.Decimal(2); // ignora WAC placeholder ~C$1-2
  const MIN_FACTOR = new Prisma.Decimal(4); // metales/agregados; ignora presentaciones sueltas
  const RATIO = new Prisma.Decimal("0.6"); // margen para alzas normales de precio

  if (input.packageFactor.lt(MIN_FACTOR)) return;
  if (input.existingWac.lte(FLOOR)) return;

  const threshold = input.existingWac.mul(input.packageFactor).mul(RATIO);
  if (input.baseMovementUnitCost.gte(threshold)) {
    const factorStr = input.packageFactor.toFixed(0);
    throw new WacValidationError(
      "SUSPECTED_PACKAGE_COST_AS_UNIT_COST",
      `El costo por unidad ingresado (C$${input.baseMovementUnitCost.toFixed(2)}) parece ser el costo del ` +
        `PAQUETE completo, no el de una sola unidad. El costo de referencia por unidad es ~C$${input.existingWac.toFixed(2)} ` +
        `y este producto trae ${factorStr} unidades por paquete. Divida el costo del paquete entre ${factorStr} e ingrese ` +
        `el costo por unidad. Si de verdad es el costo correcto, reintente autorizando costo alto (allowHighUnitCost).`,
    );
  }
}

/* ────────────────────────────────────────────────────────────────
 * Core WAC recalculation with validations
 * ──────────────────────────────────────────────────────────────── */
export function recalculateWeightedAverage(input: {
  currentQty: Prisma.Decimal;
  currentWac: Prisma.Decimal;
  movementQty: Prisma.Decimal;
  movementUnitCost: Prisma.Decimal;
  inbound: boolean;
}) {
  const zero = new Prisma.Decimal(0);
  const currentQty = input.currentQty;
  const currentWac = input.currentWac;

  // Pre-calculation validations
  validateMovementInputs({
    movementQty: input.movementQty,
    movementUnitCost: input.movementUnitCost,
    inbound: input.inbound,
  });

  // Validate current state consistency
  if (currentQty.lt(zero)) {
    throw new WacValidationError(
      "NEGATIVE_CURRENT_QUANTITY",
      "Current quantity on hand is negative — data inconsistency detected.",
    );
  }
  if (currentWac.lt(zero)) {
    throw new WacValidationError(
      "NEGATIVE_CURRENT_WAC",
      "Current WAC is negative — data inconsistency detected.",
    );
  }

  if (input.inbound) {
    const newQty = currentQty.plus(input.movementQty);
    if (newQty.lte(zero)) {
      throw new WacValidationError(
        "INVALID_INBOUND_QUANTITY",
        "Resulting quantity after inbound movement is not positive.",
      );
    }

    const incomingCost = input.movementQty.mul(input.movementUnitCost);
    const existingCost = currentQty.mul(currentWac);
    const newWac = existingCost.plus(incomingCost).div(newQty);

    // Post-calculation WAC sanity check
    if (newWac.lt(zero)) {
      throw new WacValidationError(
        "NEGATIVE_RESULTING_WAC",
        "Calculated WAC is negative — this should never happen with valid inputs.",
      );
    }

    const inventoryValue = newQty.mul(newWac);
    return { newQty, newWac, inventoryValue };
  }

  // Outbound: ensure sufficient stock
  if (currentQty.lt(input.movementQty)) {
    throw new Error("INSUFFICIENT_STOCK");
  }

  const newQty = currentQty.minus(input.movementQty);
  const newWac = currentWac; // WAC is preserved on outbound
  const inventoryValue = newQty.mul(newWac);

  // Post-calculation sanity: inventory value must not be negative
  if (inventoryValue.lt(zero)) {
    throw new WacValidationError(
      "NEGATIVE_INVENTORY_VALUE",
      "Resulting inventory value is negative — data inconsistency.",
    );
  }

  return { newQty, newWac, inventoryValue };
}
