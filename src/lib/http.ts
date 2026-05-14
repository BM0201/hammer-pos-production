import { NextResponse } from "next/server";
import { MissingDatabaseUrlError, isDatabaseConnectionError } from "@/lib/prisma";
import { isCsrfError } from "@/modules/security/csrf";

/**
 * Convert errors to appropriate HTTP responses.
 *
 * BUG FIX: Added handling for "NOT_AUTHENTICATED" (used by timber routes).
 * BUG FIX: Added handling for "INVALID_SALARY" and "INVALID_INPUT" errors.
 * BUG FIX: Added handling for Prisma-specific errors (P2025 = record not found).
 * BUG FIX: Log actual error for debugging (server-side only).
 * BUG FIX: CsrfError (and legacy "INVALID_CSRF_TOKEN" string) always → 403.
 * BUG FIX: Added FORBIDDEN_OWNER_ONLY to authorization error list.
 */
export function toHttpErrorResponse(error: unknown) {
  // ── CSRF errors (highest priority — must never fall through to 500) ──
  if (isCsrfError(error)) {
    return NextResponse.json(
      { message: "CSRF inválido", reason: "INVALID_CSRF_TOKEN" },
      { status: 403 },
    );
  }

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
      error.message === "FORBIDDEN_REPORTS" ||
      error.message === "FORBIDDEN_CAPABILITY" ||
      error.message === "FORBIDDEN_OWNER_ONLY"
    ) {
      return NextResponse.json({ message: "Acceso denegado", reason: error.message }, { status: 403 });
    }

    // Legacy string-based CSRF check (backward-compat with any code still
    // throwing plain Error("INVALID_CSRF_TOKEN"))
    if (error.message === "INVALID_CSRF_TOKEN") {
      return NextResponse.json({ message: "CSRF inválido", reason: "INVALID_CSRF_TOKEN" }, { status: 403 });
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
    if (error.message === "SALE_ORDER_LINE_NOT_FOUND") {
      return NextResponse.json({ message: "La línea no pertenece a la orden indicada.", reason: "SALE_ORDER_LINE_NOT_FOUND" }, { status: 404 });
    }
    if (error.message === "PRODUCT_INACTIVE") {
      return NextResponse.json({ message: "El producto no está activo.", reason: "PRODUCT_INACTIVE" }, { status: 400 });
    }

    // Cash session errors
    if (error.message === "CASH_SESSION_NOT_OPEN" || error.message === "CASH_SESSION_ALREADY_OPEN" || error.message === "CASH_SESSION_CASH_BOX_INVALID") {
      return NextResponse.json({ message: error.message, reason: error.message }, { status: 409 });
    }
    if (
      error.message === "CASH_SESSION_NOT_RECONCILING"
      || error.message === "CASH_SESSION_UNRESOLVED_ORDERS"
      || error.message === "CASH_SESSION_HAS_PENDING_PAYMENTS"
      || error.message === "CASH_SESSION_DISCREPANCY_REQUIRES_APPROVAL"
    ) {
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

// ─────────────────────────────────────────────────────────────────────────────
// Client-side fetch helper with automatic CSRF token refresh + single retry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch a fresh CSRF token from the server.
 * Stores it in the module-level cache so subsequent calls reuse it.
 */
async function fetchCsrfToken(): Promise<string> {
  const res = await fetch("/api/auth/csrf", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to obtain CSRF token");
  const data = (await res.json()) as { csrfToken: string };
  _csrfTokenCache = data.csrfToken;
  return _csrfTokenCache;
}

/** Module-level CSRF token cache (client-side only). */
let _csrfTokenCache: string | null = null;

export interface ApiFetchOptions extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
}

/**
 * `apiFetch` — drop-in replacement for `fetch()` that:
 *  1. Automatically attaches the `x-csrf-token` header to mutating requests.
 *  2. On a 403 with `reason === "INVALID_CSRF_TOKEN"`, refreshes the CSRF
 *     token and retries the request **once**.
 *
 * Safe methods (GET / HEAD / OPTIONS) skip CSRF handling entirely.
 */
export async function apiFetch(
  url: string,
  options: ApiFetchOptions = {},
): Promise<Response> {
  const method = (options.method ?? "GET").toUpperCase();
  const isSafe = ["GET", "HEAD", "OPTIONS"].includes(method);

  // Ensure we have a CSRF token for mutating requests
  if (!isSafe && !_csrfTokenCache) {
    await fetchCsrfToken();
  }

  const buildHeaders = (): Record<string, string> => {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      ...options.headers,
    };
    if (!isSafe && _csrfTokenCache) {
      h["x-csrf-token"] = _csrfTokenCache;
    }
    return h;
  };

  let res = await fetch(url, {
    ...options,
    credentials: options.credentials ?? "include",
    headers: buildHeaders(),
  });

  // If CSRF was rejected, refresh token and retry exactly once
  if (!isSafe && res.status === 403) {
    try {
      const body = (await res.clone().json()) as { reason?: string };
      if (body.reason === "INVALID_CSRF_TOKEN") {
        await fetchCsrfToken();
        res = await fetch(url, {
          ...options,
          credentials: options.credentials ?? "include",
          headers: buildHeaders(),
        });
      }
    } catch {
      // If we can't parse the body, just return the original response
    }
  }

  return res;
}
