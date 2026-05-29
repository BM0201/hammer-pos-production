import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { listDiscountSuggestions } from "@/modules/discounts/service";
import { ok } from "@/lib/api/response";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? "24");
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50, limit)) : 24;
    const data = await listDiscountSuggestions(safeLimit);
    return ok(data);
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}
