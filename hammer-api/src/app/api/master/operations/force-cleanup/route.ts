import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { forceCleanupBranch } from "@/modules/operations/force-cleanup-service";
import { requireCsrf } from "@/modules/security/csrf";
import { z } from "zod";

const forceCleanupSchema = z.object({
  branchId: z.string().min(1),
  mode: z.enum(["DRY_RUN", "EXECUTE"]),
  note: z.string().trim().max(2000).default(""),
  actions: z.object({
    closeStaleOpenCashSessions: z.boolean().optional(),
    resolveAutoClosedPendingReview: z.boolean().optional(),
    closeStaleOperationalDay: z.boolean().optional(),
    refreshOperationalDaySummaries: z.boolean().optional(),
  }),
});

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const body = await request.json();
    const parsed = forceCleanupSchema.safeParse(body);
    if (!parsed.success) return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Solicitud inválida.", 400);

    if (parsed.data.mode === "EXECUTE" && !parsed.data.note.trim()) {
      return fail("FORCE_CLEANUP_NOTE_REQUIRED", "Se requiere una nota de justificación para ejecutar el force-cleanup.", 400);
    }

    return ok(
      await forceCleanupBranch({
        branchId: parsed.data.branchId,
        mode: parsed.data.mode,
        note: parsed.data.note,
        actorUserId: session.userId,
        actions: parsed.data.actions,
      }),
    );
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
