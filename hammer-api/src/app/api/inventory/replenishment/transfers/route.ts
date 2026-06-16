import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { getTransferOpportunities } from "@/modules/inventory/replenishment-service";

function numberParam(value: string | null) {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId");
    if (!branchId) return fail("VALIDATION_ERROR", "branchId es requerido", 400);

    return ok(await getTransferOpportunities({
      branchId,
      leadTimeDays: numberParam(searchParams.get("leadTimeDays")),
      coverageDays: numberParam(searchParams.get("coverageDays")),
    }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
