/** Tipos del viaje de madera (lado cliente) y la lógica pura de la pantalla, sin React, para poder probarla. */

export type Branch = { id: string; code: string; name: string };

export type TripLineDraft = { thickness: number; width: number; length: number; pieces: number };

export type Expenses = {
  freightAmount: number; fuelAmount: number; perDiemAmount: number; permitsAmount: number; otherExpensesAmount: number; sawingAmount: number;
};
export const EMPTY_EXPENSES: Expenses = { freightAmount: 0, fuelAmount: 0, perDiemAmount: 0, permitsAmount: 0, otherExpensesAmount: 0, sawingAmount: 0 };
export const EXPENSE_FIELDS: ReadonlyArray<readonly [label: string, key: keyof Expenses]> = [
  ["Aserrado", "sawingAmount"],
  ["Flete", "freightAmount"],
  ["Combustible", "fuelAmount"],
  ["Viáticos", "perDiemAmount"],
  ["Permisos / INAFOR", "permitsAmount"],
  ["Otros", "otherExpensesAmount"],
];

export type TripStatus = "DRAFT" | "CUBICADO" | "CONFIRMED" | "TRANSFERRED" | "CANCELLED";
export type Reconciliation = { invoicedFeet: number | null; differenceFeet: number; differencePercent: number; tolerancePercent: number; status: "OK" | "REVIEW" | "NOT_APPLICABLE" };

type Num = number | string;

export type TripSummary = {
  id: string; tripCode: string; status: TripStatus;
  destinationBranch: { code: string; name: string };
  totalPieces: number; totalFeet: Num; totalCost: Num; marginPercent: Num;
  supplierName: string | null; createdAt: string;
};

export type TripLine = {
  id: string; thicknessIn: number; widthIn: number; lengthIn: number; varaLength: number; priceGroup: string; pieces: number;
  calculatedFeet: Num; calculatedCostFeet: Num; calculatedCostPerPiece: Num; calculatedSalePricePerPiece: Num;
  calculatedSaleTotal: Num; calculatedProfit: Num; calculatedMarginPct: Num;
};

export type TripDetail = {
  id: string; tripCode: string; status: TripStatus; destinationBranchId: string;
  destinationBranch: { code: string; name: string };
  woodTripTotalCost: Num; computedCostPerFoot: Num; landedCostPerFoot: Num; tripExpensesTotal: Num;
  freightAmount: Num; fuelAmount: Num; perDiemAmount: Num; permitsAmount: Num; otherExpensesAmount: Num; sawingAmount?: Num;
  invoicedFeet: Num | null; pricePolicy: string;
  totalPieces: number; totalFeet: Num; totalCost: Num; totalSale: Num; totalProfit: Num; marginPercent: Num;
  supplierName: string | null; origin: string | null; notes: string | null;
  confirmedAt?: string | null; marginOverrideReason?: string | null;
  reconciliation: Reconciliation;
  lines: TripLine[];
};

export type InjectionPreviewLine = {
  lineId: string;
  dimensions: { thickness: number; width: number; length: number };
  isNewProduct: boolean; productName: string; sku: string | null; piecesToAdd: number;
  costPerPiece: { before: number | null; after: number };
  sellingPrice: { before: number | null; after: number };
};
export type InjectionPreview = { tripId: string; tripCode: string; pricePolicy: string; lines: InjectionPreviewLine[]; hash: string };

export type CubicationImportRecognizedLine = { thickness: number; width: number; length: number; pieces: number; calculatedFeet: number; existingPieces: number | null; action: "CREATE" | "UPDATE" };
export type CubicationImportUnrecognizedRow = { rowNumber: number; rawMedida: string; rawPiezas: string; reason: string };
export type CubicationImportPreview = { tripId: string; tripCode: string; recognized: CubicationImportRecognizedLine[]; unrecognized: CubicationImportUnrecognizedRow[] };

export const PRICE_POLICIES = [
  ["RECALC_FROM_PRICE_PER_INCH", "Precio por pulgada", "El precio sale del precio por pulgada de la sucursal"],
  ["COST_ONLY", "Solo actualizar costos", "Los precios de venta quedan como están"],
  ["TARGET_MARGIN", "Margen objetivo", "El precio se calcula para dejar el margen configurado"],
] as const;

export function n(v: Num | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  return typeof v === "number" ? v : Number(v);
}
export function pct(v: Num | null | undefined, decimals = 1): string {
  return `${(n(v) * 100).toFixed(decimals)}%`;
}
export function measureLabel(m: { thickness: number; width: number; length: number }): string {
  return `${m.thickness}×${m.width}×${m.length}`;
}
export function statusLabel(status: TripStatus): { label: string; variant: "warning" | "success" | "neutral" } {
  if (status === "DRAFT" || status === "CUBICADO") return { label: "Borrador", variant: "warning" };
  if (status === "CANCELLED") return { label: "Cancelado", variant: "neutral" };
  return { label: "Ingresado", variant: "success" };
}

/** Pies tablares de una línea: grueso × ancho × largo × piezas ÷ 12 (misma fórmula que el servidor). */
export function lineFeet(l: TripLineDraft): number {
  return (l.thickness * l.width * l.length * l.pieces) / 12;
}

export type CostMode = "PER_FOOT" | "TOTAL";

/** Costo del viaje en vivo, mientras se edita (el servidor recalcula igual al guardar). */
export function liveTripCost(input: { lines: TripLineDraft[]; costMode: CostMode; costPerFoot: number; woodTripTotalCost: number; expenses: Expenses }) {
  const totalPieces = input.lines.reduce((sum, l) => sum + l.pieces, 0);
  const totalFeet = input.lines.reduce((sum, l) => sum + lineFeet(l), 0);
  const costPerFoot = input.costMode === "PER_FOOT"
    ? input.costPerFoot || 0
    : totalFeet > 0 && input.woodTripTotalCost > 0 ? input.woodTripTotalCost / totalFeet : 0;
  const woodTotal = input.costMode === "TOTAL" ? input.woodTripTotalCost || 0 : costPerFoot * totalFeet;
  const expensesTotal = Object.values(input.expenses).reduce((sum, v) => sum + (Number(v) || 0), 0);
  const landedCostPerFoot = totalFeet > 0 ? (woodTotal + expensesTotal) / totalFeet : 0;
  return { totalPieces, totalFeet, costPerFoot, woodTotal, expensesTotal, landedTotal: woodTotal + expensesTotal, landedCostPerFoot };
}

/** Margen sobre el precio que de verdad queda (el de la política del viaje). */
export function marginOf(line: Pick<InjectionPreviewLine, "costPerPiece" | "sellingPrice">): number {
  const price = line.sellingPrice.after;
  return price > 0 ? (price - line.costPerPiece.after) / price : 0;
}

export type ReadinessItem = { key: string; ok: boolean; label: string; blocking: boolean };

/**
 * Qué falta para poder ingresar el viaje — las mismas reglas que confirmTimberTrip, dichas
 * antes de pulsar el botón. `blocking` = sin esto el servidor rechaza.
 */
export function tripReadiness(input: {
  trip: Pick<TripDetail, "lines" | "woodTripTotalCost" | "landedCostPerFoot" | "reconciliation">;
  preview: Pick<InjectionPreview, "lines"> | null;
  reconciliationAcknowledged: boolean;
  marginOverrideReason: string;
  blockNegativeMargin?: boolean;
}): { items: ReadinessItem[]; canConfirm: boolean; negativeMarginLines: number; priceDrops: number } {
  const linesWithPieces = input.trip.lines.filter((l) => l.pieces > 0).length;
  const hasCost = n(input.trip.woodTripTotalCost) > 0 && n(input.trip.landedCostPerFoot) > 0;
  const previewLines = input.preview?.lines ?? [];
  const negativeMarginLines = previewLines.filter((l) => l.sellingPrice.after < l.costPerPiece.after).length;
  const priceDrops = previewLines.filter((l) => l.sellingPrice.before !== null && l.sellingPrice.after < l.sellingPrice.before).length;
  const needsAck = input.trip.reconciliation.status === "REVIEW";
  const needsReason = negativeMarginLines > 0 && (input.blockNegativeMargin ?? true);

  const items: ReadinessItem[] = [
    { key: "lines", ok: linesWithPieces > 0, blocking: true, label: linesWithPieces > 0 ? `${linesWithPieces} medida${linesWithPieces === 1 ? "" : "s"} con piezas` : "Agregá al menos una medida con piezas" },
    { key: "cost", ok: hasCost, blocking: true, label: hasCost ? "Costo de la madera escrito" : "Falta el costo de la madera (precio por pie o total)" },
  ];
  if (needsAck) items.push({ key: "invoice", ok: input.reconciliationAcknowledged, blocking: true, label: input.reconciliationAcknowledged ? "Diferencia con la factura revisada" : "Los pies no cuadran con la factura: marcá que lo revisaste" });
  if (needsReason) items.push({ key: "margin", ok: input.marginOverrideReason.trim().length > 0, blocking: true, label: `${negativeMarginLines} medida${negativeMarginLines === 1 ? "" : "s"} bajo costo: escribí el motivo` });

  const canConfirm = input.preview !== null && previewLines.length > 0 && items.every((item) => item.ok || !item.blocking);
  return { items, canConfirm, negativeMarginLines, priceDrops };
}

/**
 * Carga del Excel: la medida que ya estaba se REEMPLAZA (el usuario recuenta de cero),
 * la nueva se agrega.
 */
export function mergeCubicationImport(lines: TripLineDraft[], recognized: TripLineDraft[]): TripLineDraft[] {
  const merged = [...lines];
  for (const item of recognized) {
    const idx = merged.findIndex((l) => l.thickness === item.thickness && l.width === item.width && l.length === item.length);
    if (idx >= 0) merged[idx] = { ...merged[idx], pieces: item.pieces };
    else merged.push({ thickness: item.thickness, width: item.width, length: item.length, pieces: item.pieces });
  }
  return merged;
}

/** Otra vez la misma medida (otro atado de la hoja) suma piezas a su línea. */
export function addMeasureTo(lines: TripLineDraft[], measure: Omit<TripLineDraft, "pieces">, pieces: number): TripLineDraft[] {
  const idx = lines.findIndex((l) => l.thickness === measure.thickness && l.width === measure.width && l.length === measure.length);
  if (idx >= 0) return lines.map((l, i) => (i === idx ? { ...l, pieces: l.pieces + pieces } : l));
  return [...lines, { ...measure, pieces }];
}
