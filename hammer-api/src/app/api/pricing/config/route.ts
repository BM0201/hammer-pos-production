import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { upsertPricingConfigSchema } from "@/modules/pricing/validators";
import { requireCsrf } from "@/modules/security/csrf";
import { fail, ok } from "@/lib/api/response";
import {
  upsertPricingConfig,
  getPricingConfig,
  listAllPricingConfigs,
} from "@/modules/pricing/service";

/**
 * GET /api/pricing/config?branchId=xxx
 * Get pricing config for a branch (or all if no branchId).
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId");

    if (branchId) {
      const config = await getPricingConfig(branchId);
      return ok(config ?? { branchId, exists: false });
    }

    const configs = await listAllPricingConfigs();
    return ok(configs);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

/**
 * POST /api/pricing/config
 * Create or update pricing config for a branch.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

    const body = await req.json();
    const parsed = upsertPricingConfigSchema.parse(body);
    const config = await upsertPricingConfig(parsed, session.userId);

    return ok(config);
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return fail("VALIDATION_ERROR", "Datos inv\u00e1lidos", 400);
    }
    return toHttpErrorResponse(error);
  }
}
