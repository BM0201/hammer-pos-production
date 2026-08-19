import { prisma } from "@/lib/prisma";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { ok, validationFail } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";
import { requireBranchCapability } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { z } from "zod";

const querySchema = z.object({ branchId: z.string().cuid() });

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const url = new URL(request.url);
    const parsed = querySchema.safeParse({ branchId: url.searchParams.get("branchId") });
    if (!parsed.success) return validationFail(parsed.error.flatten());

    requireBranchCapability(session, parsed.data.branchId, CAPABILITIES.CASH_BOX_VIEW);

    const [cashBoxes, pendingOrders] = await Promise.all([
      prisma.physicalCashBox.findMany({
        where: { branchId: parsed.data.branchId, isActive: true },
        include: {
          sessions: {
            where: { status: { in: ["OPEN", "RECONCILING"] } },
            include: {
              operators: {
                where: { isActive: true, revokedAt: null },
                include: { user: { select: { id: true, username: true, fullName: true } } },
              },
              payments: {
                where: { status: "POSTED" },
                select: { amount: true, method: true },
              },
              cashMovements: true,
            },
            orderBy: { openedAt: "desc" },
            take: 1,
          },
        },
        orderBy: { code: "asc" },
      }),
      prisma.saleOrder.count({
        where: { branchId: parsed.data.branchId, status: "PENDING_PAYMENT" },
      }),
    ]);

    return ok({
      cashBoxes: cashBoxes.map((box) => {
        const activeSession = box.sessions[0] ?? null;
        return {
          ...box,
          activeSession,
          status: activeSession?.status ?? "CLOSED",
          operators: activeSession?.operators ?? [],
          totalCollected: activeSession?.payments.reduce((sum, payment) => sum + Number(payment.amount), 0) ?? 0,
          pendingOrders,
        };
      }),
      messages: {
        noCashBoxes: cashBoxes.length === 0 ? "No hay cajas fisicas configuradas para esta sucursal." : null,
      },
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
