/**
 * H.A.M.M.E.R. — Timber Module Calculator (Timber Improvements)
 *
 * Implements lumber pricing formulas from "FORMULA PARA MADERA.xlsx".
 * Now supports adjustable prices (tabla/tablilla/cuadro) and trip-based cubication.
 *
 * ## Core Formulas:
 *
 * ### Board Feet (Pies Tablares)
 * boardFeet = (thickness × width × length × pieces) / 12
 *
 * ### Base Cost
 * baseCost = boardFeet × costPerFoot
 *
 * ### Selling Price per Piece
 * sellingPrice = thickness × width × varas × pricePerInch
 * Where varas = VARA_LENGTH_MAP[commercialLength]
 *   16 → 6, 14 → 5, 11 → 4, 8 → 3
 *
 * ### Price Groups:
 * - TABLA: (1×10, 1×12, 2×10, 2×12) — pricePerInchTabla (default C$8.90)
 * - TABLILLA: (1×6, 1×8) — pricePerInchTablilla (default C$6.90)
 * - CUADRO: everything else + all 8ft wood — pricePerInchCuadro (default C$6.90)
 *
 * ### Margin
 * marginPercent = (sellingPrice - baseCost) / sellingPrice
 */

/* ── Constants ── */

/** Conversion map: internal vara lengths → commercial display in pies (feet) */
export const VARA_LENGTH_MAP: Readonly<Record<number, number>> = {
  16: 6,
  14: 5,
  11: 4,
  8: 3,
};

/** Commercial lengths where price group is forced to CUADRO */
export const LENGTHS_THAT_FORCE_CUADRO: ReadonlySet<number> = new Set([8]);

/** Default pricing constants */
export const DEFAULT_COST_PER_FOOT = 20.0;
export const DEFAULT_PRICE_PER_INCH_TABLA = 8.9;
export const DEFAULT_PRICE_PER_INCH_TABLILLA = 6.9;
export const DEFAULT_PRICE_PER_INCH_CUADRO = 6.9;

/** Width threshold: >= 10" with thickness 1 or 2 = TABLA */
export const TABLA_WIDTH_THRESHOLD = 10;

/* ── Types ── */

export type TimberPriceGroup = "TABLA" | "TABLILLA" | "CUADRO";

export interface TimberDimensions {
  /** Thickness in inches (integer) */
  thickness: number;
  /** Width in inches (integer) */
  width: number;
  /** Length in feet (commercial: 8, 11, 14, 16) */
  length: number;
}

export interface TimberPricing {
  costPerFoot: number;
  pricePerInchTabla: number;
  pricePerInchTablilla: number;
  pricePerInchCuadro: number;
}

export interface TimberCalculation {
  priceGroup: TimberPriceGroup;
  dimensions: TimberDimensions;
  /** Board feet per piece */
  boardFeet: number;
  /** Base cost per piece in C$ */
  baseCost: number;
  /** Length in varas */
  varaLength: number;
  /** Price per inch used */
  pricePerInch: number;
  /** Selling price per piece in C$ */
  sellingPrice: number;
  /** Margin percentage (0-1 range, e.g., 0.35 = 35%) */
  marginPercent: number;
  /** Profit per piece in C$ */
  profitPerPiece: number;
}

export interface TimberTripLineInput {
  thickness: number;
  width: number;
  length: number;
  pieces: number;
  priceGroup?: TimberPriceGroup; // override classification
}

export interface TimberTripLineResult {
  dimensions: TimberDimensions;
  priceGroup: TimberPriceGroup;
  pieces: number;
  varaLength: number;
  calculatedFeet: number;
  calculatedCostFeet: number;
  calculatedCostPerPiece: number;
  calculatedSalePricePerPiece: number;
  calculatedSaleTotal: number;
  calculatedProfit: number;
  calculatedMarginPct: number;
}

export interface TimberTripTotals {
  totalPieces: number;
  totalFeet: number;
  computedCostPerFoot: number;
  woodTripTotalCost: number;
  totalCostFeet: number;
  totalSale: number;
  totalProfit: number;
  globalMarginPct: number;
}

export interface TimberTripResult {
  lines: TimberTripLineResult[];
  totals: TimberTripTotals;
  distribution: TimberDistribution;
}

export interface TimberDistribution {
  feetOf12: number;
  feetOf10: number;
  pctOf12: number;
  pctOf10: number;
  pctTabla: number;
  remainderPct: number;
}

/* ── Rounding helpers ── */

const MONEY_DECIMALS = 2;
const FEET_DECIMALS = 4;
const PCT_DECIMALS = 4;

function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/* ── Classification ── */

/**
 * Classify timber into price group based on dimensions.
 * - TABLILLA: 1×6, 1×8
 * - TABLA: (1 or 2) × (10 or 12)
 * - CUADRO: everything else, and all 8ft lengths
 */
export function classifyTimber(
  thickness: number,
  width: number,
  length?: number,
): TimberPriceGroup {
  if (length != null && LENGTHS_THAT_FORCE_CUADRO.has(length)) return "CUADRO";
  if (thickness === 1 && (width === 6 || width === 8)) return "TABLILLA";
  if ((thickness === 1 || thickness === 2) && (width === 10 || width === 12)) return "TABLA";
  return "CUADRO";
}

/**
 * Get vara length from commercial length.
 */
export function getVaraLength(lengthFeet: number): number {
  const vara = VARA_LENGTH_MAP[lengthFeet];
  if (vara != null) return vara;
  // Fallback: round(lengthFeet * 12 / 33.87) — traditional vara calculation
  return Math.round((lengthFeet * 12) / 33.87);
}

/**
 * Get price per inch based on price group.
 */
export function getPricePerInch(
  priceGroup: TimberPriceGroup,
  pricing: TimberPricing,
): number {
  switch (priceGroup) {
    case "TABLA": return pricing.pricePerInchTabla;
    case "TABLILLA": return pricing.pricePerInchTablilla;
    case "CUADRO": return pricing.pricePerInchCuadro;
  }
}

/**
 * Calculate board feet for a single piece.
 * Formula: (thickness × width × length) / 12
 */
export function calculateBoardFeet(dims: TimberDimensions): number {
  return (dims.thickness * dims.width * dims.length) / 12;
}

/**
 * Full timber calculation for a single piece with custom pricing.
 */
export function calculateTimber(
  dims: TimberDimensions,
  pricing: TimberPricing = DEFAULT_PRICING,
): TimberCalculation {
  const priceGroup = classifyTimber(dims.thickness, dims.width, dims.length);
  const boardFeet = calculateBoardFeet(dims);
  const baseCost = boardFeet * pricing.costPerFoot;
  const varaLength = getVaraLength(dims.length);
  const pricePerInch = getPricePerInch(priceGroup, pricing);
  const sellingPrice = dims.thickness * dims.width * varaLength * pricePerInch;
  const marginPercent = sellingPrice > 0 ? (sellingPrice - baseCost) / sellingPrice : 0;
  const profitPerPiece = sellingPrice - baseCost;

  return {
    priceGroup,
    dimensions: dims,
    boardFeet: roundTo(boardFeet, FEET_DECIMALS),
    baseCost: roundTo(baseCost, MONEY_DECIMALS),
    varaLength,
    pricePerInch,
    sellingPrice: roundTo(sellingPrice, MONEY_DECIMALS),
    marginPercent: roundTo(marginPercent, PCT_DECIMALS),
    profitPerPiece: roundTo(profitPerPiece, MONEY_DECIMALS),
  };
}

/**
 * Calculate an entire timber trip (viaje de madera).
 * This is the main cubication function that processes all lines.
 */
export function calculateTimberTrip(
  lines: TimberTripLineInput[],
  woodTripTotalCost: number,
  pricing: TimberPricing = DEFAULT_PRICING,
): TimberTripResult {
  // Phase 1: calculate feet for all lines
  const rawLines = lines.map((line) => {
    const priceGroup = line.priceGroup ?? classifyTimber(line.thickness, line.width, line.length);
    const varaLength = getVaraLength(line.length);
    const feet = roundTo((line.thickness * line.width * line.length * line.pieces) / 12, FEET_DECIMALS);
    const pricePerInch = getPricePerInch(priceGroup, pricing);
    const salePricePerPiece = roundTo(line.thickness * line.width * varaLength * pricePerInch, MONEY_DECIMALS);
    const saleTotal = roundTo(line.pieces * salePricePerPiece, MONEY_DECIMALS);

    return {
      ...line,
      priceGroup,
      varaLength,
      feet,
      salePricePerPiece,
      saleTotal,
    };
  });

  const totalPieces = rawLines.reduce((acc, l) => acc + l.pieces, 0);
  const totalFeet = roundTo(rawLines.reduce((acc, l) => acc + l.feet, 0), FEET_DECIMALS);

  // Phase 2: compute cost per foot from trip total
  const computedCostPerFoot = roundTo(
    totalFeet > 0
      ? (woodTripTotalCost > 0 ? woodTripTotalCost / totalFeet : pricing.costPerFoot)
      : 0,
    MONEY_DECIMALS,
  );

  // Phase 3: calculate cost/profit for each line
  const lineResults: TimberTripLineResult[] = rawLines.map((line) => {
    const costFeet = roundTo(line.feet * computedCostPerFoot, MONEY_DECIMALS);
    const costPerPiece = roundTo(line.pieces > 0 ? costFeet / line.pieces : 0, MONEY_DECIMALS);
    const profit = roundTo(line.saleTotal - costFeet, MONEY_DECIMALS);
    const marginPct = roundTo(line.saleTotal > 0 ? profit / line.saleTotal : 0, PCT_DECIMALS);

    return {
      dimensions: { thickness: line.thickness, width: line.width, length: line.length },
      priceGroup: line.priceGroup,
      pieces: line.pieces,
      varaLength: line.varaLength,
      calculatedFeet: line.feet,
      calculatedCostFeet: costFeet,
      calculatedCostPerPiece: costPerPiece,
      calculatedSalePricePerPiece: line.salePricePerPiece,
      calculatedSaleTotal: line.saleTotal,
      calculatedProfit: profit,
      calculatedMarginPct: marginPct,
    };
  });

  // Phase 4: totals
  const totalCostFeet = roundTo(lineResults.reduce((acc, l) => acc + l.calculatedCostFeet, 0), MONEY_DECIMALS);
  const totalSale = roundTo(lineResults.reduce((acc, l) => acc + l.calculatedSaleTotal, 0), MONEY_DECIMALS);
  const totalProfit = roundTo(lineResults.reduce((acc, l) => acc + l.calculatedProfit, 0), MONEY_DECIMALS);
  const globalMarginPct = roundTo(totalSale > 0 ? totalProfit / totalSale : 0, PCT_DECIMALS);

  const totals: TimberTripTotals = {
    totalPieces,
    totalFeet,
    computedCostPerFoot,
    woodTripTotalCost: roundTo(woodTripTotalCost > 0 ? woodTripTotalCost : totalCostFeet, MONEY_DECIMALS),
    totalCostFeet,
    totalSale,
    totalProfit,
    globalMarginPct,
  };

  // Phase 5: distribution
  const distribution = calculateDistribution(lineResults, totalFeet);

  return { lines: lineResults, totals, distribution };
}

/**
 * Calculate distribution percentages (% tabla de 12, de 10, etc.)
 */
export function calculateDistribution(
  lines: TimberTripLineResult[],
  totalFeet: number,
): TimberDistribution {
  const feetOf12 = roundTo(
    lines.filter((l) => l.priceGroup === "TABLA" && l.dimensions.width === 12)
      .reduce((a, l) => a + l.calculatedFeet, 0),
    FEET_DECIMALS,
  );
  const feetOf10 = roundTo(
    lines.filter((l) => l.priceGroup === "TABLA" && l.dimensions.width === 10)
      .reduce((a, l) => a + l.calculatedFeet, 0),
    FEET_DECIMALS,
  );

  if (totalFeet <= 0) {
    return { feetOf12, feetOf10, pctOf12: 0, pctOf10: 0, pctTabla: 0, remainderPct: 0 };
  }

  const pctOf12 = roundTo(feetOf12 / totalFeet, PCT_DECIMALS);
  const pctOf10 = roundTo(feetOf10 / totalFeet, PCT_DECIMALS);
  const pctTabla = roundTo((feetOf12 + feetOf10) / totalFeet, PCT_DECIMALS);
  const remainderPct = roundTo(1 - pctTabla, PCT_DECIMALS);

  return { feetOf12, feetOf10, pctOf12, pctOf10, pctTabla, remainderPct };
}

/** Default pricing configuration */
export const DEFAULT_PRICING: TimberPricing = {
  costPerFoot: DEFAULT_COST_PER_FOOT,
  pricePerInchTabla: DEFAULT_PRICE_PER_INCH_TABLA,
  pricePerInchTablilla: DEFAULT_PRICE_PER_INCH_TABLILLA,
  pricePerInchCuadro: DEFAULT_PRICE_PER_INCH_CUADRO,
};

/** Standard timber measures (all common dimensions) */
export const STANDARD_MEASURES: TimberDimensions[] = [
  // TABLA: 1×12
  { thickness: 1, width: 12, length: 16 },
  { thickness: 1, width: 12, length: 14 },
  { thickness: 1, width: 12, length: 11 },
  { thickness: 1, width: 12, length: 8 },
  // TABLA: 2×12
  { thickness: 2, width: 12, length: 16 },
  { thickness: 2, width: 12, length: 14 },
  { thickness: 2, width: 12, length: 11 },
  // TABLA: 2×10
  { thickness: 2, width: 10, length: 16 },
  { thickness: 2, width: 10, length: 14 },
  { thickness: 2, width: 10, length: 11 },
  // TABLA: 1×10
  { thickness: 1, width: 10, length: 16 },
  { thickness: 1, width: 10, length: 14 },
  { thickness: 1, width: 10, length: 11 },
  // TABLILLA: 1×8
  { thickness: 1, width: 8, length: 16 },
  { thickness: 1, width: 8, length: 14 },
  { thickness: 1, width: 8, length: 11 },
  { thickness: 1, width: 8, length: 8 },
  // TABLILLA: 1×6
  { thickness: 1, width: 6, length: 16 },
  { thickness: 1, width: 6, length: 14 },
  { thickness: 1, width: 6, length: 11 },
  { thickness: 1, width: 6, length: 8 },
  // CUADRO: 2×8
  { thickness: 2, width: 8, length: 16 },
  { thickness: 2, width: 8, length: 14 },
  // CUADRO: 2×6
  { thickness: 2, width: 6, length: 16 },
  { thickness: 2, width: 6, length: 14 },
  { thickness: 2, width: 6, length: 11 },
  // CUADRO: 2×4
  { thickness: 2, width: 4, length: 16 },
  { thickness: 2, width: 4, length: 14 },
  { thickness: 2, width: 4, length: 11 },
  { thickness: 2, width: 4, length: 8 },
  // CUADRO: 2×3
  { thickness: 2, width: 3, length: 16 },
  { thickness: 2, width: 3, length: 14 },
  { thickness: 2, width: 3, length: 11 },
  // CUADRO: 2×2
  { thickness: 2, width: 2, length: 16 },
  { thickness: 2, width: 2, length: 14 },
  { thickness: 2, width: 2, length: 11 },
  { thickness: 2, width: 2, length: 8 },
  // CUADRO: 1×4
  { thickness: 1, width: 4, length: 16 },
  { thickness: 1, width: 4, length: 14 },
  { thickness: 1, width: 4, length: 11 },
  // CUADRO: 1×3
  { thickness: 1, width: 3, length: 16 },
  { thickness: 1, width: 3, length: 14 },
  { thickness: 1, width: 3, length: 11 },
  { thickness: 1, width: 3, length: 8 },
  // CUADRO: 1×2
  { thickness: 1, width: 2, length: 16 },
  { thickness: 1, width: 2, length: 14 },
  { thickness: 1, width: 2, length: 11 },
  { thickness: 1, width: 2, length: 8 },
  // CUADRO: 4×4
  { thickness: 4, width: 4, length: 16 },
  { thickness: 4, width: 4, length: 14 },
  { thickness: 4, width: 4, length: 11 },
];

/** Generate measure key like "1x12x16" */
export function measureKey(dims: TimberDimensions): string {
  return `${dims.thickness}x${dims.width}x${dims.length}`;
}

/** Legacy compatibility alias */
export type TimberType = TimberPriceGroup;

/** Export constants for reference */
export const TIMBER_CONSTANTS = {
  VARA_LENGTH_MAP,
  DEFAULT_COST_PER_FOOT,
  DEFAULT_PRICE_PER_INCH_TABLA,
  DEFAULT_PRICE_PER_INCH_TABLILLA,
  DEFAULT_PRICE_PER_INCH_CUADRO,
  TABLA_WIDTH_THRESHOLD,
} as const;
