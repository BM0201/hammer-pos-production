import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { getTransportServiceById, updateTransportStatus } from "@/modules/transport/service";
import { updateTransportStatusSchema, validateTransportTransition } from "@/modules/transport/validators";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { requireAnyBranchCapability, requireBranchCapability } from "@/modules/rbac/guards";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail, validationFail } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const { id } = await params;
    const parsed = updateTransportStatusSchema.safeParse(await request.json());
    if (!parsed.success) {
      return validationFail(parsed.error.flatten());
    }

    const transport = await getTransportServiceById(id);

    // Auditoría 2026-08-03: la autorización se validaba DESPUÉS de leer el
    // registro y de comparar la transición de estado — un usuario sin
    // DISPATCH_MARK en ninguna sucursal podía enviar un id de transporte
    // ajeno y, si la transición era inválida (el caso más probable), el
    // mensaje de error revelaba el status real del servicio de transporte
    // de otra sucursal antes de que se aplicara ningún chequeo de permiso.
    // Ahora la autorización va primero.
    requireAnyBranchCapability(session, [CAPABILITIES.DISPATCH_MARK]);
    requireBranchCapability(session, transport.branchId, CAPABILITIES.DISPATCH_MARK);

    // Validate state transition
    if (!validateTransportTransition(transport.status, parsed.data.status)) {
      return fail(
        "INVALID_TRANSPORT_TRANSITION",
        `No se puede cambiar de ${transport.status} a ${parsed.data.status}`,
        409,
      );
    }

    const updated = await updateTransportStatus({
      transportId: id,
      status: parsed.data.status,
      actorUserId: session.userId,
    });

    return ok(updated);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
