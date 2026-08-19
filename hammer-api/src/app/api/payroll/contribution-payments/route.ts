import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertFinanceAccess, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, validationFail } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";

/**
 * Pago mensual de las facturas del patrón (INSS / INATEC).
 *
 * El INSS se cobra UNA vez al mes (la factura del período vence ≈17 del mes
 * siguiente). Aquí queda el registro CONTABLE de si ya se pagó — solo estado y
 * auditoría: el costo ya está reconocido en employerCost, así que marcarla
 * pagada NO genera otro gasto (sin doble conteo) ni toca caja.
 */

const markPaidSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  kind: z.enum(["INSS", "INATEC"]),
  amount: z.coerce.number().positive(),
  notes: z.string().max(300).optional(),
});

/** GET /api/payroll/contribution-payments?year=&month= — estado del período. */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertFinanceAccess(session!);

    const url = new URL(req.url);
    const year = Number(url.searchParams.get("year"));
    const month = Number(url.searchParams.get("month"));
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return validationFail("year y month son requeridos");
    }

    const payments = await prisma.employerContributionPayment.findMany({
      where: { year, month },
      orderBy: { kind: "asc" },
    });
    return ok({ year, month, payments });
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}

/** POST — marca la factura del período como PAGADA (solo Master; idempotente). */
export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session!);

    const parsed = markPaidSchema.safeParse(await req.json());
    if (!parsed.success) return validationFail(parsed.error.issues);
    const { year, month, kind, amount, notes } = parsed.data;

    const payment = await prisma.employerContributionPayment.upsert({
      where: { year_month_kind: { year, month, kind } },
      create: { year, month, kind, amount, notes: notes ?? null, paidByUserId: session!.userId },
      update: { amount, notes: notes ?? null, paidAt: new Date(), paidByUserId: session!.userId },
    });

    await logAuditEvent({
      actorUserId: session!.userId,
      module: "payroll",
      action: "contribution_payment.marked_paid",
      entityType: "EmployerContributionPayment",
      entityId: payment.id,
      metadataJson: { year, month, kind, amount },
    });

    return ok(payment);
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}
