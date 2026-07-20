import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, validationFail } from "@/lib/api/response";
import { confirmRollCall } from "@/modules/payroll/employee-absences-service";

type Params = { params: Promise<{ id: string }> };

const confirmSchema = z.object({
  corrections: z
    .array(
      z.object({
        employeeId: z.string().min(1),
        status: z.enum(["PRESENT", "UNJUSTIFIED", "JUSTIFIED"]),
        notes: z.string().max(300).optional(),
      }),
    )
    .max(200)
    .optional(),
});

/**
 * POST /api/payroll/attendance/roll-call/[id]/confirm — Master confirma que
 * el pase es real (o lo corrige antes de confirmar). Solo Master: quien pasó
 * lista no puede autoconfirmarse.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session!);

    const parsed = confirmSchema.safeParse(await req.json());
    if (!parsed.success) return validationFail(parsed.error.issues);

    const { id } = await params;
    return ok(await confirmRollCall(id, parsed.data.corrections ?? [], session!.userId));
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}
