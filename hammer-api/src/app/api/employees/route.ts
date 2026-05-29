import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { createEmployee, listEmployees } from "@/modules/payroll/payroll-service";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, fail } from "@/lib/api/response";

/** GET /api/employees — list employees with optional filters */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session!);

    const url = new URL(req.url);
    const branchId = url.searchParams.get("branchId") ?? undefined;
    const isActive = url.searchParams.get("isActive");
    const position = url.searchParams.get("position") ?? undefined;

    const employees = await listEmployees({
      branchId,
      isActive: isActive !== null ? isActive === "true" : undefined,
      position,
    });

    return ok(employees);
  } catch (err: any) {
    return toHttpErrorResponse(err);
  }
}

/** POST /api/employees — create new employee */
export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session!);

    const body = await req.json();
    const { fullName, position, branchId, monthlySalary, startDate } = body;

    if (!fullName || !position || !branchId || !monthlySalary || !startDate) {
      return fail("ERROR", "Campos requeridos: fullName, position, branchId, monthlySalary, startDate", 400);
    }

    const employee = await createEmployee(
      { fullName, position, branchId, monthlySalary: Number(monthlySalary), startDate },
      session!.userId,
    );

    return created(employee);
  } catch (err: any) {
    if (err.message === "INVALID_SALARY") {
      return fail("ERROR", "El salario debe ser mayor a 0", 400);
    }
    return toHttpErrorResponse(err);
  }
}
