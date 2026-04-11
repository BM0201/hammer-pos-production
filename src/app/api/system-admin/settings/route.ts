import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertSystemAdmin } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { getSystemSettings, updateSystemSetting } from "@/modules/system-admin/service";

export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertSystemAdmin(session);
    const data = await getSystemSettings();
    return NextResponse.json({ data });
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertSystemAdmin(session);
    const body = await request.json();
    const { key, value } = body;
    if (!key || value === undefined) {
      return NextResponse.json({ message: "key and value are required" }, { status: 400 });
    }
    const data = await updateSystemSetting(key, String(value), session.userId);
    return NextResponse.json({ data });
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}
