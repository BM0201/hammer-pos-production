import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, validationFail } from "@/lib/api/response";
import {
  cancelEmployeeLoan,
  getEmployeeLoan,
  updateEmployeeLoan,
} from "@/modules/payroll/employee-loans-service";

type Params = { params: Promise<{ id: string }> };

const updateLoanSchema = z.object({
  installmentAmount: z.coerce.number().positive().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { id } = await params;
    const loan = await getEmployeeLoan(id);
    if (!loan) throw new Error("EMPLOYEE_LOAN_NOT_FOUND");
    return ok(loan);
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

    const parsed = updateLoanSchema.safeParse(await req.json());
    if (!parsed.success) return validationFail(parsed.error.issues);

    const { id } = await params;
    const loan = await updateEmployeeLoan(id, parsed.data, session.userId);
    return ok(loan);
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

    const { id } = await params;
    const loan = await cancelEmployeeLoan(id, session.userId);
    return ok(loan);
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}
