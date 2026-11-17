import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertFinanceAccess } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, fail } from "@/lib/api/response";
import { compareBranchPricingSuggestions } from "@/modules/pricing/branch-comparison-service";
import { ROUNDING_RULES } from "@/modules/pricing/validators";

const querySchema = z.object({
  productId: z.string().min(1),
  baseCost: z.coerce.number().positive(),
  taxPercent: z.coerce.number().min(0).max(100).default(0),
  includeTaxInCost: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  roundingRule: z.enum(ROUNDING_RULES).optional(),
});

/**
 * GET /api/pricing/branch-comparison?productId=&baseCost=&taxPercent=&includeTaxInCost=&roundingRule=
 * Precio sugerido del producto en cada sucursal activa con sus propios gastos/unidades/margen.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertFinanceAccess(session);

    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) return fail("VALIDATION_ERROR", "Parámetros inválidos", 400, parsed.error.flatten());

    return ok(await compareBranchPricingSuggestions(parsed.data));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("INVALID_")) {
      return fail("VALIDATION_ERROR", error.message, 400);
    }
    return toHttpErrorResponse(error);
  }
}
