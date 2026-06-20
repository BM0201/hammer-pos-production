import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { markUserOnline } from "@/modules/auth/presence-service";

const heartbeatSchema = z.object({
  branchId: z.string().nullable().optional(),
  currentPath: z.string().max(512).nullable().optional(),
  currentModule: z.string().max(80).nullable().optional(),
});

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return fail("UNAUTHENTICATED", "No autenticado", 401);
    }

    await requireCsrf(request, session);

    const body = await request.json().catch(() => ({}));
    const parsed = heartbeatSchema.safeParse(body);
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Solicitud invalida.", 400);
    }

    await markUserOnline({
      session,
      branchId: parsed.data.branchId ?? session.primaryBranchId,
      currentPath: parsed.data.currentPath,
      currentModule: parsed.data.currentModule,
    });

    return ok({
      status: "ONLINE",
      userId: session.userId,
      sessionVersion: session.sessionVersion ?? 0,
    });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
