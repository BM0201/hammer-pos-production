import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { prisma } from "@/lib/prisma";
import { toHttpErrorResponse } from "@/lib/http";

/**
 * GET /api/branches — lightweight list of all branches.
 * Used by dropdowns (e.g. timber trips destination selector).
 */
export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const branches = await prisma.branch.findMany({
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    });

    return NextResponse.json(branches);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
