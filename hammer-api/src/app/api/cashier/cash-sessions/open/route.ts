import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster } from "@/modules/rbac/guards";
import { openCashSessionSchema } from "@/modules/cash-session/validators";
import { logCashSessionDenied, openCashSession } from "@/modules/cash-session/service";
import { getCashAutoCloseConfig } from "@/modules/cash-session/auto-close-config";
import { getCashAutoCloseDeadline } from "@/modules/cash-session/auto-close-service";
import { toHttpErrorResponse } from "@/lib/http";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { requireCsrf } from "@/modules/security/csrf";
import { created, fail } from "@/lib/api/response";

const CONFLICT_REASONS = new Set([
  "CASH_SESSION_ALREADY_OPEN",
  "CASH_SESSION_RECONCILING",
  "CASH_SESSION_AUTO_CLOSED_PENDING_REVIEW",
  "CASH_SESSION_CASH_BOX_INVALID",
  "CASH_BOX_INACTIVE",
  "CASH_BOX_BRANCH_MISMATCH",
  "OPERATIONAL_DAY_NOT_OPEN",
  "OPERATIONAL_DAY_ALREADY_CLOSED",
  "STALE_OPERATIONAL_DAY_OPEN",
  "OPERATIONAL_DAY_STALE",
  "CASH_SESSION_AFTER_CLOSING_TIME",
]);

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

    // Guard: block opening if the auto-close deadline for today has already passed.
    // Prevents the UX failure where a user opens a session and the cron immediately
    // sends it to AUTO_CLOSED_PENDING_REVIEW with no clear explanation.
    if (!isMaster(session)) {
      const autoCloseConfig = await getCashAutoCloseConfig();
      if (autoCloseConfig.enabled) {
        const deadline = getCashAutoCloseDeadline({ id: parsed.data.branchId }, new Date(), autoCloseConfig);
        if (deadline.enabled && deadline.expired) {
          await logCashSessionDenied({
            actorUserId: session.userId,
            branchId: parsed.data.branchId,
            entityId: parsed.data.physicalCashBoxId,
            reason: "CASH_SESSION_AFTER_CLOSING_TIME",
            metadata: { closeTime: deadline.closeTime, timezone: deadline.timezone },
          });
          return fail(
            "CASH_SESSION_AFTER_CLOSING_TIME",
            `La hora de cierre operativo (${deadline.closeTime ?? "?"}) ya paso. No se puede abrir una nueva sesion de caja.`,
            409,
          );
        }
      }
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
