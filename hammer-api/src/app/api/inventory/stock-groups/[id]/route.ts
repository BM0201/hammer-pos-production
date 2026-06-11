import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { deleteStockGroup, updateStockGroup, type StockGroupMemberInput } from "@/modules/catalog/stock-group-crud";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      isActive?: boolean;
      packageUnit?: string | null;
      conversionFactorToBase?: number | null;
      tracksPackages?: boolean;
      approximateFactor?: boolean;
      members?: StockGroupMemberInput[];
    };

    const group = await updateStockGroup(
      id,
      {
        name: body.name,
        isActive: body.isActive,
        packageUnit: body.packageUnit,
        conversionFactorToBase: body.conversionFactorToBase,
        tracksPackages: body.tracksPackages,
        approximateFactor: body.approximateFactor,
        members: body.members,
      },
      session.userId,
    );

    return ok(group);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { id } = await context.params;
    const group = await deleteStockGroup(id, session.userId);

    return ok(group);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
