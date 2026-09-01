import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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
    // "un 409 es una pregunta, no un error" — el WAC resultante se disparó
    // muy por encima del actual (detectExcessiveWacJump, wac.ts). No es un
    // payload inválido (400): es una operación válida que necesita
    // confirmación explícita del usuario (reintentar con allowLargeWacJump),
    // el mismo patrón que FUSION_PRICE_OVERRIDE_CONFIRMATION_REQUIRED abajo.
    if (code === "EXCESSIVE_WAC_JUMP") {
      return errJson(code, error.message, 409);
    }
    // Cualquier otro WacValidationError sin mapeo específico (p.ej.
    // SUSPECTED_PACKAGE_COST_AS_UNIT_COST lanzado desde createOpeningBalance,
    // que no tiene su propio catch como /api/inventory/movements) — 422 en
    // vez de caer al 500 mudo del fallback final. Mismo patrón que ya usan
    // /api/inventory/movements y /api/catalog/products/[id] con sus propios
    // catches; esto cubre a quien no tiene uno.
    if (error.name === "WacValidationError") {
      return errJson(code, error.message, 422);
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
      error.message === "FORBIDDEN_FINANCE_ONLY" ||
      error.message === "FORBIDDEN_SYSTEM_ADMIN_ONLY" ||
      error.message === "FORBIDDEN_REPORTS" ||
      error.message === "FORBIDDEN_CAPABILITY" ||
      error.message === "FORBIDDEN_OWNER_ONLY" ||
      error.message === "FORBIDDEN_INVENTORY_IMPORT" ||
      error.name === "FORBIDDEN_PRODUCTION"
    ) {
      return errJson("FORBIDDEN", "Acceso denegado", 403);
    }

    // Auditoría 2026-08-03: requireSaleOrderPrintAccess/requireTransferPrintAccess/
    // requirePurchaseOrderPrintAccess (modules/printing/printing-access.ts) lanzan
    // "FORBIDDEN: <detalle>" — sin este caso genérico, ese mensaje no matcheaba
    // ninguna de las constantes exactas de arriba y caía al 500 genérico del
    // final, aunque el acceso SÍ se estaba denegando correctamente (bug de
    // status code, no de autorización — pero le devolvía al cliente "error
    // interno" en vez de "acceso denegado").
    if (error.message.startsWith("FORBIDDEN:")) {
      return errJson("FORBIDDEN", error.message.replace(/^FORBIDDEN:\s?/, ""), 403);
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
    if (error.message.startsWith("REPAIR_PREVIEW_STALE:")) {
      return errJson("REPAIR_PREVIEW_STALE", error.message.replace(/^REPAIR_PREVIEW_STALE:\s?/, ""), 409);
    }
    if (error.message === "INJECTION_PREVIEW_STALE") {
      return errJson("INJECTION_PREVIEW_STALE", "El costo del inventario cambió desde que se generó el preview. Vuelve a calcular antes de completar el lote.", 409);
    }
    if (error.message === "ONLY_COMPLETED_BATCHES_CAN_BE_REVERSED") {
      return errJson("CONFLICT", "Solo un lote completado puede revertirse.", 409);
    }
    if (error.message.startsWith("INSUFFICIENT_STOCK_TO_REVERSE:")) {
      return errJson("INSUFFICIENT_STOCK_TO_REVERSE", error.message.replace(/^INSUFFICIENT_STOCK_TO_REVERSE:\s?/, ""), 409);
    }
    if (error.message === "PRICE_APPLICATION_BLOCKED") {
      return errJson("PRICE_APPLICATION_BLOCKED", "El precio no puede aplicarse porque no cumple la rentabilidad minima.", 409);
    }
    if (error.message === "BELOW_COST_NOT_ALLOWED") {
      return errJson("BELOW_COST_NOT_ALLOWED", "El precio no puede ser menor al costo. Corrige el costo y el precio juntos.", 409);
    }
    if (error.message === "FUSION_COST_WRITE_NOT_ALLOWED") {
      return errJson("FUSION_COST_WRITE_NOT_ALLOWED", "Esta presentación es un miembro derivado de una fusión: el costo se carga en el producto canónico, no aquí.", 409);
    }
    if (error.message === "PRICE_EXCEPTION_REASON_REQUIRED") {
      return errJson("PRICE_EXCEPTION_REASON_REQUIRED", "Escribí el motivo de este precio de sucursal (mínimo 3 caracteres).", 400);
    }
    if (error.message.startsWith("FUSION_PRICE_OVERRIDE_CONFIRMATION_REQUIRED:")) {
      return errJson("FUSION_PRICE_OVERRIDE_CONFIRMATION_REQUIRED", error.message.replace(/^FUSION_PRICE_OVERRIDE_CONFIRMATION_REQUIRED:\s?/, ""), 409);
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
    if (error.message === "PRODUCT_HAS_NO_BRANCH_PRICE") {
      return errJson("PRODUCT_HAS_NO_BRANCH_PRICE", "Este producto no tiene precio de venta asignado en esta sucursal. Asígnalo en Catálogo → Precios y costos antes de venderlo.", 422);
    }

    // Operational day errors — Día Operativo 360 (bitácora, no compuerta):
    // el día operativo nunca bloquea abrir caja ni vender. Estos códigos son
    // todos de la firma de Master (confirmar/reabrir/revertir/cancelar) o de
    // integridad de datos, no de flujo operativo normal.
    if (error.message === "BRANCH_NOT_ACTIVE") {
      return errJson("CONFLICT", "La sucursal no está activa.", 409);
    }
    if (error.message === "OPERATIONAL_DAY_NOT_ACTIVE") {
      return errJson("CONFLICT", "El día operativo de esta sesión ya no está activo.", 409);
    }
    if (error.message === "OPERATIONAL_DAY_CANCELLED") {
      return errJson("CONFLICT", "El día operativo fue anulado.", 409);
    }
    if (error.message === "OPERATIONAL_DAY_CONFIRM_REQUIRES_HUMAN") {
      return errJson("FORBIDDEN", "Confirmar un día operativo requiere la firma de un usuario Master real.", 403);
    }
    if (error.message === "OPERATIONAL_DAY_CONFIRM_NOTE_REQUIRED") {
      return errJson("VALIDATION_ERROR", "Se requiere una nota para confirmar un día con pendientes o diferencia de caja.", 400);
    }
    if (error.message === "OPERATIONAL_DAY_NOT_AWAITING_REVIEW") {
      return errJson("CONFLICT", "El día operativo no está en espera de revisión.", 409);
    }
    if (error.message === "OPERATIONAL_DAY_REOPEN_NOTE_REQUIRED") {
      return errJson("VALIDATION_ERROR", "Se requiere una nota de justificación para reabrir el día.", 400);
    }
    if (error.message === "OPERATIONAL_DAY_REOPEN_PAST_DATE") {
      return errJson("CONFLICT", "Solo se puede reabrir el día operativo de hoy.", 409);
    }
    if (error.message === "FORCE_CLEANUP_NOTE_REQUIRED") {
      return errJson("VALIDATION_ERROR", "Se requiere una nota de justificacion para ejecutar force-cleanup.", 400);
    }
    if (error.message === "OPERATIONAL_DAY_ALREADY_CONFIRMED") {
      return errJson("CONFLICT", "El día operativo ya fue confirmado por Master.", 409);
    }
    if (error.message === "OPERATIONAL_DAY_NOT_CONFIRMED") {
      return errJson("CONFLICT", "El día operativo todavía no fue confirmado.", 409);
    }
    if (error.message === "OPERATIONAL_DAY_REVERT_NOTE_REQUIRED") {
      return errJson("VALIDATION_ERROR", "Se requiere una nota para revertir la confirmación.", 400);
    }
    if (error.message === "OPERATIONAL_DAY_HAS_REAL_PAYMENTS" || error.message === "OPERATIONAL_DAY_HAS_REAL_ACTIVITY") {
      return errJson("CONFLICT", "El dia operativo tiene actividad real (pagos, devoluciones o movimientos de caja) y no puede cancelarse sin override.", 409);
    }
    if (error.message === "OPERATIONAL_DAY_ALREADY_CANCELLED") {
      return errJson("CONFLICT", "El dia operativo ya fue cancelado.", 409);
    }
    if (error.message === "OPERATIONAL_DAY_ALREADY_OPEN") {
      return errJson("CONFLICT", "Ya existe un día operativo abierto para esta sucursal.", 409);
    }
    if (error.message === "OPERATIONAL_DAY_OPEN_DATE_NOT_TODAY") {
      return errJson("FORBIDDEN", "Solo un Master puede abrir un dia operativo con fecha distinta a hoy.", 403);
    }
    if (error.message === "OPERATIONAL_DAY_OPEN_FUTURE_NOT_ALLOWED") {
      return errJson("CONFLICT", "No se puede abrir un dia operativo con fecha futura.", 409);
    }
    if (error.message === "OPERATIONAL_DAY_OPEN_DATE_NOTE_REQUIRED") {
      return errJson("VALIDATION_ERROR", "Se requiere una nota para abrir un dia operativo con fecha distinta a hoy.", 400);
    }
    if (error.message === "OPERATIONAL_DAY_REOPEN_BLOCKED_ACTIVE_DAY_EXISTS") {
      return errJson("CONFLICT", "No se puede reabrir: la sucursal ya tiene un dia operativo activo. Cierra el dia en curso primero.", 409);
    }

    // Cash session errors
    if (error.message === "CASH_SESSION_AUTO_CLOSED_PENDING_REVIEW") {
      return errJson("CONFLICT", "La caja fue cerrada automaticamente por horario y requiere revision. Abra una nueva caja para continuar.", 409);
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
    if (error.message === "CASH_SESSION_RECONCILING") {
      return errJson("CASH_SESSION_RECONCILING", "La caja esta en proceso de conciliacion. Espera a que se complete el cierre antes de abrir una nueva sesion.", 409);
    }
    if (error.message === "CASH_SESSION_AFTER_CLOSING_TIME") {
      return errJson("CASH_SESSION_AFTER_CLOSING_TIME", "La hora de cierre operativo ya paso. No se puede abrir una nueva sesion de caja.", 409);
    }
    if (error.message === "NO_ACTIVE_CASH_BOX_FOR_BRANCH") {
      return errJson("NO_ACTIVE_CASH_BOX_FOR_BRANCH", "La sucursal no tiene caja fisica activa configurada.", 409);
    }
    if (error.message === "STALE_PENDING_PAYMENT_ORDERS") {
      return errJson("STALE_PENDING_PAYMENT_ORDERS", "Hay ordenes con pago pendiente que deben resolverse antes de cerrar la caja.", 409);
    }
    if (error.message === "OPERATIONAL_DAY_REOPEN_REQUIRED") {
      return errJson("OPERATIONAL_DAY_REOPEN_REQUIRED", "El dia operativo fue cerrado. Un administrador Master debe reabrirlo para continuar operaciones.", 409);
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
    if (error.message === "PAYMENT_REFERENCE_REQUIRED") {
      return errJson("PAYMENT_REFERENCE_REQUIRED", "Se requiere numero de referencia para pagos con tarjeta o transferencia.", 400);
    }
    if (error.message === "PAYMENT_BANK_ACCOUNT_REQUIRED") {
      return errJson("PAYMENT_BANK_ACCOUNT_REQUIRED", "Elegí a qué cuenta entró la transferencia.", 400);
    }
    if (error.message === "INVALID_TENDER_AMOUNT") {
      return errJson("INVALID_TENDER_AMOUNT", "El monto del pago debe ser mayor que cero.", 400);
    }
    if (error.message === "INVALID_CASH_RECEIVED_AMOUNT") {
      return errJson("INVALID_CASH_RECEIVED_AMOUNT", "El monto recibido en efectivo no puede ser menor al total.", 400);
    }
    if (error.message === "INVALID_CASH_CHANGE_AMOUNT") {
      return errJson("INVALID_CASH_CHANGE_AMOUNT", "El cambio registrado no coincide con el monto recibido menos el total.", 400);
    }
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

  // Cualquier otro error de Prisma (schema desincronizado, select invalido,
  // etc.) que no matcheo un codigo conocido arriba: lo dejamos rastreado en
  // logs en vez de caer al 500 mudo del fallback final.
  if (error instanceof Prisma.PrismaClientValidationError || error instanceof Prisma.PrismaClientKnownRequestError) {
    console.error("[prisma]", error);
    return errJson("QUERY_ERROR", "Error de consulta en base de datos.", 500);
  }

  console.error("[HTTP_ERROR]", error);
  return errJson("INTERNAL_ERROR", "Error interno del servidor", 500);
}
