/**
 * Fase 2 (prompt-entrada-inventario.md) — lógica pura de la pantalla
 * "Entrada de inventario": todo lo que se puede probar sin DOM vive acá
 * (test:unit:logic); intake-sheet.tsx solo arma la UI alrededor.
 */

export type IntakeKind = "ADD_STOCK" | "PHYSICAL_COUNT" | "OPENING_BALANCE";
/**
 * prompt-entrada-multisucursal-fix.md — SKIPPED (celda: "0 en esta
 * sucursal, no lleva") y PENDING (fila: la vista previa todavía no llegó,
 * o falló — nunca se muestra como ERROR mientras tanto) se suman al viejo
 * OK/REVIEW/ERROR.
 */
export type IntakeLineStatus = "OK" | "REVIEW" | "ERROR" | "SKIPPED" | "PENDING";

export type IntakeLine = {
  productId: string;
  sku: string;
  name: string;
  saleUnit: string;
  baseUnit: string;
  hasConversion: boolean;
  conversionFactor: number;
  /** Unidad elegida para esta línea (saleUnit o baseUnit, si el producto tiene conversión). */
  unit: string;
  /** "Cantidad para todas" — null = campo vacío. Nunca arranca en 1 (2.2/2.4). */
  quantity: number | null;
  /** branchId → cantidad explícita. null = ese campo está vacío (distinto de 0, que SÍ es un valor real en Conteo). */
  overrides: Record<string, number | null>;
  /** null = sin cambio de costo (usa el promedio/costo vigente). */
  unitCost: number | null;
  /** null = sin cambio de precio de venta ("⋯ → Cambiar precio de venta", 2.3). */
  salePrice: number | null;
};

export function quantityForIntakeBranch(line: IntakeLine, branchId: string): number | null {
  return branchId in line.overrides ? line.overrides[branchId] : line.quantity;
}

export type ScannedProductRef = {
  id: string;
  sku: string;
  name: string;
  saleUnit: string;
  baseUnit: string;
  hasConversion: boolean;
  conversionFactor: number;
};

function newIntakeLine(product: ScannedProductRef): IntakeLine {
  return {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    saleUnit: product.saleUnit,
    baseUnit: product.baseUnit,
    hasConversion: product.hasConversion,
    conversionFactor: product.conversionFactor,
    unit: product.saleUnit,
    quantity: null,
    overrides: {},
    unitCost: null,
    salePrice: null,
  };
}

export type ScanOutcome = { lines: IntakeLine[]; focusProductId: string };

/**
 * "la cantidad arranca vacía, nunca en '1'" (2.2/2.4) — cualquier alta
 * (buscador, escáner, pegado) entra SIN cantidad. "escanear un repetido en
 * Sumar suma y en Conteo enfoca" (tests 2.8): en ADD_STOCK, un producto YA
 * en la lista suma +1 a "para todas" (así funciona un escaneo repetido
 * mientras entra mercadería); en PHYSICAL_COUNT/OPENING_BALANCE —donde
 * "otra vez" no tiene un significado aditivo razonable, solo hay UN conteo
 * o UNA apertura por producto— escanear de nuevo solo lleva el foco a esa
 * fila, sin tocar ningún valor.
 */
export function addOrFocusScannedProduct(lines: IntakeLine[], product: ScannedProductRef, kind: IntakeKind): ScanOutcome {
  const idx = lines.findIndex((l) => l.productId === product.id);
  if (idx === -1) {
    return { lines: [...lines, newIntakeLine(product)], focusProductId: product.id };
  }
  if (kind === "ADD_STOCK") {
    const next = [...lines];
    next[idx] = { ...next[idx], quantity: (next[idx].quantity ?? 0) + 1 };
    return { lines: next, focusProductId: product.id };
  }
  return { lines, focusProductId: product.id };
}

/** "Cambiar de tarjeta con productos ya cargados pide confirmación" (2.2). */
export function switchingKindNeedsConfirmation(lines: IntakeLine[]): boolean {
  return lines.length > 0;
}

/**
 * "Conteo físico admite una sola sucursal" (2.2): togglear una sucursal en
 * PHYSICAL_COUNT REEMPLAZA la selección (chips de selección única); en los
 * demás `kind` es la selección múltiple de siempre.
 */
export function toggleBranchSelection(kind: IntakeKind, selected: string[], branchId: string): string[] {
  if (kind === "PHYSICAL_COUNT") {
    return selected.length === 1 && selected[0] === branchId ? [] : [branchId];
  }
  return selected.includes(branchId) ? selected.filter((id) => id !== branchId) : [...selected, branchId];
}

/** Al cambiar a Conteo con 2+ sucursales ya elegidas, se queda solo con la primera. */
export function enforceBranchSelectionForKind(kind: IntakeKind, selected: string[]): string[] {
  return kind === "PHYSICAL_COUNT" && selected.length > 1 ? [selected[0]] : selected;
}

export function reasonChipsForKind(kind: IntakeKind): string[] {
  switch (kind) {
    case "ADD_STOCK":
      return ["Llegó pedido", "Devolución de proveedor", "Producción", "Otro"];
    case "PHYSICAL_COUNT":
      return ["Conteo mensual", "Conteo por diferencia"];
    case "OPENING_BALANCE":
      return ["Apertura de sucursal", "Producto nuevo"];
  }
}

export type RowStatus = { productId: string; status: IntakeLineStatus };

/**
 * Estado de una fila = el peor de sus celdas (una por sucursal elegida).
 * Sin ninguna celda todavía (vista previa no llegó o no corrió) → PENDING,
 * nunca ERROR — "calculando", no "falta algo" (prompt-entrada-multisucursal-fix.md
 * Commit 2 #4). SKIPPED ("no lleva") no cuenta para el peor estado: una
 * fila con una sucursal en 0 y otra OK sigue siendo OK. Si TODAS las
 * celdas de la fila fueran SKIPPED (no debería pasar — el backend ya
 * convierte ese caso a ERROR con ALL_BRANCHES_SKIPPED), se trata como
 * PENDING por seguridad, nunca como "listo".
 */
export function worstRowStatus(cellStatuses: IntakeLineStatus[]): IntakeLineStatus {
  if (cellStatuses.length === 0) return "PENDING";
  const meaningful = cellStatuses.filter((s) => s !== "SKIPPED");
  if (meaningful.length === 0) return "PENDING";
  if (meaningful.includes("ERROR")) return "ERROR";
  if (meaningful.includes("REVIEW")) return "REVIEW";
  return "OK";
}

export type BarCounts = { ok: number; review: number; error: number; pending: number };

/** "✓ N listos · ⚠ N para revisar · ✕ N con error" (2.4). PENDING no es error — es "todavía calculando". */
export function computeBarCounts(rows: RowStatus[]): BarCounts {
  const counts: BarCounts = { ok: 0, review: 0, error: 0, pending: 0 };
  for (const row of rows) {
    if (row.status === "OK") counts.ok += 1;
    else if (row.status === "REVIEW") counts.review += 1;
    else if (row.status === "PENDING") counts.pending += 1;
    else counts.error += 1;
  }
  return counts;
}

/**
 * "Revisar y confirmar" deshabilitado con errores, sin ninguna fila
 * todavía, con alguna fila aún calculando, o si la vista previa falló del
 * todo (prompt-entrada-multisucursal-fix.md Commit 2 #4 — "el botón
 * confirmar queda deshabilitado con ese texto, no con 'corregí N errores'").
 */
export function canConfirmIntake(counts: BarCounts, totalRows: number, previewFailed = false): boolean {
  return totalRows > 0 && counts.error === 0 && counts.pending === 0 && !previewFailed;
}

/** Texto corto del badge según el tipo de mensaje de error — nunca todo "Falta dato" (causa 1). */
export function shortTextForErrorCode(code: string): string {
  switch (code) {
    case "MISSING_QUANTITY":
    case "NO_COST_NO_AVERAGE":
    case "ALL_BRANCHES_SKIPPED":
      return "Falta dato";
    case "OPENING_BALANCE_NO_COST":
      return "Falta costo";
    case "PRODUCT_BLOCKED":
      return "Bloqueado";
    case "OPENING_BALANCE_HAS_STOCK":
    case "PRICE_BELOW_COST":
      return "No se puede";
    default:
      return "Revisar";
  }
}

/** Para "Corregí N errores → enfocá la primera fila con error" (Commit 2 #7). */
export function firstErrorProductId(rows: RowStatus[]): string | null {
  return rows.find((r) => r.status === "ERROR")?.productId ?? null;
}

/**
 * Celdas por sucursal (Commit 2 #1): vacío QUITA el override (vuelve a
 * "para todas" — nunca lo deja en null, que es el bug de fondo de la
 * causa 3); cualquier número (incluido 0 = "no lleva") lo fija.
 */
export function applyBranchCellInput(line: IntakeLine, branchId: string, rawValue: string): IntakeLine {
  if (rawValue.trim() === "") {
    const overrides = { ...line.overrides };
    delete overrides[branchId];
    return { ...line, overrides };
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return line;
  return { ...line, overrides: { ...line.overrides, [branchId]: parsed } };
}

export type IntakeLinePayload = { productId: string; quantity: number; unit?: string; unitCost?: number; salePrice?: number; overrides?: Record<string, number> };

/**
 * "la cantidad vacía no se manda como 1" (tests 2.8) — una línea sin NINGÚN
 * valor escrito (ni "para todas" ni ningún override, para ninguna sucursal
 * elegida) se omite entera; nunca se completa con 1. Los `overrides` solo
 * viajan donde el valor real DIFIERE de "para todas" (mismo criterio que
 * multi-branch-matrix.ts).
 */
export function buildIntakePayloadLines(lines: IntakeLine[], branchIds: string[]): IntakeLinePayload[] {
  return lines
    .filter((line) => branchIds.some((id) => quantityForIntakeBranch(line, id) !== null))
    .map((line) => {
      const overrides: Record<string, number> = {};
      for (const branchId of branchIds) {
        const resolved = quantityForIntakeBranch(line, branchId);
        if (resolved !== null && resolved !== line.quantity) overrides[branchId] = resolved;
      }
      const payload: IntakeLinePayload = { productId: line.productId, quantity: line.quantity ?? 0, unit: line.unit };
      if (line.unitCost !== null) payload.unitCost = line.unitCost;
      if (line.salePrice !== null) payload.salePrice = line.salePrice;
      if (Object.keys(overrides).length > 0) payload.overrides = overrides;
      return payload;
    });
}

export type CreateIntakeRequestBody = {
  clientRequestId: string;
  kind: IntakeKind;
  reason: string;
  notes?: string;
  branchIds: string[];
  lines: IntakeLinePayload[];
};

/** "armado del payload por kind" (tests 2.8) — el cuerpo completo que recibe POST /api/inventory/multi-branch-intake. */
export function buildCreateIntakeRequest(input: {
  clientRequestId: string;
  kind: IntakeKind;
  reason: string;
  notes: string;
  branchIds: string[];
  lines: IntakeLine[];
}): CreateIntakeRequestBody {
  return {
    clientRequestId: input.clientRequestId,
    kind: input.kind,
    reason: input.reason.trim(),
    notes: input.notes.trim() || undefined,
    branchIds: input.branchIds,
    lines: buildIntakePayloadLines(input.lines, input.branchIds),
  };
}

export type PreviewRequestLine = { productId: string; quantity: number | null; overrides?: Record<string, number | null>; unitCost?: number | null; salePrice?: number | null; unit?: string };

/** Vista previa: a diferencia del guardado, SÍ viaja con `null` (campo vacío) — el servidor decide el estado de esa celda (intake-preview-service.ts). */
export function buildPreviewRequestLines(lines: IntakeLine[]): PreviewRequestLine[] {
  return lines.map((line) => ({
    productId: line.productId,
    quantity: line.quantity,
    overrides: Object.keys(line.overrides).length > 0 ? line.overrides : undefined,
    unitCost: line.unitCost,
    salePrice: line.salePrice,
    unit: line.unit,
  }));
}

// ── Borrador (localStorage, por usuario y tipo — "Guardar borrador", 2.4) ──

export type IntakeDraft = {
  kind: IntakeKind;
  branchIds: string[];
  reason: string;
  notes: string;
  lines: IntakeLine[];
  savedAt: string;
};

function draftStorageKey(userId: string, kind: IntakeKind): string {
  return `hammer_intake_draft_${userId}_${kind}`;
}

/** Mínimo necesario para no tocar `window.localStorage` en los tests (mismo patrón que quick-add-product.ts). */
export type DraftStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** Nunca debe tirar (SSR, modo privado, cuota) — el llamador real pasa `window.localStorage`. */
export function saveIntakeDraft(storage: DraftStorage, userId: string, draft: Omit<IntakeDraft, "savedAt">): void {
  try {
    storage.setItem(draftStorageKey(userId, draft.kind), JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
  } catch {
    /* localStorage no disponible */
  }
}

export function loadIntakeDraft(storage: DraftStorage, userId: string, kind: IntakeKind): IntakeDraft | null {
  try {
    const raw = storage.getItem(draftStorageKey(userId, kind));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.lines) || typeof parsed.savedAt !== "string") return null;
    return parsed as IntakeDraft;
  } catch {
    return null;
  }
}

export function clearIntakeDraft(storage: DraftStorage, userId: string, kind: IntakeKind): void {
  try {
    storage.removeItem(draftStorageKey(userId, kind));
  } catch {
    /* localStorage no disponible */
  }
}

/** "Tenés un borrador de hace 2 h: ¿continuar?" (2.4). */
export function draftAgeLabel(savedAt: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(savedAt).getTime()) / 60000));
  if (minutes < 1) return "hace un momento";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return `hace ${days} d`;
}
