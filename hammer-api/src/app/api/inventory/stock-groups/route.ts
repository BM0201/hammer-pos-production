import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { listStockGroups, type StockGroupMemberInput } from "@/modules/catalog/stock-group-crud";
import { createFusionGroup, type FusionBranchResolutionInput } from "@/modules/catalog/fusion-wizard-service";

export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    return ok(await listStockGroups());
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      code?: string;
      baseUnit?: string;
      packageUnit?: string | null;
      conversionFactorToBase?: number | null;
      tracksPackages?: boolean;
      approximateFactor?: boolean;
      minimumClosedPackageReserve?: number | null;
      autoOpenForUnitSale?: boolean;
      categoryId?: string | null;
      members?: StockGroupMemberInput[];
      branchResolutions?: Record<string, FusionBranchResolutionInput>;
    };

    const group = await createFusionGroup({
      name: body.name ?? "",
      code: body.code,
      baseUnit: body.baseUnit,
      packageUnit: body.packageUnit,
      conversionFactorToBase: body.conversionFactorToBase,
      tracksPackages: body.tracksPackages,
      approximateFactor: body.approximateFactor,
      minimumClosedPackageReserve: body.minimumClosedPackageReserve,
      autoOpenForUnitSale: body.autoOpenForUnitSale,
      categoryId: body.categoryId ?? null,
      members: body.members ?? [],
      branchResolutions: body.branchResolutions,
      actorUserId: session.userId,
    });

    return created(group);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
