import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { hasBranchAccess } from "@/modules/rbac/guards";
import { requireSaleOrderPrintAccess } from "@/modules/printing/printing-access";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail, validationFail } from "@/lib/api/response";
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

    // Auditoría 2026-08-03: no se validaba que branchId/saleOrderId
    // pertenecieran al scope del usuario — cualquier autenticado podía
    // insertar entradas DOCUMENT_PRINTED/REPRINTED (bitácora anti-fraude)
    // referenciando sucursales u órdenes ajenas.
    if (parsed.data.branchId && !hasBranchAccess(session, parsed.data.branchId)) {
      return fail("FORBIDDEN", "No tienes acceso a esta sucursal.", 403);
    }
    if (parsed.data.saleOrderId) {
      await requireSaleOrderPrintAccess(session, parsed.data.saleOrderId);
    }

    await recordPrintAudit({ ...parsed.data, actorUserId: session.userId });
    return ok({ recorded: true });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
