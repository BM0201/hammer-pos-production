import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { getPrimaryInventoryBranchId, setPrimaryInventoryBranchId } from "@/modules/catalog-inventory/primary-branch-config";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    return ok({ branchId: await getPrimaryInventoryBranchId() });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

const updateSchema = z.object({ branchId: z.string().cuid() });

export async function PUT(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "branchId inválido.", 400);

    const branch = await prisma.branch.findUnique({ where: { id: parsed.data.branchId }, select: { id: true, isActive: true } });
    if (!branch || !branch.isActive) return fail("VALIDATION_ERROR", "La sucursal no existe o no está activa.", 400);

    await setPrimaryInventoryBranchId(branch.id, session.userId);
    return ok({ branchId: branch.id });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
