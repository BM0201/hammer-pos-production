import { NextResponse } from "next/server";

/**
 * Lightweight healthcheck endpoint for the deployment platform.
 * Must stay free of DB/auth dependencies so it can return 200 even
 * while downstream services are warming up.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "hammer-pos-production",
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
