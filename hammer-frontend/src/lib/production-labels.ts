/**
 * Etiquetas y tonos de Producción de Materiales — una sola fuente para el hub,
 * las listas de lotes y las recetas. Los códigos vienen del backend
 * (ProductionBatchStatus, recipeType, recipeFamily, recomendaciones,
 * findIncompleteRecipes); acá solo se traducen. Un código desconocido se
 * muestra tal cual, nunca se inventa.
 */

export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

export const BATCH_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Borrador", tone: "neutral" },
  PLANNED: { label: "Planificado", tone: "info" },
  IN_PROGRESS: { label: "En proceso", tone: "warning" },
  COMPLETED: { label: "Completado", tone: "success" },
  CANCELLED: { label: "Cancelado", tone: "neutral" },
  REVERSED: { label: "Revertido", tone: "danger" },
};

export const RECIPE_TYPES: Array<[code: string, label: string]> = [
  ["MANUFACTURING", "Manufactura"],
  ["CONVERSION", "Conversión"],
  ["CUTTING", "Corte"],
  ["MIXING", "Mezcla"],
  ["PACKAGING", "Empaque"],
  ["REPACKAGING", "Reempaque"],
];

export const RECIPE_FAMILIES: Array<[code: string, label: string]> = [
  ["WOOD", "Madera"],
  ["CEMENT", "Cemento"],
  ["STONE", "Piedra"],
  ["METAL", "Metal"],
  ["BLOCKS", "Bloques"],
  ["PAINT", "Pintura"],
  ["GENERAL", "General"],
];

export const RECOMMENDATION_PRIORITY: Record<string, { label: string; tone: Tone; rank: number }> = {
  URGENT: { label: "Urgente", tone: "danger", rank: 4 },
  HIGH: { label: "Alta", tone: "warning", rank: 3 },
  MEDIUM: { label: "Media", tone: "info", rank: 2 },
  LOW: { label: "Baja", tone: "neutral", rank: 1 },
};

export const RECOMMENDATION_TYPE: Record<string, string> = {
  PRODUCE_FROM_EXCESS: "Con insumos sobrantes",
  PRODUCE_FROM_AVAILABLE_STOCK: "Con insumos disponibles",
  BUY_INSTEAD: "Conviene comprar",
  NOT_ENOUGH_INPUTS: "Faltan insumos",
  REVIEW_RECIPE: "Revisar receta",
};

/**
 * prompt-produccion-materiales.md Fase 3 — razones de findIncompleteRecipes
 * (dashboard-aggregation.ts). Distinto del set que traía hub-produccion.patch
 * (NO_EXPECTED_QUANTITY/INPUT_WITHOUT_QUANTITY): acá ZERO_COST_INPUT es un
 * insumo SIN COSTO EFECTIVO resuelto en la sucursal (getInputWacTx), no solo
 * sin cantidad en la receta.
 */
export const INCOMPLETE_RECIPE_REASON: Record<string, string> = {
  NO_INPUTS: "no tiene insumos",
  INVALID_EXPECTED_QUANTITY: "no indica cuánto produce",
  ZERO_COST_INPUT: "tiene un insumo sin costo efectivo en esta sucursal",
};

function lookup(list: Array<[string, string]>, code: string | null | undefined): string {
  if (!code) return "—";
  return list.find(([value]) => value === code)?.[1] ?? code;
}

export const recipeTypeLabel = (code: string | null | undefined) => lookup(RECIPE_TYPES, code);
export const recipeFamilyLabel = (code: string | null | undefined) => lookup(RECIPE_FAMILIES, code);

export function batchStatus(code: string): { label: string; tone: Tone } {
  return BATCH_STATUS[code] ?? { label: code, tone: "neutral" };
}

export function recommendationPriority(code: string): { label: string; tone: Tone; rank: number } {
  return RECOMMENDATION_PRIORITY[code] ?? { label: code, tone: "neutral", rank: 0 };
}
