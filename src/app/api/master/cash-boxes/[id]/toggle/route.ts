import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { toHttpErrorResponse } from "@/lib/http";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { id } = await context.params;
    const cashBox = await prisma.physicalCashBox.findUniqueOrThrow({ where: { id } });

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

    return NextResponse.json({ data: updated });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
