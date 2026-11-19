import { getDecisionCatalogEntry, type DecisionArea } from "@/modules/brain/decision-catalog";

/**
 * "Qué te sugiero" del Centro de decisiones: para cada decisión, una opción
 * recomendada + alternativas, cada una con qué cambia en palabras simples,
 * y un texto corto de ayuda. Puro (sin DB): lo arma enrichDecision/inbox a
 * partir de lo que el detector ya guardó. Nada se ejecuta solo — cada
 * opción es un botón que el dueño confirma.
 *
 * Tipos de opción → qué endpoint EXISTENTE la ejecuta (frontend):
 *   APPLY_PRICE → POST /api/master/pricing/tray/apply (mismo lock/guard de costo que la Bandeja)
 *   KEEP_PRICE  → POST /api/master/pricing/tray/keep
 *   RUN         → POST /api/master/brain/decisions/[id]/run (execute-decision.ts)
 *   RESOLVE     → POST /api/master/brain/decisions/[id]/resolve
 *   GO_RESOLVE  → enlace a la pantalla del catálogo
 */

export type SuggestionKind = "APPLY_PRICE" | "KEEP_PRICE" | "RUN" | "RESOLVE" | "GO_RESOLVE";

export type SuggestionOption = {
  kind: SuggestionKind;
  label: string;
  explain: string;
  /** Solo APPLY_PRICE: el precio que se va a escribir. */
  price?: number;
  /** Solo APPLY_PRICE/RUN/KEEP_PRICE: cambian datos reales, la pantalla pide confirmación. */
  needsConfirm: boolean;
};

export type DecisionSuggestion = {
  recommended: SuggestionOption | null;
  alternatives: SuggestionOption[];
  help: string;
};

/** Mismos tipos que tray-service.ts aplica (APPLICABLE_TYPES sin NO_COST, que no trae precio). */
const PRICE_APPLY_TYPES = new Set(["REVIEW_PRICE_BELOW_COST", "REVIEW_PRICE_MARGIN_POLICY", "REVIEW_BRANCH_COST_PRICE", "COST_CHANGED_PRICE_STALE", "REVIEW_FUSION_UNSELLABLE"]);
/** Mismo KEEPABLE_TYPES de tray-service.ts: bajo el costo nunca se "mantiene". */
const PRICE_KEEP_TYPES = new Set(["REVIEW_PRICE_MARGIN_POLICY", "COST_CHANGED_PRICE_STALE"]);
const ACTIVE_STATUSES = new Set(["OPEN", "APPROVED", "MANUAL_REVIEW", "FAILED"]);
/** inventory/wac.ts: C$2 o menos es un relleno, no un precio real. */
const PLACEHOLDER_PRICE_MAX = 2;

export const HELP_BY_TYPE: Record<string, string> = {
  REVIEW_PRODUCT_NO_COST: "Sin costo no se puede saber si se gana o se pierde. Cargá el costo de compra (general o de esta sucursal) en Precios; al siguiente escaneo se calcula el margen.",
  REVIEW_PRICE_BELOW_COST: "Cada venta de este producto pierde plata. Subí el precio al sugerido, o si el costo está mal cargado, corregí el costo primero.",
  REVIEW_PRICE_MARGIN_POLICY: "Se vende con ganancia, pero menos de lo que pide la política de la categoría. Podés subir al precio sugerido o mantenerlo si es a propósito (competencia, liquidación).",
  PRODUCT_NOT_RENTABLE_UNDER_MARKET_PRICE: "Al precio que aguanta el mercado no deja margen. Conviene venderlo bajo pedido, buscar otro proveedor o bajar el flete asignado.",
  REVIEW_CZ_STOCK_PRICE_POLICY: "Producto de poco movimiento con stock parado. Evaluá liquidarlo con descuento o dejar de reponerlo.",
  REVIEW_BRANCH_PRICE_SETTINGS: "Esta sucursal tiene un precio distinto al de las demás. Si no es a propósito, alinealo en Precios.",
  REVIEW_BRANCH_COST_PRICE: "El costo propio de esta sucursal deja el precio bajo el costo. Subí el precio al sugerido o revisá si ese costo de sucursal está bien.",
  COST_CHANGED_PRICE_STALE: "El costo cambió después de la última vez que se fijó el precio. Aplicá el sugerido con el costo nuevo, o mantené el precio si ya lo revisaste.",
  PRICING_SCOPE_MISCONFIGURATION: "El gasto se está repartiendo mal (pocas unidades para mucho gasto). Revisá el alcance de gasto de la categoría en Precios.",
  WOOD_PRODUCT_WITHOUT_PRICE: "Madera sin precio de venta: no se puede vender bien en caja. Fijá el precio por sucursal en Precios o en Madera.",
  CREATE_PRICE_CHANGE_PROPOSAL: "Es una propuesta de cambio de precio. Revisala en Precios; si ya la viste, marcala como revisada.",

  REVIEW_WAC_BELOW_SALE_PRICE: "El costo promedio quedó por encima del precio de venta. Revisá la última entrada (cantidad o unidad mal digitada) antes de cambiar el precio.",
  REVIEW_WAC_VS_COST_CHAIN_DEVIATION: "El costo promedio se aleja mucho del costo esperado. Suele ser una entrada con unidad o cantidad equivocada: revisala en el Kardex.",
  REVIEW_WAC_SIBLING_BRANCH_DEVIATION: "El mismo producto cuesta muy distinto entre sucursales. Revisá si alguna entrada se cargó con el paquete como unidad.",

  REVIEW_FUSION_UNSELLABLE: "En la fusión, este producto quedó con precio bajo el costo. Aplicá el precio sugerido o corregí la base de la fusión.",
  REVIEW_FUSION_COST_BASIS_CONFLICT: "Los miembros de la fusión no coinciden en su costo base. Abrí la fusión y elegí cuál es el correcto.",
  REVIEW_FUSION_PRICE_BASIS_CONFLICT: "Los miembros de la fusión no coinciden en su precio base. Abrí la fusión y alinealos.",
  REVIEW_FUSION_PLACEHOLDER_COST: "La fusión usa un costo provisional. Cargá el costo real para que el margen sea confiable.",
  REVIEW_FUSION_MARGIN_OUTLIER: "Un miembro de la fusión tiene un margen muy distinto a los demás. Revisá su precio o su factor de conversión.",

  REVIEW_INVENTORY_MOVEMENTS: "Hay movimientos de inventario raros. Revisá el Kardex del producto y hacé un conteo antes de ajustar.",
  REVIEW_PRODUCT_STATE_DRIFT: "El resumen precalculado ya se corrigió solo. Solo marcalo como revisado.",
  REVIEW_REORDER_OR_TRANSFER: "Se está quedando sin stock. En Reposición podés pedirlo al proveedor o traerlo de otra sucursal que tenga de más.",
  REVIEW_PRODUCT_COST: "Tiene stock pero no tiene costo. Cargá el costo en el producto para que el margen y el inventario valgan bien.",
  INITIAL_STOCK_WITHOUT_COST: "La existencia inicial entró sin costo. Definí el costo en el producto antes de seguir vendiendo.",
  REVIEW_DISCOUNT_OR_TRANSFER: "Hay stock que casi no se mueve. Considerá un descuento o trasladarlo a una sucursal donde se venda más.",
  WOOD_CATEGORY_SKU_MISMATCH: "El SKU no coincide con la categoría de madera. Corregí la categoría o el SKU en el producto.",
  REVIEW_PRODUCT_PRICE: "Producto sin precio de venta en esta sucursal. Fijá el precio en el producto antes de venderlo.",
  REVIEW_INITIAL_INVENTORY: "Producto activo sin existencia. Cargá la existencia inicial o desactivalo si ya no se vende.",
  WOOD_DIMENSION_DUPLICATE_SUSPECT: "Parece que la misma medida de madera está dos veces. Revisá si son el mismo producto y fusionalos.",
  RECALCULATE_KARDEX_BALANCE: "El saldo del Kardex no cuadra. Revisalo en el producto; marcalo como revisado cuando esté bien.",
  CREATE_INVENTORY_ADJUSTMENT_DRAFT: "Se propone un ajuste de inventario. Hacé el conteo y registrá el ajuste en Inventario si corresponde.",
  SEND_TO_PHYSICAL_COUNT: "Conviene contar este producto. Mandalo a conteo físico desde Inventario.",

  REVIEW_REPLENISHMENT_SIGNAL: "Hay una señal de reposición. Abrí Reposición para decidir si comprar o trasladar.",
  REVIEW_PURCHASE_ORDER: "Este pedido de compra lleva tiempo sin moverse. Revisá si se recibe, se aprueba o se cancela.",
  REVIEW_PURCHASE_NEED: "Hay necesidad de compra. Antes de pedir, revisá si otra sucursal puede trasladar.",
  CREATE_PURCHASE_ORDER_DRAFT: "Brain ya armó el pedido. Al ejecutarlo se crea un borrador; no sale al proveedor hasta que lo apruebes en Compras.",
  CREATE_TRANSFER_DRAFT: "Brain ya armó el traslado. Al ejecutarlo se crea un borrador; no mueve stock hasta que se despache.",
  CONVERT_REORDER_ALERT_TO_PURCHASE: "La alerta de reorden se convierte en un pedido de compra en borrador, listo para revisar en Compras.",
  CONVERT_REORDER_ALERT_TO_TRANSFER: "La alerta de reorden se convierte en un traslado en borrador, listo para revisar en Traslados.",

  REVIEW_CASH_SESSION: "La caja tiene una diferencia sin explicar. Hablá con el cajero, revisá el cierre y anotá la causa.",
  RECALCULATE_CASH_SESSION: "Los totales guardados de la caja no coinciden con los pagos. Recalcular solo vuelve a sumar pagos y movimientos; no cambia ninguna venta.",
  REVIEW_CASH_CLOSURE: "Hubo algo raro en el cierre (ventas después del cierre, autorizaciones). Revisalo en Cierres de caja.",
  REVIEW_PAYMENT_DUPLICATE: "Parece un cobro doble. Compará la referencia con el banco antes de devolver nada.",
  REQUIRE_CASH_REVIEW: "Esta caja necesita revisión manual. Revisá el cierre y marcalo como revisado.",
  REFRESH_OPERATIONAL_DAY: "El resumen del Día Operativo está desactualizado. Refrescar solo vuelve a sumar; no cambia ventas ni cajas.",
  CASH_SESSION_CLOSE_DISCREPANCY: "Al cerrar la caja hubo descuadre. Confirmá con el cajero y dejá anotada la causa.",
  REVIEW_BANK_DEPOSIT_SHORTFALL: "Se depositó menos de lo que había en custodia. En Tesorería revisá el depósito o ajustá la custodia con su motivo.",
  REVIEW_BANK_DEPOSIT_ACCOUNT_MISMATCH: "El depósito cayó en otra cuenta. Corregí la cuenta del depósito en Tesorería.",
  REVIEW_CASH_EXPENSES_EXCEED_RETAINED: "Se pagaron gastos con más efectivo del que se dejó retenido. Revisá los gastos en Tesorería.",
  REVIEW_CASH_CANCELLATION_FOLLOWUP: "Se anuló una venta con efectivo de una caja ya cerrada. Confirmá que el dinero se devolvió y marcalo como revisado.",

  REVIEW_CAMERA_HEALTH: "Una cámara no está reportando. Revisá energía y red; marcalo como revisado cuando vuelva.",
  REVIEW_CAMERA_INFRA_FAILURE: "Se cayeron varias cámaras a la vez: suele ser el router o el grabador. Revisalo en sitio.",

  REVIEW_USER_DISCOUNTS: "Este usuario da más descuentos de lo normal. Revisá sus ventas en Descuentos y hablá con él si no se justifican.",
  CREATE_DISCOUNT_PROPOSAL: "Se propone un descuento para mover stock. Si te parece, crealo en Descuentos.",
  REPAIR_DRAFT_ORDER_TOTALS: "Una orden borrador tiene totales que no cuadran. Revisala en Ventas antes de cobrarla.",
  BLOCK_ORDER_FOR_REVIEW: "Una orden tiene pagos que no cuadran con su total. Revisala en Ventas antes de cerrar la caja.",
  INVALIDATE_MANUAL_INVOICE: "Una factura manual parece inválida. Revisala en Ventas y anulala si corresponde.",
  REVIEW_BRANCH_SALES_PERFORMANCE: "Esta sucursal vende bastante menos que el promedio. Mirá Analítica para ver qué productos bajaron.",
  REVIEW_PRODUCT_DEMAND_TREND: "La demanda de este producto cambió mucho. Ajustá la reposición según la tendencia.",

  REVIEW_DISPATCH_TICKET: "Una boleta de despacho está atrasada. Priorizala en Despacho.",
  REVIEW_TRANSPORT_CHARGE: "El cobro de transporte parece bajo. Revisá la tarifa antes de despachar.",
  REVIEW_TRANSPORT_SERVICE: "Un transporte está pendiente. Confirmá la salida y el cobro en Despacho.",

  PRODUCTION_OPPORTUNITY_FROM_EXCESS: "Hay insumo de sobra para producir. Evaluá crear un lote en Producción.",
  PRODUCTION_RECIPE_BLOCKED_BY_INPUTS: "Falta insumo para esta receta. Compralo o trasladalo antes de producir.",
  PRODUCTION_RECIPE_NEEDS_REVIEW: "La receta tiene datos a revisar. Abrila y corregí cantidades o costos.",
  EXCESS_INPUT_CAN_SUPPLY_SHORTAGE: "Un insumo que sobra puede cubrir un faltante. Revisalo en Producción.",
  PRODUCTION_RECIPE_MISSING_COST: "La receta no tiene costo. Cargá el costo de sus insumos para calcular el del producto.",
  PRODUCTION_BATCH_STUCK: "Un lote lleva días sin avanzar. Abrilo y terminalo o cancelalo.",
  PRODUCTION_OUTPUT_PRICE_BELOW_COST: "Lo que se produce se vende bajo su costo. Subí el precio del producto terminado o revisá la receta.",

  REVIEW_USER_PERMISSIONS: "Un usuario tiene permisos de más. Revisalos en Usuarios.",
  CREATE_AUDIT_CASE: "Se sugiere abrir un caso de auditoría. Revisá la bitácora y marcalo como revisado.",
  REVIEW_BRANCH_SETUP: "A esta sucursal le falta configuración. Completala en Sucursales.",
  REVIEW_SYSTEM_CONFIGURATION: "Hay una configuración del sistema a revisar en Configuración.",
  IRON_UNIT_CONVERSION_REQUIRED: "A este hierro le falta la conversión de unidad. Definila en el producto.",
  REVIEW_ONLY: "Aviso informativo. Revisalo y marcalo como revisado.",
  REVIEW_LEGACY_AI_INSIGHT: "Aviso del sistema viejo de análisis. Revisalo y marcalo como revisado.",
};

const HELP_BY_AREA: Record<DecisionArea, string> = {
  PRICING: "Revisalo en Precios.",
  CASH: "Revisalo en Cierres de caja o Tesorería.",
  SALES: "Revisalo en Ventas.",
  INVENTORY: "Revisalo en Inventario.",
  REORDER: "Revisalo en Reposición.",
  PURCHASING: "Revisalo en Compras.",
  DISPATCH: "Revisalo en Despacho.",
  PRODUCTION: "Revisalo en Producción.",
  SECURITY: "Revisalo y marcalo como revisado.",
  SYSTEM: "Revisalo y marcalo como revisado.",
};

const RUN_COPY: Record<string, { label: string; explain: string }> = {
  CREATE_PURCHASE_ORDER_DRAFT: { label: "Crear borrador de compra", explain: "Crea un pedido de compra en borrador con lo que Brain calculó. No se envía al proveedor hasta que lo apruebes en Compras." },
  CREATE_TRANSFER_DRAFT: { label: "Crear borrador de traslado", explain: "Crea un traslado en borrador entre sucursales. No mueve stock hasta que se despache." },
  CONVERT_REORDER_ALERT_TO_PURCHASE: { label: "Convertir en compra", explain: "Convierte la alerta de reorden en un pedido de compra en borrador para revisar en Compras." },
  CONVERT_REORDER_ALERT_TO_TRANSFER: { label: "Convertir en traslado", explain: "Convierte la alerta de reorden en un traslado en borrador para revisar en Traslados." },
  RECALCULATE_CASH_SESSION: { label: "Recalcular caja", explain: "Vuelve a sumar los pagos y movimientos de esa caja y corrige el esperado y la diferencia guardados. No cambia ninguna venta." },
  REFRESH_OPERATIONAL_DAY: { label: "Refrescar Día Operativo", explain: "Vuelve a sumar ventas y pendientes del día. No cambia ventas ni cajas." },
};

const nio = new Intl.NumberFormat("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (value: number) => `C$ ${nio.format(value)}`;

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function buildDecisionSuggestion(input: {
  proposedActionType: string | null;
  category: string;
  status: string;
  href: string | null;
  evidence: Record<string, unknown>;
  action: Record<string, unknown>;
}): DecisionSuggestion {
  const type = input.proposedActionType;
  const entry = getDecisionCatalogEntry(type, input.category);
  const costLooksWrong = input.evidence.costLooksWrong === true;
  const help = costLooksWrong && type !== null && PRICE_APPLY_TYPES.has(type)
    ? "El costo de este producto parece mal cargado (por ejemplo, el paquete como unidad). Corregí el costo primero; con el costo bien, el precio sugerido se recalcula solo."
    : (type && HELP_BY_TYPE[type]) || HELP_BY_AREA[entry.area];
  if (!ACTIVE_STATUSES.has(input.status)) return { recommended: null, alternatives: [], help };

  const options: SuggestionOption[] = [];
  const goResolve: SuggestionOption | null = input.href && entry.resolution !== "ACKNOWLEDGE"
    ? { kind: "GO_RESOLVE", label: entry.cta, explain: "Abre la pantalla donde se corrige, con todo el detalle.", needsConfirm: false }
    : null;
  const resolve: SuggestionOption = entry.resolution === "ACKNOWLEDGE"
    ? { kind: "RESOLVE", label: "Ya lo revisé", explain: "Cierra el aviso sin cambiar nada.", needsConfirm: false }
    : { kind: "RESOLVE", label: "Ya lo resolví", explain: "Cierra el aviso sin cambiar nada. Si el problema sigue, vuelve a aparecer en el próximo escaneo.", needsConfirm: false };

  const isOpenPricing = type !== null && input.status === "OPEN";
  const suggestedPrice = num(input.action.suggestedPrice);
  const currentPrice = num(input.action.currentPrice ?? input.evidence.currentPrice ?? input.evidence.effectivePrice ?? input.evidence.price);
  const cost = num(input.evidence.effectiveCost ?? input.evidence.cost);

  if (isOpenPricing && PRICE_APPLY_TYPES.has(type) && costLooksWrong) {
    options.push({ kind: "GO_RESOLVE", label: "Revisar el costo primero", explain: "Abre Precios para corregir el costo antes de tocar el precio.", needsConfirm: false });
  } else if (isOpenPricing && PRICE_APPLY_TYPES.has(type) && suggestedPrice !== null && suggestedPrice > PLACEHOLDER_PRICE_MAX
    && (currentPrice === null || Math.abs(suggestedPrice - currentPrice) >= 0.01)) {
    const margin = cost !== null && cost > 0 ? ((suggestedPrice - cost) / suggestedPrice) * 100 : null;
    options.push({
      kind: "APPLY_PRICE",
      label: `Aplicar precio sugerido ${money(suggestedPrice)}`,
      explain: `Cambia el precio de venta en esta sucursal${currentPrice !== null ? ` de ${money(currentPrice)}` : ""} a ${money(suggestedPrice)}${margin !== null ? ` (margen ${margin.toFixed(1)}%)` : ""}. Solo esta sucursal; queda en la bitácora. Si el costo subió y el precio quedara bajo el costo, no se aplica.`,
      price: suggestedPrice,
      needsConfirm: true,
    });
  }

  if (isOpenPricing && PRICE_KEEP_TYPES.has(type) && !costLooksWrong) {
    options.push({ kind: "KEEP_PRICE", label: "Mantener precio actual", explain: "No cambia el precio y lo marca como revisado. Si el costo vuelve a cambiar, el aviso regresa.", needsConfirm: true });
  }

  if (type && entry.resolution === "EXECUTABLE" && RUN_COPY[type]) {
    options.push({ kind: "RUN", ...RUN_COPY[type], needsConfirm: true });
  }

  if (goResolve && !options.some((o) => o.kind === "GO_RESOLVE")) options.push(goResolve);
  options.push(resolve);

  const [recommended, ...alternatives] = options;
  return { recommended, alternatives, help };
}
