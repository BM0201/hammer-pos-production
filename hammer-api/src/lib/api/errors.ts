import { Prisma } from "@prisma/client";
import { z, type ZodSchema } from "zod";
import { MissingDatabaseUrlError, isDatabaseConnectionError } from "@/lib/prisma";
import { isCsrfError } from "@/modules/security/csrf";
import { InsufficientStockError } from "@/modules/inventory/wac";
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
]);

const FORBIDDEN_MESSAGES = new Set([
  "FORBIDDEN_BRANCH",
  "FORBIDDEN_MASTER_ONLY",
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
  "CASH_SESSION_CASH_BOX_INVALID",
  "CASH_SESSION_NOT_RECONCILING",
  "CASH_SESSION_UNRESOLVED_ORDERS",
  "CASH_SESSION_HAS_PENDING_PAYMENTS",
  "CASH_SESSION_DISCREPANCY_REQUIRES_APPROVAL",
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

  // Descriptive insufficient-stock error (includes available/requested qty).
  if (error instanceof InsufficientStockError) {
    return conflict(error.detail);
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
