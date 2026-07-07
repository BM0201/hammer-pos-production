import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { toHttpErrorResponse } from "@/lib/http";
import { ok } from "@/lib/api/response";
import { deletePayrollRun } from "@/modules/payroll/payroll-service";

type Params = { params: Promise<{ id: string }> };

// DELETE /api/payroll/runs/[id]
// Elimina un borrador (DRAFT) de nómina subido por error. Bloquea nóminas POSTED
// o con pagos registrados para evitar borrados que descuadren caja o pagos dobles.
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

    const { id } = await params;
    const result = await deletePayrollRun(id, session.userId);
    return ok(result);
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}
