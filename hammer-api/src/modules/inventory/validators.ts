import { z } from "zod";

const INBOUND_MOVEMENT_TYPES = [
  "PURCHASE_IN",
  "RETURN_IN",
  "ADJUSTMENT_IN",
  "TRANSFER_IN",
  "TIMBER_INTAKE_IN",
] as const;

export const createInventoryMovementSchema = z
  .object({
    branchId: z.string().cuid(),
    productId: z.string().cuid(),
    movementType: z.enum([
      "PURCHASE_IN",
      "SALE_OUT",
      "RETURN_IN",
      "RETURN_OUT",
      "ADJUSTMENT_IN",
      "ADJUSTMENT_OUT",
      "TRANSFER_OUT",
      "TRANSFER_IN",
      "TIMBER_INTAKE_IN",
    ]),
    quantity: z.coerce.number().positive("Quantity must be greater than zero."),
    unitCost: z.coerce.number().nonnegative("Unit cost cannot be negative."),
    referenceType: z.string().min(1).max(64),
    referenceId: z.string().min(1).max(64),
    notes: z.string().max(500).optional().nullable(),
  })
  .refine(
    (data) => {
      // Inbound movements must have a strictly positive unit cost
      if ((INBOUND_MOVEMENT_TYPES as readonly string[]).includes(data.movementType)) {
        return data.unitCost > 0;
      }
      return true;
    },
    {
      message: "Inbound movements require a positive unit cost (> 0) for WAC integrity.",
      path: ["unitCost"],
    },
  );

export const stockAdjustmentSchema = z.object({
  branchId: z.string().cuid(),
  productId: z.string().cuid(),
  desiredQuantity: z.coerce.number().nonnegative(),
  reason: z.string().min(5).max(500),
});

export const manualInventoryAdjustmentSchema = z.object({
  branchId: z.string().cuid(),
  productId: z.string().cuid(),
  adjustmentType: z.enum(["ADJUSTMENT_IN", "ADJUSTMENT_OUT", "PHYSICAL_COUNT", "DAMAGE", "RETURN", "OTHER"]),
  quantity: z.coerce.number().positive("La cantidad debe ser mayor que cero."),
  unit: z.string().min(1).max(32).optional(),
  reason: z.string().min(5, "El motivo es obligatorio.").max(300),
  notes: z.string().max(500).optional().nullable(),
});
