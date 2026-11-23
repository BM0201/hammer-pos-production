import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertMaster } from "@/modules/security/rbac-helpers";
import {
  getTimberTrip,
  updateTimberTrip,
  confirmTimberTrip,
  cancelTimberTrip,
  correctTimberTrip,
} from "@/modules/timber/service";
import { updateTimberTripSchema } from "@/modules/timber/validators";
import { timberErrorResponse, timberValidationFail } from "@/modules/timber/errors";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentSession();
    if (!session) return fail("ERROR", "No autenticado", 401);
    // Expone costo, flete, gastos y margen real del viaje: solo Master (que ve todas las sucursales).
    assertMaster(session);

    const { id } = await params;
    const trip = await getTimberTrip(id);
    if (!trip) throw new Error("TIMBER_TRIP_NOT_FOUND");
    return ok(trip);
  } catch (err: unknown) {
    return timberErrorResponse(err);
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
    const parsed = updateTimberTripSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return timberValidationFail(parsed.error.issues);

    return ok(await updateTimberTrip(id, parsed.data));
  } catch (err: unknown) {
    return timberErrorResponse(err);
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
    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === "confirm") {
      const trip = await confirmTimberTrip(id, session.userId, {
        expectedHash: typeof body.expectedHash === "string" ? body.expectedHash : undefined,
        acknowledgeReconciliation: body.acknowledgeReconciliation === true,
        marginOverrideReason: typeof body.marginOverrideReason === "string" ? body.marginOverrideReason : undefined,
      });
      return ok(trip);
    }
    if (action === "cancel") {
      return ok(await cancelTimberTrip(id));
    }
    if (action === "correct") {
      const parsed = updateTimberTripSchema.safeParse(body.changes);
      if (!parsed.success) return timberValidationFail(parsed.error.issues);
      return ok(await correctTimberTrip(id, session.userId, parsed.data, {
        marginOverrideReason: typeof body.marginOverrideReason === "string" ? body.marginOverrideReason : undefined,
      }));
    }
    return fail("VALIDATION_ERROR", "Acción no válida: usá \"confirm\", \"cancel\" o \"correct\".", 400);
  } catch (err: unknown) {
    return timberErrorResponse(err);
  }
}
