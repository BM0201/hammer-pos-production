import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import {
  getTimberTrip,
  updateTimberTrip,
  confirmTimberTrip,
  cancelTimberTrip,
} from "@/modules/timber/service";
import { updateTimberTripSchema } from "@/modules/timber/validators";

/**
 * BUG FIX: Added try-catch to GET handler.
 * BUG FIX: Added try-catch to PATCH body parsing.
 * BUG FIX: Validate action param in PATCH.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const { id } = await params;
    const trip = await getTimberTrip(id);
    if (!trip) return NextResponse.json({ error: "Viaje no encontrado" }, { status: 404 });

    return NextResponse.json(trip);
  } catch (err: unknown) {
    console.error("[TIMBER_TRIP_GET]", err);
    return NextResponse.json({ error: "Error al obtener viaje" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentSession();
    if (!session || !session.globalRoles.includes("MASTER")) {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();
    const parsed = updateTimberTripSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validación fallida", details: parsed.error.flatten() }, { status: 400 });
    }

    const result = await updateTimberTrip(id, parsed.data);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    const status = message === "TIMBER_TRIP_NOT_FOUND" ? 404 : message === "TRIP_NOT_EDITABLE" ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentSession();
    if (!session || !session.globalRoles.includes("MASTER")) {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();
    const action = body.action as string;

    // BUG FIX: Validate action is provided
    if (!action) {
      return NextResponse.json({ error: "Se requiere el campo 'action'" }, { status: 400 });
    }

    if (action === "confirm") {
      const trip = await confirmTimberTrip(id, session.userId);
      return NextResponse.json(trip);
    }
    if (action === "cancel") {
      const trip = await cancelTimberTrip(id);
      return NextResponse.json(trip);
    }
    return NextResponse.json({ error: `Acción desconocida: ${action}` }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    const status = message.includes("NOT_FOUND") ? 404 : message.includes("CANNOT") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
