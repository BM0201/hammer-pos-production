import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster, requireAnyBranchCapability, requireBranchCapability } from "@/modules/rbac/guards";
import { dispatchListSchema } from "@/modules/dispatch/validators";
import { listDispatchHistory } from "@/modules/dispatch/service";
import { ok, validationFail } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";
import { CAPABILITIES } from "@/modules/rbac/policies";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { searchParams } = new URL(request.url);
    const parsed = dispatchListSchema.safeParse({ branchId: searchParams.get("branchId") ?? undefined });
    if (!parsed.success) {
      return validationFail(parsed.error.flatten());
    }

    const branchId = parsed.data.branchId ?? "";

    requireAnyBranchCapability(session, [CAPABILITIES.DISPATCH_VIEW]);
    // Auditoría 2026-08-03: requireAnyBranchCapability solo confirma que el
    // usuario tenga DISPATCH_VIEW en ALGUNA sucursal — no que sea la pedida
    // por query param. Sin este chequeo, un WAREHOUSE/SALES con el permiso
    // solo en su propia sucursal podía pedir ?branchId=<otra> y ver el
    // historial de despacho de una sucursal ajena (mismo patrón que
    // inventory/balances). Master queda exento (isMaster ya bypassa scope).
    if (branchId && !isMaster(session)) {
      requireBranchCapability(session, branchId, CAPABILITIES.DISPATCH_VIEW);
    }

    const data = await listDispatchHistory({
      branchId,
      includeAllBranches: isMaster(session) && !branchId,
    });

    return ok(data);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
