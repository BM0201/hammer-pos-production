import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { prisma } from "@/lib/prisma";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";
import { z } from "zod";
import { logAuditEvent } from "@/modules/audit/service";

const schema = z.object({
  branchId: z.string().cuid(),
  isAvailable: z.boolean(),
});

/**
 * PATCH /api/catalog/products/[id]/branch-settings
 * Manually assign or unassign a product to a branch.
 * Sets BranchProductSetting.isAvailable = true/false for the given branch.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { id: productId } = await context.params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload inválido", 400);

    const { branchId, isAvailable } = parsed.data;

    const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true, sku: true } });
    if (!product) return fail("NOT_FOUND", "Producto no encontrado", 404);

    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, name: true } });
    if (!branch) return fail("NOT_FOUND", "Sucursal no encontrada", 404);

    const setting = await prisma.branchProductSetting.upsert({
      where: { branchId_productId: { branchId, productId } },
      create: { branchId, productId, isAvailable },
      update: { isAvailable },
      select: { id: true, branchId: true, productId: true, isAvailable: true },
    });

    await logAuditEvent({
      actorUserId: session.userId,
      module: "catalog",
      action: isAvailable ? "PRODUCT_BRANCH_ASSIGNED" : "PRODUCT_BRANCH_UNASSIGNED",
      entityType: "Product",
      entityId: productId,
      metadataJson: { branchId, branchName: branch.name, productSku: product.sku, isAvailable },
    });

    return ok(setting);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
