import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { hasBranchAccess } from "@/modules/rbac/guards";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { z } from "zod";
import { provisionBranchAgent } from "@/modules/cameras/service";
import { logAuditEvent } from "@/modules/audit/service";

const schema = z.object({ branchId: z.string().cuid() });

/**
 * Genera (o regenera) el token del agente de una sucursal. El token en
 * texto plano solo se devuelve UNA vez, en esta respuesta — copiarlo a
 * agent.config antes de cerrar la pantalla. Regenerarlo invalida el token
 * anterior de inmediato (el agente viejo deja de poder heartbeatear).
 */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());

    if (!hasBranchAccess(session, parsed.data.branchId)) return fail("FORBIDDEN", "Forbidden", 403);
    if (!canInBranch(session, parsed.data.branchId, CAPABILITIES.MASTER_CAMERAS_VIEW)) return fail("FORBIDDEN", "No tienes permiso para aprovisionar el agente de esta sucursal.", 403);

    const { token } = await provisionBranchAgent(parsed.data.branchId);

    await logAuditEvent({
      actorUserId: session.userId,
      branchId: parsed.data.branchId,
      module: "cameras",
      action: "CAMERA_AGENT_PROVISIONED",
      entityType: "BranchCameraAgent",
      entityId: parsed.data.branchId,
    });

    return ok({ token });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
