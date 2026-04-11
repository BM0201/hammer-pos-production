import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { createTimberTrip, listTimberTrips } from "@/modules/timber/service";
import { createTimberTripSchema } from "@/modules/timber/validators";

/**
 * BUG FIX: Added try-catch to GET handler.
 * BUG FIX: Validate page/limit params to prevent invalid queries.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const url = new URL(req.url);
    const status = url.searchParams.get("status") || undefined;
    const destinationBranchId = url.searchParams.get("destinationBranchId") || undefined;
    const search = url.searchParams.get("search") || undefined;
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10) || 20));

    const result = await listTimberTrips({ status, destinationBranchId, search, page, limit });
    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error("[TIMBER_TRIPS_GET]", err);
    return NextResponse.json({ error: "Error al listar viajes" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session || !session.globalRoles.includes("MASTER")) {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = createTimberTripSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validación fallida", details: parsed.error.flatten() }, { status: 400 });
    }

    const result = await createTimberTrip(parsed.data, session.userId);
    return NextResponse.json(result, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    console.error("[TIMBER_TRIPS_POST]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
