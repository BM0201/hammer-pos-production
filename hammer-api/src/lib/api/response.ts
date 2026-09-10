import { NextResponse } from "next/server";
import { roundDecimalsForResponse } from "./decimal-rounding";

export type ApiSuccess<T> = {
  ok: true;
  data: T;
};

export type ApiErrorBody = {
  code: string;
  message: string;
  details?: unknown;
};

export type ApiError = {
  ok: false;
  error: ApiErrorBody;
};

/**
 * Frontera de salida: todo Prisma.Decimal en `data` se redondea a 2 decimales
 * (dinero) o 4 (cantidad/factor) ANTES de serializar a JSON — ver
 * decimal-rounding.ts. No afecta cómo se calculó o se guardó `data`; solo lo
 * que sale por la red. okCached/created delegan aquí, así que heredan esto
 * automáticamente.
 */
export function ok<T>(data: T, status = 200): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ ok: true, data: roundDecimalsForResponse(data) }, { status });
}

/**
 * Same as ok() but adds a browser-only Cache-Control header.
 * Use only for non-critical, authenticated GETs that don't change frequently
 * (categories, static config, reports). Never use for cash, inventory line,
 * or sale-execution data.
 * TTL: seconds to cache in the browser (private — CDNs never cache authed responses).
 */
export function okCached<T>(data: T, ttlSeconds: number): NextResponse<ApiSuccess<T>> {
  const res = ok(data);
  res.headers.set("Cache-Control", `private, max-age=${ttlSeconds}, stale-while-revalidate=${Math.floor(ttlSeconds / 2)}`);
  return res;
}

export function created<T>(data: T): NextResponse<ApiSuccess<T>> {
  return ok(data, 201);
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export function fail(
  code: string,
  message: string,
  status: number,
  details?: unknown,
): NextResponse<ApiError> {
  const body: ApiError = {
    ok: false,
    error: details === undefined ? { code, message } : { code, message, details },
  };

  return NextResponse.json(body, { status });
}

export function validationFail(details?: unknown): NextResponse<ApiError> {
  return fail("VALIDATION_ERROR", "Datos de entrada invalidos", 400, details);
}

export function unauthorized(message = "No autenticado"): NextResponse<ApiError> {
  return fail("UNAUTHENTICATED", message, 401);
}

export function forbidden(message = "Acceso denegado"): NextResponse<ApiError> {
  return fail("FORBIDDEN", message, 403);
}

export function notFound(message = "Recurso no encontrado"): NextResponse<ApiError> {
  return fail("NOT_FOUND", message, 404);
}

export function conflict(message = "Conflicto de estado"): NextResponse<ApiError> {
  return fail("CONFLICT", message, 409);
}
