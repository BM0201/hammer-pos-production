import { z } from "zod";
import { OrderTemplateKind } from "@prisma/client";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, fail } from "@/lib/api/response";
import { listOrderTemplates, createOrderTemplate } from "@/modules/purchase-orders/order-template-service";

const lineSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().positive(),
  overrides: z.record(z.string(), z.number().min(0)).optional(),
  unitCost: z.number().min(0).optional(),
});

const createSchema = z.object({
  name: z.string().trim().min(1),
  kind: z.nativeEnum(OrderTemplateKind),
  supplierId: z.string().min(1).optional().nullable(),
  branchIds: z.array(z.string().min(1)).default([]),
  lines: z.array(lineSchema).min(1),
});

/** GET /api/master/order-templates?kind=PURCHASE — "Usar plantilla ▾". */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const url = new URL(request.url);
    const kindParam = url.searchParams.get("kind");
    const kind = kindParam && Object.values(OrderTemplateKind).includes(kindParam as OrderTemplateKind) ? (kindParam as OrderTemplateKind) : undefined;

    return ok(await listOrderTemplates({ kind }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

/** POST /api/master/order-templates — "Guardar como plantilla". */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Parámetros inválidos.", 400, parsed.error.flatten());

    return created(await createOrderTemplate({ ...parsed.data, actorUserId: session!.userId }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
