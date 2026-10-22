import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { requireBranchCapability } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, fail } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";
import { createCashPurchase, listCashPurchasesByBranch } from "@/modules/finance/cash-purchase-service";

const createSchema = z.object({
  branchId: z.string().min(1),
  amount: z.number().positive(),
  description: z.string().min(1).max(200),
  supplierName: z.string().max(160).optional(),
  kind: z.enum(["GOODS", "FREIGHT"]),
  receiptPhotoUrl: z.string().url().optional(),
});

/**
 * GET /api/branch/cash-purchases?branchId=xxx
 * "Informativo: compras pagadas con caja" (Gastos) — no son gasto operativo.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const branchId = new URL(req.url).searchParams.get("branchId");
    if (!branchId) return fail("VALIDATION_ERROR", "branchId es requerido", 400);

    requireBranchCapability(session, branchId, CAPABILITIES.OPERATING_EXPENSE_VIEW);

    return ok(await listCashPurchasesByBranch(branchId));
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

/**
 * POST /api/branch/cash-purchases
 * Registra una compra de mercadería/flete pagada con caja — NUNCA un gasto operativo.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return fail("VALIDATION_ERROR", "Datos inválidos", 400);

    requireBranchCapability(session, parsed.data.branchId, CAPABILITIES.CASH_MOVEMENT_CREATE);

    const purchase = await createCashPurchase(parsed.data, session.userId);
    return created(purchase);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
