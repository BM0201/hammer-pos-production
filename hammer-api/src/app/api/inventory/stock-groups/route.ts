import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { createStockGroup, listStockGroups, type StockGroupMemberInput } from "@/modules/catalog/stock-group-crud";

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
      categoryId?: string | null;
      members?: StockGroupMemberInput[];
    };

    const group = await createStockGroup(
      {
        name: body.name ?? "",
        code: body.code,
        baseUnit: body.baseUnit,
        packageUnit: body.packageUnit,
        conversionFactorToBase: body.conversionFactorToBase,
        tracksPackages: body.tracksPackages,
        approximateFactor: body.approximateFactor,
        categoryId: body.categoryId ?? null,
        members: body.members ?? [],
      },
      session.userId,
    );

    return created(group);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
