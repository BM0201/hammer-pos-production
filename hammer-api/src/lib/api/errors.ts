import { Prisma } from "@prisma/client";
import { z, type ZodSchema } from "zod";
import { MissingDatabaseUrlError, isDatabaseConnectionError } from "@/lib/prisma";
import { isCsrfError } from "@/modules/security/csrf";
import { conflict, fail, forbidden, notFound, unauthorized, validationFail } from "@/lib/api/response";

const VALIDATION_CODES = new Set([
  "INVALID_MOVEMENT_QUANTITY",
  "NEGATIVE_UNIT_COST",
  "ZERO_COST_INBOUND",
  "NEGATIVE_CURRENT_QUANTITY",
  "NEGATIVE_CURRENT_WAC",
  "NEGATIVE_RESULTING_WAC",
  "NEGATIVE_INVENTORY_VALUE",
  "INVALID_INBOUND_QUANTITY",
  "PAYMENT_REFERENCE_REQUIRED",
  "INVALID_TENDER_AMOUNT",
  "INVALID_CASH_RECEIVED_AMOUNT",
  "INVALID_CASH_CHANGE_AMOUNT",
]);

const FORBIDDEN_MESSAGES = new Set([
  "FORBIDDEN_BRANCH",
  "FORBIDDEN_MASTER_ONLY",
  "FORBIDDEN_FINANCE_ONLY",
  "FORBIDDEN_SYSTEM_ADMIN_ONLY",
  "FORBIDDEN_REPORTS",
  "FORBIDDEN_CAPABILITY",
  "FORBIDDEN_OWNER_ONLY",
  "FORBIDDEN_MODULE_DISABLED",
  "FORBIDDEN_OWNER_OR_SYSTEM_ADMIN_ONLY",
]);

const WORKFLOW_MODULE_ERRORS: Record<string, { message: string; status: number }> = {
  CASHIER_MODULE_DISABLED: { message: "Modulo de caja desactivado en esta sucursal", status: 403 },
  CASHIER_MODULE_ENABLED: { message: "Modulo de caja activo - use flujo de caja en lugar de venta directa", status: 403 },
  DISPATCH_MODULE_DISABLED: { message: "Modulo de despacho desactivado en esta sucursal", status: 403 },
  INVALID_WORKFLOW_ACTION: { message: "Accion de workflow invalida para esta configuracion", status: 403 },
  TRANSPORT_REQUIRED_BUT_MISSING: { message: "Se requiere transporte pero no se proporciono informacion", status: 400 },
};

const CASH_SESSION_CONFLICTS = new Set([
  "CASH_SESSION_NOT_OPEN",
  "CASH_SESSION_ALREADY_OPEN",
  "CASH_SESSION_RECONCILING",
  "CASH_SESSION_CASH_BOX_INVALID",
  "CASH_SESSION_NOT_RECONCILING",
  "CASH_SESSION_UNRESOLVED_ORDERS",
  "CASH_SESSION_HAS_PENDING_PAYMENTS",
  "CASH_SESSION_DISCREPANCY_REQUIRES_APPROVAL",
  "CASH_BOX_INACTIVE",
  "CASH_BOX_BRANCH_MISMATCH",
  "INVALID_CASH_SESSION",
  "DIRECT_PAYMENT_DISABLED",
]);

const PAYMENT_CONFLICTS = new Set([
  "PAYMENT_INVALID_STATUS",
  "PAYMENT_ALREADY_POSTED",
  "NO_ACTIVE_CASH_BOX",
  "NO_ACTIVE_CASH_SESSION",
]);

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function getErrorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

export function toApiErrorResponse(error: unknown) {
  // ZodError handling
  if (error instanceof z.ZodError) {
    return validationFail(error.flatten());
  }

  if (isCsrfError(error)) {
    return fail("INVALID_CSRF_TOKEN", "CSRF invalido", 403);
  }

  const code = getErrorCode(error);
  const message = getErrorMessage(error);

  if (code && VALIDATION_CODES.has(code)) {
    return fail(code, message ?? "Datos invalidos", 400);
  }

  if (error instanceof MissingDatabaseUrlError || isDatabaseConnectionError(error)) {
    return fail(
      "DATABASE_UNAVAILABLE",
      "Base de datos no disponible o mal configurada. Verifica DATABASE_URL.",
      503,
    );
  }

  if (message === "UNAUTHENTICATED" || message === "NOT_AUTHENTICATED") {
    return unauthorized();
  }

  if (message && FORBIDDEN_MESSAGES.has(message)) {
    return forbidden(message);
  }

  if (message === "CASH_SESSION_OPERATOR_REQUIRED") {
    return forbidden("Solo operadores autorizados de esta sesion pueden realizar esta accion.");
  }

  if (message === "STALE_OPERATIONAL_DAY_OPEN" || message === "OPERATIONAL_DAY_STALE") {
    return fail("STALE_OPERATIONAL_DAY_OPEN", "Existe un dia operativo anterior abierto. Un administrador Master debe ejecutar limpieza operativa.", 409);
  }

  if (message === "OPERATIONAL_DAY_ALREADY_CLOSED") {
    return fail("OPERATIONAL_DAY_ALREADY_CLOSED", "El dia operativo ya fue cerrado.", 409);
  }

  // prompt-historial-sucursal.md Fase 3.2 — executeSaleCancellation
  // (sales-returns/service.ts) lo lanza si el día operativo de la
  // anulación ya está CONFIRMED (un período cerrado no se reabre).
  if (message === "OPERATIONAL_DAY_ALREADY_CONFIRMED") {
    return fail("OPERATIONAL_DAY_ALREADY_CONFIRMED", "El dia operativo de esta anulacion ya fue confirmado — no se puede ejecutar.", 409);
  }

  if (message === "CASH_SESSION_RECONCILING") {
    return fail("CASH_SESSION_RECONCILING", "La caja esta en proceso de conciliacion.", 409);
  }

  if (message === "CASH_SESSION_AFTER_CLOSING_TIME") {
    return fail("CASH_SESSION_AFTER_CLOSING_TIME", "La hora de cierre operativo ya paso. No se puede abrir una nueva sesion de caja.", 409);
  }

  if (message === "NO_ACTIVE_CASH_BOX_FOR_BRANCH") {
    return fail("NO_ACTIVE_CASH_BOX_FOR_BRANCH", "La sucursal no tiene caja fisica activa configurada.", 409);
  }

  if (message === "STALE_PENDING_PAYMENT_ORDERS") {
    return fail("STALE_PENDING_PAYMENT_ORDERS", "Hay ordenes con pago pendiente que deben resolverse antes de cerrar la caja.", 409);
  }

  if (message === "OPERATIONAL_DAY_REOPEN_REQUIRED") {
    return fail("OPERATIONAL_DAY_REOPEN_REQUIRED", "El dia operativo fue cerrado. Un administrador Master debe reabrirlo.", 409);
  }

  // Workflow module errors
  if (message && message in WORKFLOW_MODULE_ERRORS) {
    const wf = WORKFLOW_MODULE_ERRORS[message];
    return fail(message, wf.message, wf.status);
  }

  if (message === "INVALID_CSRF_TOKEN") {
    return fail("INVALID_CSRF_TOKEN", "CSRF invalido", 403);
  }

  if (message === "INVALID_SALARY") {
    return fail("INVALID_SALARY", "El salario debe ser mayor a 0", 400);
  }

  if (message?.startsWith("INVALID_INPUT:")) {
    return fail("INVALID_INPUT", message.replace("INVALID_INPUT: ", ""), 400);
  }

  if (message === "INSUFFICIENT_STOCK" || message === "INSUFFICIENT_STOCK_AT_PAYMENT") {
    return conflict("Stock insuficiente");
  }

  if (message === "BRANCH_CLOSED") {
    return fail("BRANCH_CLOSED", "La sucursal esta cerrada. No se pueden crear ordenes.", 409);
  }

  if (message === "ORDER_NOT_DRAFT" || message === "INVALID_TRANSITION") {
    return fail(message, "La orden no esta en estado editable.", 409);
  }

  if (message === "ORDER_EMPTY") {
    return fail("ORDER_EMPTY", "La orden esta vacia. Agrega productos primero.", 400);
  }

  if (message === "SALE_ORDER_LINE_NOT_FOUND") {
    return notFound("La linea no pertenece a la orden indicada.");
  }

  if (message === "PRODUCT_INACTIVE") {
    return fail("PRODUCT_INACTIVE", "El producto no esta activo.", 400);
  }

  if (message === "PRODUCT_HAS_NO_BRANCH_PRICE") {
    return fail("PRODUCT_HAS_NO_BRANCH_PRICE", "Este producto no tiene precio de venta asignado en esta sucursal. Asignalo en Catalogo -> Precios y costos antes de venderlo.", 422);
  }

  if (message && CASH_SESSION_CONFLICTS.has(message)) {
    return fail(message, message, 409);
  }

  if (message && PAYMENT_CONFLICTS.has(message)) {
    return fail(message, "La orden ya no esta disponible para pago.", 409);
  }

  if (message === "INVALID_PAYMENT_AMOUNT") {
    return fail("INVALID_PAYMENT_AMOUNT", "Monto de pago invalido.", 400);
  }

  if (message === "DISPATCH_INVALID_STATUS" || message === "DISPATCH_ALREADY_COMPLETED") {
    return fail(message, "El despacho no puede completarse en el estado actual.", 409);
  }

  // prompt-pendientes-2026-09.md Fase 3 — sales-returns/service.ts lanzaba
  // estos códigos desde antes, pero ninguno estaba mapeado acá: las rutas de
  // solicitar/ejecutar devolución (que usan toApiErrorResponse, a diferencia
  // de approvals/[id]/route.ts que ya traducía SALE_RETURN_NOT_REQUESTED por
  // su cuenta con toHttpErrorResponse) devolvían 500 genérico para cualquier
  // regla de negocio violada, sin forma de distinguir una de otra en la UI.
  // conflict() siempre devuelve code "CONFLICT" — acá se usa fail() con el
  // código original para que el mapa de mensajes del frontend (que busca por
  // code) pueda distinguir cada caso.
  if (message === "SALE_ORDER_NOT_RETURNABLE") {
    return fail("SALE_ORDER_NOT_RETURNABLE", "Esta orden no está en un estado que permita devoluciones.", 409);
  }

  if (message === "SALE_ORDER_NOT_PAID") {
    return fail("SALE_ORDER_NOT_PAID", "Esta orden no tiene pagos confirmados.", 409);
  }

  if (message === "SALE_RETURN_LINE_NOT_IN_ORDER") {
    return fail("SALE_RETURN_LINE_NOT_IN_ORDER", "Una de las líneas no pertenece a esta orden.", 400);
  }

  if (message === "SALE_RETURN_QUANTITY_EXCEEDS_SOLD") {
    return fail("SALE_RETURN_QUANTITY_EXCEEDS_SOLD", "La cantidad supera lo vendido (o ya solicitado/devuelto) de esa línea.", 400);
  }

  if (message?.startsWith("RETURN_ITEM_")) {
    return fail(message, "La condición del ítem no coincide con el destino de inventario.", 400);
  }

  if (message === "SALE_RETURN_NOT_REQUESTED") {
    return fail("SALE_RETURN_NOT_REQUESTED", "Esta solicitud ya fue resuelta o ejecutada.", 409);
  }

  if (message === "SALE_CANCELLATION_NOT_REQUESTED") {
    return fail("SALE_CANCELLATION_NOT_REQUESTED", "Esta solicitud ya fue resuelta o ejecutada.", 409);
  }

  if (message === "SALE_RETURN_NOT_APPROVED") {
    return fail("SALE_RETURN_NOT_APPROVED", "Esta devolución todavía no fue aprobada.", 409);
  }

  if (message === "SALE_RETURN_ALREADY_EXECUTED") {
    return fail("SALE_RETURN_ALREADY_EXECUTED", "Esta devolución ya fue ejecutada.", 409);
  }

  if (message === "CASH_SESSION_REQUIRED_FOR_CASH_REFUND") {
    return fail("CASH_SESSION_REQUIRED_FOR_CASH_REFUND", "Selecciona la sesión de caja para un reembolso en efectivo.", 400);
  }

  if (message === "REFUND_EXCEEDS_AMOUNT_PAID") {
    return fail("REFUND_EXCEEDS_AMOUNT_PAID", "El monto a reembolsar supera lo efectivamente pagado.", 409);
  }

  if (message === "REFUND_METHOD_MISMATCH_REQUIRES_MASTER_EXCEPTION") {
    return fail("REFUND_METHOD_MISMATCH_REQUIRES_MASTER_EXCEPTION", "Cambiar el método de reembolso requiere una devolución aprobada por Master.", 409);
  }

  if (message === "CUSTOMER_REQUIRED_FOR_CREDIT_NOTE") {
    return fail("CUSTOMER_REQUIRED_FOR_CREDIT_NOTE", "Se requiere un cliente para emitir una nota de crédito.", 400);
  }

  // prompt-historial-sucursal.md Fase 1.4 — mismos códigos de
  // sales-returns/service.ts para anulaciones, sin mapear hasta ahora.
  if (message === "SALE_ORDER_NOT_CANCELLABLE") {
    return fail("SALE_ORDER_NOT_CANCELLABLE", "Esta orden no está en un estado que permita anularla.", 409);
  }

  if (message === "SALE_CANCELLATION_ALREADY_PENDING") {
    return fail("SALE_CANCELLATION_ALREADY_PENDING", "Ya hay una solicitud de anulación en curso para esta orden.", 409);
  }

  if (message === "SALE_CANCELLATION_NOT_APPROVED") {
    return fail("SALE_CANCELLATION_NOT_APPROVED", "Esta anulación todavía no fue aprobada.", 409);
  }

  if (message === "SALE_CANCELLATION_ALREADY_EXECUTED") {
    return fail("SALE_CANCELLATION_ALREADY_EXECUTED", "Esta anulación ya fue ejecutada.", 409);
  }

  if (message?.includes("NOT_FOUND") || message?.toLowerCase().includes("not found")) {
    return notFound();
  }

  if (code === "P2025" || error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
    return notFound("Registro no encontrado");
  }

  if (code === "P2002" || error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return fail("UNIQUE_CONSTRAINT_VIOLATION", "Ya existe un registro con esos datos", 409);
  }

  console.error("[API_ERROR]", error);
  return fail("INTERNAL_SERVER_ERROR", "Error interno del servidor", 500);
}



/**
 * Parse JSON body from a Request and validate with Zod.
 * Returns the validated data or throws a ZodError (caught by toApiErrorResponse).
 */
export async function parseJsonBody<T>(request: Request, schema: ZodSchema<T>): Promise<T> {
  const raw = await request.json().catch(() => null);
  return schema.parse(raw);
}
