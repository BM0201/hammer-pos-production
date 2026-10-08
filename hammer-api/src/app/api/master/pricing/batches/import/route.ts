import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { isMaster } from "@/modules/rbac/guards";
import { can, CAPABILITIES } from "@/modules/rbac/policies";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { importPriceUpdateDraft } from "@/modules/pricing/price-update-import-service";

const bodySchema = z.object({
  fileBase64: z.string().min(1),
  target: z.enum(["BRANCHES", "GENERAL"]),
  branchIds: z.array(z.string().cuid()).default([]),
  reason: z.string().min(3).max(500),
});

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    if (!isMaster(session) && !can(session.roleCode, CAPABILITIES.PRICING_EDIT_GLOBAL)) {
      return fail("FORBIDDEN", "No tienes permiso para importar cargas de precios.", 403);
    }

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload inválido.", 400, parsed.error.flatten());

    const result = await importPriceUpdateDraft({ ...parsed.data, actorUserId: session.userId });
    return ok(result, 201);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
