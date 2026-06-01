export type ApiErrorPayload = {
  message?: string;
  reason?: string;
  code?: string;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

const ERROR_MESSAGES_ES: Record<string, string> = {
  BRANCH_CLOSED: "La caja de la sucursal está cerrada. No se pueden procesar ventas.",
  NO_ACTIVE_CASH_SESSION: "No hay una sesión de caja abierta. Abre una sesión para continuar.",
  NO_ACTIVE_CASH_BOX: "No hay caja física activa. Contacta al administrador.",
  CASH_SESSION_NOT_OPEN: "La sesión de caja no está abierta.",
  CASH_SESSION_AUTO_CLOSED_PENDING_REVIEW: "La caja fue cerrada automaticamente por horario y requiere revision. Abre una nueva caja para continuar.",
  OPERATIONAL_DAY_NOT_OPEN: "No hay dia operativo abierto para esta sucursal. Solicita a un administrador abrir la operacion de hoy.",
  CASH_SESSION_ALREADY_OPEN: "Ya existe una sesión abierta para esta caja.",
  CASH_SESSION_CASH_BOX_INVALID: "La caja física no está activa o no pertenece a la sucursal.",
  CASH_SESSION_NOT_RECONCILING: "La sesión debe estar en conciliación antes de cerrarla.",
  CASH_SESSION_UNRESOLVED_ORDERS: "No puedes cerrar caja con órdenes pendientes de pago o despacho.",
  CASH_SESSION_HAS_PENDING_PAYMENTS: "Hay pagos pendientes en esta sesión. Procésalos antes de cerrar.",
  CASH_SESSION_DISCREPANCY_REQUIRES_APPROVAL: "La diferencia de caja requiere aprobación de un supervisor.",
  INVALID_CASH_SESSION: "La sesión de caja no es válida para esta operación.",
  CASH_BOX_INACTIVE: "La caja física no está activa. Contacta al administrador.",
  CASH_BOX_BRANCH_MISMATCH: "La caja física no pertenece a esta sucursal.",
  CASHIER_MODULE_ENABLED: "El módulo de caja está habilitado. Usa el flujo normal de cobro.",
  FORBIDDEN: "No tienes permiso para realizar esta acción.",
  FORBIDDEN_ROLE: "Tu rol no tiene permisos para esta operación.",
  FORBIDDEN_BRANCH: "No tienes acceso a esta sucursal.",
  UNAUTHENTICATED: "Tu sesión expiró. Inicia sesión nuevamente.",
  NOT_AUTHENTICATED: "Tu sesión expiró. Inicia sesión nuevamente.",
  INVALID_CSRF_TOKEN: "Sesión inválida por seguridad. Recarga la pantalla e inténtalo de nuevo.",
  INSUFFICIENT_STOCK: "Stock insuficiente para completar la operación.",
  INSUFFICIENT_STOCK_AT_PAYMENT: "Stock insuficiente al confirmar. Verifica existencias y vuelve a intentar.",
  PRODUCT_INACTIVE: "El producto no está disponible actualmente.",
  ORDER_NOT_DRAFT: "La orden ya no está en estado editable.",
  ORDER_EMPTY: "La orden está vacía. Agrega productos antes de continuar.",
  INVALID_TRANSITION: "La orden ya no puede cambiar de estado.",
  PAYMENT_ALREADY_POSTED: "Esta orden ya fue pagada. Evita registrar un pago duplicado.",
  PAYMENT_INVALID_STATUS: "La orden ya no está disponible para cobro.",
  INVALID_PAYMENT_AMOUNT: "El monto del pago no coincide con el total de la orden.",
  TRANSPORT_INVALID: "Datos de transporte inválidos. Verifica el monto y vuelve a intentar.",
  INVALID_TRANSPORT_AMOUNT: "Monto de transporte inválido. Debe ser un número mayor que cero.",
  SALE_ORDER_LINE_NOT_FOUND: "La línea del ticket ya no existe o no pertenece a esta orden.",
  NETWORK_ERROR: "Error de red. Verifica tu conexión e inténtalo nuevamente.",
};

function normalizeErrorKey(value?: string): string {
  if (!value) return "";
  return value.trim().toUpperCase().replace(/\s+/g, "_");
}

export function mapPosErrorToSpanish(input: {
  payload?: ApiErrorPayload;
  status?: number;
  fallback?: string;
  thrownError?: unknown;
}): string {
  const { payload, status, fallback, thrownError } = input;

  if (thrownError instanceof TypeError) {
    return ERROR_MESSAGES_ES.NETWORK_ERROR;
  }

  if (status === 401) {
    return ERROR_MESSAGES_ES.UNAUTHENTICATED;
  }

  const reasonKey = normalizeErrorKey(payload?.reason ?? payload?.error?.code);
  if (reasonKey === "BELOW_COST_NOT_ALLOWED") return "No se puede vender por debajo del costo efectivo.";
  if (reasonKey === "BELOW_COST_OVERRIDE_REASON_REQUIRED") return "No se puede vender por debajo del costo efectivo sin una razon autorizada.";
  if (reasonKey === "DISCOUNT_LIMIT_EXCEEDED") return "Este rol no puede aplicar ese descuento.";
  if (reasonKey && ERROR_MESSAGES_ES[reasonKey]) {
    return ERROR_MESSAGES_ES[reasonKey];
  }

  const messageKey = normalizeErrorKey(payload?.message ?? payload?.error?.message);
  if (messageKey && ERROR_MESSAGES_ES[messageKey]) {
    return ERROR_MESSAGES_ES[messageKey];
  }

  const message = payload?.message ?? payload?.error?.message;
  if (message?.trim()) {
    return message;
  }

  return fallback ?? "No se pudo completar la operación. Intenta nuevamente.";
}

export type DispatchVisualStatus =
  | "PENDING"
  | "ASSIGNED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "CANCELLED"
  | "FAILED"
  | "IN_PROGRESS"
  | "DISPATCHED"
  | "DISPATCH_PENDING";

const DISPATCH_STATUS_LABELS_ES: Record<string, string> = {
  PENDING: "Pendiente",
  ASSIGNED: "Asignado",
  IN_TRANSIT: "En tránsito",
  DELIVERED: "Entregado",
  CANCELLED: "Cancelado",
  FAILED: "Fallido",
  IN_PROGRESS: "En preparación",
  DISPATCHED: "Despachado",
  DISPATCH_PENDING: "Pendiente de despacho",
};

export function mapDispatchStatusToSpanish(status?: string): string {
  if (!status) return "Sin estado";
  return DISPATCH_STATUS_LABELS_ES[status] ?? status.replace(/_/g, " ").toLowerCase();
}

export function mapDispatchStatusVariant(
  status?: string,
): "neutral" | "warning" | "info" | "success" | "danger" {
  if (!status) return "neutral";

  if (status === "PENDING" || status === "ASSIGNED" || status === "DISPATCH_PENDING") return "warning";
  if (status === "IN_PROGRESS" || status === "IN_TRANSIT") return "info";
  if (status === "DELIVERED" || status === "DISPATCHED") return "success";
  if (status === "CANCELLED" || status === "FAILED") return "danger";
  return "neutral";
}
