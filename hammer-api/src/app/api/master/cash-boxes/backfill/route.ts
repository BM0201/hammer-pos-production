import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { requireCsrf } from "@/modules/security/csrf";
import { toHttpErrorResponse } from "@/lib/http";
import { ok } from "@/lib/api/response";

/**
 * Crea de forma retroactiva una "Caja Principal" para toda sucursal activa
 * que aún no tenga ninguna caja física. Es idempotente: si una sucursal ya
 * tiene al menos una caja, se omite (no se duplica).
 *
 * Resuelve el bloqueo operativo de sucursales como Masaya (MSY) que quedaron
 * sin caja física y por ello no podían cobrar.
 */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const branches = await prisma.branch.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        // Only include active boxes — a branch with only inactive boxes is effectively blocked.
        physicalCashBoxes: {
          where: { isActive: true },
          select: { id: true },
          take: 1,
        },
      },
      orderBy: { code: "asc" },
    });

    // Branches that have no active cash box at all (may have inactive ones — those are not valid).
    const branchesWithoutBox = branches.filter((branch) => branch.physicalCashBoxes.length === 0);

    const createdBoxes: { branchCode: string; code: string }[] = [];

    for (const branch of branchesWithoutBox) {
      const cashBox = await prisma.physicalCashBox.create({
        data: {
          branchId: branch.id,
          code: `CASH-${branch.code}-01`,
          description: `Caja principal ${branch.name}`,
          isActive: true,
        },
      });

      await logAuditEvent({
        actorUserId: session.userId,
        branchId: branch.id,
        module: "cash-session",
        action: "CASH_BOX_CREATED",
        entityType: "PhysicalCashBox",
        entityId: cashBox.id,
        metadataJson: { code: cashBox.code, description: cashBox.description, source: "backfill" },
      });

      createdBoxes.push({ branchCode: branch.code, code: cashBox.code });
    }

    return ok({
      createdCount: createdBoxes.length,
      created: createdBoxes,
      message:
        createdBoxes.length > 0
          ? `Se crearon ${createdBoxes.length} caja(s) para sucursales que no tenían.`
          : "Todas las sucursales activas ya tienen al menos una caja física activa.",
    });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
