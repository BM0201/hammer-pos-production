import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { updateTransportStatus } from "@/modules/transport/service";
import { TransportServiceStatus } from "@prisma/client";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

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
        { status: 400 }
      );
    }

    const transport = await updateTransportStatus({
      transportId: id,
      status,
      actorUserId: session.userId,
    });

    return NextResponse.json({ data: transport });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
