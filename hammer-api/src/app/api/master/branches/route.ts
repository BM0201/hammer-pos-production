import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { created, fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { createMasterBranch, listMasterBranches } from "@/modules/branches/service";
import { createBranchSchema } from "@/modules/branches/validators";

export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const data = await listMasterBranches();
    return ok(data);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const parsed = createBranchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Datos invalidos.", 400, parsed.error.flatten());
    }

    const data = await createMasterBranch(parsed.data, session.userId);
    return created(data);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
