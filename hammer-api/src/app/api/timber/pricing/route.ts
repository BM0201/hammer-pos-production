import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertMaster } from "@/modules/security/rbac-helpers";
import { getPricingConfig, updatePricingConfig } from "@/modules/timber/service";
import { updateTimberPricingConfigSchema } from "@/modules/timber/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";

/**
 * BUG FIX: Added try-catch error handling to both GET and PUT.
 * BUG FIX: PUT body parsing could throw if invalid JSON.
 */
export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const config = await getPricingConfig();
    return NextResponse.json(config);
  } catch (err: unknown) {
    console.error("[TIMBER_PRICING_GET]", err);
    return toHttpErrorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

    const body = await req.json();
    const parsed = updateTimberPricingConfigSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validación fallida", details: parsed.error.flatten() }, { status: 400 });
    }

    const config = await updatePricingConfig(parsed.data, session.userId);
    return NextResponse.json(config);
  } catch (err: unknown) {
    console.error("[TIMBER_PRICING_PUT]", err);
    return toHttpErrorResponse(err);
  }
}
