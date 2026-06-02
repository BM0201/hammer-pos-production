import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, validationFail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { recordPrintAudit } from "@/modules/printing/printing-service";

const schema = z.object({
  branchId: z.string().optional(),
  saleOrderId: z.string().optional(),
  entityType: z.string().min(1).default("Document"),
  entityId: z.string().min(1),
  documentType: z.string().min(1),
  isReprint: z.boolean().optional(),
  reason: z.string().optional(),
  metadataJson: z.record(z.unknown()).optional(),
});

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return validationFail(parsed.error);

    await recordPrintAudit({ ...parsed.data, actorUserId: session.userId });
    return ok({ recorded: true });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
