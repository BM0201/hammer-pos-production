import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { createTransportService, listTransportServices } from "@/modules/transport/service";
import { TransportServiceStatus } from "@prisma/client";
import { CAPABILITIES } from "@/modules/rbac/policies";
import {
  getBranchIdsWithCapability,
  isPrivilegedGlobal,
  requireAnyBranchCapability,
  requireBranchCapability,
} from "@/modules/rbac/guards";
import { requireCsrf } from "@/modules/security/csrf";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    requireAnyBranchCapability(session, [CAPABILITIES.DISPATCH_VIEW]);

    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get("branchId");
    const statusFilter = searchParams.get("status");

    const status = statusFilter ? (statusFilter.split(",") as TransportServiceStatus[]) : undefined;

    if (branchId) {
      requireBranchCapability(session, branchId, CAPABILITIES.DISPATCH_VIEW);
      const data = await listTransportServices({ branchIds: [branchId], status });
      return NextResponse.json({ data });
    }

    const branchIds = isPrivilegedGlobal(session)
      ? undefined
      : getBranchIdsWithCapability(session, CAPABILITIES.DISPATCH_VIEW);

    if (!isPrivilegedGlobal(session) && (!branchIds || branchIds.length === 0)) {
      return NextResponse.json({ data: [] });
    }

    const data = await listTransportServices({ branchIds, status });
    return NextResponse.json({ data });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const body = await request.json();
    const { saleOrderId, branchId, customerName, reference, price, scheduledPaymentTime, notes } = body;

    if (!saleOrderId || !branchId || !customerName || price == null) {
      return NextResponse.json(
        { message: "Faltan campos requeridos: saleOrderId, branchId, customerName, price" },
        { status: 400 },
      );
    }

    requireAnyBranchCapability(session, [CAPABILITIES.DISPATCH_MARK]);
    requireBranchCapability(session, branchId, CAPABILITIES.DISPATCH_MARK);

    const transport = await createTransportService({
      saleOrderId,
      branchId,
      customerName,
      reference: reference || null,
      price: Number(price),
      scheduledPaymentTime: scheduledPaymentTime ? new Date(scheduledPaymentTime) : null,
      notes: notes || null,
      createdByUserId: session.userId,
    });

    return NextResponse.json({ data: transport }, { status: 201 });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
