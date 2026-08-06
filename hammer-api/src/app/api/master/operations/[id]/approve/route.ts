import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { isMaster } from "@/modules/rbac/guards";
import { approveOperationalDayReview } from "@/modules/operations/service";
import {
  assertCanApproveOperationalDay,
  getApprovalPolicy,
} from "@/modules/operations/approve-policy-config";
import { approveOperationalDaySchema } from "@/modules/operations/validators";
import { prisma } from "@/lib/prisma";
import { requireCsrf } from "@/modules/security/csrf";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    const { id } = await context.params;

    // Load the day up front — its branch and thresholds drive the delegation check.
    const day = await prisma.operationalDay.findUniqueOrThrow({
      where: { id },
      select: {
        branchId: true,
        cashDifferenceTotal: true,
        salesTotal: true,
        closeChecklistJson: true,
      },
    });

    const policy = await getApprovalPolicy();
    assertCanApproveOperationalDay(session, day, policy);

    const sessionIsMaster = isMaster(session);

    const body = approveOperationalDaySchema.safeParse(await request.json().catch(() => ({})));
    const parsed = body.success ? body.data : { forceApprove: false, note: null };
    // forceApprove remains MASTER-exclusive — silently ignore it for delegates.
    const forceApprove = sessionIsMaster ? parsed.forceApprove : false;
    const note = parsed.note ?? null;

    return ok(
      await approveOperationalDayReview({
        id,
        actorUserId: session.userId,
        forceApprove,
        note,
        isMaster: sessionIsMaster,
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.message === "OPERATIONAL_DAY_APPROVAL_REQUIRES_MASTER") {
      return fail(
        "OPERATIONAL_DAY_APPROVAL_REQUIRES_MASTER",
        "Este día requiere aprobación de un Master.",
        403,
      );
    }
    if (error instanceof Error && error.message === "OPERATIONAL_DAY_APPROVE_NOTE_REQUIRED") {
      return fail(
        "OPERATIONAL_DAY_APPROVE_NOTE_REQUIRED",
        "Se requiere una nota para aprobar con excepciones.",
        400,
      );
    }
    if (error instanceof Error && error.message === "OPERATIONAL_DAY_REVIEW_HAS_BLOCKERS") {
      return fail(
        "OPERATIONAL_DAY_REVIEW_HAS_BLOCKERS",
        "El dia operativo tiene pendientes antes de aprobar.",
        409,
        {
          blockers: (error as unknown as { blockers?: unknown }).blockers,
          warnings: (error as unknown as { warnings?: unknown }).warnings,
        },
      );
    }
    return toHttpErrorResponse(error);
  }
}
