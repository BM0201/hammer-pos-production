import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { getTransportServiceById, updateTransportStatus } from "@/modules/transport/service";
import { TransportServiceStatus } from "@prisma/client";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { requireAnyBranchCapability, requireBranchCapability } from "@/modules/rbac/guards";
import { requireCsrf } from "@/modules/security/csrf";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const { id } = await params;
    const body = await request.json();
    const { status } = body;

    const validStatuses: TransportServiceStatus[] = [
      TransportServiceStatus.PENDING,
      TransportServiceStatus.IN_TRANSIT,
      TransportServiceStatus.DELIVERED,
      TransportServiceStatus.CANCELLED,
    ];

    if (!status || !validStatuses.includes(status)) {
      return NextResponse.json(
        { message: "Estado inválido. Valores permitidos: PENDING, IN_TRANSIT, DELIVERED, CANCELLED" },
        { status: 400 },
      );
    }

    const transport = await getTransportServiceById(id);
    requireAnyBranchCapability(session, [CAPABILITIES.DISPATCH_MARK]);
    requireBranchCapability(session, transport.branchId, CAPABILITIES.DISPATCH_MARK);

    const updated = await updateTransportStatus({
      transportId: id,
      status,
      actorUserId: session.userId,
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
