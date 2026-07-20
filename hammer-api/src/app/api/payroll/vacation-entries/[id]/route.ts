import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertFinanceAccess } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { toHttpErrorResponse } from "@/lib/http";
import { ok } from "@/lib/api/response";
import { deleteVacationEntry } from "@/modules/payroll/employee-vacation-service";

type Params = { params: Promise<{ id: string }> };

/** DELETE /api/payroll/vacation-entries/[id] — elimina una entrada registrada por error. */
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertFinanceAccess(session!);

    const { id } = await params;
    return ok(await deleteVacationEntry(id, session!.userId));
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}
