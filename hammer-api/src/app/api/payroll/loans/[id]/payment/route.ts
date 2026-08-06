import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertFinanceAccess } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, validationFail } from "@/lib/api/response";
import { registerManualLoanPayment } from "@/modules/payroll/employee-loans-service";
import { refreshDraftLoanDeductionsForEmployee } from "@/modules/payroll/payroll-service";

type Params = { params: Promise<{ id: string }> };

const paymentSchema = z.object({
  amount: z.coerce.number().positive(),
});

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertFinanceAccess(session);

    const parsed = paymentSchema.safeParse(await req.json());
    if (!parsed.success) return validationFail(parsed.error.issues);

    const { id } = await params;
    const loan = await registerManualLoanPayment(id, parsed.data.amount, session.userId);
    // El abono manual se refleja en lo que RESTA del mes: las corridas DRAFT
    // del empleado recalculan su deducción de préstamo (y sus quincenas
    // pendientes) con el saldo ya reducido.
    const refreshedDraftLines = await refreshDraftLoanDeductionsForEmployee(loan.employeeId);
    return ok({ ...loan, refreshedDraftLines });
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}
