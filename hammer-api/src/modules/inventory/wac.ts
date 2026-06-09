import { Prisma } from "@prisma/client";

const INBOUND_TYPES = new Set([
  "PURCHASE_IN",
  "RETURN_IN",
  "ADJUSTMENT_IN",
  "TRANSFER_IN",
  "TIMBER_INTAKE_IN",
  "PRODUCTION_OUTPUT",
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
 * Insufficient-stock error (negative-stock prevention)
 *
 * Se lanza cuando un movimiento de salida dejaria el inventario en
 * negativo. Mantiene `message = "INSUFFICIENT_STOCK"` para conservar la
 * compatibilidad con los manejadores existentes que comparan por mensaje,
 * pero expone cantidades (`available` / `requested`) y un mensaje
 * descriptivo en espanol (`detail`) para mostrar al usuario final.
 * ──────────────────────────────────────────────────────────────── */
export class InsufficientStockError extends Error {
  constructor(
    public readonly available: Prisma.Decimal,
    public readonly requested: Prisma.Decimal,
    public readonly unit?: string | null,
  ) {
    super("INSUFFICIENT_STOCK");
    this.name = "InsufficientStockError";
  }

  /** Mensaje descriptivo en espanol para el usuario final. */
  get detail(): string {
    const u = this.unit ? ` ${this.unit}` : "";
    return (
      `Stock insuficiente: disponible ${this.available.toString()}${u}, ` +
      `solicitado ${this.requested.toString()}${u}. El movimiento dejaria el inventario en negativo.`
    );
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
 * Core WAC recalculation with validations
 * ──────────────────────────────────────────────────────────────── */
export function recalculateWeightedAverage(input: {
  currentQty: Prisma.Decimal;
  currentWac: Prisma.Decimal;
  movementQty: Prisma.Decimal;
  movementUnitCost: Prisma.Decimal;
  inbound: boolean;
  /** Unidad base del movimiento, usada para mensajes de error descriptivos. */
  unit?: string | null;
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

  // Outbound: ensure sufficient stock (negative-stock prevention).
  if (currentQty.lt(input.movementQty)) {
    throw new InsufficientStockError(currentQty, input.movementQty, input.unit);
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
