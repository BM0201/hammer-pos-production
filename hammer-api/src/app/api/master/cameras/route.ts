import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, created, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { hasBranchAccess } from "@/modules/rbac/guards";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { registerCameraSchema } from "@/modules/cameras/validators";
import { registerCamera, listCamerasForBranch } from "@/modules/cameras/service";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const branchId = new URL(request.url).searchParams.get("branchId");
    if (!branchId) return fail("VALIDATION_ERROR", "branchId es obligatorio.", 400);
    if (!hasBranchAccess(session, branchId)) return fail("FORBIDDEN", "Forbidden", 403);
    if (!canInBranch(session, branchId, CAPABILITIES.MASTER_CAMERAS_VIEW)) return fail("FORBIDDEN", "No tienes permiso para ver cámaras en esta sucursal.", 403);

    return ok(await listCamerasForBranch(branchId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsed = registerCameraSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());

    if (!hasBranchAccess(session, parsed.data.branchId)) return fail("FORBIDDEN", "Forbidden", 403);
    if (!canInBranch(session, parsed.data.branchId, CAPABILITIES.MASTER_CAMERAS_VIEW)) return fail("FORBIDDEN", "No tienes permiso para registrar cámaras en esta sucursal.", 403);

    const camera = await registerCamera(parsed.data);
    return created({ id: camera.id, name: camera.name, branchId: camera.branchId });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
