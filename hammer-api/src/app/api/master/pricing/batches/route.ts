import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { isMaster } from "@/modules/rbac/guards";
import { can, CAPABILITIES } from "@/modules/rbac/policies";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { parseListLimit } from "@/lib/api/list-limit";
import { createDraft, listBatches } from "@/modules/pricing/price-update-batch-service";
import type { PriceUpdateBatchStatus } from "@prisma/client";

/**
 * prompt-carga-precios.md Fase 1 — mismo permiso que tray/apply
 * (PRICING_VIEW para leer, PRICING_EDIT_GLOBAL para crear/mutar).
 */

const createDraftSchema = z.object({
  target: z.enum(["BRANCHES", "GENERAL"]),
  branchIds: z.array(z.string().cuid()).default([]),
  reason: z.string().min(3).max(500),
  source: z.enum(["MANUAL", "TRAY", "FILE", "REVERT"]).default("MANUAL"),
  items: z
    .array(
      z.object({
        productId: z.string().cuid(),
        newPrice: z.number().positive().optional().nullable(),
        trayDecisionId: z.string().cuid().optional().nullable(),
      }),
    )
    .min(1),
});

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    if (!isMaster(session) && !can(session.roleCode, CAPABILITIES.PRICING_VIEW)) {
      return fail("FORBIDDEN", "No tienes permiso para ver las cargas de precios.", 403);
    }

    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get("status") as PriceUpdateBatchStatus | null;
    const limit = parseListLimit(searchParams.get("limit"), { default: 50 });
    const offset = Math.max(0, Number(searchParams.get("offset") ?? 0) || 0);

    const result = await listBatches({ status: statusParam ?? undefined, limit, offset });
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    if (!isMaster(session) && !can(session.roleCode, CAPABILITIES.PRICING_EDIT_GLOBAL)) {
      return fail("FORBIDDEN", "No tienes permiso para crear cargas de precios.", 403);
    }

    const parsed = createDraftSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload inválido.", 400, parsed.error.flatten());

    const result = await createDraft({ ...parsed.data, actorUserId: session.userId });
    return ok(result, 201);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
