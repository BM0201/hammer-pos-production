import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { createCsrfToken } from "@/modules/security/csrf";

// GET: Generate a new CSRF token
export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const token = await createCsrfToken(session.userId);
    return NextResponse.json({ csrfToken: token });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ message: "Error generating CSRF token" }, { status: 500 });
  }
}
