import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { receiveTransfer } from "@/modules/transfers/service";
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
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { id } = await params;
    const result = await receiveTransfer(id, session.userId, await readOptionalJson(request));

    // Reposición v2 (Fase 1.5): refrescar snapshot de señales de la sucursal destino — best-effort.
    (async () => {
      const transfer = await prisma.transfer.findUnique({ where: { id }, select: { toBranchId: true } });
      if (transfer) await refreshReplenishmentSignalSnapshot(transfer.toBranchId);
    })().catch(() => {});

    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
