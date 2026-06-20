import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { toHttpErrorResponse } from "@/lib/http";
import { created, ok, validationFail } from "@/lib/api/response";
import { createEmployeeLoan, listEmployeeLoans } from "@/modules/payroll/employee-loans-service";

const createLoanSchema = z.object({
  employeeId: z.string().cuid(),
  branchId: z.string().cuid(),
  principalAmount: z.coerce.number().positive(),
  installmentAmount: z.coerce.number().positive().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const url = new URL(req.url);
    const loans = await listEmployeeLoans({
      employeeId: url.searchParams.get("employeeId") ?? undefined,
      branchId: url.searchParams.get("branchId") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
    });

    return ok(loans);
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

    const parsed = createLoanSchema.safeParse(await req.json());
    if (!parsed.success) return validationFail(parsed.error.issues);

    const loan = await createEmployeeLoan(parsed.data, session.userId);
    return created(loan);
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}
