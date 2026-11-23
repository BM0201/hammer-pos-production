import { fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";

/**
 * Errores de Madera en español entendible. El `code` sale tal cual (el frontend decide con él,
 * p. ej. INJECTION_PREVIEW_STALE → recalcular), el mensaje es el que ve quien usa la pantalla.
 */
const TIMBER_ERRORS: Record<string, { status: number; message: string }> = {
  TIMBER_TRIP_NOT_FOUND: { status: 404, message: "No se encontró el viaje. Puede que lo hayan cancelado: volvé a la lista." },
  TIMBER_PRODUCT_NOT_FOUND: { status: 404, message: "No se encontró esa medida de madera." },
  BRANCH_NOT_FOUND: { status: 404, message: "No se encontró la sucursal." },
  BRANCH_ID_REQUIRED: { status: 400, message: "Elegí una sucursal." },
  TRIP_NOT_EDITABLE: { status: 409, message: "Este viaje ya se ingresó o se canceló: los cambios no se guardaron." },
  TRIP_CANNOT_BE_CONFIRMED: { status: 409, message: "Solo se puede ingresar un viaje en borrador." },
  TRIP_ALREADY_CONFIRMED: { status: 409, message: "Este viaje ya se ingresó al inventario." },
  TRIP_CANNOT_BE_CANCELLED: { status: 409, message: "Un viaje ya ingresado (o ya cancelado) no se puede cancelar." },
  TRIP_NOT_CORRECTABLE: { status: 409, message: "Solo se puede corregir un viaje ya ingresado al inventario." },
  TRIP_CORRECTION_WINDOW_CLOSED: { status: 409, message: "Ya pasaron las 24 horas desde que se ingresó este viaje: quedó cerrado y no se puede corregir. Si algo quedó mal, hacé un ajuste de inventario." },
  TRIP_CHANGED_WHILE_CORRECTING: { status: 409, message: "Alguien más corrigió este viaje mientras lo editabas. Se recargó: revisá y volvé a guardar." },
  TRIP_HAS_NO_LINES:{ status: 400, message: "Agregá al menos una medida con piezas antes de ingresar el viaje." },
  TRIP_REQUIRES_COST: { status: 400, message: "Falta el costo de la madera (precio por pie o total del viaje)." },
  INJECTION_PREVIEW_REQUIRED: { status: 400, message: "Revisá la vista previa antes de ingresar el viaje." },
  INJECTION_PREVIEW_STALE: { status: 409, message: "El viaje o el inventario cambiaron mientras revisabas. Ya se recalculó: revisá de nuevo." },
  RECONCILIATION_REQUIRES_ACK: { status: 400, message: "Los pies no cuadran con la factura del aserradero: marcá que lo revisaste para continuar." },
  NEGATIVE_MARGIN_REQUIRES_OVERRIDE: { status: 400, message: "Al menos una medida queda vendiéndose bajo su costo: escribí el motivo para continuar." },
  EMPTY_CUBICATION_FILE: { status: 400, message: "El archivo está vacío o no se pudo leer." },
  CUBICATION_COLUMNS_NOT_FOUND: { status: 400, message: "No se encontraron las columnas MEDIDA y PIEZAS en la hoja \"Simple\" (o la primera hoja) del archivo." },
};

export function timberErrorResponse(err: unknown) {
  const known = err instanceof Error ? TIMBER_ERRORS[err.message] : undefined;
  if (known && err instanceof Error) return fail(err.message, known.message, known.status);
  // Mensaje armado con la medida y las piezas que quedan (correction.ts).
  if (err instanceof Error && (err as { code?: string }).code === "TRIP_CORRECTION_STOCK_SOLD") return fail("TRIP_CORRECTION_STOCK_SOLD", err.message, 409);
  return toHttpErrorResponse(err);
}

/** Primer mensaje de Zod (ya en español en validators.ts) en vez de "Validación fallida". */
export function timberValidationFail(issues: Array<{ message: string }>) {
  return fail("VALIDATION_ERROR", issues[0]?.message ?? "Revisá los datos del viaje.", 400);
}
