import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { searchParams } = new URL(request.url);
    const ids = (searchParams.get("productIds") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (ids.length === 0) return ok([]);

    const rows = await prisma.inventoryBalance.groupBy({
      by: ["productId"],
      where: { productId: { in: ids } },
      _sum: { quantityOnHand: true },
    });

    const data = ids.map((productId) => {
      const row = rows.find((r) => r.productId === productId);
      return { productId, totalQty: Number(row?._sum.quantityOnHand ?? 0) };
    });

    return ok(data);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
