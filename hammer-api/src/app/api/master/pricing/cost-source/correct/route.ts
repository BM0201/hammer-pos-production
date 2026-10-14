import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster } from "@/modules/rbac/guards";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { correctProductCostTx } from "@/modules/pricing/cost-correction-service";

/**
 * D · Fase 3 (prompt-completo-pendientes-2026-10.md) — "lo mismo fuera de la
 * Bandeja": corregir SOLO el costo (sin aplicar un precio ni cerrar ninguna
 * BrainDecision), para la ficha del producto y Precios vigentes. Delega
 * íntegro en correctProductCostTx (Fase 1) — no reimplementa nada.
 */
const correctSchema = z.object({
  productId: z.string().cuid(),
  branchId: z.string().cuid(),
  action: z.enum(["SET_BRANCH_COST", "CLEAR_BRANCH_COST", "SET_GLOBAL_COST", "SET_AVERAGE_COST"]),
  value: z.number().positive().optional(),
  reason: z.string().min(10),
  allowHighUnitCost: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    if (!isMaster(session)) return fail("FORBIDDEN", "Solo Master puede corregir costos.", 403);

    const parsed = correctSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload inválido.", 400, parsed.error.flatten());

    const result = await prisma.$transaction((tx) => correctProductCostTx(tx, {
      productId: parsed.data.productId,
      branchId: parsed.data.branchId,
      action: parsed.data.action,
      newCost: parsed.data.value,
      reason: parsed.data.reason,
      actorUserId: session!.userId,
      allowHighUnitCost: parsed.data.allowHighUnitCost,
    }));

    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
