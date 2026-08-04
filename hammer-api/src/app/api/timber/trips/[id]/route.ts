import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertMaster } from "@/modules/security/rbac-helpers";
import {
  getTimberTrip,
  updateTimberTrip,
  confirmTimberTrip,
  cancelTimberTrip,
} from "@/modules/timber/service";
import { updateTimberTripSchema } from "@/modules/timber/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";

/**
 * BUG FIX: Added try-catch to GET handler.
 * BUG FIX: Added try-catch to PATCH body parsing.
 * BUG FIX: Validate action param in PATCH.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentSession();
    if (!session) return fail("ERROR", "No autenticado", 401);

    // Auditoría 2026-08-03: solo exigía sesión, mientras PUT/PATCH en este
    // mismo archivo ya exigen MASTER — expone costo, flete, gastos y margen
    // de ganancia real del viaje.
    assertMaster(session);

    const { id } = await params;
    const trip = await getTimberTrip(id);
    if (!trip) return fail("ERROR", "Viaje no encontrado", 404);

    return ok(trip);
  } catch (err: unknown) {
    console.error("[TIMBER_TRIP_GET]", err);
    return toHttpErrorResponse(err);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

    const { id } = await params;
    const body = await req.json();
    const parsed = updateTimberTripSchema.safeParse(body);
    if (!parsed.success) {
      return fail("ERROR", "Validación fallida", 400);
    }

    const result = await updateTimberTrip(id, parsed.data);
    return ok(result);
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message === "TIMBER_TRIP_NOT_FOUND") {
        return fail("NOT_FOUND", err.message, 404);
      }
      if (err.message === "TRIP_NOT_EDITABLE") {
        return fail("CONFLICT", err.message, 409);
      }
    }
    return toHttpErrorResponse(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

    const { id } = await params;
    const body = await req.json();
    const action = body.action as string;

    // BUG FIX: Validate action is provided
    if (!action) {
      return fail("ERROR", "Se requiere el campo 'action'", 400);
    }

    if (action === "confirm") {
      const trip = await confirmTimberTrip(id, session.userId, {
        expectedHash: body.expectedHash,
        acknowledgeReconciliation: body.acknowledgeReconciliation === true,
        marginOverrideReason: typeof body.marginOverrideReason === "string" ? body.marginOverrideReason : undefined,
      });
      return ok(trip);
    }
    if (action === "cancel") {
      const trip = await cancelTimberTrip(id);
      return ok(trip);
    }
    return fail("VALIDATION_ERROR", `Acción desconocida: ${action}`, 400);
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message.includes("NOT_FOUND")) {
        return fail("NOT_FOUND", err.message, 404);
      }
      if (err.message.includes("CANNOT") || err.message === "TRIP_HAS_NO_LINES" || err.message === "TRIP_ALREADY_CONFIRMED") {
        return fail("CONFLICT", err.message, 409);
      }
      if (err.message === "TRIP_REQUIRES_COST") {
        return fail("VALIDATION_ERROR", "El viaje necesita un costo (total o por pie) antes de inyectarse al inventario.", 400);
      }
      if (err.message === "INJECTION_PREVIEW_REQUIRED") {
        return fail("VALIDATION_ERROR", "Generá el preview de inyección antes de confirmar.", 400);
      }
      if (err.message === "INJECTION_PREVIEW_STALE") {
        return fail("CONFLICT", "El inventario cambió desde que se generó este preview. Generá uno nuevo antes de confirmar.", 409);
      }
      if (err.message === "RECONCILIATION_REQUIRES_ACK") {
        return fail("VALIDATION_ERROR", "La conciliación con la factura está fuera de tolerancia — confirmá explícitamente para continuar.", 400);
      }
      if (err.message === "NEGATIVE_MARGIN_REQUIRES_OVERRIDE") {
        return fail("VALIDATION_ERROR", "Al menos una medida queda con margen negativo — indicá un motivo para confirmar de todos modos.", 400);
      }
    }
    return toHttpErrorResponse(err);
  }
}
