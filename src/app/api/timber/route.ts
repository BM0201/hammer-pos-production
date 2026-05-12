import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster } from "@/modules/rbac/guards";
import { createTimberProduct, listTimberProducts } from "@/modules/timber/service";
import { createTimberProductSchema } from "@/modules/timber/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { z } from "zod";
import { requireCsrf } from "@/modules/security/csrf";

/** GET /api/timber — List timber products with optional filters */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const url = new URL(request.url);
    const timberType = url.searchParams.get("timberType") ?? undefined;
    const search = url.searchParams.get("search") ?? undefined;
    const page = parseInt(url.searchParams.get("page") ?? "1", 10);
    const limit = parseInt(url.searchParams.get("limit") ?? "20", 10);

    const result = await listTimberProducts({ timberType, search, page, limit });
    return NextResponse.json(result);
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}

/** POST /api/timber — Create a new timber product */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    // Only MASTER can create timber products
    if (!isMaster(session)) {
      return NextResponse.json({ error: "Solo el rol MASTER puede crear productos de madera" }, { status: 403 });
    }

    const body = await request.json();
    const parsed = createTimberProductSchema.parse(body);
    const result = await createTimberProduct(parsed);

    return NextResponse.json(result, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Validación fallida", details: err.errors }, { status: 422 });
    }
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return NextResponse.json({ error: "Ya existe un producto con ese SKU" }, { status: 409 });
    }
    return toHttpErrorResponse(err);
  }
}
