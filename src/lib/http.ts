import { NextResponse } from "next/server";
import { MissingDatabaseUrlError, isDatabaseConnectionError } from "@/lib/prisma";

/**
 * Convert errors to appropriate HTTP responses.
 *
 * BUG FIX: Added handling for "NOT_AUTHENTICATED" (used by timber routes).
 * BUG FIX: Added handling for "INVALID_SALARY" and "INVALID_INPUT" errors.
 * BUG FIX: Added handling for Prisma-specific errors (P2025 = record not found).
 * BUG FIX: Log actual error for debugging (server-side only).
 */
export function toHttpErrorResponse(error: unknown) {
  if (error instanceof Error && "code" in error && (error as { code: string }).code) {
    // Handle WacValidationError and similar coded errors
    const code = (error as { code: string }).code;
    if (["INVALID_MOVEMENT_QUANTITY", "NEGATIVE_UNIT_COST", "ZERO_COST_INBOUND", "NEGATIVE_CURRENT_QUANTITY", "NEGATIVE_CURRENT_WAC", "NEGATIVE_RESULTING_WAC", "NEGATIVE_INVENTORY_VALUE", "INVALID_INBOUND_QUANTITY"].includes(code)) {
      return NextResponse.json({ message: error.message, code }, { status: 400 });
    }
  }

  if (error instanceof MissingDatabaseUrlError || isDatabaseConnectionError(error)) {
    return NextResponse.json(
      { message: "Base de datos no disponible o mal configurada. Verifica DATABASE_URL en Railway." },
      { status: 503 }
    );
  }

  if (error instanceof Error) {
    // Authentication errors
    if (error.message === "UNAUTHENTICATED" || error.message === "NOT_AUTHENTICATED") {
      return NextResponse.json({ message: "No autenticado" }, { status: 401 });
    }

    // Authorization errors
    if (
      error.message === "FORBIDDEN_BRANCH" ||
      error.message === "FORBIDDEN_MASTER_ONLY" ||
      error.message === "FORBIDDEN_SYSTEM_ADMIN_ONLY" ||
      error.message === "FORBIDDEN_REPORTS"
    ) {
      return NextResponse.json({ message: "Acceso denegado" }, { status: 403 });
    }

    // Business logic validation errors
    if (error.message === "INVALID_SALARY") {
      return NextResponse.json({ message: "El salario debe ser mayor a 0" }, { status: 400 });
    }
    if (error.message.startsWith("INVALID_INPUT:")) {
      return NextResponse.json({ message: error.message.replace("INVALID_INPUT: ", "") }, { status: 400 });
    }

    // Stock errors
    if (error.message === "INSUFFICIENT_STOCK" || error.message === "INSUFFICIENT_STOCK_AT_PAYMENT") {
      return NextResponse.json({ message: "Stock insuficiente", reason: error.message }, { status: 409 });
    }

    // Branch closed
    if (error.message === "BRANCH_CLOSED") {
      return NextResponse.json({ message: "La sucursal está cerrada. No se pueden crear órdenes.", reason: "BRANCH_CLOSED" }, { status: 409 });
    }

    // Order validation errors
    if (error.message === "ORDER_NOT_DRAFT" || error.message === "INVALID_TRANSITION") {
      return NextResponse.json({ message: "La orden no está en estado editable.", reason: error.message }, { status: 409 });
    }
    if (error.message === "ORDER_EMPTY") {
      return NextResponse.json({ message: "La orden está vacía. Agrega productos primero.", reason: "ORDER_EMPTY" }, { status: 400 });
    }
    if (error.message === "PRODUCT_INACTIVE") {
      return NextResponse.json({ message: "El producto no está activo.", reason: "PRODUCT_INACTIVE" }, { status: 400 });
    }

    // Cash session errors
    if (error.message === "CASH_SESSION_NOT_OPEN" || error.message === "CASH_SESSION_ALREADY_OPEN" || error.message === "CASH_SESSION_CASH_BOX_INVALID") {
      return NextResponse.json({ message: error.message, reason: error.message }, { status: 409 });
    }
    if (error.message === "CASH_SESSION_NOT_RECONCILING" || error.message === "CASH_SESSION_UNRESOLVED_ORDERS") {
      return NextResponse.json({ message: error.message, reason: error.message }, { status: 409 });
    }

    // Payment errors
    if (error.message === "PAYMENT_INVALID_STATUS" || error.message === "PAYMENT_ALREADY_POSTED") {
      return NextResponse.json({ message: "La orden ya no está disponible para pago.", reason: error.message }, { status: 409 });
    }
    if (error.message === "INVALID_PAYMENT_AMOUNT") {
      return NextResponse.json({ message: "Monto de pago inválido.", reason: error.message }, { status: 400 });
    }
    if (error.message === "NO_ACTIVE_CASH_BOX" || error.message === "NO_ACTIVE_CASH_SESSION") {
      return NextResponse.json({ message: "No hay caja o sesión de caja activa.", reason: error.message }, { status: 409 });
    }

    // Dispatch errors
    if (error.message === "DISPATCH_INVALID_STATUS" || error.message === "DISPATCH_ALREADY_COMPLETED") {
      return NextResponse.json({ message: "El despacho no puede completarse en el estado actual.", reason: error.message }, { status: 409 });
    }

    // Not found errors
    if (error.message.includes("NOT_FOUND") || error.message.includes("not found")) {
      return NextResponse.json({ message: "Recurso no encontrado" }, { status: 404 });
    }

    // Prisma record not found
    if ("code" in error && (error as Record<string, unknown>).code === "P2025") {
      return NextResponse.json({ message: "Registro no encontrado" }, { status: 404 });
    }

    // Prisma unique constraint violation
    if ("code" in error && (error as Record<string, unknown>).code === "P2002") {
      return NextResponse.json({ message: "Ya existe un registro con esos datos" }, { status: 409 });
    }
  }

  // BUG FIX: Log the actual error for debugging (server-side)
  console.error("[HTTP_ERROR]", error);

  return NextResponse.json({ message: "Error interno del servidor" }, { status: 500 });
}
