/**
 * Fase 1 (prompt-entrada-inventario.md) — "¿qué está bien, qué hay que
 * revisar y qué impide guardar?", por línea. Pura, sin DB: la vista previa
 * (intake-preview-service.ts) resuelve todos los datos reales (stock,
 * costo, última compra, OC pendiente, compra típica) y esta función solo
 * decide, con esos números ya en la mano.
 */

export type IntakeKind = "ADD_STOCK" | "PHYSICAL_COUNT" | "OPENING_BALANCE";
/**
 * prompt-entrada-multisucursal-fix.md — SKIPPED: "0 en una sucursal" en
 * ADD_STOCK/OPENING_BALANCE ("no lleva") — nunca es un error, no se valida
 * nada más para esa celda. Distinto de un conteo en 0 (PHYSICAL_COUNT),
 * que es un valor real y se queda en OK/REVIEW/ERROR como siempre.
 */
export type IntakeLineStatus = "OK" | "REVIEW" | "ERROR" | "SKIPPED";

export type IntakeMessageKind = "DATA" | "BLOCKED" | "RULE";

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
    | "QUANTITY_FAR_ABOVE_TYPICAL"
    | "ALL_BRANCHES_SKIPPED"
    | "NO_SALE_PRICE"
    | "MARGIN_BELOW_POLICY";
  text: string;
  /** DATA = falta un dato; BLOCKED = el producto no se puede cargar acá; RULE = una regla de negocio lo impide o lo marca para revisar. La pantalla elige el texto corto del badge con esto. */
  kind: IntakeMessageKind;
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
  /** Precio de venta nuevo, solo si la fila lo cambia (ya resuelto para ESTA sucursal — override ?? general). null = no se toca. */
  newPrice: number | null;
  /**
   * prompt-entrada-reintento-precio.md Commit 3 — precio de venta vigente
   * en ESTA sucursal (nunca null en el llamador real: effectivePrice cae a
   * standardSalePrice). null acá = "el llamador no mandó este dato" (test
   * viejo, antes de este commit) — no dispara ningún chequeo nuevo, igual
   * que typicalPurchaseQuantity.
   */
  currentSalePrice: number | null;
  /** Mínimo de margen de la política de categoría de esta sucursal — null = sin dato (no se compara). */
  minMarginPercent: number | null;
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
    // Bloqueado es bloqueado — no tiene sentido evaluar cantidad/costo de
    // algo que no se puede cargar, ni confundir con "falta dato" (causa 1).
    return { status: "ERROR", messages: [{ code: "PRODUCT_BLOCKED", text: input.productBlocked.reason, kind: "BLOCKED" }] };
  }

  const quantityWritten = input.quantity !== null;

  // "0 en una sucursal" (ADD_STOCK/OPENING_BALANCE) = esa sucursal no
  // lleva — SKIPPED, sin validar nada más (ni cantidad, ni costo, ni OC
  // pendiente). En PHYSICAL_COUNT, 0 es un conteo real: sigue de largo.
  if (input.kind !== "PHYSICAL_COUNT" && quantityWritten && input.quantity === 0) {
    return { status: "SKIPPED", messages: [] };
  }

  const quantityValidForKind = input.kind === "PHYSICAL_COUNT" ? quantityWritten && input.quantity! >= 0 : quantityWritten && input.quantity! > 0;
  if (!quantityValidForKind) {
    errors.push({
      code: "MISSING_QUANTITY",
      kind: "DATA",
      text: !quantityWritten
        ? "Falta la cantidad."
        : input.kind === "PHYSICAL_COUNT"
          ? "La cantidad no puede ser negativa."
          : "La cantidad debe ser mayor a 0.",
    });
  }

  if (input.kind === "OPENING_BALANCE") {
    if (input.enteredCost === null || input.enteredCost <= 0) {
      errors.push({ code: "OPENING_BALANCE_NO_COST", kind: "DATA", text: "Carga inicial necesita un costo mayor a 0." });
    }
    if (input.currentQty > 0) {
      errors.push({ code: "OPENING_BALANCE_HAS_STOCK", kind: "RULE", text: "Ya tiene existencias: usá Sumar o Conteo." });
    }
  }

  if (input.kind !== "OPENING_BALANCE" && (input.enteredCost === null || input.enteredCost <= 0) && (input.currentEffectiveCost === null || input.currentEffectiveCost <= 0)) {
    // Conteo nunca necesita costo salvo este caso (producto sin costo y con conteo > 0) — igual que carga inicial.
    const countsAsInbound = input.kind === "ADD_STOCK" || (input.kind === "PHYSICAL_COUNT" && (input.quantity ?? 0) > input.currentQty);
    if (countsAsInbound) {
      errors.push({ code: "NO_COST_NO_AVERAGE", kind: "DATA", text: "Sin costo: escribí el costo de la factura." });
    }
  }

  if (input.newPrice !== null) {
    const resultingCost = input.enteredCost ?? input.currentEffectiveCost;
    if (resultingCost !== null && resultingCost > 0 && input.newPrice < resultingCost) {
      errors.push({ code: "PRICE_BELOW_COST", kind: "RULE", text: "El precio nuevo queda bajo el costo resultante." });
    }
  }

  // ── Para revisar (se puede guardar marcando "Revisé los avisos") ───────

  // Commit 3 (prompt-entrada-reintento-precio.md) — "visible siempre en
  // Sumar y en Carga inicial. En Conteo se oculta: no cambia precios."
  // `currentSalePrice === null` = el llamador no mandó este dato (tests
  // viejos) — no dispara nada nuevo, igual que typicalPurchaseQuantity.
  if (input.kind !== "PHYSICAL_COUNT" && input.currentSalePrice !== null) {
    const resultingPrice = input.newPrice ?? input.currentSalePrice;
    if (resultingPrice <= 0) {
      reviews.push({ code: "NO_SALE_PRICE", kind: "DATA", text: "No tiene precio de venta en esta sucursal." });
    } else if (input.minMarginPercent !== null) {
      // "margen con el costo nuevo" — el mismo precio resultante (nuevo o
      // vigente) contra el costo que esta línea deja (entrado o el
      // efectivo de siempre), nunca contra el costo viejo.
      const resultingCost = input.enteredCost ?? input.currentEffectiveCost;
      if (resultingCost !== null && resultingCost > 0) {
        const marginPercent = ((resultingPrice - resultingCost) / resultingPrice) * 100;
        if (marginPercent < input.minMarginPercent) {
          reviews.push({ code: "MARGIN_BELOW_POLICY", kind: "RULE", text: `El margen queda en ${marginPercent.toFixed(1)}%, bajo el ${input.minMarginPercent}% de la categoría.` });
        }
      }
    }
  }

  if (input.enteredCost !== null && input.enteredCost > 0) {
    const vsAverage = input.currentEffectiveCost !== null && deviates(input.enteredCost, input.currentEffectiveCost);
    const vsLastPurchase = input.lastPurchaseCost !== null && deviates(input.enteredCost, input.lastPurchaseCost);
    if (vsAverage || vsLastPurchase) {
      reviews.push({ code: "COST_DEVIATION", kind: "RULE", text: "¿Precio por paquete en vez de por unidad?" });
    }
  }

  if (input.kind === "PHYSICAL_COUNT" && quantityWritten && input.currentQty > 0) {
    const newQty = input.quantity!;
    if (newQty <= 0 || (input.currentQty - newQty) / input.currentQty > COUNT_DROP_THRESHOLD) {
      reviews.push({ code: "COUNT_DROPS_SHARPLY", kind: "RULE", text: newQty <= 0 ? "El conteo deja el producto en 0." : "El conteo baja más del 50% respecto al sistema." });
    }
  }

  if (input.kind === "ADD_STOCK" && input.pendingPurchaseOrder) {
    reviews.push({
      code: "PENDING_PURCHASE_ORDER",
      kind: "RULE",
      text: `Tiene la ${input.pendingPurchaseOrder.orderNumber} pendiente: si es esa mercadería, recibila desde la orden.`,
      poId: input.pendingPurchaseOrder.poId,
    });
  }

  if (input.kind === "ADD_STOCK" && quantityWritten && input.typicalPurchaseQuantity !== null && input.typicalPurchaseQuantity > 0 && input.quantity! > input.typicalPurchaseQuantity * TYPICAL_PURCHASE_MULTIPLE) {
    reviews.push({ code: "QUANTITY_FAR_ABOVE_TYPICAL", kind: "RULE", text: `La cantidad es más de ${TYPICAL_PURCHASE_MULTIPLE} veces la compra típica de este producto.` });
  }

  const status: IntakeLineStatus = errors.length > 0 ? "ERROR" : reviews.length > 0 ? "REVIEW" : "OK";
  return { status, messages: [...errors, ...reviews] };
}

/**
 * Texto agrupado por código ("Sin costo en MSY y RIV: escribí el costo de
 * la factura.") — usado por intake-preview-service.ts para lineMessages.
 * Un código no mapeado acá (no debería pasar; los únicos que agrupan por
 * sucursal son los que puede haber más de un mensaje repetido en el
 * mismo renglón) cae a un texto genérico, nunca revienta.
 */
export function formatGroupedMessageText(code: IntakeValidationMessage["code"], branchCodes: string[], fallbackText: string): string {
  const joined = branchCodes.length <= 1 ? branchCodes.join("") : `${branchCodes.slice(0, -1).join(", ")} y ${branchCodes[branchCodes.length - 1]}`;
  switch (code) {
    case "NO_COST_NO_AVERAGE":
      return `Sin costo en ${joined}: escribí el costo de la factura.`;
    case "MISSING_QUANTITY":
      return `Falta la cantidad en ${joined}.`;
    case "PRICE_BELOW_COST":
      return `El precio nuevo queda bajo el costo resultante en ${joined}.`;
    case "OPENING_BALANCE_HAS_STOCK":
      return `${joined} ya tiene existencias: usá Sumar o Conteo.`;
    case "COST_DEVIATION":
      return `¿Precio por paquete en vez de por unidad? (${joined})`;
    case "PENDING_PURCHASE_ORDER":
      return `Tiene una orden de compra pendiente en ${joined}: si es esa mercadería, recibila desde la orden.`;
    case "NO_SALE_PRICE":
      return `No tiene precio de venta en ${joined}.`;
    case "MARGIN_BELOW_POLICY":
      return `El margen queda bajo la política de la categoría en ${joined}.`;
    default:
      return branchCodes.length > 0 ? `${fallbackText} (${joined})` : fallbackText;
  }
}
