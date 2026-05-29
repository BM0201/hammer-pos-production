import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster } from "@/modules/rbac/guards";
import { openCashSessionSchema } from "@/modules/cash-session/validators";
import { logCashSessionDenied, openCashSession } from "@/modules/cash-session/service";
import { toHttpErrorResponse } from "@/lib/http";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { requireCsrf } from "@/modules/security/csrf";
import { created, fail } from "@/lib/api/response";

const CONFLICT_REASONS = new Set(["CASH_SESSION_ALREADY_OPEN", "CASH_SESSION_CASH_BOX_INVALID", "OPERATIONAL_DAY_NOT_OPEN"]);

export async function POST(request: Request) {
  let parsedBranchId: string | undefined;
  let parsedCashBoxId: string | undefined;

  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsed = openCashSessionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Invalid payload", 400);
    }

    parsedBranchId = parsed.data.branchId;
    parsedCashBoxId = parsed.data.physicalCashBoxId;

    if (!canInAnyAssignedBranch(session, CAPABILITIES.CASH_SESSION_OPERATE)) {
      await logCashSessionDenied({
        actorUserId: session.userId,
        branchId: parsed.data.branchId,
        entityId: parsed.data.physicalCashBoxId,
        reason: "FORBIDDEN_ROLE",
        metadata: { role: session.roleCode },
      });
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    if (!isMaster(session) && !canInBranch(session, parsed.data.branchId, CAPABILITIES.CASH_SESSION_OPERATE)) {
      await logCashSessionDenied({
        actorUserId: session.userId,
        branchId: parsed.data.branchId,
        entityId: parsed.data.physicalCashBoxId,
        reason: "FORBIDDEN_BRANCH",
      });
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    const data = await openCashSession({
      ...parsed.data,
      actorUserId: session.userId,
    });

    return created(data);
  } catch (error) {
    if (error instanceof Error && CONFLICT_REASONS.has(error.message)) {
      const session = await getCurrentSession();
      await logCashSessionDenied({
        actorUserId: session?.userId,
        branchId: parsedBranchId,
        entityId: parsedCashBoxId ?? "unknown",
        reason: error.message,
      });
      return fail("CONFLICT", error.message, 409);
    }
    return toHttpErrorResponse(error);
  }
}
