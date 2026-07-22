export const dynamic = "force-dynamic";

import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { canInBranch, requireBranchCapability } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { syncOfflineSale } from "@/modules/sales/offline-sync.service";
import { ok, validationFail, fail } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";

const offlineSyncLineSchema = z.object({
  productId: z.string().cuid(),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
  discountAmount: z.number().min(0).default(0),
});

const offlineSyncSchema = z.object({
  offlineId: z.string().min(1),
  branchId: z.string().cuid(),
  cashSessionId: z.string().cuid(),
  operatorUserId: z.string().cuid(),
  lines: z.array(offlineSyncLineSchema).min(1),
  grandTotal: z.number().positive(),
  notes: z.string().max(500).optional(),
  overrideReason: z.string().max(500).optional(),
  createdAt: z.string().datetime(),
});

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsed = offlineSyncSchema.safeParse(await request.json());
    if (!parsed.success) return validationFail(parsed.error.flatten());

    const body = parsed.data;

    // The actor must be the same user who made the sale offline
    if (body.operatorUserId !== session.userId) {
      return fail("FORBIDDEN_OFFLINE_SYNC_ACTOR", "No puedes sincronizar ventas de otro usuario.", 403);
    }

    // RBAC: sincronizar una venta offline equivale a una venta directa cobrada
    // (crea orden DISPATCHED + pago POSTED en un solo paso) — mismo requisito
    // que /api/sales/orders/[id]/direct-sale.
    const canDirectCollect = canInBranch(session, body.branchId, CAPABILITIES.POS_DIRECT_COLLECT);
    const canSellAndCollect = canInBranch(session, body.branchId, CAPABILITIES.POS_SEND_TO_CASHIER)
      && canInBranch(session, body.branchId, CAPABILITIES.PAYMENT_COLLECT_DIRECT);
    if (!canDirectCollect && !canSellAndCollect) {
      requireBranchCapability(session, body.branchId, CAPABILITIES.POS_DIRECT_COLLECT);
    }

    const result = await syncOfflineSale({
      offlineId: body.offlineId,
      branchId: body.branchId,
      cashSessionId: body.cashSessionId,
      actorUserId: session.userId,
      actorRole: session.roleCode,
      overrideReason: body.overrideReason,
      lines: body.lines,
      grandTotal: body.grandTotal,
      notes: body.notes,
      createdAt: body.createdAt,
    });

    return ok(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
