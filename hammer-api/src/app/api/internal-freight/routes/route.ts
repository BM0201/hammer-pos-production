import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, validationFail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { createInternalFreightRoute, listInternalFreightRoutes } from "@/modules/internal-freight/service";

const schema = z.object({
  originBranchId: z.string().cuid(),
  destinationBranchId: z.string().cuid(),
  name: z.string().min(1).max(120),
  roundTripKm: z.coerce.number().positive(),
  defaultAllocationMethod: z.enum(["BY_VALUE", "BY_QUANTITY", "MANUAL"]).optional(),
  notes: z.string().max(1000).optional().nullable(),
});

export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    return ok(await listInternalFreightRoutes());
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

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return validationFail(parsed.error.issues);

    return created(await createInternalFreightRoute(parsed.data, session.userId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
