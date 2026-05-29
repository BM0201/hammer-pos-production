import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { executeInventoryImport, previewInventoryImport } from "@/modules/inventory/import-service";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";

const destinationModeSchema = z.enum(["SINGLE", "MULTI", "ALL", "FILE"]);

const previewSchema = z.object({
  mode: z.literal("preview"),
  fileContent: z.string().min(1).optional(),
  fileBase64: z.string().min(1).optional(),
  fileName: z.string().optional(),
  destinationMode: destinationModeSchema,
  branchIds: z.array(z.string().cuid()).optional(),
  defaultBranchId: z.string().cuid().optional(),
}).refine((payload) => Boolean(payload.fileContent || payload.fileBase64), {
  message: "Debes enviar fileContent o fileBase64.",
  path: ["fileContent"],
});

const executeSchema = z.object({
  mode: z.literal("execute"),
  items: z.array(z.object({
    rowNumber: z.number().int().positive(),
    sku: z.string(),
    name: z.string().optional().default(""),
    quantity: z.number().positive(),
    unitCost: z.number().nonnegative(),
    standardSalePrice: z.number().positive().optional(),
    targetBranchId: z.string().cuid(),
    targetBranchCode: z.string().min(1),
    targetBranchName: z.string().min(1),
    productStatus: z.enum(["EXISTING", "NEW"]),
    action: z.enum(["IMPORT_EXISTING", "CREATE_AND_IMPORT"]),
    status: z.enum(["READY", "ERROR"]),
    messages: z.array(z.string()),
  })),
  createMissingProducts: z.boolean().default(false),
  defaultCategoryId: z.string().cuid().optional(),
  defaultUnit: z.string().min(1).max(32).optional(),
  defaultStandardSalePrice: z.number().positive().optional(),
});

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const payload = await request.json();
    if (payload?.mode === "preview") {
      const parsed = previewSchema.safeParse(payload);
      if (!parsed.success) {
        return fail("VALIDATION_ERROR", "Payload inválido para preview.", 400);
      }

      const data = await previewInventoryImport(parsed.data);
      return ok(data);
    }

    if (payload?.mode === "execute") {
      const parsed = executeSchema.safeParse(payload);
      if (!parsed.success) {
        return fail("VALIDATION_ERROR", "Payload inválido para ejecución.", 400);
      }

      const data = await executeInventoryImport({
        actorUserId: session.userId,
        items: parsed.data.items,
        createMissingProducts: parsed.data.createMissingProducts,
        defaultCategoryId: parsed.data.defaultCategoryId,
        defaultUnit: parsed.data.defaultUnit,
        defaultStandardSalePrice: parsed.data.defaultStandardSalePrice,
      });
      return ok(data);
    }

    return fail("VALIDATION_ERROR", "mode debe ser preview o execute.", 400);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
