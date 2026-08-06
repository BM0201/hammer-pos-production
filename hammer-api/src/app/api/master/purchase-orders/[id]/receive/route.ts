import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { receivePurchaseOrder } from "@/modules/purchase-orders/service";
import { refreshReplenishmentSignalSnapshot } from "@/modules/inventory/replenishment-service";
import { prisma } from "@/lib/prisma";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok } from "@/lib/api/response";

async function readOptionalJson(request: Request) {
  const text = await request.text();
  if (!text.trim()) return {};
  return JSON.parse(text);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { id } = await params;
    const result = await receivePurchaseOrder(id, session.userId, await readOptionalJson(request));

    // Reposición v2 (Fase 1.5): refrescar snapshot de señales tras la recepción — best-effort.
    (async () => {
      const po = await prisma.purchaseOrder.findUnique({ where: { id }, select: { branchId: true } });
      if (po) await refreshReplenishmentSignalSnapshot(po.branchId);
    })().catch(() => {});

    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
