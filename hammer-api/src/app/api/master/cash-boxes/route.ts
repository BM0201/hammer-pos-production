import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { prisma } from "@/lib/prisma";
import { toHttpErrorResponse } from "@/lib/http";
import { ok } from "@/lib/api/response";

export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const data = await prisma.physicalCashBox.findMany({
      include: {
        branch: { select: { id: true, code: true, name: true } },
        _count: { select: { sessions: true } },
      },
      orderBy: [{ branch: { code: "asc" } }, { code: "asc" }],
    });

    return ok(data);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
