import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { ok } from "@/lib/api/response";
import { getMultiBranchIntake } from "@/modules/inventory/multi-branch-intake-service";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { id } = await params;
    return ok(await getMultiBranchIntake(id));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
