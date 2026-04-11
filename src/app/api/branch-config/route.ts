export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { listBranchModuleConfigs, upsertBranchModuleConfig, bulkUpdateBranchModuleConfigs } from "@/modules/branch-config/service";
import { toHttpErrorResponse } from "@/lib/http";

function isOwnerOrAbove(session: any): boolean {
  const role = session?.roleCode;
  const globals = session?.globalRoles ?? [];
  return role === "OWNER" || role === "SYSTEM_ADMIN" || globals.includes("OWNER") || globals.includes("SYSTEM_ADMIN");
}

export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    if (!isOwnerOrAbove(session)) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    const configs = await listBranchModuleConfigs();
    return NextResponse.json(configs);
  } catch (error: any) {
    return toHttpErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    if (!isOwnerOrAbove(session)) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    const body = await request.json();

    // Bulk update
    if (Array.isArray(body?.branchIds)) {
      const results = await bulkUpdateBranchModuleConfigs({
        branchIds: body.branchIds,
        enableCashier: Boolean(body.enableCashier),
        enableDispatch: Boolean(body.enableDispatch),
        actorUserId: session.userId,
      });
      return NextResponse.json({ updated: results.length });
    }

    // Single update
    if (!body?.branchId) {
      return NextResponse.json({ error: "branchId requerido" }, { status: 400 });
    }
    const result = await upsertBranchModuleConfig({
      branchId: body.branchId,
      enableCashier: Boolean(body.enableCashier),
      enableDispatch: Boolean(body.enableDispatch),
      actorUserId: session.userId,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    return toHttpErrorResponse(error);
  }
}
