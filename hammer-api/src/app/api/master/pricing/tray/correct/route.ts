import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster } from "@/modules/rbac/guards";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { correctAndApplyTrayItemTx, type CorrectAndApplyItemResult } from "@/modules/pricing/cost-correction-service";

/**
 * D.1.3 (prompt-completo-pendientes-2026-10.md) — "corregir costo y
 * precio desde la Bandeja", en una transacción POR DECISIÓN. Solo valida
 * con Zod y abre la transacción — el cuerpo vive en cost-correction-service.ts
 * (correctAndApplyTrayItemTx), para poder probarlo con un tx en memoria,
 * mismo patrón que applyOneTrayDecisionTx.
 */
const costActionSchema = z.object({
  action: z.enum(["SET_BRANCH_COST", "CLEAR_BRANCH_COST", "SET_GLOBAL_COST", "SET_AVERAGE_COST"]),
  value: z.number().positive().optional(),
});

const itemSchema = z.object({
  decisionId: z.string().cuid(),
  mode: z.enum(["AUTO", "MANUAL"]),
  cost: costActionSchema.optional(),
  price: z.number().positive().optional(),
  keepPrice: z.boolean().optional(),
  allowHighUnitCost: z.boolean().optional(),
  alsoBranchIds: z.array(z.string().cuid()).optional(),
});

const correctSchema = z.object({
  items: z.array(itemSchema).min(1),
  reason: z.string().min(5),
});

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    if (!isMaster(session)) return fail("FORBIDDEN", "Solo Master puede corregir costos.", 403);

    const parsed = correctSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload inválido.", 400, parsed.error.flatten());

    const done: CorrectAndApplyItemResult[] = [];
    const failed: Array<{ decisionId: string; reason: string }> = [];
    for (const item of parsed.data.items) {
      try {
        const result = await prisma.$transaction((tx) => correctAndApplyTrayItemTx(tx, item, parsed.data.reason, session!.userId));
        done.push(result);
      } catch (error) {
        failed.push({ decisionId: item.decisionId, reason: error instanceof Error ? error.message : "UNKNOWN_ERROR" });
      }
    }

    return ok({ done, failed });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
