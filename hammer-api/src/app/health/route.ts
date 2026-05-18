import { ok } from "@/lib/api/response";

/**
 * Lightweight healthcheck endpoint for Railway.
 * Must stay free of DB/auth dependencies so it can return 200 even
 * while downstream services are warming up.
 */
export async function GET() {
  return ok({
    status: "ok",
    service: "hammer-pos-production",
    timestamp: new Date().toISOString(),
  });
}
