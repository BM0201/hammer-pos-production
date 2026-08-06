import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import {
  getOperationalAutomationConfig,
  getOperationalAutomationStatus,
  updateOperationalAutomationConfig,
} from "@/modules/operations/operational-automation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const timeField = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato de hora invalido (use HH:mm)")
  .nullable();

const updateSchema = z.object({
  operationalDay: z.object({
    autoOpenEnabled: z.boolean().optional(),
    autoOpenTime: timeField.optional(),
    autoCloseEnabled: z.boolean().optional(),
    autoCloseTime: timeField.optional(),
    timezone: z.string().min(1).max(64).optional(),
    weekdayOpenTime: timeField.optional(),
    saturdayOpenTime: timeField.optional(),
    sundayOpenTime: timeField.optional(),
    weekdayCloseTime: timeField.optional(),
    saturdayCloseTime: timeField.optional(),
    sundayCloseTime: timeField.optional(),
    allowOpenDayWhenOpeningCashSession: z.boolean().optional(),
  }).partial().optional(),
  cashSessions: z.object({
    autoCloseEnabled: z.boolean().optional(),
    timezone: z.string().min(1).max(64).optional(),
    weekdayCloseTime: timeField.optional(),
    saturdayCloseTime: timeField.optional(),
    sundayCloseTime: timeField.optional(),
    autoCloseAction: z.enum(["PENDING_REVIEW", "DIRECT_CLOSE"]).optional(),
  }).partial().optional(),
  safetyRules: z.object({
    blockDayCloseWithOpenCashSessions: z.literal(true).optional(),
    blockDayCloseWithReconcilingCashSessions: z.literal(true).optional(),
    blockDayCloseWithPendingReviews: z.literal(true).optional(),
    blockDayCloseWithPendingPayments: z.literal(true).optional(),
  }).partial().optional(),
});

async function buildPayload() {
  const [config, status] = await Promise.all([
    getOperationalAutomationConfig(),
    getOperationalAutomationStatus(),
  ]);
  return { config, status };
}

export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    return ok(await buildPayload());
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
    if (!parsed.success) return fail("VALIDATION_ERROR", "Configuracion invalida.", 400, parsed.error.flatten());

    if (parsed.data.cashSessions?.autoCloseAction === "DIRECT_CLOSE") {
      return fail("VALIDATION_ERROR", "El cierre directo no esta habilitado porque requiere conciliacion segura.", 400);
    }

    await updateOperationalAutomationConfig(parsed.data, session.userId);
    return ok(await buildPayload());
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
