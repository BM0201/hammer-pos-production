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

export const openingBalanceSchema = z.object({
  branchId: z.string().cuid(),
  productId: z.string().cuid(),
  quantity: z.coerce.number().positive("La cantidad inicial debe ser mayor que cero."),
  unit: z.string().min(1).max(32).optional(),
  unitCost: z.coerce.number().nonnegative("El costo inicial no puede ser negativo.").optional().nullable(),
  costMode: z.enum(["SET_WAC", "SET_BRANCH_COST", "QUANTITY_ONLY"]).default("SET_WAC"),
  salePrice: z.coerce.number().nonnegative("El precio inicial no puede ser negativo.").optional().nullable(),
  priceMode: z.enum(["SET_BRANCH_PRICE", "SET_GLOBAL_PRICE", "NO_PRICE_CHANGE"]).default("SET_BRANCH_PRICE"),
  reason: z.string().min(5, "El motivo es obligatorio.").max(300),
  notes: z.string().max(500).optional().nullable(),
}).superRefine((data, ctx) => {
  if ((data.costMode === "SET_WAC" || data.costMode === "SET_BRANCH_COST") && (!data.unitCost || data.unitCost <= 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["unitCost"],
      message: "Este modo de costo requiere un costo inicial mayor que cero.",
    });
  }
  if ((data.priceMode === "SET_BRANCH_PRICE" || data.priceMode === "SET_GLOBAL_PRICE") && (!data.salePrice || data.salePrice <= 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["salePrice"],
      message: "Este modo de precio requiere un precio de venta mayor que cero.",
    });
  }
});


