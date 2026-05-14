import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster } from "@/modules/rbac/guards";
import { getTimberProduct, updateTimberProduct, deleteTimberProduct } from "@/modules/timber/service";
import { updateTimberProductSchema } from "@/modules/timber/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { z } from "zod";
import { requireCsrf } from "@/modules/security/csrf";

type Params = { params: Promise<{ id: string }> };

/** GET /api/timber/[id] — Get a specific timber product */
export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    const { id } = await params;

    const result = await getTimberProduct(id);
    if (!result) {
      return NextResponse.json({ error: "Producto de madera no encontrado" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}

/** PUT /api/timber/[id] — Update a timber product */
export async function PUT(request: Request, { params }: Params) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    const { id } = await params;

    if (!isMaster(session)) {
      return NextResponse.json({ error: "Solo MASTER puede editar productos de madera" }, { status: 403 });
    }

    const body = await request.json();
    const parsed = updateTimberProductSchema.parse(body);
    const result = await updateTimberProduct(id, parsed);

    return NextResponse.json(result);
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Validación fallida", details: err.errors }, { status: 422 });
    }
    if (err instanceof Error && err.message === "TIMBER_PRODUCT_NOT_FOUND") {
      return NextResponse.json({ error: "Producto de madera no encontrado" }, { status: 404 });
    }
    return toHttpErrorResponse(err);
  }
}

/** DELETE /api/timber/[id] — Delete (deactivate) a timber product */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    const { id } = await params;

    if (!isMaster(session)) {
      return NextResponse.json({ error: "Solo MASTER puede eliminar productos de madera" }, { status: 403 });
    }

    const result = await deleteTimberProduct(id);
    return NextResponse.json(result);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "TIMBER_PRODUCT_NOT_FOUND") {
      return NextResponse.json({ error: "Producto de madera no encontrado" }, { status: 404 });
    }
    return toHttpErrorResponse(err);
  }
}
