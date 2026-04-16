export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { getBranchModuleConfig } from "@/modules/branch-config/service";
import { toHttpErrorResponse } from "@/lib/http";

export async function GET(_req: Request, { params }: { params: Promise<{ branchId: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    const { branchId } = await params;
    const config = await getBranchModuleConfig(branchId);
    return NextResponse.json(config);
  } catch (error: any) {
    return toHttpErrorResponse(error);
  }
}
