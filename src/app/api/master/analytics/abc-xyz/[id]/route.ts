import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { toHttpErrorResponse } from "@/lib/http";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { id } = await params;
    const body = await request.json();

    const validAbc = ["A", "B", "C", null];
    const validXyz = ["X", "Y", "Z", null];

    if (body.abcClassification !== undefined && !validAbc.includes(body.abcClassification)) {
      throw new Error("INVALID_INPUT: Clasificación ABC inválida");
    }
    if (body.xyzClassification !== undefined && !validXyz.includes(body.xyzClassification)) {
      throw new Error("INVALID_INPUT: Clasificación XYZ inválida");
    }

    const product = await prisma.product.update({
      where: { id },
      data: {
        ...(body.abcClassification !== undefined && { abcClassification: body.abcClassification }),
        ...(body.xyzClassification !== undefined && { xyzClassification: body.xyzClassification }),
        lastClassificationAt: new Date(),
      },
    });

    await logAuditEvent({
      actorUserId: session.userId,
      module: "analytics",
      action: "PRODUCT_CLASSIFICATION_UPDATED",
      entityType: "Product",
      entityId: id,
      metadataJson: {
        abcClassification: body.abcClassification,
        xyzClassification: body.xyzClassification,
      },
    });

    return NextResponse.json({ data: product });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
