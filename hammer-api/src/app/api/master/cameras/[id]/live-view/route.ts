import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { hasBranchAccess } from "@/modules/rbac/guards";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { openLiveViewSchema } from "@/modules/cameras/validators";
import { openLiveView } from "@/modules/cameras/service";

/**
 * Abre una cámara en vivo. Cada apertura queda en auditLog (prompt §7,
 * caso de prueba 9) — trivial de implementar, protege a ambas partes.
 *
 * La URL/token de señalización WebRTC hacia go2rtc en el agente de la
 * sucursal NO se resuelve acá todavía — requiere el agente y el relay
 * corriendo contra hardware real, fuera de lo que se puede verificar sin
 * cámaras (ver reporte de la sesión). Este endpoint deja lista la
 * autorización + auditoría; conectar el relay real es el siguiente paso.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: cameraId } = await params;
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsed = openLiveViewSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());

    if (!hasBranchAccess(session, parsed.data.branchId)) return fail("FORBIDDEN", "Forbidden", 403);
    if (!canInBranch(session, parsed.data.branchId, CAPABILITIES.MASTER_CAMERAS_VIEW)) return fail("FORBIDDEN", "No tienes permiso para ver cámaras en esta sucursal.", 403);

    await openLiveView({ actorUserId: session.userId, branchId: parsed.data.branchId, cameraId });
    return ok({ cameraId, opened: true });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
