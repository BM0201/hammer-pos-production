export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { CashSessionStatus, PaymentMethod, SaleOrderStatus } from "@prisma/client";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { submitDirectSale } from "@/modules/sales/service";
import { toHttpErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { requireAnyBranchCapability, requireBranchCapability } from "@/modules/rbac/guards";
import { requireCsrf } from "@/modules/security/csrf";
import { saleOrderDirectSaleSchema } from "@/modules/sales/validators";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsedBody = saleOrderDirectSaleSchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return NextResponse.json({ message: "Invalid payload", issues: parsedBody.error.issues, reason: "INVALID_PAYLOAD" }, { status: 400 });
    }

    const body = parsedBody.data;
    const { id } = await params;

    const order = await prisma.saleOrder.findUnique({
      where: { id },
      select: { id: true, branchId: true, status: true },
    });

    if (!order) {
      return NextResponse.json({ message: "Recurso no encontrado", reason: "ORDER_NOT_FOUND" }, { status: 404 });
    }

    if (order.status !== SaleOrderStatus.DRAFT) {
      return NextResponse.json({ message: "La orden no está en estado editable.", reason: "ORDER_NOT_DRAFT" }, { status: 409 });
    }

    requireAnyBranchCapability(session, [CAPABILITIES.SALES_SUBMIT_PAYMENT, CAPABILITIES.CASH_PAYMENTS_COLLECT]);
    requireBranchCapability(session, order.branchId, CAPABILITIES.SALES_SUBMIT_PAYMENT);
    requireBranchCapability(session, order.branchId, CAPABILITIES.CASH_PAYMENTS_COLLECT);

    const cashSession = await prisma.cashSession.findUnique({
      where: { id: body.cashSessionId },
      include: { physicalCashBox: true },
    });

    if (!cashSession || cashSession.status !== CashSessionStatus.OPEN || !cashSession.activeSessionKey) {
      return NextResponse.json({ message: "Sesión de caja inválida", reason: "INVALID_CASH_SESSION" }, { status: 409 });
    }

    if (!cashSession.physicalCashBox?.isActive) {
      return NextResponse.json({ message: "Caja inactiva", reason: "CASH_BOX_INACTIVE" }, { status: 409 });
    }

    if (cashSession.physicalCashBox.branchId !== order.branchId) {
      return NextResponse.json({ message: "Caja/sesión fuera de sucursal", reason: "CASH_BOX_BRANCH_MISMATCH" }, { status: 403 });
    }

    const method = body.method ?? PaymentMethod.CASH;

    const result = await submitDirectSale({
      saleOrderId: order.id,
      actorUserId: session.userId,
      cashSessionId: body.cashSessionId,
      method,
      requiresTransport: body?.requiresTransport,
      transportAmount: body?.transportAmount,
      referenceNumber: body?.referenceNumber ?? null,
    });

    return NextResponse.json({ order: result });
  } catch (error: any) {
    return toHttpErrorResponse(error);
  }
}
