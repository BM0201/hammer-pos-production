import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { reopenOperationalDay } from "@/modules/operations/service";
import { requireCsrf } from "@/modules/security/csrf";
import { z } from "zod";

const reopenSchema = z.object({
  note: z.string().trim().min(1).max(1500),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { id } = await context.params;
    const body = await request.json();
    const parsed = reopenSchema.safeParse(body);
    if (!parsed.success) return fail("VALIDATION_ERROR", "Se requiere una nota para reabrir el dia operativo.", 400);

    return ok(await reopenOperationalDay({ id, actorUserId: session.userId, note: parsed.data.note }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
