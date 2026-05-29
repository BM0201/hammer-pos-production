import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { listDiscounts, createDiscount } from "@/modules/discounts/service";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, fail } from "@/lib/api/response";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    const url = new URL(request.url);
    const activeParam = url.searchParams.get("active");
    const params = activeParam !== null ? { active: activeParam === "true" } : undefined;
    const data = await listDiscounts(params);
    return ok(data);
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);
    const body = await request.json();

    if (!body.name?.trim()) {
      return fail("VALIDATION_ERROR", "El nombre del descuento es requerido", 400);
    }
    if (!body.type || !["PERCENTAGE", "FIXED_AMOUNT"].includes(body.type)) {
      return fail("VALIDATION_ERROR", "Tipo de descuento inválido", 400);
    }
    if (typeof body.value !== "number" || body.value <= 0) {
      return fail("VALIDATION_ERROR", "El valor debe ser un número positivo", 400);
    }

    const data = await createDiscount({ ...body, createdByUserId: session.userId });
    return created(data);
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}
