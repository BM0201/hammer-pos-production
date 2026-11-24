import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertMaster } from "@/modules/security/rbac-helpers";
import { addTimberTripPayment, getTimberTripPayments } from "@/modules/timber/service";
import { createTimberTripPaymentSchema } from "@/modules/timber/validators";
import { timberErrorResponse, timberValidationFail } from "@/modules/timber/errors";
import { requireCsrf } from "@/modules/security/csrf";
import { ok } from "@/lib/api/response";

/** Cuenta con el proveedor del viaje: movimientos y saldo. Solo Master, como el resto del viaje (costos y pagos). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    const { id } = await params;
    return ok(await getTimberTripPayments(id));
  } catch (err: unknown) {
    return timberErrorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);
    const { id } = await params;
    const parsed = createTimberTripPaymentSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return timberValidationFail(parsed.error.issues);
    return ok(await addTimberTripPayment(id, session.userId, parsed.data));
  } catch (err: unknown) {
    return timberErrorResponse(err);
  }
}
