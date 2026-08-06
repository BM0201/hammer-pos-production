import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import {
  getOperationalDayAutoConfig,
  updateOperationalDayAutoConfig,
} from "@/modules/operations/auto-day-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const timeField = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato de hora inválido (use HH:mm)")
  .nullable();

const updateSchema = z.object({
  autoOpenEnabled: z.boolean().optional(),
  autoCloseEnabled: z.boolean().optional(),
  timezone: z.string().min(1).max(64).optional(),
  weekdayOpenTime: timeField.optional(),
  saturdayOpenTime: timeField.optional(),
  sundayOpenTime: timeField.optional(),
  weekdayCloseTime: timeField.optional(),
  saturdayCloseTime: timeField.optional(),
  sundayCloseTime: timeField.optional(),
});

export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    return ok(await getOperationalDayAutoConfig());
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

    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Configuración inválida.", 400);
    }

    return ok(await updateOperationalDayAutoConfig(parsed.data, session.userId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
