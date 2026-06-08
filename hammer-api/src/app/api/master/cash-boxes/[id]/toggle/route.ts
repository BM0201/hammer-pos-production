import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok } from "@/lib/api/response";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { id } = await context.params;
    const cashBox = await prisma.physicalCashBox.findUniqueOrThrow({ where: { id } });

    // Al ACTIVAR una caja, asegurar que la sucursal no tenga ya otra caja activa.
    // Una sucursal solo puede tener una caja física activa a la vez.
    if (!cashBox.isActive) {
      const otherActive = await prisma.physicalCashBox.findFirst({
        where: { branchId: cashBox.branchId, isActive: true, id: { not: id } },
        select: { code: true },
      });
      if (otherActive) {
        throw new Error(
          `VALIDATION_ERROR: La sucursal ya tiene la caja ${otherActive.code} activa. Desactívala antes de activar otra. Solo se permite una caja activa por sucursal.`,
        );
      }
    }

    const updated = await prisma.physicalCashBox.update({
      where: { id },
      data: { isActive: !cashBox.isActive },
      include: { branch: { select: { code: true, name: true } } },
    });

    await logAuditEvent({
      actorUserId: session.userId,
      branchId: cashBox.branchId,
      module: "cash-session",
      action: updated.isActive ? "CASH_BOX_ACTIVATED" : "CASH_BOX_DEACTIVATED",
      entityType: "PhysicalCashBox",
      entityId: id,
      metadataJson: { code: cashBox.code, newState: updated.isActive },
    });

    return ok(updated);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
