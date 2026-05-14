import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertMaster } from "@/modules/security/rbac-helpers";
import {
  getTimberTrip,
  updateTimberTrip,
  confirmTimberTrip,
  cancelTimberTrip,
} from "@/modules/timber/service";
import { updateTimberTripSchema } from "@/modules/timber/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";

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
    return toHttpErrorResponse(err);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

    const { id } = await params;
    const body = await req.json();
    const parsed = updateTimberTripSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validación fallida", details: parsed.error.flatten() }, { status: 400 });
    }

    const result = await updateTimberTrip(id, parsed.data);
    return NextResponse.json(result);
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message === "TIMBER_TRIP_NOT_FOUND") {
        return NextResponse.json({ error: err.message }, { status: 404 });
      }
      if (err.message === "TRIP_NOT_EDITABLE") {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
    }
    return toHttpErrorResponse(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

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
    if (err instanceof Error) {
      if (err.message.includes("NOT_FOUND")) {
        return NextResponse.json({ error: err.message }, { status: 404 });
      }
      if (err.message.includes("CANNOT")) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
    }
    return toHttpErrorResponse(err);
  }
}
