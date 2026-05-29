import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster } from "@/modules/rbac/guards";
import { createDraftSaleOrder, listSaleOrders } from "@/modules/sales/service";
import { createSaleOrderSchema } from "@/modules/sales/validators";
import { logAuditEvent } from "@/modules/audit/service";
import { toHttpErrorResponse } from "@/lib/http";
import { SALE_AUDIT_EVENTS } from "@/modules/sales/audit-events";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, fail } from "@/lib/api/response";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    if (!canInAnyAssignedBranch(session, CAPABILITIES.SALES_VIEW)) {
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get("branchId") ?? "";

    if (!isMaster(session) && !canInBranch(session, branchId, CAPABILITIES.SALES_VIEW)) {
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    const data = await listSaleOrders({ branchId, includeAllBranches: isMaster(session) && !branchId });
    return ok(data);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    if (!canInAnyAssignedBranch(session, CAPABILITIES.SALES_DRAFT_MANAGE)) {
      await logAuditEvent({
        actorUserId: session.userId,
        module: "sales",
        action: SALE_AUDIT_EVENTS.ORDER_CREATE_DENIED,
        entityType: "SaleOrder",
        entityId: "new",
        metadataJson: { reason: "FORBIDDEN_ROLE", role: session.roleCode },
      });
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    const parsed = createSaleOrderSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Invalid payload", 400);
    }

    if (!isMaster(session) && !canInBranch(session, parsed.data.branchId, CAPABILITIES.SALES_DRAFT_MANAGE)) {
      await logAuditEvent({
        actorUserId: session.userId,
        branchId: parsed.data.branchId,
        module: "sales",
        action: SALE_AUDIT_EVENTS.ORDER_CREATE_DENIED,
        entityType: "SaleOrder",
        entityId: "new",
        metadataJson: { reason: "FORBIDDEN_BRANCH" },
      });
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    const data = await createDraftSaleOrder({
      ...parsed.data,
      actorUserId: session.userId,
    });

    return created(data);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
