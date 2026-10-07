import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { isMaster } from "@/modules/rbac/guards";
import { can, CAPABILITIES } from "@/modules/rbac/policies";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { applyBulkRule } from "@/modules/pricing/price-update-batch-service";

const roundingSchema = z.enum(["NONE", "NEAREST_1", "NEAREST_5", "NEAREST_10", "NEAREST_50", "NEAREST_100", "ENDING_9", "ENDING_90", "ENDING_99"]);

const ruleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PERCENT_ON_PRICE"), percent: z.number(), rounding: roundingSchema.optional() }),
  z.object({ kind: z.literal("MARKUP_ON_COST"), percent: z.number(), rounding: roundingSchema.optional() }),
  z.object({ kind: z.literal("TARGET_MARGIN"), percent: z.number(), rounding: roundingSchema.optional() }),
  z.object({ kind: z.literal("FIXED"), price: z.number(), rounding: roundingSchema.optional() }),
]);

const bodySchema = z.object({
  lineIds: z.array(z.string().cuid()).optional(),
  rule: ruleSchema,
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    if (!isMaster(session) && !can(session.roleCode, CAPABILITIES.PRICING_EDIT_GLOBAL)) {
      return fail("FORBIDDEN", "No tienes permiso para editar cargas de precios.", 403);
    }

    const { id } = await context.params;
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload inválido.", 400, parsed.error.flatten());

    const target = parsed.data.lineIds?.length ? { lineIds: parsed.data.lineIds } : ("ALL" as const);
    const result = await applyBulkRule(id, target, parsed.data.rule);
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
