import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertMaster } from "@/modules/security/rbac-helpers";
import { createTimberTrip, listTimberTrips } from "@/modules/timber/service";
import { createTimberTripSchema } from "@/modules/timber/validators";
import { timberErrorResponse, timberValidationFail } from "@/modules/timber/errors";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, fail } from "@/lib/api/response";

/**
 * BUG FIX: Added try-catch to GET handler.
 * BUG FIX: Validate page/limit params to prevent invalid queries.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session) return fail("ERROR", "No autenticado", 401);

    // Auditoría 2026-08-03: solo exigía sesión, mientras POST en este mismo
    // archivo ya exige MASTER — TimberTrip trae costo, flete, gastos y
    // margen de ganancia real de cada viaje de importación de madera.
    assertMaster(session);

    const url = new URL(req.url);
    const status = url.searchParams.get("status") || undefined;
    const destinationBranchId = url.searchParams.get("destinationBranchId") || undefined;
    const search = url.searchParams.get("search") || undefined;
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10) || 20));

    const result = await listTimberTrips({ status, destinationBranchId, search, page, limit });
    return ok(result);
  } catch (err: unknown) {
    return timberErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

    const parsed = createTimberTripSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return timberValidationFail(parsed.error.issues);

    const result = await createTimberTrip(parsed.data, session.userId);
    return created(result);
  } catch (err: unknown) {
    return timberErrorResponse(err);
  }
}
