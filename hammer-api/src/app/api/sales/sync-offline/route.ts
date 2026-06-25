export const dynamic = "force-dynamic";

import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { syncOfflineSale } from "@/modules/sales/offline-sync.service";
import { ok, validationFail } from "@/lib/api/response";
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
  createdAt: z.string().datetime(),
});

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const parsed = offlineSyncSchema.safeParse(await request.json());
    if (!parsed.success) return validationFail(parsed.error.flatten());

    const body = parsed.data;

    // The actor must be the same user who made the sale offline
    if (body.operatorUserId !== session.userId) {
      return new Response(
        JSON.stringify({ message: "No puedes sincronizar ventas de otro usuario." }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    const result = await syncOfflineSale({
      offlineId: body.offlineId,
      branchId: body.branchId,
      cashSessionId: body.cashSessionId,
      actorUserId: session.userId,
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
