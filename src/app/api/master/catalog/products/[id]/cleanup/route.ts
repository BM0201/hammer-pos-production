import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { cleanupProductWithPolicy } from "@/modules/inventory/import-service";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";

const cleanupSchema = z.object({
  mode: z.enum(["AUTO", "DEACTIVATE", "DELETE_HARD"]).default("AUTO"),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { id } = await context.params;
    const parsed = cleanupSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Payload inválido.", issues: parsed.error.issues }, { status: 400 });
    }

    const data = await cleanupProductWithPolicy({
      actorUserId: session.userId,
      productId: id,
      mode: parsed.data.mode,
    });

    return NextResponse.json({ data });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
