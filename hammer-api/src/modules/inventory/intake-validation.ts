/**
 * Fase 1 (prompt-entrada-inventario.md) — "¿qué está bien, qué hay que
 * revisar y qué impide guardar?", por línea. Pura, sin DB: la vista previa
 * (intake-preview-service.ts) resuelve todos los datos reales (stock,
 * costo, última compra, OC pendiente, compra típica) y esta función solo
 * decide, con esos números ya en la mano.
 */

export type IntakeKind = "ADD_STOCK" | "PHYSICAL_COUNT" | "OPENING_BALANCE";
export type IntakeLineStatus = "OK" | "REVIEW" | "ERROR";

export type IntakeValidationMessage = {
  /** Para poder testear/filtrar sin parsear el texto en español. */
  code:
    | "MISSING_QUANTITY"
    | "OPENING_BALANCE_NO_COST"
    | "OPENING_BALANCE_HAS_STOCK"
    | "NO_COST_NO_AVERAGE"
    | "PRICE_BELOW_COST"
    | "PRODUCT_BLOCKED"
    | "COST_DEVIATION"
    | "COUNT_DROPS_SHARPLY"
    | "PENDING_PURCHASE_ORDER"
    | "QUANTITY_FAR_ABOVE_TYPICAL";
  text: string;
  /** Solo en PENDING_PURCHASE_ORDER — para el botón "Recibir OC-XXXX →". */
  poId?: string;
};

export type ValidateIntakeLineInput = {
  kind: IntakeKind;
  /** null = el campo quedó vacío (nunca se escribió nada) — distinto de 0, que sí es un valor real en PHYSICAL_COUNT. */
  quantity: number | null;
  currentQty: number;
  enteredCost: number | null;
  /** Costo efectivo ANTES de esta línea (branchCost > WAC > averageCost > globalCost > lastPurchaseCost) — null = sin costo previo. */
  currentEffectiveCost: number | null;
  lastPurchaseCost: number | null;
  /** Precio de venta nuevo, solo si la fila lo cambia (Fase 2, "⋯ → Cambiar precio de venta"). null = no se toca. */
  newPrice: number | null;
  productBlocked: { reason: string } | null;
  pendingPurchaseOrder: { poId: string; orderNumber: string } | null;
  /** Compra típica (p.ej. mediana de cantidad por línea de compra) — null = sin historial suficiente. */
  typicalPurchaseQuantity: number | null;
};

export type IntakeLineValidation = { status: IntakeLineStatus; messages: IntakeValidationMessage[] };

/** Mismo umbral (40%) que suspectCostFarFromPurchase (cost-correction-service.ts) — acá genérico (promedio actual O última compra), sin requerir que el producto tenga conversión de paquete. */
const COST_DEVIATION_THRESHOLD = 0.4;
/** "conteo que baja más de 50% o deja en 0". */
const COUNT_DROP_THRESHOLD = 0.5;
/** "cantidad más de 10 veces la compra típica". */
const TYPICAL_PURCHASE_MULTIPLE = 10;

function deviates(a: number, reference: number): boolean {
  if (reference <= 0) return false;
  return Math.abs(a - reference) / reference > COST_DEVIATION_THRESHOLD;
}

export function validateIntakeLine(input: ValidateIntakeLineInput): IntakeLineValidation {
  const errors: IntakeValidationMessage[] = [];
  const reviews: IntakeValidationMessage[] = [];

  // ── Errores (impiden guardar) ──────────────────────────────────────────
  if (input.productBlocked) {
    errors.push({ code: "PRODUCT_BLOCKED", text: input.productBlocked.reason });
  }

  const quantityWritten = input.quantity !== null;
  const quantityValidForKind = input.kind === "PHYSICAL_COUNT" ? quantityWritten && input.quantity! >= 0 : quantityWritten && input.quantity! > 0;
  if (!quantityValidForKind) {
    errors.push({
      code: "MISSING_QUANTITY",
      text: !quantityWritten
        ? "Falta la cantidad."
        : input.kind === "PHYSICAL_COUNT"
          ? "La cantidad no puede ser negativa."
          : "La cantidad debe ser mayor a 0.",
    });
  }

  if (input.kind === "OPENING_BALANCE") {
    if (input.enteredCost === null || input.enteredCost <= 0) {
      errors.push({ code: "OPENING_BALANCE_NO_COST", text: "Carga inicial necesita un costo mayor a 0." });
    }
    if (input.currentQty > 0) {
      errors.push({ code: "OPENING_BALANCE_HAS_STOCK", text: "Ya tiene existencias: usá Sumar o Conteo." });
    }
  }

  if (input.kind !== "OPENING_BALANCE" && (input.enteredCost === null || input.enteredCost <= 0) && (input.currentEffectiveCost === null || input.currentEffectiveCost <= 0)) {
    // Conteo nunca necesita costo salvo este caso (producto sin costo y con conteo > 0) — igual que carga inicial.
    const countsAsInbound = input.kind === "ADD_STOCK" || (input.kind === "PHYSICAL_COUNT" && (input.quantity ?? 0) > input.currentQty);
    if (countsAsInbound) {
      errors.push({ code: "NO_COST_NO_AVERAGE", text: "Sin costo: escribí el costo de la factura." });
    }
  }

  if (input.newPrice !== null) {
    const resultingCost = input.enteredCost ?? input.currentEffectiveCost;
    if (resultingCost !== null && resultingCost > 0 && input.newPrice < resultingCost) {
      errors.push({ code: "PRICE_BELOW_COST", text: "El precio nuevo queda bajo el costo resultante." });
    }
  }

  // ── Para revisar (se puede guardar marcando "Revisé los avisos") ───────
  if (input.enteredCost !== null && input.enteredCost > 0) {
    const vsAverage = input.currentEffectiveCost !== null && deviates(input.enteredCost, input.currentEffectiveCost);
    const vsLastPurchase = input.lastPurchaseCost !== null && deviates(input.enteredCost, input.lastPurchaseCost);
    if (vsAverage || vsLastPurchase) {
      reviews.push({ code: "COST_DEVIATION", text: "¿Precio por paquete en vez de por unidad?" });
    }
  }

  if (input.kind === "PHYSICAL_COUNT" && quantityWritten && input.currentQty > 0) {
    const newQty = input.quantity!;
    if (newQty <= 0 || (input.currentQty - newQty) / input.currentQty > COUNT_DROP_THRESHOLD) {
      reviews.push({ code: "COUNT_DROPS_SHARPLY", text: newQty <= 0 ? "El conteo deja el producto en 0." : "El conteo baja más del 50% respecto al sistema." });
    }
  }

  if (input.kind === "ADD_STOCK" && input.pendingPurchaseOrder) {
    reviews.push({
      code: "PENDING_PURCHASE_ORDER",
      text: `Tiene la ${input.pendingPurchaseOrder.orderNumber} pendiente: si es esa mercadería, recibila desde la orden.`,
      poId: input.pendingPurchaseOrder.poId,
    });
  }

  if (input.kind === "ADD_STOCK" && quantityWritten && input.typicalPurchaseQuantity !== null && input.typicalPurchaseQuantity > 0 && input.quantity! > input.typicalPurchaseQuantity * TYPICAL_PURCHASE_MULTIPLE) {
    reviews.push({ code: "QUANTITY_FAR_ABOVE_TYPICAL", text: `La cantidad es más de ${TYPICAL_PURCHASE_MULTIPLE} veces la compra típica de este producto.` });
  }

  const status: IntakeLineStatus = errors.length > 0 ? "ERROR" : reviews.length > 0 ? "REVIEW" : "OK";
  return { status, messages: [...errors, ...reviews] };
}
