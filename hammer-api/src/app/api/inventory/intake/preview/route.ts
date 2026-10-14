import { z } from "zod";
import { MultiBranchIntakeKind } from "@prisma/client";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, fail } from "@/lib/api/response";
import { previewIntake } from "@/modules/inventory/intake-preview-service";

export const maxDuration = 30;

const lineSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().min(0).nullable(),
  overrides: z.record(z.string(), z.number().min(0).nullable()).optional(),
  unitCost: z.number().min(0).nullable().optional(),
  salePrice: z.number().positive().nullable().optional(),
  unit: z.string().optional(),
});

const requestSchema = z.object({
  kind: z.nativeEnum(MultiBranchIntakeKind),
  branchIds: z.array(z.string().min(1)).min(1),
  lines: z.array(lineSchema).min(1),
});

/**
 * Fase 1 (prompt-entrada-inventario.md) — POST /api/inventory/intake/preview:
 * el "Resultado" por fila ANTES de guardar nada — mismo motor que
 * multi-branch-intake-service.ts (calculateSharedStockChange,
 * recalculateWeightedAverage), nunca una aproximación aparte.
 */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Parámetros inválidos.", 400, parsed.error.flatten());

    const deniedBranches = parsed.data.branchIds.filter((id) => !canInBranch(session, id, CAPABILITIES.INVENTORY_MOVEMENT_POST));
    if (deniedBranches.length > 0) {
      return fail("FORBIDDEN", "No tenés permiso para ver la vista previa en una de las sucursales elegidas.", 403);
    }

    return ok(await previewIntake(parsed.data));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
