/**
 * Diccionario único de traducción de la bitácora — acción cruda → frase humana.
 * Ver prompt-auditoria-v2.md. Fuente de verdad para audit-log-viewer.tsx.
 *
 * Agregar una acción nueva = una entrada en DESCRIPTORS. Una acción NO mapeada
 * jamás rompe: cae a resolveFallback(), que humaniza el `action` crudo y usa
 * un patrón de sensibilidad (*_DELETED, *VOID*, FORCE_*, etc).
 */

export type AuditActor = { id: string; username: string; fullName: string } | null;
export type AuditBranch = { id: string; code: string; name: string } | null;

export type AuditEvent = {
  id: string;
  occurredAt: string;
  module: string;
  action: string;
  entityType: string;
  entityId: string;
  metadataJson: Record<string, unknown> | null;
  branch: AuditBranch;
  actor: AuditActor;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type HeadlineSegment = { text: string; emphasis?: boolean };
export type FilterGroup = "sales" | "inventory" | "cash" | "pricing" | "people";
export type Role = "danger" | "warning" | "success" | "info" | "master" | "owner" | "neutral";

export type ResolvedEvent = {
  actorLabel: string;
  headline: HeadlineSegment[];
  context: string | null;
  sensitive: boolean;
  moduleLabel: string;
  filterGroup: FilterGroup | null;
  role: Role;
  detailProse: string;
  diff: { was: string; now: string; delta?: string } | null;
  rawMetadata: Record<string, unknown> | null;
  /** false = cayó al fallback humanizado (acción no mapeada explícitamente). */
  mapped: boolean;
};

// ── Módulo → etiqueta legible (tag "mod" de cada fila; ~30 valores reales) ──

export const MODULE_LABEL: Record<string, string> = {
  approvals: "Aprobaciones",
  auth: "Autenticación",
  mfa: "Autenticación 2FA",
  brain: "Brain / Decisiones",
  "branch-config": "Configuración de sucursal",
  branches: "Sucursales",
  catalog: "Catálogo",
  "catalog-inventory": "Catálogo · Inventario",
  cash_session: "Caja (sesiones)",
  cash_closure: "Cierre de caja",
  discounts: "Descuentos",
  dispatch: "Despacho",
  expenses: "Gastos",
  "internal-freight": "Flete interno",
  inventory: "Inventario",
  operations: "Día operacional",
  payments: "Pagos",
  payroll: "Nómina",
  pricing: "Precios",
  printing: "Impresión",
  production: "Producción",
  "purchase-orders": "Órdenes de compra",
  reorder: "Reorden",
  sales: "Ventas",
  sales_returns: "Devoluciones",
  sales_cancellations: "Anulaciones",
  suppliers: "Proveedores",
  "system-admin": "Administración del sistema",
  timber: "Madera",
  transfers: "Traslados",
  transport: "Transporte",
  users: "Usuarios",
  analytics: "Analítica",
  security: "Seguridad",
};

// ── Módulo → grupo de filtro (solo los 5 chips del mockup; el resto queda sin
//    chip propio, visible igual bajo "Todo"/"Sensible") ──

const MODULE_GROUP: Partial<Record<string, FilterGroup>> = {
  sales: "sales",
  sales_returns: "sales",
  sales_cancellations: "sales",
  payments: "sales",
  dispatch: "sales",
  inventory: "inventory",
  "catalog-inventory": "inventory",
  catalog: "inventory",
  transfers: "inventory",
  reorder: "inventory",
  production: "inventory",
  timber: "inventory",
  "purchase-orders": "inventory",
  suppliers: "inventory",
  "internal-freight": "inventory",
  transport: "inventory",
  cash_session: "cash",
  cash_closure: "cash",
  expenses: "cash",
  pricing: "pricing",
  discounts: "pricing",
  users: "people",
  payroll: "people",
  auth: "people",
  mfa: "people",
  branches: "people",
  "branch-config": "people",
  "system-admin": "people",
  security: "people",
};

export const GROUP_LABEL: Record<FilterGroup, string> = {
  sales: "Ventas",
  inventory: "Inventario",
  cash: "Caja",
  pricing: "Precios",
  people: "Personas",
};

const GROUP_ROLE: Record<FilterGroup, Role> = {
  sales: "success",
  inventory: "info",
  cash: "warning",
  pricing: "owner",
  people: "master",
};

// ── Helpers de formato ──

const money = (v: unknown) => {
  const n = Number(v ?? 0);
  return new Intl.NumberFormat("es-NI", { style: "currency", currency: "NIO" }).format(n);
};
const pct = (v: unknown) => `${Number(v ?? 0) >= 0 ? "+" : ""}${Number(v ?? 0).toFixed(1)}%`;
const str = (v: unknown, fallback = "—") => (typeof v === "string" && v.trim() ? v : fallback);
const num = (v: unknown) => Number(v ?? 0);
const shortId = (id: string) => `${id.slice(0, 10)}…`;

const seg = (text: string, emphasis = false): HeadlineSegment => ({ text, emphasis });

// ── Patrones de sensibilidad para el fallback (acciones NO mapeadas) ──

const SENSITIVE_PATTERNS: RegExp[] = [
  /_DELETED$/, /^MASS_DELETE/, /_DELETE$/,
  /VOID/,
  /REVERSED?$/, /REVERSAL/,
  /^FORCE_/,
  /^EMERGENCY_/,
  /^MANUAL_/,
  /^DISCOUNT_/,
  /^PRICE_/,
  /^OVERRIDE_/,
  /CANCEL/,
  /^REFUND/,
  /ROLE_CHANGED|GLOBAL_ROLE/,
  /_REJECTED$/,
];

function isSensitiveByPattern(action: string): boolean {
  return SENSITIVE_PATTERNS.some((re) => re.test(action));
}

function humanizeAction(action: string): string {
  return action.toLowerCase().replace(/_/g, " ");
}

// ── El diccionario ──

type Descriptor = {
  sensitive: boolean;
  role?: Role;
  label: string;
  headline: (e: AuditEvent) => HeadlineSegment[];
  context?: (e: AuditEvent) => string | null;
  detail?: (e: AuditEvent) => string;
  diff?: (e: AuditEvent) => ResolvedEvent["diff"];
};

const DESCRIPTORS: Record<string, Descriptor> = {
  // ── Ventas ──────────────────────────────────────────────────────────────
  SALE_ORDER_CREATED: {
    sensitive: false,
    label: "creó una venta",
    headline: () => [seg("creó una venta nueva")],
  },
  DIRECT_SALE_COMPLETED: {
    sensitive: false,
    label: "registró una venta de contado",
    headline: (e) => [seg("registró una venta de contado por "), seg(money(e.metadataJson?.amount), true)],
    context: (e) => `pago: ${str(e.metadataJson?.method as string, "—").toLowerCase()}`,
  },
  SALE_ORDER_SUBMITTED_PENDING_PAYMENT: {
    sensitive: false,
    label: "envió una venta a cobro",
    headline: () => [seg("envió una venta a cobro pendiente")],
  },
  SALE_ORDER_CANCELLED: {
    sensitive: true,
    role: "danger",
    label: "anuló una venta",
    headline: (e) => [
      seg("anuló la venta "),
      seg(`#${str(e.metadataJson?.orderNumber as string, shortId(e.entityId))}`, true),
      seg(" por "),
      seg(money(e.metadataJson?.grandTotal), true),
    ],
    context: (e) => `motivo: "${str(e.metadataJson?.reason as string)}"`,
    detail: (e) =>
      `Se anuló una venta ya creada${num(e.metadataJson?.voidedPaymentsCount) > 0 ? ", con pagos revertidos" : ""}.`,
  },
  SALE_CANCELLATION_REQUESTED: {
    sensitive: true,
    label: "solicitó anular una venta",
    headline: () => [seg("solicitó anular una venta")],
    context: (e) => (e.metadataJson?.reason ? `motivo: "${str(e.metadataJson?.reason as string)}"` : null),
  },
  SALE_CANCELLATION_APPROVED: {
    sensitive: true,
    label: "aprobó la anulación de una venta",
    headline: () => [seg("aprobó la anulación de una venta")],
  },
  SALE_CANCELLATION_REJECTED: {
    sensitive: false,
    label: "rechazó la anulación de una venta",
    headline: () => [seg("rechazó una solicitud de anulación")],
  },
  SALE_CANCELLATION_EXECUTED: {
    sensitive: true,
    role: "danger",
    label: "ejecutó la anulación de una venta",
    headline: () => [seg("ejecutó la anulación de una venta")],
  },

  // ── Devoluciones / notas de crédito / reembolsos ─────────────────────────
  SALE_RETURN_REQUESTED: {
    sensitive: true,
    label: "solicitó una devolución",
    headline: () => [seg("solicitó una devolución de venta")],
  },
  SALE_RETURN_APPROVED: {
    sensitive: true,
    label: "aprobó una devolución",
    headline: () => [seg("aprobó una devolución de venta")],
  },
  SALE_RETURN_REJECTED: {
    sensitive: false,
    label: "rechazó una devolución",
    headline: () => [seg("rechazó una solicitud de devolución")],
    context: (e) => (e.metadataJson?.reason ? `motivo: "${str(e.metadataJson?.reason as string)}"` : null),
  },
  SALE_RETURN_EXECUTED: {
    sensitive: true,
    role: "danger",
    label: "ejecutó una devolución",
    headline: () => [seg("ejecutó una devolución de venta")],
    context: (e) => (e.metadataJson?.refundMethod ? `reembolso: ${str(e.metadataJson?.refundMethod as string).toLowerCase()}` : null),
  },
  CREDIT_NOTE_CREATED: {
    sensitive: true,
    label: "emitió una nota de crédito",
    headline: (e) => [seg("emitió una nota de crédito por "), seg(money(e.metadataJson?.amount), true)],
  },
  REFUND_POSTED: {
    sensitive: true,
    role: "danger",
    label: "devolvió dinero de caja",
    headline: (e) => [
      seg("devolvió "), seg(money(e.metadataJson?.amount), true),
      seg(` (${str(e.metadataJson?.method as string, "—").toLowerCase()})`),
    ],
  },
  DAMAGED_INVENTORY_RECEIVED: {
    sensitive: false,
    label: "recibió inventario dañado de una devolución",
    headline: () => [seg("recibió inventario dañado de una devolución")],
  },

  // ── Descuentos / Precios ──────────────────────────────────────────────────
  DISCOUNT_CREATED: {
    sensitive: true,
    label: "creó un descuento",
    headline: (e) => [
      seg("creó el descuento "), seg(str(e.metadataJson?.name as string, "sin nombre"), true),
      seg(" de "), seg(`${num(e.metadataJson?.value)}${e.metadataJson?.type === "PERCENTAGE" ? "%" : ""}`, true),
    ],
  },
  DISCOUNT_UPDATED: {
    sensitive: true,
    label: "modificó un descuento",
    headline: () => [seg("modificó un descuento")],
  },
  DISCOUNT_DELETED: {
    sensitive: true,
    label: "eliminó un descuento",
    headline: (e) => [seg("eliminó el descuento "), seg(str(e.metadataJson?.name as string), true)],
  },
  PRICE_APPLIED: {
    sensitive: true,
    role: "owner",
    label: "cambió un precio",
    headline: () => [seg("cambió el precio de un producto")],
    diff: (e) => {
      const was = e.metadataJson?.previousPrice;
      const now = e.metadataJson?.newPrice;
      if (was == null || now == null) return null;
      const wasN = Number(was);
      const nowN = Number(now);
      const delta = wasN > 0 ? pct(((nowN - wasN) / wasN) * 100) : undefined;
      return { was: money(was), now: money(now), delta };
    },
    context: (e) => {
      const was = Number(e.metadataJson?.previousPrice ?? 0);
      const now = Number(e.metadataJson?.newPrice ?? 0);
      return was > 0 ? pct(((now - was) / was) * 100) : null;
    },
  },
  EXPENSE_CREATED: {
    sensitive: false,
    label: "registró un gasto",
    headline: () => [seg("registró un gasto")],
  },
  EXPENSE_UPDATED: {
    sensitive: false,
    label: "modificó un gasto",
    headline: () => [seg("modificó un gasto")],
  },
  EXPENSE_DELETED: {
    sensitive: true,
    label: "eliminó un gasto",
    headline: () => [seg("eliminó un gasto")],
  },
  CATEGORY_POLICY_CREATED: {
    sensitive: false,
    label: "creó una política de categoría",
    headline: () => [seg("creó una política de precios por categoría")],
  },
  CATEGORY_POLICY_UPDATED: {
    sensitive: true,
    label: "modificó una política de precios",
    headline: () => [seg("modificó una política de precios por categoría")],
  },
  PRODUCT_GLOBAL_COST_UPDATED: {
    sensitive: true,
    role: "owner",
    label: "actualizó el costo global de un producto",
    headline: () => [seg("actualizó el costo global de un producto")],
  },

  // ── Inventario / Catálogo ─────────────────────────────────────────────────
  MANUAL_INVENTORY_ADJUSTMENT: {
    sensitive: true,
    role: "danger",
    label: "hizo un ajuste manual de inventario",
    headline: (e) => {
      const closed = num(e.metadataJson?.closedDelta);
      const loose = num(e.metadataJson?.looseDelta);
      const delta = closed !== 0 ? closed : loose;
      const sign = delta > 0 ? "+" : "";
      return [seg("hizo un ajuste manual de inventario: "), seg(`${sign}${delta}`, true)];
    },
    context: (e) => (e.metadataJson?.reason ? `motivo: ${str(e.metadataJson?.reason as string)}` : null),
  },
  INVENTORY_MOVEMENT_CREATE: {
    sensitive: false,
    role: "info",
    label: "registró un movimiento de inventario",
    headline: () => [seg("registró un movimiento de inventario")],
  },
  STOCK_ADJUSTMENT_REQUESTED: {
    sensitive: true,
    label: "solicitó un ajuste de inventario",
    headline: (e) => [seg("solicitó un ajuste de inventario de "), seg(`${num(e.metadataJson?.adjustmentDelta)}`, true)],
    context: (e) => (e.metadataJson?.reason ? `motivo: ${str(e.metadataJson?.reason as string)}` : null),
  },
  STOCK_ADJUSTMENT_DENIED: {
    sensitive: false,
    label: "denegó un ajuste de inventario",
    headline: () => [seg("denegó un ajuste de inventario (autorización insuficiente)")],
  },
  STOCK_ADJUSTMENT_REJECTED: {
    sensitive: false,
    label: "rechazó un ajuste de inventario",
    headline: () => [seg("rechazó una solicitud de ajuste de inventario")],
  },
  PACKAGE_OPENED: {
    sensitive: false,
    role: "info",
    label: "abrió un paquete cerrado",
    headline: () => [seg("abrió un paquete cerrado para vender por unidad")],
  },
  PACKAGE_CLOSED: {
    sensitive: false,
    role: "info",
    label: "reempacó sueltas a empaque cerrado",
    headline: () => [seg("reempacó unidades sueltas de vuelta a empaque cerrado")],
  },
  MASS_DELETE_ALL_PRODUCTS: {
    sensitive: true,
    role: "danger",
    label: "borró todo el catálogo de productos",
    headline: (e) => [seg("borró TODO el catálogo — "), seg(`${num(e.metadataJson?.deletedCount)} productos`, true)],
  },
  PRODUCT_CREATE: {
    sensitive: false,
    label: "creó un producto",
    headline: () => [seg("creó un producto nuevo")],
  },
  PRODUCT_UPDATE: {
    sensitive: false,
    label: "modificó un producto",
    headline: () => [seg("modificó un producto")],
  },
  PRODUCT_DELETE: {
    sensitive: true,
    label: "eliminó un producto",
    headline: (e) => [seg("eliminó el producto "), seg(str(e.metadataJson?.name as string), true)],
  },
  PRODUCT_DEACTIVATE: {
    sensitive: true,
    label: "desactivó un producto",
    headline: () => [seg("desactivó un producto (tiene historial asociado)")],
  },
  CATEGORY_CREATE: {
    sensitive: false,
    label: "creó una categoría",
    headline: () => [seg("creó una categoría de catálogo")],
  },
  CATEGORY_DELETE: {
    sensitive: true,
    label: "eliminó una categoría",
    headline: (e) => [seg("eliminó la categoría "), seg(str(e.metadataJson?.name as string), true)],
  },
  CATEGORY_DEACTIVATE: {
    sensitive: false,
    label: "desactivó una categoría",
    headline: () => [seg("desactivó una categoría (tiene productos asociados)")],
  },
  TRANSFER_CREATED: {
    sensitive: false,
    role: "info",
    label: "creó un traslado",
    headline: (e) => [seg("creó el traslado "), seg(`#${str(e.metadataJson?.transferNumber as string, shortId(e.entityId))}`, true)],
  },
  TRANSFER_APPROVED: {
    sensitive: false,
    label: "aprobó un traslado",
    headline: () => [seg("aprobó un traslado")],
  },
  TRANSFER_CANCELLED: {
    sensitive: true,
    label: "canceló un traslado",
    headline: () => [seg("canceló un traslado")],
  },
  PURCHASE_ORDER_CREATED: {
    sensitive: false,
    label: "creó una orden de compra",
    headline: (e) => [
      seg("creó la orden de compra "), seg(`#${str(e.metadataJson?.orderNumber as string, shortId(e.entityId))}`, true),
      seg(" por "), seg(money(e.metadataJson?.total), true),
    ],
  },
  PURCHASE_ORDER_APPROVED: {
    sensitive: false,
    label: "aprobó una orden de compra",
    headline: () => [seg("aprobó una orden de compra")],
  },
  PURCHASE_ORDER_CANCELLED: {
    sensitive: true,
    label: "canceló una orden de compra",
    headline: () => [seg("canceló una orden de compra")],
  },
  RECIPE_CREATE: {
    sensitive: false,
    label: "creó una receta de producción",
    headline: () => [seg("creó una receta de producción")],
  },
  BATCH_COMPLETE: {
    sensitive: false,
    label: "completó un lote de producción",
    headline: () => [seg("completó un lote de producción")],
  },
  BATCH_REVERSED: {
    sensitive: true,
    label: "revirtió un lote de producción",
    headline: () => [seg("revirtió un lote de producción")],
  },
  TIMBER_COST_INJECTED: {
    sensitive: true,
    role: "owner",
    label: "inyectó costos de madera al catálogo",
    headline: () => [seg("inyectó costos de un viaje de madera al catálogo")],
  },

  // ── Caja / Día operativo ──────────────────────────────────────────────────
  CASH_MOVEMENT_CREATED: {
    sensitive: false,
    role: "warning",
    label: "registró un movimiento de caja",
    headline: (e) => [
      seg("registró un movimiento de caja de "), seg(money(e.metadataJson?.amount), true),
      seg(` (${str(e.metadataJson?.type as string, "—").toLowerCase()})`),
    ],
    context: (e) => (e.metadataJson?.reason ? `motivo: ${str(e.metadataJson?.reason as string)}` : null),
  },
  CASH_SESSION_OPERATOR_ASSIGNED: {
    sensitive: false,
    label: "asignó un operador de caja",
    headline: () => [seg("asignó un operador a una caja")],
  },
  REVIEW_COMPLETED: {
    sensitive: false,
    label: "revisó una caja auto-cerrada",
    headline: () => [seg("completó la revisión de una caja auto-cerrada")],
  },
  EMERGENCY_REOPEN: {
    sensitive: true,
    role: "danger",
    label: "reabrió un cierre de caja de emergencia",
    headline: () => [seg("hizo una reapertura de emergencia de un cierre de caja")],
    context: (e) => (e.metadataJson?.reason ? `motivo: "${str(e.metadataJson?.reason as string)}"` : null),
  },
  CASH_BOX_CREATED: {
    sensitive: false,
    label: "creó una caja física",
    headline: () => [seg("creó una caja física")],
  },
  CASH_BOX_CONSOLIDATED: {
    sensitive: true,
    label: "consolidó cajas físicas",
    headline: () => [seg("consolidó dos cajas físicas en una")],
  },
  OPERATIONAL_DAY_OPENED: {
    sensitive: false,
    role: "master",
    label: "abrió el día operativo",
    headline: () => [seg("abrió el día operativo")],
  },
  OPERATIONAL_DAY_CLOSED: {
    sensitive: false,
    role: "master",
    label: "cerró el día operativo",
    headline: () => [seg("cerró el día operativo")],
    context: (e) => {
      const diff = e.metadataJson?.summary && typeof e.metadataJson.summary === "object"
        ? (e.metadataJson.summary as Record<string, unknown>).cashDifferenceTotal
        : null;
      return diff != null ? `diferencia de caja: ${money(diff)}` : null;
    },
  },
  OPERATIONAL_DAY_MASTER_APPROVED: {
    sensitive: false,
    role: "master",
    label: "aprobó el día operativo",
    headline: () => [seg("aprobó el cierre del día operativo")],
  },
  OPERATIONAL_DAY_CANCELLED: {
    sensitive: true,
    label: "canceló un día operativo",
    headline: () => [seg("canceló un día operativo")],
  },
  OPERATIONAL_DAY_REOPENED: {
    sensitive: true,
    label: "reabrió un día operativo",
    headline: () => [seg("reabrió un día operativo ya cerrado")],
    context: (e) => (e.metadataJson?.note ? `nota: "${str(e.metadataJson?.note as string)}"` : null),
  },
  FORCE_CLEANUP_EXECUTED: {
    sensitive: true,
    role: "danger",
    label: "ejecutó una limpieza forzada",
    headline: () => [seg("ejecutó una limpieza operativa forzada")],
    context: (e) => (e.metadataJson?.note ? `nota: "${str(e.metadataJson?.note as string)}"` : null),
  },
  OPERATIONAL_DAY_ORPHAN_CASH_SESSION_AUTO_CLOSED: {
    sensitive: true,
    label: "auto-cerró una caja huérfana",
    headline: () => [seg("auto-cerró una caja huérfana pendiente de revisión")],
  },

  // ── Personas ──────────────────────────────────────────────────────────────
  LOGIN_SUCCESS: {
    sensitive: false,
    label: "inició sesión",
    headline: () => [seg("inició sesión")],
  },
  LOGIN_FAILURE: {
    sensitive: false,
    label: "falló un intento de inicio de sesión",
    headline: () => [seg("falló un intento de inicio de sesión")],
    context: (e) => (e.metadataJson?.reason ? str(e.metadataJson?.reason as string) : null),
  },
  LOGOUT: {
    sensitive: false,
    label: "cerró sesión",
    headline: () => [seg("cerró sesión")],
  },
  PASSWORD_CHANGED: {
    sensitive: false,
    label: "cambió su contraseña",
    headline: () => [seg("cambió su contraseña")],
  },
  PASSWORD_RESET_BY_ADMIN: {
    sensitive: true,
    label: "reseteó la contraseña de un usuario",
    headline: (e) => [seg("reseteó la contraseña de "), seg(str(e.metadataJson?.username as string), true)],
  },
  MFA_ENABLED: {
    sensitive: false,
    label: "activó verificación en dos pasos",
    headline: () => [seg("activó la verificación en dos pasos")],
  },
  MFA_DISABLED: {
    sensitive: true,
    label: "desactivó verificación en dos pasos",
    headline: () => [seg("desactivó la verificación en dos pasos")],
  },
  USER_CREATED: {
    sensitive: false,
    label: "creó un usuario",
    headline: () => [seg("creó un usuario nuevo")],
  },
  USER_UPDATED: {
    sensitive: false,
    label: "modificó un usuario",
    headline: (e) => [seg("modificó el usuario "), seg(str(e.metadataJson?.username as string), true)],
  },
  USER_DEACTIVATED: {
    sensitive: true,
    label: "desactivó un usuario",
    headline: (e) => [seg("desactivó al usuario "), seg(str(e.metadataJson?.username as string), true)],
  },
  USER_REACTIVATED: {
    sensitive: false,
    label: "reactivó un usuario",
    headline: (e) => [seg("reactivó al usuario "), seg(str(e.metadataJson?.username as string), true)],
  },
  USER_DELETED: {
    sensitive: true,
    label: "eliminó un usuario",
    headline: () => [seg("eliminó un usuario")],
  },
  GLOBAL_ROLE_CHANGED: {
    sensitive: true,
    role: "danger",
    label: "cambió el rol global de un usuario",
    headline: (e) => [
      seg("cambió el rol de "), seg(str(e.metadataJson?.username as string), true),
      seg(" a "), seg(str(e.metadataJson?.newGlobalRole as string), true),
    ],
  },
  BRANCH_ROLE_CONFIG_UPDATED: {
    sensitive: true,
    label: "modificó la configuración de roles",
    headline: () => [seg("modificó la configuración de roles por sucursal")],
  },
  SYSTEM_SETTING_UPDATED: {
    sensitive: true,
    label: "modificó un ajuste del sistema",
    headline: () => [seg("modificó un ajuste global del sistema")],
  },
  BRANCH_CREATED: {
    sensitive: false,
    label: "creó una sucursal",
    headline: (e) => [seg("creó la sucursal "), seg(str(e.metadataJson?.name as string), true)],
  },
  BRANCH_UPDATED: {
    sensitive: false,
    label: "modificó una sucursal",
    headline: () => [seg("modificó una sucursal")],
  },
  SUPPLIER_CREATED: {
    sensitive: false,
    label: "creó un proveedor",
    headline: () => [seg("creó un proveedor nuevo")],
  },
  SUPPLIER_UPDATED: {
    sensitive: false,
    label: "modificó un proveedor",
    headline: () => [seg("modificó un proveedor")],
  },
};

// ── Resolución final ──

function actorLabelOf(actor: AuditActor): string {
  if (!actor) return "El sistema";
  return actor.fullName || actor.username;
}

function fallbackDescriptor(action: string): Descriptor {
  return {
    sensitive: isSensitiveByPattern(action),
    label: humanizeAction(action),
    headline: () => [seg(`hizo: ${humanizeAction(action)}`)],
  };
}

export function resolveAuditEvent(e: AuditEvent): ResolvedEvent {
  const mapped = e.action in DESCRIPTORS;
  const descriptor = DESCRIPTORS[e.action] ?? fallbackDescriptor(e.action);
  const filterGroup = MODULE_GROUP[e.module] ?? null;
  const role: Role = descriptor.role ?? (descriptor.sensitive ? "danger" : filterGroup ? GROUP_ROLE[filterGroup] : "neutral");

  let context: string | null = null;
  try {
    context = descriptor.context ? descriptor.context(e) : null;
  } catch {
    context = null;
  }

  let diff: ResolvedEvent["diff"] = null;
  try {
    diff = descriptor.diff ? descriptor.diff(e) : null;
  } catch {
    diff = null;
  }

  let detailProse = descriptor.label;
  try {
    detailProse = descriptor.detail ? descriptor.detail(e) : descriptor.label;
  } catch {
    detailProse = descriptor.label;
  }

  return {
    actorLabel: actorLabelOf(e.actor),
    headline: descriptor.headline(e),
    context,
    sensitive: descriptor.sensitive,
    moduleLabel: MODULE_LABEL[e.module] ?? e.module,
    filterGroup,
    role,
    detailProse,
    diff,
    rawMetadata: e.metadataJson,
    mapped,
  };
}
