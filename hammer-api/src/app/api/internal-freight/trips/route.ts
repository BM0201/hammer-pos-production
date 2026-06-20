import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, validationFail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { calculateInternalFreightTrip, listInternalFreightTrips } from "@/modules/internal-freight/service";

const lineSchema = z.object({
  productId: z.string().cuid(),
  transferLineId: z.string().cuid().optional().nullable(),
  quantity: z.coerce.number().positive(),
  lineValue: z.coerce.number().nonnegative(),
  allocatedFreight: z.coerce.number().nonnegative().optional(),
});

const tripSchema = z.object({
  routeId: z.string().cuid(),
  transferId: z.string().cuid().optional().nullable(),
  truckId: z.string().cuid().optional().nullable(),
  tripDate: z.string().optional().nullable(),
  fuelPricePerGallon: z.coerce.number().nonnegative(),
  fuelCost: z.coerce.number().nonnegative().optional().nullable(),
  driverCost: z.coerce.number().nonnegative().optional().nullable(),
  helperCost: z.coerce.number().nonnegative().optional().nullable(),
  otherCost: z.coerce.number().nonnegative().optional().nullable(),
  allocationMethod: z.enum(["BY_VALUE", "BY_QUANTITY", "MANUAL"]).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  lines: z.array(lineSchema).optional(),
});

export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    return ok(await listInternalFreightTrips());
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

    const parsed = tripSchema.safeParse(await req.json());
    if (!parsed.success) return validationFail(parsed.error.issues);

    return created(await calculateInternalFreightTrip(parsed.data, session.userId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
