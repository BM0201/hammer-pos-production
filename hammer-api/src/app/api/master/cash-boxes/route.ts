import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { requireCsrf } from "@/modules/security/csrf";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, created } from "@/lib/api/response";

export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const data = await prisma.physicalCashBox.findMany({
      include: {
        branch: { select: { id: true, code: true, name: true } },
        _count: { select: { sessions: true } },
      },
      orderBy: [{ branch: { code: "asc" } }, { code: "asc" }],
    });

    return ok(data);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

/**
 * Crea una caja física para una sucursal de forma manual.
 * Body: { branchId: string; description?: string; code?: string }
 * Si no se envía `code`, se genera automáticamente el siguiente correlativo
 * para la sucursal (CASH-{codigoSucursal}-0N).
 */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const body = (await request.json().catch(() => ({}))) as {
      branchId?: unknown;
      description?: unknown;
      code?: unknown;
    };

    const branchId = typeof body.branchId === "string" ? body.branchId.trim() : "";
    if (!branchId) {
      throw new Error("VALIDATION_ERROR: Debe seleccionar una sucursal.");
    }

    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true, code: true, name: true },
    });
    if (!branch) {
      throw new Error("VALIDATION_ERROR: La sucursal indicada no existe.");
    }

    const existingBoxes = await prisma.physicalCashBox.findMany({
      where: { branchId },
      select: { code: true, isActive: true },
    });

    // Regla de negocio: una sucursal solo puede tener UNA caja física activa.
    // Varios vendedores comparten la misma caja. Esto evita el problema de cajas
    // duplicadas (p. ej. CAJA-01 + CASH-MGA-01 en una misma sucursal).
    if (existingBoxes.some((box) => box.isActive)) {
      throw new Error(
        "VALIDATION_ERROR: Esta sucursal ya tiene una caja física activa. Solo se permite una caja por sucursal. Desactiva o consolida la caja existente antes de crear otra.",
      );
    }

    // Determinar el código de la nueva caja.
    let code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    if (code) {
      if (!/^[A-Z0-9_-]{2,32}$/.test(code)) {
        throw new Error("VALIDATION_ERROR: Código de caja inválido. Use letras, números, guion o guion bajo.");
      }
      if (existingBoxes.some((box) => box.code === code)) {
        throw new Error("VALIDATION_ERROR: Ya existe una caja con ese código en la sucursal.");
      }
    } else {
      const next = existingBoxes.length + 1;
      code = `CASH-${branch.code}-${String(next).padStart(2, "0")}`;
      // Evitar colisión si hubiera huecos en la numeración.
      let attempt = next;
      while (existingBoxes.some((box) => box.code === code)) {
        attempt += 1;
        code = `CASH-${branch.code}-${String(attempt).padStart(2, "0")}`;
      }
    }

    const description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : `Caja principal ${branch.name}`;

    const cashBox = await prisma.physicalCashBox.create({
      data: { branchId, code, description, isActive: true },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        _count: { select: { sessions: true } },
      },
    });

    await logAuditEvent({
      actorUserId: session.userId,
      branchId,
      module: "cash_session",
      action: "CASH_BOX_CREATED",
      entityType: "PhysicalCashBox",
      entityId: cashBox.id,
      metadataJson: { code: cashBox.code, description: cashBox.description },
    });

    return created(cashBox);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
