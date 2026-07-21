import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { addSignalsToPlan } from "@/modules/inventory/replenishment-draft-service";
import type { ReplenishmentSignal } from "@/modules/inventory/replenishment-service";

const signalSourceSchema = z.object({
  type: z.enum(["TRANSFER", "PRODUCTION", "PURCHASE"]),
  quantity: z.number(),
  branchId: z.string().optional(),
  branchName: z.string().optional(),
  supplierId: z.string().nullable().optional(),
  supplierName: z.string().nullable().optional(),
});

const signalSchema = z.object({
  productId: z.string(),
  sku: z.string(),
  name: z.string(),
  branchId: z.string(),
  mode: z.enum(["AUTO", "MANUAL_OVERRIDE", "EXCLUDED"]),
  stockOnHand: z.number(),
  averageDailyDemand: z.number(),
  abcClass: z.enum(["A", "B", "C"]),
  xyzClass: z.enum(["X", "Y", "Z"]),
  combinedClass: z.string(),
  leadTimeDays: z.number(),
  coverageDaysRemaining: z.number().nullable(),
  reorderPoint: z.number(),
  targetQuantity: z.number(),
  inboundQuantity: z.number(),
  inboundDocuments: z.array(z.any()),
  grossNeed: z.number(),
  netNeed: z.number(),
  estimatedCost: z.number().nullable(),
  severity: z.enum(["CRITICAL", "LOW", "COVERED", "NO_DEMAND"]),
  sources: z.array(signalSourceSchema),
  message: z.string(),
  warnings: z.array(z.string()),
});

const bodySchema = z.object({
  branchId: z.string().cuid(),
  signals: z.array(signalSchema).min(1),
});

/** POST /api/master/replenishment/drafts/add-signals — agrega señales al plan activo (Reposición v2, Fase 1.4) */
export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload inválido", 400);

    const draft = await addSignalsToPlan(parsed.data.branchId, parsed.data.signals as ReplenishmentSignal[], session.userId);
    return ok(draft, 201);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
