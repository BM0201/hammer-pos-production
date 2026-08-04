/**
 * GET  /api/account/mfa  → estado actual de MFA del usuario autenticado
 * POST /api/account/mfa  → iniciar setup (genera secret + URI sin activar)
 * PUT  /api/account/mfa  → confirmar setup (activa MFA, devuelve códigos de recuperación)
 * DELETE /api/account/mfa → desactivar MFA (requiere código TOTP para confirmar)
 */

import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { ok, fail, unauthorized } from "@/lib/api/response";
import { requireCsrf } from "@/modules/security/csrf";
import { toHttpErrorResponse } from "@/lib/http";
import {
  initMfaSetup,
  confirmMfaSetup,
  verifyMfaCode,
  disableMfa,
} from "@/modules/auth/mfa-service";
import { prisma } from "@/lib/prisma";
import { getClientIp } from "@/lib/client-ip";

function getAuditContext(req: Request) {
  return {
    ipAddress: getClientIp(req),
    userAgent: req.headers.get("user-agent") ?? "unknown",
  };
}

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return unauthorized();

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { mfaEnabled: true, mfaEnabledAt: true, mfaRecoveryCodes: true },
  });

  if (!user) return unauthorized();

  const remainingCodes = Array.isArray(user.mfaRecoveryCodes)
    ? (user.mfaRecoveryCodes as string[]).length
    : 0;

  return ok({
    mfaEnabled: user.mfaEnabled,
    mfaEnabledAt: user.mfaEnabledAt,
    remainingRecoveryCodes: remainingCodes,
  });
}

export async function POST(req: Request) {
  const session = await getCurrentSession();
  if (!session) return unauthorized();

  // Auditoría 2026-08-03: ninguno de los 3 handlers mutantes de este
  // archivo exigía CSRF. POST (inicio de setup) es disparable "a ciegas"
  // vía CSRF y regenera/descarta el secreto MFA pendiente del usuario.
  try {
    await requireCsrf(req, session);
  } catch (err) {
    return toHttpErrorResponse(err);
  }

  const ctx = getAuditContext(req);
  const result = await initMfaSetup(session.userId, session.username, ctx);
  return ok(result, 201);
}

const confirmSchema = z.object({ code: z.string().length(6) });

export async function PUT(req: Request) {
  const session = await getCurrentSession();
  if (!session) return unauthorized();

  try {
    await requireCsrf(req, session);
  } catch (err) {
    return toHttpErrorResponse(err);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("VALIDATION_ERROR", "Solicitud inválida.", 400);
  }

  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "Se requiere un código de 6 dígitos.", 400);
  }

  try {
    const ctx = getAuditContext(req);
    const { recoveryCodes } = await confirmMfaSetup(
      session.userId,
      parsed.data.code,
      ctx,
    );
    return ok({ recoveryCodes });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("VALIDATION_ERROR:")) {
      return fail("VALIDATION_ERROR", msg.replace("VALIDATION_ERROR: ", ""), 422);
    }
    if (msg.startsWith("MFA_SETUP_REQUIRED:")) {
      return fail("VALIDATION_ERROR", "Inicia el proceso de configuración primero.", 400);
    }
    throw err;
  }
}

const disableSchema = z.object({ code: z.string().min(6) });

export async function DELETE(req: Request) {
  const session = await getCurrentSession();
  if (!session) return unauthorized();

  try {
    await requireCsrf(req, session);
  } catch (err) {
    return toHttpErrorResponse(err);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("VALIDATION_ERROR", "Solicitud inválida.", 400);
  }

  const parsed = disableSchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "Debes confirmar con tu código TOTP o código de recuperación.", 400);
  }

  const ctx = getAuditContext(req);
  const valid = await verifyMfaCode(session.userId, parsed.data.code, ctx);
  if (!valid) {
    return fail("UNAUTHENTICATED", "Código MFA incorrecto. No se puede desactivar MFA.", 401);
  }

  await disableMfa(session.userId, session.userId, ctx);
  return ok({ disabled: true });
}
