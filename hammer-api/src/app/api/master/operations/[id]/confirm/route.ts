import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { isMaster } from "@/modules/rbac/guards";
import { confirmOperationalDay } from "@/modules/operations/service";
import { assertCanApproveOperationalDay, getApprovalPolicy } from "@/modules/operations/approve-policy-config";
import { confirmOperationalDaySchema } from "@/modules/operations/validators";
import { prisma } from "@/lib/prisma";
import { requireCsrf } from "@/modules/security/csrf";

/**
 * Firma humana — el único camino a reviewStatus CONFIRMED. Los ítems en
 * atención nunca bloquean; solo exigen que quede una nota escrita.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    const { id } = await context.params;

    const day = await prisma.operationalDay.findUniqueOrThrow({
      where: { id },
      select: { branchId: true, cashDifferenceTotal: true, salesTotal: true, checklistJson: true },
    });

    const policy = await getApprovalPolicy();
    assertCanApproveOperationalDay(session, day, policy);

    const body = confirmOperationalDaySchema.safeParse(await request.json().catch(() => ({})));
    const note = body.success ? body.data.note ?? null : null;

    return ok(await confirmOperationalDay({ id, actorUserId: session.userId, note }));
  } catch (error) {
    if (error instanceof Error && error.message === "OPERATIONAL_DAY_APPROVAL_REQUIRES_MASTER") {
      return fail("OPERATIONAL_DAY_APPROVAL_REQUIRES_MASTER", "Este día requiere confirmación de un Master.", 403);
    }
    if (error instanceof Error && error.message === "OPERATIONAL_DAY_CONFIRM_NOTE_REQUIRED") {
      return fail("OPERATIONAL_DAY_CONFIRM_NOTE_REQUIRED", "Se requiere una nota para confirmar un día con pendientes o diferencia de caja.", 400);
    }
    if (error instanceof Error && error.message === "OPERATIONAL_DAY_CONFIRM_REQUIRES_HUMAN") {
      return fail("OPERATIONAL_DAY_CONFIRM_REQUIRES_HUMAN", "Confirmar requiere la firma de un usuario Master real.", 403);
    }
    return toHttpErrorResponse(error);
  }
}
