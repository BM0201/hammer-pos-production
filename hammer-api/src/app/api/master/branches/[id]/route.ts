import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { updateMasterBranch } from "@/modules/branches/service";
import { updateBranchSchema } from "@/modules/branches/validators";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { id } = await context.params;
    const parsed = updateBranchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Datos invalidos.", 400, parsed.error.flatten());
    }

    const data = await updateMasterBranch(id, parsed.data, session.userId);
    return ok(data);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
