import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertSystemAdmin } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { listBranchRoleConfigs, updateBranchRoleConfig } from "@/modules/system-admin/service";

export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertSystemAdmin(session);
    const data = await listBranchRoleConfigs();
    return NextResponse.json({ data });
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertSystemAdmin(session);
    const body = await request.json();
    const { branchId, role, enabled } = body;
    if (!branchId || !role || typeof enabled !== "boolean") {
      return NextResponse.json({ message: "branchId, role, and enabled are required" }, { status: 400 });
    }
    // Validate role is a valid RoleCode (cannot configure MASTER or SYSTEM_ADMIN at branch level)
    const validBranchRoles = ["BRANCH_ADMIN", "SALES", "CASHIER", "WAREHOUSE"];
    if (!validBranchRoles.includes(role)) {
      return NextResponse.json({ message: `Rol inválido para configuración de sucursal. Roles válidos: ${validBranchRoles.join(", ")}` }, { status: 400 });
    }
    const data = await updateBranchRoleConfig({ branchId, role, enabled, actorUserId: session.userId });
    return NextResponse.json({ data });
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}
