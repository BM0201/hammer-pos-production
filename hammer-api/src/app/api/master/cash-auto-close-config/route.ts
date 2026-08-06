import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import {
  getCashAutoCloseConfig,
  updateCashAutoCloseConfig,
} from "@/modules/cash-session/auto-close-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "HH:mm" 24h time, or null to disable that day.
const timeField = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato de hora inválido (use HH:mm)")
  .nullable();

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  timezone: z.string().min(1).max(64).optional(),
  weekdayCloseTime: timeField.optional(),
  saturdayCloseTime: timeField.optional(),
  sundayCloseTime: timeField.optional(),
});

export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    const config = await getCashAutoCloseConfig();
    return ok(config);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const body = await request.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Configuración inválida.", 400);
    }

    const config = await updateCashAutoCloseConfig(parsed.data, session.userId);
    return ok(config);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
