import { NextResponse } from "next/server";

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

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export function ok<T>(data: T, status = 200): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ ok: true, data }, { status });
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
