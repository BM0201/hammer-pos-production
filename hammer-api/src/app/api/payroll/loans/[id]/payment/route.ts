import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, validationFail } from "@/lib/api/response";
import { registerManualLoanPayment } from "@/modules/payroll/employee-loans-service";

type Params = { params: Promise<{ id: string }> };

const paymentSchema = z.object({
  amount: z.coerce.number().positive(),
});

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

    const parsed = paymentSchema.safeParse(await req.json());
    if (!parsed.success) return validationFail(parsed.error.issues);

    const { id } = await params;
    const loan = await registerManualLoanPayment(id, parsed.data.amount, session.userId);
    return ok(loan);
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}
