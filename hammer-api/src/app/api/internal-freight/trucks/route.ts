import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, validationFail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { createTruck, listTrucks } from "@/modules/internal-freight/service";

const schema = z.object({
  name: z.string().min(1).max(120),
  plate: z.string().max(32).optional().nullable(),
  fuelEfficiencyKmPerGallon: z.coerce.number().positive().optional().nullable(),
  maintenanceCostPerKm: z.coerce.number().nonnegative().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    return ok(await listTrucks());
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

    return created(await createTruck(parsed.data, session.userId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
