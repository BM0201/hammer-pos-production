import { EXECUTABLE_ACTION_TYPES } from "@/modules/brain/actions/execute-decision";

/**
 * prompt-brain-centro-decisiones.md Fase 1.2 — única fuente de etiqueta,
 * área, resolución, CTA y enlace para cada `proposedActionType` que emite
 * algún detector. Antes esto vivía repartido en frases por palabra clave
 * (`nextBestActionFor`/`buildExecutiveSummary`, ambas borradas) y la
 * pantalla mostraba el código crudo (`REVIEW_CZ_STOCK_PRICE_POLICY`) cuando
 * no matcheaba ninguna.
 *
 * `resolution`:
 *   - EXECUTABLE: el motor (execute-decision.ts) de verdad hace algo —
 *     ver EXECUTABLE_ACTION_TYPES, importado de ahí, NUNCA copiado a mano
 *     acá (si el switch cambia, este catálogo no se desincroniza solo).
 *   - IN_MODULE: hay una pantalla donde se resuelve — el CTA lleva ahí.
 *   - ACKNOWLEDGE: no hay nada que ejecutar ni a dónde ir — la acción ES
 *     que alguien la haya visto y la cierre ("Ya lo revisé").
 *
 * `href` arma la URL con los parámetros que la pantalla destino YA acepta
 * hoy — ninguna ruta ni query param nuevo. Varias pantallas candidatas
 * (discounts, cash-closure-reports, security, purchase-orders, reorder,
 * replenishment, inventory-fusion, treasury, transfers, branches,
 * ai-insights) no leen ningún filtro por URL todavía — para esas, el
 * enlace es a la pantalla sola, documentado abajo y en el reporte de
 * cierre (Fase 1 "Al terminar"). Las únicas excepciones confirmadas:
 * master/pricing (tab/branchId), master/production/batches (status) y
 * las rutas [id] de producto/lote/receta.
 */

export type DecisionArea =
  | "PRICING" | "CASH" | "SALES" | "INVENTORY" | "REORDER" | "PURCHASING"
  | "DISPATCH" | "PRODUCTION" | "SECURITY" | "SYSTEM";

export type DecisionResolution = "IN_MODULE" | "EXECUTABLE" | "ACKNOWLEDGE";

export type DecisionHrefInput = {
  branchId?: string | null;
  productId?: string | null;
  evidence: Record<string, unknown>;
  action: Record<string, unknown>;
};

export type DecisionCatalogEntry = {
  label: string;
  area: DecisionArea;
  resolution: DecisionResolution;
  cta: string;
  href: (input: DecisionHrefInput) => string | null;
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

const pricingTrayHref = (input: DecisionHrefInput) =>
  input.branchId ? `/app/master/pricing?tab=tray&branchId=${input.branchId}` : "/app/master/pricing?tab=tray";

const productHref = (input: DecisionHrefInput) =>
  input.productId ? `/app/master/catalog-inventory/products/${input.productId}` : "/app/master/catalog-inventory";

const batchHref = (input: DecisionHrefInput) => {
  const batchId = str(input.evidence.batchId) ?? str(input.action.batchId);
  return batchId ? `/app/master/production/batches/${batchId}` : "/app/master/production/batches";
};

const recipeHref = (input: DecisionHrefInput) => {
  const recipeId = str(input.evidence.recipeId) ?? str(input.action.recipeId);
  return recipeId ? `/app/master/production/recipes/${recipeId}` : "/app/master/production/recipes";
};

const FUSION_ISSUE_KINDS = ["UNSELLABLE", "COST_BASIS_CONFLICT", "PRICE_BASIS_CONFLICT", "PLACEHOLDER_COST", "MARGIN_OUTLIER"] as const;

const RAW_CATALOG: Record<string, DecisionCatalogEntry> = {
  // ── Precios (Bandeja / Carga de precios) ──
  REVIEW_PRODUCT_NO_COST: { label: "Productos sin costo registrado", area: "PRICING", resolution: "IN_MODULE", cta: "Abrir en Precios", href: pricingTrayHref },
  REVIEW_PRICE_BELOW_COST: { label: "Productos vendiéndose bajo el costo", area: "PRICING", resolution: "IN_MODULE", cta: "Abrir en Precios", href: pricingTrayHref },
  REVIEW_PRICE_MARGIN_POLICY: { label: "Margen por debajo de la política", area: "PRICING", resolution: "IN_MODULE", cta: "Abrir en Precios", href: pricingTrayHref },
  PRODUCT_NOT_RENTABLE_UNDER_MARKET_PRICE: { label: "No rentable al precio de mercado", area: "PRICING", resolution: "IN_MODULE", cta: "Abrir en Precios", href: pricingTrayHref },
  REVIEW_CZ_STOCK_PRICE_POLICY: { label: "Productos CZ con stock — revisar precio", area: "PRICING", resolution: "IN_MODULE", cta: "Abrir en Precios", href: pricingTrayHref },
  REVIEW_BRANCH_PRICE_SETTINGS: { label: "Configuración de precio por sucursal", area: "PRICING", resolution: "IN_MODULE", cta: "Abrir en Precios", href: pricingTrayHref },
  REVIEW_BRANCH_COST_PRICE: { label: "Costo propio de sucursal a revisar", area: "PRICING", resolution: "IN_MODULE", cta: "Abrir en Precios", href: pricingTrayHref },
  COST_CHANGED_PRICE_STALE: { label: "El costo cambió, el precio no", area: "PRICING", resolution: "IN_MODULE", cta: "Abrir en Precios", href: pricingTrayHref },
  PRICING_SCOPE_MISCONFIGURATION: { label: "Posible error de alcance en precios", area: "PRICING", resolution: "IN_MODULE", cta: "Abrir en Precios", href: pricingTrayHref },
  WOOD_PRODUCT_WITHOUT_PRICE: { label: "Madera sin precio configurado", area: "PRICING", resolution: "IN_MODULE", cta: "Abrir en Precios", href: pricingTrayHref },
  CREATE_PRICE_CHANGE_PROPOSAL: { label: "Propuesta de cambio de precio", area: "PRICING", resolution: "ACKNOWLEDGE", cta: "Ya lo revisé", href: pricingTrayHref },

  // ── WAC / costo (Inventario, pero son del motor de precios) ──
  REVIEW_WAC_BELOW_SALE_PRICE: { label: "WAC por encima del precio de venta", area: "INVENTORY", resolution: "IN_MODULE", cta: "Abrir en Precios", href: pricingTrayHref },
  REVIEW_WAC_VS_COST_CHAIN_DEVIATION: { label: "WAC se aleja del costo esperado", area: "INVENTORY", resolution: "IN_MODULE", cta: "Abrir en Precios", href: pricingTrayHref },
  REVIEW_WAC_SIBLING_BRANCH_DEVIATION: { label: "WAC distinto entre sucursales hermanas", area: "INVENTORY", resolution: "IN_MODULE", cta: "Abrir en Precios", href: pricingTrayHref },

  // ── Fusión de inventario ──
  ...Object.fromEntries(FUSION_ISSUE_KINDS.map((kind) => [
    `REVIEW_FUSION_${kind}`,
    {
      label: `Fusión de inventario — ${kind === "UNSELLABLE" ? "no vendible" : kind === "COST_BASIS_CONFLICT" ? "conflicto de costo" : kind === "PRICE_BASIS_CONFLICT" ? "conflicto de precio" : kind === "PLACEHOLDER_COST" ? "costo provisional" : "margen atípico"}`,
      area: "INVENTORY" as const,
      resolution: "IN_MODULE" as const,
      cta: "Abrir fusión de inventario",
      href: () => "/app/master/inventory-fusion",
    },
  ])),

  // ── Inventario ──
  REVIEW_INVENTORY_MOVEMENTS: { label: "Movimientos de inventario a revisar", area: "INVENTORY", resolution: "IN_MODULE", cta: "Abrir en Inventario", href: productHref },
  REVIEW_REORDER_OR_TRANSFER: { label: "Reponer o trasladar", area: "INVENTORY", resolution: "IN_MODULE", cta: "Abrir Reposición", href: () => "/app/master/replenishment" },
  REVIEW_PRODUCT_COST: { label: "Costo de producto a revisar", area: "INVENTORY", resolution: "IN_MODULE", cta: "Abrir producto", href: productHref },
  INITIAL_STOCK_WITHOUT_COST: { label: "Existencia inicial sin costo", area: "INVENTORY", resolution: "IN_MODULE", cta: "Abrir producto", href: productHref },
  REVIEW_DISCOUNT_OR_TRANSFER: { label: "Descuento o traslado a revisar", area: "INVENTORY", resolution: "IN_MODULE", cta: "Abrir producto", href: productHref },
  WOOD_CATEGORY_SKU_MISMATCH: { label: "SKU de madera no coincide con su categoría", area: "INVENTORY", resolution: "IN_MODULE", cta: "Abrir producto", href: productHref },
  REVIEW_PRODUCT_PRICE: { label: "Precio de producto a revisar", area: "PRICING", resolution: "IN_MODULE", cta: "Abrir en Precios", href: pricingTrayHref },
  REVIEW_INITIAL_INVENTORY: { label: "Existencia inicial a revisar", area: "INVENTORY", resolution: "IN_MODULE", cta: "Abrir producto", href: productHref },
  WOOD_DIMENSION_DUPLICATE_SUSPECT: { label: "Posible dimensión de madera duplicada", area: "INVENTORY", resolution: "IN_MODULE", cta: "Abrir producto", href: productHref },
  RECALCULATE_KARDEX_BALANCE: { label: "Saldo de Kardex a recalcular", area: "INVENTORY", resolution: "ACKNOWLEDGE", cta: "Ya lo revisé", href: productHref },
  CREATE_INVENTORY_ADJUSTMENT_DRAFT: { label: "Ajuste de inventario propuesto", area: "INVENTORY", resolution: "ACKNOWLEDGE", cta: "Ya lo revisé", href: () => "/app/master/inventory" },
  SEND_TO_PHYSICAL_COUNT: { label: "Enviar a conteo físico", area: "INVENTORY", resolution: "ACKNOWLEDGE", cta: "Ya lo revisé", href: () => "/app/master/inventory" },

  // ── Reposición / compras ──
  REVIEW_REPLENISHMENT_SIGNAL: { label: "Señal de reposición", area: "REORDER", resolution: "IN_MODULE", cta: "Abrir Reposición", href: () => "/app/master/replenishment" },
  REVIEW_PURCHASE_ORDER: { label: "Pedido de compra a revisar", area: "PURCHASING", resolution: "IN_MODULE", cta: "Abrir Compras", href: () => "/app/master/purchase-orders" },
  REVIEW_PURCHASE_NEED: { label: "Necesidad de compra detectada", area: "PURCHASING", resolution: "IN_MODULE", cta: "Abrir Compras", href: () => "/app/master/purchase-orders" },
  CREATE_PURCHASE_ORDER_DRAFT: { label: "Crear borrador de pedido de compra", area: "PURCHASING", resolution: "EXECUTABLE", cta: "Ejecutar", href: () => "/app/master/purchase-orders" },
  CREATE_TRANSFER_DRAFT: { label: "Crear borrador de traslado", area: "REORDER", resolution: "EXECUTABLE", cta: "Ejecutar", href: () => "/app/master/transfers" },
  CONVERT_REORDER_ALERT_TO_PURCHASE: { label: "Convertir alerta a compra", area: "PURCHASING", resolution: "EXECUTABLE", cta: "Ejecutar", href: () => "/app/master/purchase-orders" },
  CONVERT_REORDER_ALERT_TO_TRANSFER: { label: "Convertir alerta a traslado", area: "REORDER", resolution: "EXECUTABLE", cta: "Ejecutar", href: () => "/app/master/transfers" },

  // ── Caja ──
  REVIEW_CASH_SESSION: { label: "Caja con diferencia sin justificar", area: "CASH", resolution: "ACKNOWLEDGE", cta: "Ya lo revisé", href: () => "/app/master/cash-closure-reports" },
  RECALCULATE_CASH_SESSION: { label: "Recalcular snapshot de caja", area: "CASH", resolution: "EXECUTABLE", cta: "Ejecutar", href: () => "/app/master/cash-closure-reports" },
  REVIEW_CASH_CLOSURE: { label: "Cierre de caja a revisar", area: "CASH", resolution: "IN_MODULE", cta: "Abrir cierres", href: () => "/app/master/cash-closure-reports" },
  REVIEW_PAYMENT_DUPLICATE: { label: "Posible pago duplicado", area: "CASH", resolution: "IN_MODULE", cta: "Abrir cierres", href: () => "/app/master/cash-closure-reports" },
  REQUIRE_CASH_REVIEW: { label: "Requiere revisión de caja", area: "CASH", resolution: "ACKNOWLEDGE", cta: "Ya lo revisé", href: () => "/app/master/cash-closure-reports" },
  REFRESH_OPERATIONAL_DAY: { label: "Refrescar resumen de Día Operativo", area: "CASH", resolution: "EXECUTABLE", cta: "Ejecutar", href: () => "/app/master/operations" },

  // ── Ventas ──
  REVIEW_USER_DISCOUNTS: { label: "Descuentos de un usuario a revisar", area: "SALES", resolution: "IN_MODULE", cta: "Abrir Descuentos", href: () => "/app/master/discounts" },
  CREATE_DISCOUNT_PROPOSAL: { label: "Propuesta de descuento", area: "SALES", resolution: "ACKNOWLEDGE", cta: "Ya lo revisé", href: () => "/app/master/discounts" },
  REPAIR_DRAFT_ORDER_TOTALS: { label: "Totales de orden borrador a reparar", area: "SALES", resolution: "ACKNOWLEDGE", cta: "Ya lo revisé", href: () => "/app/master/sales/orders" },
  BLOCK_ORDER_FOR_REVIEW: { label: "Orden bloqueada para revisión", area: "SALES", resolution: "ACKNOWLEDGE", cta: "Ya lo revisé", href: () => "/app/master/sales/orders" },
  INVALIDATE_MANUAL_INVOICE: { label: "Factura manual a invalidar", area: "SALES", resolution: "ACKNOWLEDGE", cta: "Ya lo revisé", href: () => "/app/master/sales/orders" },
  REVIEW_BRANCH_SALES_PERFORMANCE: { label: "Desempeño de ventas de la sucursal", area: "SALES", resolution: "IN_MODULE", cta: "Abrir Analítica", href: () => "/app/master/analytics" },
  REVIEW_PRODUCT_DEMAND_TREND: { label: "Tendencia de demanda de un producto", area: "SALES", resolution: "IN_MODULE", cta: "Abrir Analítica", href: productHref },

  // ── Despacho ──
  REVIEW_DISPATCH_TICKET: { label: "Boleta de despacho a revisar", area: "DISPATCH", resolution: "IN_MODULE", cta: "Abrir Despacho", href: () => "/app/branch/warehouse/dispatch" },
  REVIEW_TRANSPORT_CHARGE: { label: "Cobro de transporte a revisar", area: "DISPATCH", resolution: "IN_MODULE", cta: "Abrir Despacho", href: () => "/app/branch/warehouse/dispatch" },
  REVIEW_TRANSPORT_SERVICE: { label: "Servicio de transporte a revisar", area: "DISPATCH", resolution: "IN_MODULE", cta: "Abrir Despacho", href: () => "/app/branch/warehouse/dispatch" },

  // ── Producción ──
  PRODUCTION_OPPORTUNITY_FROM_EXCESS: { label: "Oportunidad de producción por excedente", area: "PRODUCTION", resolution: "IN_MODULE", cta: "Abrir Producción", href: () => "/app/master/production" },
  PRODUCTION_RECIPE_BLOCKED_BY_INPUTS: { label: "Receta bloqueada por falta de insumos", area: "PRODUCTION", resolution: "IN_MODULE", cta: "Abrir Producción", href: () => "/app/master/production" },
  PRODUCTION_RECIPE_NEEDS_REVIEW: { label: "Receta a revisar", area: "PRODUCTION", resolution: "IN_MODULE", cta: "Abrir receta", href: recipeHref },
  EXCESS_INPUT_CAN_SUPPLY_SHORTAGE: { label: "Insumo excedente puede cubrir faltante", area: "PRODUCTION", resolution: "IN_MODULE", cta: "Abrir Producción", href: () => "/app/master/production" },
  PRODUCTION_RECIPE_MISSING_COST: { label: "Receta sin costo", area: "PRODUCTION", resolution: "IN_MODULE", cta: "Abrir receta", href: recipeHref },
  PRODUCTION_BATCH_STUCK: { label: "Lote de producción trabado", area: "PRODUCTION", resolution: "IN_MODULE", cta: "Abrir lote", href: batchHref },
  PRODUCTION_OUTPUT_PRICE_BELOW_COST: { label: "Producto de producción bajo el costo", area: "PRODUCTION", resolution: "IN_MODULE", cta: "Abrir lote", href: batchHref },

  // ── Seguridad / sistema ──
  REVIEW_USER_PERMISSIONS: { label: "Permisos de usuario a revisar", area: "SECURITY", resolution: "IN_MODULE", cta: "Abrir Usuarios", href: () => "/app/master/users" },
  CREATE_AUDIT_CASE: { label: "Caso de auditoría a abrir", area: "SECURITY", resolution: "ACKNOWLEDGE", cta: "Ya lo revisé", href: () => "/app/master/audit" },
  REVIEW_BRANCH_SETUP: { label: "Configuración de sucursal a revisar", area: "SYSTEM", resolution: "IN_MODULE", cta: "Abrir Sucursales", href: () => "/app/master/branches" },
  REVIEW_SYSTEM_CONFIGURATION: { label: "Configuración del sistema a revisar", area: "SYSTEM", resolution: "IN_MODULE", cta: "Abrir Configuración", href: () => "/app/system-admin/settings" },
  IRON_UNIT_CONVERSION_REQUIRED: { label: "Conversión de unidad de hierro pendiente", area: "SYSTEM", resolution: "IN_MODULE", cta: "Abrir producto", href: productHref },
  REVIEW_ONLY: { label: "Revisión general", area: "SYSTEM", resolution: "ACKNOWLEDGE", cta: "Ya lo revisé", href: () => null },

  // ── Heredado (insights viejos) ──
  REVIEW_LEGACY_AI_INSIGHT: { label: "Insight heredado a revisar", area: "SYSTEM", resolution: "ACKNOWLEDGE", cta: "Ya lo revisé", href: () => "/app/master/ai-insights" },
};

for (const key of EXECUTABLE_ACTION_TYPES) {
  if (!RAW_CATALOG[key]) {
    throw new Error(`decision-catalog.ts: falta una entrada para el tipo ejecutable "${key}" (ver execute-decision.ts).`);
  }
  if (RAW_CATALOG[key].resolution !== "EXECUTABLE") {
    throw new Error(`decision-catalog.ts: "${key}" lo ejecuta execute-decision.ts pero el catálogo no lo marca EXECUTABLE.`);
  }
}

export const DECISION_CATALOG: Readonly<Record<string, DecisionCatalogEntry>> = RAW_CATALOG;

const AREA_BY_CATEGORY: Record<string, DecisionArea> = {
  INVENTORY: "INVENTORY",
  REORDER: "REORDER",
  PRICING: "PRICING",
  CASH: "CASH",
  SALES: "SALES",
  DISPATCH: "DISPATCH",
  PURCHASING: "PURCHASING",
  PRODUCTION: "PRODUCTION",
  SECURITY: "SECURITY",
  AUDIT: "SYSTEM",
  SYSTEM: "SYSTEM",
};

/** Fase 2.1 — reverso del catálogo: qué `proposedActionType` caen en un área, para poder filtrar `/inbox?area=` por `proposedActionType: { in: [...] }` sin que "área" exista como columna. */
export function getActionTypesForArea(area: DecisionArea): string[] {
  return Object.entries(DECISION_CATALOG)
    .filter(([, entry]) => entry.area === area)
    .map(([type]) => type);
}

/** Tipo desconocido (prefijo REVIEW_ sin entry, o un detector nuevo sin catalogar todavía) → "Revisar", área por categoría, sin enlace — nunca un código crudo sin traducir. */
export function getDecisionCatalogEntry(proposedActionType: string | null, category: string): DecisionCatalogEntry {
  if (proposedActionType && DECISION_CATALOG[proposedActionType]) return DECISION_CATALOG[proposedActionType];
  return {
    label: "Revisar",
    area: AREA_BY_CATEGORY[category] ?? "SYSTEM",
    resolution: "ACKNOWLEDGE",
    cta: "Ya lo revisé",
    href: () => null,
  };
}

function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

type EvidenceFormat = "money" | "percent" | "number" | "date" | "text";

const KNOWN_EVIDENCE_LABELS: Record<string, { label: string; format: EvidenceFormat }> = {
  effectivePrice: { label: "Precio efectivo", format: "money" },
  effectiveCost: { label: "Costo efectivo", format: "money" },
  marginPct: { label: "Margen", format: "percent" },
  policyMinMarginPercent: { label: "Margen mínimo de política", format: "percent" },
  quantityOnHand: { label: "Stock disponible", format: "number" },
  stock: { label: "Stock", format: "number" },
  weightedAverageCost: { label: "Costo promedio ponderado", format: "money" },
  unitCost: { label: "Costo unitario", format: "money" },
  reorderPoint: { label: "Punto de reorden", format: "number" },
  targetQuantity: { label: "Cantidad objetivo", format: "number" },
  netNeed: { label: "Necesidad neta", format: "number" },
  orderNumber: { label: "Número de orden", format: "text" },
  batchNumber: { label: "Número de lote", format: "text" },
  status: { label: "Estado", format: "text" },
  total: { label: "Total", format: "money" },
  transportAmount: { label: "Monto de transporte", format: "money" },
  grandTotal: { label: "Total general", format: "money" },
  price: { label: "Precio", format: "money" },
  totalDiscount: { label: "Total de descuento", format: "money" },
  discountedOrders: { label: "Órdenes con descuento", format: "number" },
  user: { label: "Usuario", format: "text" },
  closureDate: { label: "Fecha de cierre", format: "date" },
  createdAt: { label: "Creado", format: "date" },
  startedAt: { label: "Iniciado", format: "date" },
  username: { label: "Usuario", format: "text" },
  globalRole: { label: "Rol global", format: "text" },
  activeMemberships: { label: "Membresías activas", format: "number" },
  count: { label: "Cantidad", format: "number" },
  actions: { label: "Acciones", format: "text" },
  branchTotal: { label: "Total de la sucursal", format: "money" },
  averageBranchTotal: { label: "Promedio de sucursales", format: "money" },
  orders: { label: "Órdenes", format: "number" },
  previousHalfUnits: { label: "Unidades (periodo anterior)", format: "number" },
  recentHalfUnits: { label: "Unidades (periodo reciente)", format: "number" },
  sku: { label: "SKU", format: "text" },
  branch: { label: "Sucursal", format: "text" },
  code: { label: "Código", format: "text" },
  method: { label: "Método de pago", format: "text" },
  totalPayments: { label: "Pagos totales", format: "number" },
  suspiciousPayments: { label: "Pagos sospechosos", format: "number" },
  amounts: { label: "Montos", format: "text" },
};

export type FormattedEvidenceItem = { key: string; label: string; value: unknown; format: EvidenceFormat };

/** Cada clave de evidenceJson con su etiqueta — conocida (español) o humanizada de la clave misma. Nunca JSON crudo. */
export function formatEvidence(evidenceJson: unknown): FormattedEvidenceItem[] {
  if (!evidenceJson || typeof evidenceJson !== "object" || Array.isArray(evidenceJson)) return [];
  return Object.entries(evidenceJson as Record<string, unknown>)
    .filter(([key, value]) => key !== "detector" && key !== "rule" && value !== null && value !== undefined)
    .map(([key, value]) => {
      const known = KNOWN_EVIDENCE_LABELS[key];
      return known
        ? { key, label: known.label, value, format: known.format }
        : { key, label: humanizeKey(key), value, format: "text" as const };
    });
}
