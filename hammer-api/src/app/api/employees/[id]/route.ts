import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { getEmployee, updateEmployee, deactivateEmployee } from "@/modules/payroll/payroll-service";
import { requireCsrf } from "@/modules/security/csrf";

type Params = { params: Promise<{ id: string }> };

/** GET /api/employees/:id — get employee detail */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session!);

    const { id } = await params;
    const employee = await getEmployee(id);
    if (!employee) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });

    return NextResponse.json({ data: employee });
  } catch (err: any) {
    return toHttpErrorResponse(err);
  }
}

/** PUT /api/employees/:id — update employee */
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session!);

    const { id } = await params;
    const body = await req.json();
    const employee = await updateEmployee(id, body, session!.userId);

    return NextResponse.json({ data: employee });
  } catch (err: any) {
    if (err.message === "INVALID_SALARY") {
      return NextResponse.json({ error: "El salario debe ser mayor a 0" }, { status: 400 });
    }
    return toHttpErrorResponse(err);
  }
}

/** DELETE /api/employees/:id — deactivate employee */
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session!);

    const { id } = await params;
    const employee = await deactivateEmployee(id, session!.userId);

    return NextResponse.json({ data: employee });
  } catch (err: any) {
    return toHttpErrorResponse(err);
  }
}
