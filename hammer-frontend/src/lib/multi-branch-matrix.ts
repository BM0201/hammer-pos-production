/**
 * Parte B.3 (prompt-completo-pendientes-2026-10.md) — lógica pura de la
 * matriz multisucursal, compartida por compras/ingresos/traslados. Sin
 * React ni fetch: todo lo que se puede probar con test:unit:logic vive acá;
 * branch-matrix.tsx solo arma la UI alrededor de estas funciones.
 */

export type MatrixLine = {
  productId: string;
  sku: string;
  name: string;
  /** Costo unitario, cuando aplica (compras/ingresos). null = sin costo (traslados). */
  cost: number | null;
  /** "Cantidad para todas" — el valor que llenan las sucursales sin override. */
  forAll: number;
  /** branchId → cantidad explícita, solo para sucursales marcadas como "distinta". */
  overrides: Record<string, number>;
};

export function quantityForBranch(line: MatrixLine, branchId: string): number {
  return branchId in line.overrides ? line.overrides[branchId] : line.forAll;
}

export function isOverridden(line: MatrixLine, branchId: string): boolean {
  return branchId in line.overrides;
}

export function setForAll(line: MatrixLine, forAll: number): MatrixLine {
  return { ...line, forAll };
}

export function setOverride(line: MatrixLine, branchId: string, quantity: number): MatrixLine {
  return { ...line, overrides: { ...line.overrides, [branchId]: quantity } };
}

export function resetOverride(line: MatrixLine, branchId: string): MatrixLine {
  if (!(branchId in line.overrides)) return line;
  const overrides = { ...line.overrides };
  delete overrides[branchId];
  return { ...line, overrides };
}

export function setCost(line: MatrixLine, cost: number | null): MatrixLine {
  return { ...line, cost };
}

/** "12" o "=12" (estilo hoja de cálculo) → 12. null si no es una cantidad válida (negativa o no numérica). */
export function parseQuantityInput(raw: string): number | null {
  const trimmed = raw.trim();
  const withoutEquals = trimmed.startsWith("=") ? trimmed.slice(1).trim() : trimmed;
  if (withoutEquals === "") return null;
  const n = Number(withoutEquals);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** El producto ya está en la tabla → suma a "para todas" en vez de duplicar la fila. */
export function addOrIncrementProduct(
  lines: MatrixLine[],
  product: { id: string; sku: string; name: string; cost?: number | null },
  quantityToAdd = 1,
): MatrixLine[] {
  const idx = lines.findIndex((l) => l.productId === product.id);
  if (idx === -1) {
    return [...lines, { productId: product.id, sku: product.sku, name: product.name, cost: product.cost ?? null, forAll: quantityToAdd, overrides: {} }];
  }
  const next = [...lines];
  next[idx] = setForAll(next[idx], next[idx].forAll + quantityToAdd);
  return next;
}

export type MatrixTotals = {
  byBranch: Record<string, { lines: number; units: number; amount: number | null }>;
  byProductUnits: Record<string, number>;
  grandUnits: number;
  grandAmount: number | null;
};

export function computeMatrixTotals(lines: MatrixLine[], branchIds: string[]): MatrixTotals {
  const byBranch: MatrixTotals["byBranch"] = {};
  for (const branchId of branchIds) byBranch[branchId] = { lines: 0, units: 0, amount: 0 };
  const byProductUnits: Record<string, number> = {};
  let grandUnits = 0;
  let anyCostMissing = false;
  let grandAmount = 0;

  for (const line of lines) {
    let productUnits = 0;
    for (const branchId of branchIds) {
      const qty = quantityForBranch(line, branchId);
      if (qty <= 0) continue;
      const bucket = byBranch[branchId];
      bucket.lines += 1;
      bucket.units += qty;
      if (line.cost === null) {
        bucket.amount = null;
      } else if (bucket.amount !== null) {
        bucket.amount += qty * line.cost;
      }
      productUnits += qty;
    }
    if (productUnits > 0) byProductUnits[line.productId] = productUnits;
    grandUnits += productUnits;
    if (line.cost === null) anyCostMissing = true;
    else grandAmount += productUnits * line.cost;
  }

  return { byBranch, byProductUnits, grandUnits, grandAmount: anyCostMissing ? null : grandAmount };
}

export type MatrixPayloadLine = { productId: string; quantity: number; unitCost?: number; overrides?: Record<string, number> };

/** Payload para los 3 endpoints de grupo: overrides SOLO donde la sucursal difiere de "para todas", y solo para sucursales seleccionadas. */
export function buildMatrixPayloadLines(lines: MatrixLine[], branchIds: string[]): MatrixPayloadLine[] {
  const branchSet = new Set(branchIds);
  return lines
    .filter((line) => branchIds.some((id) => quantityForBranch(line, id) > 0))
    .map((line) => {
      const overrides: Record<string, number> = {};
      for (const [branchId, qty] of Object.entries(line.overrides)) {
        if (branchSet.has(branchId) && qty !== line.forAll) overrides[branchId] = qty;
      }
      const payload: MatrixPayloadLine = { productId: line.productId, quantity: line.forAll };
      if (line.cost !== null) payload.unitCost = line.cost;
      if (Object.keys(overrides).length > 0) payload.overrides = overrides;
      return payload;
    });
}

export type BranchPreview = { branchId: string; label: string; linesCount: number; unitsTotal: number; amount: number | null; skippedProductNames: string[] };

/** "Se crearán 3 órdenes: MGA 12 líneas · C$48,200; ... RVS 11 líneas (sin Varilla 3/8)". */
export function buildBranchPreviews(lines: MatrixLine[], branchIds: string[], branchLabelById: Record<string, string>): BranchPreview[] {
  return branchIds.map((branchId) => {
    let linesCount = 0;
    let unitsTotal = 0;
    let amount = 0;
    let anyCostMissing = false;
    const skippedProductNames: string[] = [];
    for (const line of lines) {
      const qty = quantityForBranch(line, branchId);
      if (qty <= 0) {
        if (lines.some((l) => l.productId === line.productId) && line.forAll > 0) skippedProductNames.push(line.name);
        continue;
      }
      linesCount += 1;
      unitsTotal += qty;
      if (line.cost === null) anyCostMissing = true;
      else amount += qty * line.cost;
    }
    return { branchId, label: branchLabelById[branchId] ?? branchId, linesCount, unitsTotal, amount: anyCostMissing ? null : amount, skippedProductNames };
  });
}

export type OriginShortfall = { productId: string; name: string; required: number; available: number; shortfall: number };

/** Para traslados: la SUMA de todos los destinos contra el stock real del origen — antes de enviar, no después. */
export function computeOriginShortfalls(lines: MatrixLine[], branchIds: string[], originStockByProductId: Record<string, number>): OriginShortfall[] {
  const shortfalls: OriginShortfall[] = [];
  for (const line of lines) {
    let required = 0;
    for (const branchId of branchIds) required += quantityForBranch(line, branchId);
    if (required <= 0) continue;
    const available = originStockByProductId[line.productId] ?? 0;
    if (required > available) shortfalls.push({ productId: line.productId, name: line.name, required, available, shortfall: required - available });
  }
  return shortfalls;
}

export type TsvPasteProduct = { id: string; sku: string; name: string; cost?: number | null; barcode?: string | null; barcodes?: string[] };
export type TsvPasteOutcome = { matched: Array<{ product: TsvPasteProduct; forAll: number; overrides: Record<string, number> }>; unmatchedCodes: string[] };

function findByCode(code: string, products: TsvPasteProduct[]): TsvPasteProduct | undefined {
  const upper = code.trim().toUpperCase();
  if (!upper) return undefined;
  return products.find((p) => p.sku.toUpperCase() === upper || p.barcode?.toUpperCase() === upper || (p.barcodes ?? []).some((b) => b.toUpperCase() === upper));
}

/**
 * Pegado desde Excel: col0 = código, col1 = cantidad para todas, col2+ =
 * opcional, una columna por sucursal con el código de sucursal como
 * encabezado (fila 0). Encabezados que no coinciden con ninguna sucursal
 * simplemente se ignoran (no rompen el pegado).
 */
export function parseMatrixTsvPaste(
  text: string,
  products: TsvPasteProduct[],
  branchIdByCode: Record<string, string>,
): TsvPasteOutcome {
  const rows = text.split(/\r?\n/).filter((row) => row.trim() !== "").map((row) => row.split("\t"));
  if (rows.length === 0) return { matched: [], unmatchedCodes: [] };

  const header = rows[0];
  const branchColumns: Array<{ index: number; branchId: string }> = [];
  for (let i = 2; i < header.length; i++) {
    const branchId = branchIdByCode[(header[i] ?? "").trim().toUpperCase()];
    if (branchId) branchColumns.push({ index: i, branchId });
  }
  // Fila 0 es encabezado solo si su primera celda no resuelve a un producto real.
  const dataRows = findByCode(header[0] ?? "", products) ? rows : rows.slice(1);

  const matched: TsvPasteOutcome["matched"] = [];
  const unmatchedCodes: string[] = [];
  for (const row of dataRows) {
    const code = (row[0] ?? "").trim();
    if (!code) continue;
    const product = findByCode(code, products);
    if (!product) {
      unmatchedCodes.push(code);
      continue;
    }
    const forAll = parseQuantityInput(row[1] ?? "") ?? 0;
    const overrides: Record<string, number> = {};
    for (const col of branchColumns) {
      const parsed = parseQuantityInput(row[col.index] ?? "");
      if (parsed !== null) overrides[col.branchId] = parsed;
    }
    matched.push({ product, forAll, overrides });
  }
  return { matched, unmatchedCodes };
}

/** Lectura/escritura de la selección de sucursales recordada por tipo de documento — nunca debe tirar (SSR, modo privado). */
export function readRememberedBranchIds(storageKey: string): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((v) => typeof v === "string") ? parsed : null;
  } catch {
    return null;
  }
}

export function writeRememberedBranchIds(storageKey: string, branchIds: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(branchIds));
  } catch {
    /* localStorage no disponible (SSR, privacidad) */
  }
}
