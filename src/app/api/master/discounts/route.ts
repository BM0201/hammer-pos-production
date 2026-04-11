import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { listDiscounts, createDiscount } from "@/modules/discounts/service";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    const url = new URL(request.url);
    const activeParam = url.searchParams.get("active");
    const params = activeParam !== null ? { active: activeParam === "true" } : undefined;
    const data = await listDiscounts(params);
    return NextResponse.json({ data });
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    const body = await request.json();

    if (!body.name?.trim()) {
      return NextResponse.json({ message: "El nombre del descuento es requerido" }, { status: 400 });
    }
    if (!body.type || !["PERCENTAGE", "FIXED_AMOUNT"].includes(body.type)) {
      return NextResponse.json({ message: "Tipo de descuento inválido" }, { status: 400 });
    }
    if (typeof body.value !== "number" || body.value <= 0) {
      return NextResponse.json({ message: "El valor debe ser un número positivo" }, { status: 400 });
    }

    const data = await createDiscount({ ...body, createdByUserId: session.userId });
    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}
