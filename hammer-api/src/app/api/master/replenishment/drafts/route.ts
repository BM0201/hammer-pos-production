import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import {
  listReplenishmentDrafts,
  createReplenishmentDraft,
} from "@/modules/inventory/replenishment-draft-service";

const createSchema = z.object({
  branchId: z.string().cuid(),
  includePreventive: z.boolean().default(false),
  categoryId: z.string().cuid().optional(),
  notes: z.string().max(500).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { searchParams } = new URL(req.url);
    const drafts = await listReplenishmentDrafts({
      branchId: searchParams.get("branchId") || undefined,
      status: searchParams.get("status") || undefined,
      limit: Number(searchParams.get("limit") ?? 50),
    });
    return ok(drafts);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload inválido", 400);

    const draft = await createReplenishmentDraft({
      ...parsed.data,
      actorUserId: session.userId,
    });
    return ok(draft, 201);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
