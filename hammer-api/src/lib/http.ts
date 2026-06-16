import { NextResponse } from "next/server";
import { MissingDatabaseUrlError, isDatabaseConnectionError } from "@/lib/prisma";
import { isCsrfError } from "@/modules/security/csrf";

/**
 * Convert errors to appropriate HTTP responses using standard contract.
 * Returns: { ok: false, error: { code, message } }
 */
function errJson(code: string, message: string, status: number) {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status },
  );
}

export function toHttpErrorResponse(error: unknown) {
  // ── CSRF errors (highest priority) ──
  if (isCsrfError(error)) {
    return errJson("INVALID_CSRF_TOKEN", "CSRF invalido. Vuelve a intentar la accion.", 403);
  }

  if (error instanceof Error && "code" in error && (error as { code: string }).code) {
    const code = (error as { code: string }).code;
    if (["INVALID_MOVEMENT_QUANTITY", "NEGATIVE_UNIT_COST", "ZERO_COST_INBOUND", "NEGATIVE_CURRENT_QUANTITY", "NEGATIVE_CURRENT_WAC", "NEGATIVE_RESULTING_WAC", "NEGATIVE_INVENTORY_VALUE", "INVALID_INBOUND_QUANTITY"].includes(code)) {
      return errJson(code, error.message, 400);
    }
    if (code === "INSUFFICIENT_LOOSE_AND_RESERVED_PACKAGE_STOCK") {
      return errJson(code, error.message, 400);
    }
  }

  if (error instanceof MissingDatabaseUrlError || isDatabaseConnectionError(error)) {
    return errJson("SERVICE_UNAVAILABLE", "Base de datos no disponible o mal configurada.", 503);
  }

  if (error instanceof Error) {
    // Authentication errors
    if (error.message === "UNAUTHENTICATED" || error.message === "NOT_AUTHENTICATED") {
      return errJson("UNAUTHENTICATED", "No autenticado", 401);
    }

    // Authorization errors
    if (
      error.message === "FORBIDDEN_BRANCH" ||
      error.message === "FORBIDDEN_MASTER_ONLY" ||
      error.message === "FORBIDDEN_SYSTEM_ADMIN_ONLY" ||
      error.message === "FORBIDDEN_REPORTS" ||
      error.message === "FORBIDDEN_CAPABILITY" ||
      error.message === "FORBIDDEN_OWNER_ONLY" ||
      error.message === "FORBIDDEN_INVENTORY_IMPORT" ||
      error.name === "FORBIDDEN_PRODUCTION"
    ) {
      return errJson("FORBIDDEN", "Acceso denegado", 403);
    }

    // Legacy CSRF check
    if (error.message === "INVALID_CSRF_TOKEN") {
      return errJson("INVALID_CSRF_TOKEN", "CSRF invalido. Vuelve a intentar la accion.", 403);
    }

    // Business logic validation errors
    if (error.message === "INVALID_SALARY") {
      return errJson("VALIDATION_ERROR", "El salario debe ser mayor a 0", 400);
    }
    if (error.message.startsWith("INVALID_INPUT:") || error.message.startsWith("VALIDATION_ERROR:")) {
      return errJson("VALIDATION_ERROR", error.message.replace(/^INVALID_INPUT:\s?/, "").replace(/^VALIDATION_ERROR:\s?/, ""), 400);
    }
    if (error.message === "PRICE_APPLICATION_BLOCKED") {
      return errJson("PRICE_APPLICATION_BLOCKED", "El precio no puede aplicarse porque no cumple la rentabilidad minima.", 409);
    }

    // Stock errors
    if (error.message === "INSUFFICIENT_STOCK" || error.message === "INSUFFICIENT_STOCK_AT_PAYMENT") {
      return errJson("CONFLICT", "Stock insuficiente", 409);
    }

    // Branch closed
    if (error.message === "BRANCH_CLOSED") {
      return errJson("CONFLICT", "La sucursal está cerrada. No se pueden crear órdenes.", 409);
    }

    // Order validation errors
    if (error.message === "ORDER_NOT_DRAFT" || error.message === "INVALID_TRANSITION") {
      return errJson("CONFLICT", "La orden no está en estado editable.", 409);
    }
    if (error.message === "ORDER_EMPTY") {
      return errJson("VALIDATION_ERROR", "La orden está vacía. Agrega productos primero.", 400);
    }
    if (error.message === "SALE_ORDER_LINE_NOT_FOUND") {
      return errJson("NOT_FOUND", "La línea no pertenece a la orden indicada.", 404);
    }
    if (error.message === "PRODUCT_INACTIVE") {
      return errJson("VALIDATION_ERROR", "El producto no está activo.", 400);
    }

    // Operational day errors
    if (error.message === "OPERATIONAL_DAY_NOT_CLOSED") {
      return errJson("CONFLICT", "El dia operativo no está cerrado. Debe cerrar el día antes de aprobarlo.", 409);
    }
    if (error.message === "OPERATIONAL_DAY_ALREADY_APPROVED") {
      return errJson("CONFLICT", "El dia operativo ya fue aprobado anteriormente.", 409);
    }
    if (error.message === "OPERATIONAL_DAY_HAS_BLOCKERS" || error.message === "OPERATIONAL_DAY_HAS_HARD_BLOCKERS") {
      return errJson("CONFLICT", "El dia operativo tiene pendientes que impiden el cierre.", 409);
    }
    if (error.message === "OPERATIONAL_DAY_CLOSE_NOTE_REQUIRED") {
      return errJson("VALIDATION_ERROR", "Se requiere una nota para cerrar con advertencias o forzar el cierre.", 400);
    }
    if (error.message === "OPERATIONAL_DAY_HAS_REAL_PAYMENTS") {
      return errJson("CONFLICT", "El dia operativo tiene pagos reales y no puede cancelarse sin override.", 409);
    }
    if (error.message === "OPERATIONAL_DAY_ALREADY_OPEN") {
      return errJson("CONFLICT", "Ya existe un día operativo abierto para esta sucursal.", 409);
    }

    // Cash session errors
    if (error.message === "CASH_SESSION_AUTO_CLOSED_PENDING_REVIEW") {
      return errJson("CONFLICT", "La caja fue cerrada automaticamente por horario y requiere revision. Abra una nueva caja para continuar.", 409);
    }
    if (error.message === "OPERATIONAL_DAY_NOT_OPEN") {
      return errJson("CONFLICT", "El dia operativo no esta abierto. Abra el dia operativo antes de cobrar.", 409);
    }
    if (error.message === "OPERATIONAL_DAY_ALREADY_CLOSED") {
      return errJson("CONFLICT", "El dia operativo ya fue cerrado.", 409);
    }
    if (error.message === "OPERATIONAL_DAY_STALE") {
      return errJson("OPERATIONAL_DAY_STALE", "El dia operativo abierto es de una fecha anterior. Contacte al administrador para cerrarlo.", 409);
    }
    if (error.message === "CASH_SESSION_NOT_OPEN" || error.message === "CASH_SESSION_ALREADY_OPEN" || error.message === "CASH_SESSION_CASH_BOX_INVALID") {
      return errJson("CONFLICT", error.message, 409);
    }
    if (error.message === "CASH_BOX_INACTIVE") {
      return errJson("CASH_BOX_INACTIVE", "La caja fisica esta inactiva y no puede usarse.", 409);
    }
    if (error.message === "CASH_BOX_BRANCH_MISMATCH") {
      return errJson("CASH_BOX_BRANCH_MISMATCH", "La caja fisica no pertenece a esta sucursal.", 409);
    }
    if (error.message === "CASH_SESSION_OPERATOR_REQUIRED") {
      return errJson("FORBIDDEN", "Solo operadores autorizados de esta sesion pueden realizar esta accion.", 403);
    }
    if (error.message === "INVALID_CASH_SESSION") {
      return errJson("INVALID_CASH_SESSION", "Sesion de caja no valida para esta operacion.", 409);
    }
    if (error.message === "DIRECT_PAYMENT_DISABLED") {
      return errJson("DIRECT_PAYMENT_DISABLED", "El pago directo no esta habilitado en esta sucursal.", 409);
    }
    if (
      error.message === "CASH_SESSION_NOT_RECONCILING"
      || error.message === "CASH_SESSION_NOT_PENDING_AUTO_REVIEW"
      || error.message === "CASH_SESSION_UNRESOLVED_ORDERS"
      || error.message === "CASH_SESSION_HAS_PENDING_PAYMENTS"
      || error.message === "CASH_SESSION_DISCREPANCY_REQUIRES_APPROVAL"
    ) {
      return errJson("CONFLICT", error.message, 409);
    }

    // Payment errors
    if (error.message === "PAYMENT_INVALID_STATUS" || error.message === "PAYMENT_ALREADY_POSTED") {
      return errJson("CONFLICT", "La orden ya no está disponible para pago.", 409);
    }
    if (error.message === "INVALID_PAYMENT_AMOUNT") {
      return errJson("VALIDATION_ERROR", "Monto de pago inválido.", 400);
    }
    if (error.message === "NO_ACTIVE_CASH_BOX" || error.message === "NO_ACTIVE_CASH_SESSION") {
      return errJson("CONFLICT", "No hay caja o sesión de caja activa.", 409);
    }

    // Dispatch errors
    if (error.message === "DISPATCH_INVALID_STATUS" || error.message === "DISPATCH_ALREADY_COMPLETED") {
      return errJson("CONFLICT", "El despacho no puede completarse en el estado actual.", 409);
    }

    // Not found errors
    if (error.message.includes("NOT_FOUND") || error.message.includes("not found")) {
      return errJson("NOT_FOUND", "Recurso no encontrado", 404);
    }

    // Prisma record not found
    if ("code" in error && (error as Record<string, unknown>).code === "P2025") {
      return errJson("NOT_FOUND", "Registro no encontrado", 404);
    }

    // Prisma unique constraint violation
    if ("code" in error && (error as Record<string, unknown>).code === "P2002") {
      return errJson("CONFLICT", "Ya existe un registro con esos datos", 409);
    }

    // Prisma interactive transaction timeout (P2028)
    if ("code" in error && (error as Record<string, unknown>).code === "P2028") {
      return errJson("TIMEOUT", "La operacion excedio el tiempo limite de la transaccion. Intenta con menos registros o reintenta.", 504);
    }

    // Prisma transaction write conflict / deadlock (P2034)
    if ("code" in error && (error as Record<string, unknown>).code === "P2034") {
      return errJson("CONFLICT", "Conflicto de escritura en la transaccion. Reintenta la operacion.", 409);
    }
  }

  console.error("[HTTP_ERROR]", error);
  return errJson("INTERNAL_ERROR", "Error interno del servidor", 500);
}
