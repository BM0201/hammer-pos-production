import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertMaster } from "@/modules/security/rbac-helpers";
import { deleteTimberTripPayment } from "@/modules/timber/service";
import { timberErrorResponse } from "@/modules/timber/errors";
import { requireCsrf } from "@/modules/security/csrf";
import { ok } from "@/lib/api/response";

/** Quitar un movimiento anotado por error (queda en la bitácora). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);
    const { id, paymentId } = await params;
    return ok(await deleteTimberTripPayment(id, paymentId, session.userId));
  } catch (err: unknown) {
    return timberErrorResponse(err);
  }
}
