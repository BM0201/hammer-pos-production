import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { createProduct, listProducts, getTopSellingProducts } from "@/modules/catalog/service";
import { createProductSchema } from "@/modules/catalog/validators";
import { toHttpErrorResponse } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") ?? undefined;
    const isActiveParam = searchParams.get("isActive");
    const isActive = isActiveParam === null ? undefined : isActiveParam === "true";
    const topSelling = searchParams.get("topSelling") === "true";
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;

    if (topSelling) {
      const products = await getTopSellingProducts({ limit: limit ?? 5, isActive });
      return NextResponse.json({ data: products });
    }

    const products = await listProducts({ q, isActive });
    return NextResponse.json({ data: products });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const parsed = createProductSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
    }

    const product = await createProduct({ ...parsed.data, actorUserId: session.userId });
    return NextResponse.json({ data: product }, { status: 201 });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
