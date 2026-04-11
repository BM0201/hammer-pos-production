import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { createEmployee, listEmployees } from "@/modules/payroll/payroll-service";

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

    return NextResponse.json({ data: employees });
  } catch (err: any) {
    return toHttpErrorResponse(err);
  }
}

/** POST /api/employees — create new employee */
export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session!);

    const body = await req.json();
    const { fullName, position, branchId, monthlySalary, startDate } = body;

    if (!fullName || !position || !branchId || !monthlySalary || !startDate) {
      return NextResponse.json({ error: "Campos requeridos: fullName, position, branchId, monthlySalary, startDate" }, { status: 400 });
    }

    const employee = await createEmployee(
      { fullName, position, branchId, monthlySalary: Number(monthlySalary), startDate },
      session!.userId,
    );

    return NextResponse.json({ data: employee }, { status: 201 });
  } catch (err: any) {
    if (err.message === "INVALID_SALARY") {
      return NextResponse.json({ error: "El salario debe ser mayor a 0" }, { status: 400 });
    }
    return toHttpErrorResponse(err);
  }
}
