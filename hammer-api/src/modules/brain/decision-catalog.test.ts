import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DECISION_CATALOG, getDecisionCatalogEntry, formatEvidence } from "@/modules/brain/decision-catalog";
import { EXECUTABLE_ACTION_TYPES } from "@/modules/brain/actions/execute-decision";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * prompt-brain-centro-decisiones.md Fase 1.2 — "un detector nuevo no puede
 * salir con un código crudo en la pantalla": esto lee con regex los
 * `proposedActionType: "…"` literales de brain/detectors/*.ts + engine.ts
 * (insights heredados) y falla si alguno no tiene entrada en el catálogo.
 *
 * Los tipos ARMADOS dinámicamente (template strings / ternarios — no un
 * string literal que el regex pueda leer solo) se verificaron a mano
 * leyendo cada detector (ver comentario de cada bloque abajo) y se
 * declaran acá como el set exacto de valores posibles que esa expresión
 * puede tomar; el test exige que TODOS esos valores concretos también
 * estén en el catálogo, no solo el patrón.
 */

const DETECTORS_DIR = path.join(__dirname, "detectors");

function literalActionTypesIn(source: string): string[] {
  const found: string[] = [];
  const regex = /proposedActionType:\s*"([A-Z0-9_]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source))) found.push(match[1]);
  return found;
}

function allDetectorFiles(): string[] {
  return readdirSync(DETECTORS_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
}

// pricing-detector.ts:624 — `REVIEW_FUSION_${issue.kind}`, issue.kind: FusionPricingIssueKind
// (catalog/fusion-pricing-health.ts) tiene exactamente estos 5 valores.
const DYNAMIC_FUSION_TYPES = [
  "REVIEW_FUSION_UNSELLABLE",
  "REVIEW_FUSION_COST_BASIS_CONFLICT",
  "REVIEW_FUSION_PRICE_BASIS_CONFLICT",
  "REVIEW_FUSION_PLACEHOLDER_COST",
  "REVIEW_FUSION_MARGIN_OUTLIER",
];

// inventory-detector.ts:268 — `isWoodCategory ? "WOOD_PRODUCT_WITHOUT_PRICE" : "REVIEW_PRODUCT_PRICE"`
// (ambos ya aparecen como literales en otras líneas del mismo archivo, pero
// se listan acá también para que quede explícito que esta línea los cubre.)
const DYNAMIC_INVENTORY_TYPES = ["WOOD_PRODUCT_WITHOUT_PRICE", "REVIEW_PRODUCT_PRICE"];

// sales-detector.ts:98 — `repairable ? "REPAIR_DRAFT_ORDER_TOTALS" : "BLOCK_ORDER_FOR_REVIEW"`
const DYNAMIC_SALES_TYPES = ["REPAIR_DRAFT_ORDER_TOTALS", "BLOCK_ORDER_FOR_REVIEW"];

// system-detector.ts:87-95 — 4 ramas según recommendation.recommendationType.
const DYNAMIC_PRODUCTION_TYPES = [
  "PRODUCTION_OPPORTUNITY_FROM_EXCESS",
  "PRODUCTION_RECIPE_BLOCKED_BY_INPUTS",
  "PRODUCTION_RECIPE_NEEDS_REVIEW",
  "EXCESS_INPUT_CAN_SUPPLY_SHORTAGE",
];

// engine.ts:135 — detectLegacyAiInsightDecisions siempre usa este literal fijo.
const LEGACY_INSIGHT_TYPE = "REVIEW_LEGACY_AI_INSIGHT";

// execute-decision.ts — tipos de "revisión confirmada" (no ejecutan nada real,
// pero SÍ pueden llegar a un decision.proposedActionType real).
const REVIEW_CONFIRMED_TYPES = [
  "CREATE_PRICE_CHANGE_PROPOSAL",
  "CREATE_DISCOUNT_PROPOSAL",
  "SEND_TO_PHYSICAL_COUNT",
  "CREATE_AUDIT_CASE",
  "REVIEW_CASH_SESSION",
  "REQUIRE_CASH_REVIEW",
  "REVIEW_ONLY",
  "REPAIR_DRAFT_ORDER_TOTALS",
  "BLOCK_ORDER_FOR_REVIEW",
  "RECALCULATE_KARDEX_BALANCE",
  "CREATE_INVENTORY_ADJUSTMENT_DRAFT",
  "INVALIDATE_MANUAL_INVOICE",
];

test("LA QUE IMPORTA — todo proposedActionType literal emitido por un detector tiene entrada en el catálogo", () => {
  const missing: string[] = [];
  for (const file of allDetectorFiles()) {
    const source = readFileSync(path.join(DETECTORS_DIR, file), "utf8");
    for (const actionType of literalActionTypesIn(source)) {
      if (!DECISION_CATALOG[actionType]) missing.push(`${file}: ${actionType}`);
    }
  }
  assert.deepEqual(missing, [], `Tipos sin catalogar: ${missing.join(", ")}`);
});

test("LA QUE IMPORTA — los tipos armados dinámicamente (fusión, madera, ventas, producción, insight heredado) también están catalogados", () => {
  const dynamic = [...DYNAMIC_FUSION_TYPES, ...DYNAMIC_INVENTORY_TYPES, ...DYNAMIC_SALES_TYPES, ...DYNAMIC_PRODUCTION_TYPES, LEGACY_INSIGHT_TYPE];
  const missing = dynamic.filter((type) => !DECISION_CATALOG[type]);
  assert.deepEqual(missing, [], `Tipos dinámicos sin catalogar: ${missing.join(", ")}`);
});

test("los tipos de 'revisión confirmada' de execute-decision.ts también están catalogados (no son EXECUTABLE)", () => {
  const missing = REVIEW_CONFIRMED_TYPES.filter((type) => !DECISION_CATALOG[type]);
  assert.deepEqual(missing, [], `Tipos sin catalogar: ${missing.join(", ")}`);
  for (const type of REVIEW_CONFIRMED_TYPES) {
    assert.notEqual(DECISION_CATALOG[type].resolution, "EXECUTABLE", `${type} no ejecuta nada real — no debería ser EXECUTABLE`);
  }
});

test("LA QUE IMPORTA — EXECUTABLE_ACTION_TYPES (el switch real) son EXACTAMENTE los marcados EXECUTABLE en el catálogo, ni más ni menos", () => {
  const executableInCatalog = Object.entries(DECISION_CATALOG)
    .filter(([, entry]) => entry.resolution === "EXECUTABLE")
    .map(([key]) => key)
    .sort();
  assert.deepEqual(executableInCatalog, [...EXECUTABLE_ACTION_TYPES].sort());
});

test("un tipo desconocido (detector nuevo sin catalogar) cae a un fallback legible, nunca el código crudo", () => {
  const fallback = getDecisionCatalogEntry("UN_TIPO_QUE_NO_EXISTE", "INVENTORY");
  assert.equal(fallback.label, "Revisar");
  assert.equal(fallback.area, "INVENTORY");
  assert.equal(fallback.href({ branchId: null, productId: null, evidence: {}, action: {} }), null);
});

test("formatEvidence — clave conocida usa su etiqueta en español; clave desconocida se humaniza, nunca JSON crudo", () => {
  const items = formatEvidence({ effectivePrice: 100, totalmenteDesconocida: "x", detector: "ignorar-esta" });
  const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
  assert.equal(byKey.effectivePrice.label, "Precio efectivo");
  assert.equal(byKey.effectivePrice.format, "money");
  assert.equal(byKey.totalmenteDesconocida.label, "Totalmente desconocida");
  assert.equal(byKey.detector, undefined, "la clave 'detector' es metadata interna, no evidencia para mostrar");
});
