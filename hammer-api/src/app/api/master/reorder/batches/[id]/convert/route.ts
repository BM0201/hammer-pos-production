import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { toApiErrorResponse } from "@/lib/api/errors";
import { ok, created } from "@/lib/api/response";
import { convertBatchToPurchaseOrder, convertBatchToTransfer } from "@/modules/reorder/service";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

/** POST /api/master/reorder/batches/:id/convert — convert batch to PO or Transfer */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session!);

    const { id } = await params;

    const batch = await prisma.reorderSuggestionBatch.findUnique({
      where: { id },
      select: { suggestionType: true },
    });

    if (!batch) {
      throw new Error("NOT_FOUND");
    }

    const result = batch.suggestionType === "PURCHASE"
      ? await convertBatchToPurchaseOrder(id, session!.userId)
      : await convertBatchToTransfer(id, session!.userId);

    return created(result);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}