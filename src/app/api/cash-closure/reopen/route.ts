import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { reopenCashClosure } from "@/modules/cash-closure/service";

const reopenSchema = z.object({
  branchId: z.string().min(1),
  reason: z.string().optional(),
});

// POST: Reopen a closed cash session (MASTER/BRANCH_ADMIN only)
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const globalRoles = session.globalRoles as unknown as string[];
    const isMaster = globalRoles.includes("MASTER") || globalRoles.includes("SYSTEM_ADMIN");
    const isBranchAdmin = session.branchMemberships.some(
      (m) => m.roleCode === "BRANCH_ADMIN"
    );

    if (!isMaster && !isBranchAdmin) {
      return NextResponse.json({ message: "Solo MASTER o BRANCH_ADMIN pueden reabrir la caja" }, { status: 403 });
    }

    const body = await request.json();
    const parsed = reopenSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ message: "Datos inválidos" }, { status: 400 });
    }

    // Branch admin can only reopen their own branch
    if (!isMaster) {
      const hasBranchAccess = session.branchMemberships.some(
        (m) => m.branchId === parsed.data.branchId && m.roleCode === "BRANCH_ADMIN"
      );
      if (!hasBranchAccess) {
        return NextResponse.json({ message: "No tienes acceso a esta sucursal" }, { status: 403 });
      }
    }

    const result = await reopenCashClosure({
      branchId: parsed.data.branchId,
      actorUserId: session.userId,
      reason: parsed.data.reason,
    });

    return NextResponse.json({
      ok: true,
      closure: {
        id: result.closure.id,
        isReopened: result.closure.isReopened,
        reopenCount: result.closure.reopenCount,
        emergencySalesCount: result.closure.emergencySalesCount,
        maxEmergencySales: result.closure.maxEmergencySales,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "UNAUTHENTICATED") {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
      }
      if (error.message === "NO_CLOSURE_TO_REOPEN") {
        return NextResponse.json({ message: "No hay cierre para reabrir hoy" }, { status: 404 });
      }
      if (error.message === "CLOSURE_PERMANENTLY_CLOSED") {
        return NextResponse.json({ message: "El cierre es permanente, no se puede reabrir hasta mañana" }, { status: 409 });
      }
    }
    return NextResponse.json({ message: "Error al reabrir caja" }, { status: 500 });
  }
}
