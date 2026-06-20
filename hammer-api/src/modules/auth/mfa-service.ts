/**
 * MFA Service — gestión de TOTP para Hammer POS
 *
 * Flujo de activación:
 *   1. setupMfa()    → genera secreto temporal, devuelve secret + otpauthUri
 *   2. confirmMfa()  → valida el código TOTP, persiste el secreto, devuelve códigos de recuperación
 *
 * Flujo de login con MFA:
 *   1. authenticate() → si mfaEnabled, crear MfaPendingToken en BD
 *   2. verifyMfaChallenge() → valida token + código TOTP → crea sesión completa
 *
 * Roles críticos que REQUIEREN MFA: MASTER, OWNER, SYSTEM_ADMIN
 */

import { createHmac, randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { revokeAllUserSessions } from "@/modules/security/token-revocation";
import {
  generateTotpSecret,
  verifyTotp,
  buildOtpauthUri,
  generateRecoveryCodes,
  verifyRecoveryCode,
} from "@/modules/auth/totp";
import { createSecurityAlert } from "@/modules/security/alerts-service";
import { env } from "@/lib/env";

export const MFA_REQUIRED_ROLES = new Set(["MASTER", "OWNER", "SYSTEM_ADMIN"]);
const PENDING_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ─── Pending MFA Challenge Token ─────────────────────────────────────────────

function signPendingToken(userId: string, nonce: string): string {
  return createHmac("sha256", env.AUTH_SESSION_SECRET)
    .update(`mfa-pending:${userId}:${nonce}`)
    .digest("hex");
}

export async function createMfaPendingToken(userId: string): Promise<string> {
  const nonce = randomBytes(16).toString("hex");
  const token = `${nonce}.${signPendingToken(userId, nonce)}`;
  const expiresAt = new Date(Date.now() + PENDING_TOKEN_TTL_MS);

  await prisma.mfaPendingToken.create({
    data: { token, userId, expiresAt },
  });

  return token;
}

export async function consumeMfaPendingToken(
  token: string,
): Promise<string | null> {
  const row = await prisma.mfaPendingToken.findUnique({
    where: { token },
    select: { id: true, userId: true, expiresAt: true },
  });

  if (!row || row.expiresAt < new Date()) {
    return null;
  }

  // Consume (single use)
  await prisma.mfaPendingToken.delete({ where: { id: row.id } });
  return row.userId;
}

/** Limpieza periódica de tokens expirados. */
export async function cleanupExpiredMfaTokens(): Promise<void> {
  await prisma.mfaPendingToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
}

// ─── MFA Setup ───────────────────────────────────────────────────────────────

/**
 * Genera un secreto TOTP temporal para el setup.
 * El secreto NO se guarda en BD todavía — el usuario debe confirmarlo primero.
 * El secreto se devuelve al frontend para que sea escaneado/ingresado.
 */
export async function initMfaSetup(
  userId: string,
  username: string,
): Promise<{ secret: string; otpauthUri: string }> {
  const secret = generateTotpSecret();
  const otpauthUri = buildOtpauthUri({ secret, username });

  // Guardamos el secreto temporal en el campo mfaSecret (sin activar aún)
  // mfaEnabled sigue en false hasta que el usuario confirme con un código válido
  await prisma.user.update({
    where: { id: userId },
    data: { mfaSecret: secret, mfaEnabled: false },
  });

  return { secret, otpauthUri };
}

/**
 * Confirma el setup de MFA: valida el código TOTP contra el secreto temporal,
 * activa MFA y genera códigos de recuperación.
 */
export async function confirmMfaSetup(
  userId: string,
  totpCode: string,
  auditContext: { ipAddress?: string; userAgent?: string } = {},
): Promise<{ recoveryCodes: string[] }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, mfaSecret: true, mfaEnabled: true },
  });

  if (!user?.mfaSecret) {
    throw new Error("MFA_SETUP_REQUIRED: inicia el setup antes de confirmar");
  }
  if (user.mfaEnabled) {
    throw new Error("VALIDATION_ERROR: MFA ya está activo");
  }

  if (!verifyTotp(user.mfaSecret, totpCode)) {
    await logAuditEvent({
      actorUserId: userId,
      module: "mfa",
      action: "MFA_SETUP_CONFIRM_FAILED",
      entityType: "User",
      entityId: userId,
      metadataJson: { reason: "INVALID_TOTP_CODE" },
      ...auditContext,
    });
    throw new Error("VALIDATION_ERROR: código TOTP inválido");
  }

  const { plain, hashed } = generateRecoveryCodes();

  await prisma.user.update({
    where: { id: userId },
    data: {
      mfaEnabled: true,
      mfaRecoveryCodes: hashed,
      mfaEnabledAt: new Date(),
    },
  });

  await logAuditEvent({
    actorUserId: userId,
    module: "mfa",
    action: "MFA_ENABLED",
    entityType: "User",
    entityId: userId,
    metadataJson: { username: user.username },
    ...auditContext,
  });

  return { recoveryCodes: plain };
}

// ─── MFA Verification (during login) ─────────────────────────────────────────

/**
 * Verifica el código MFA durante el challenge de login.
 * Acepta código TOTP o código de recuperación.
 * Devuelve true si válido.
 */
export async function verifyMfaCode(
  userId: string,
  code: string,
  auditContext: { ipAddress?: string; userAgent?: string } = {},
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      mfaSecret: true,
      mfaEnabled: true,
      mfaRecoveryCodes: true,
    },
  });

  if (!user?.mfaEnabled || !user.mfaSecret) return false;

  // Try TOTP first
  if (/^\d{6}$/.test(code)) {
    const valid = verifyTotp(user.mfaSecret, code);
    if (valid) {
      await logAuditEvent({
        actorUserId: userId,
        module: "mfa",
        action: "MFA_LOGIN_SUCCESS",
        entityType: "User",
        entityId: userId,
        metadataJson: { method: "TOTP", username: user.username },
        ...auditContext,
      });
      return true;
    }

    await logAuditEvent({
      actorUserId: userId,
      module: "mfa",
      action: "MFA_LOGIN_FAILED",
      entityType: "User",
      entityId: userId,
      metadataJson: { method: "TOTP", reason: "INVALID_CODE", username: user.username },
      ...auditContext,
    });
    await createSecurityAlert({
      severity: "MEDIUM",
      type: "MFA_FAILED",
      title: "Código MFA inválido",
      description: `El usuario ${user.username} ingresó un código MFA incorrecto.`,
      actorUserId: userId,
      metadataJson: { username: user.username },
    });
    return false;
  }

  // Try recovery code
  const hashedCodes = Array.isArray(user.mfaRecoveryCodes) ? (user.mfaRecoveryCodes as string[]) : [];
  const { valid, remainingCodes } = verifyRecoveryCode(code, hashedCodes);

  if (valid) {
    await prisma.user.update({
      where: { id: userId },
      data: { mfaRecoveryCodes: remainingCodes },
    });
    await logAuditEvent({
      actorUserId: userId,
      module: "mfa",
      action: "MFA_RECOVERY_CODE_USED",
      entityType: "User",
      entityId: userId,
      metadataJson: { username: user.username, remainingCodes: remainingCodes.length },
      ...auditContext,
    });
    await createSecurityAlert({
      severity: "HIGH",
      type: "MFA_RECOVERY_USED",
      title: "Código de recuperación MFA usado",
      description: `El usuario ${user.username} usó un código de recuperación. Quedan ${remainingCodes.length} códigos.`,
      actorUserId: userId,
      metadataJson: { username: user.username, remainingCodes: remainingCodes.length },
    });
    return true;
  }

  await logAuditEvent({
    actorUserId: userId,
    module: "mfa",
    action: "MFA_LOGIN_FAILED",
    entityType: "User",
    entityId: userId,
    metadataJson: { method: "RECOVERY_CODE", reason: "INVALID_CODE", username: user.username },
    ...auditContext,
  });
  return false;
}

// ─── MFA Disable / Reset ─────────────────────────────────────────────────────

export async function disableMfa(
  userId: string,
  actorUserId: string,
  auditContext: { ipAddress?: string; userAgent?: string } = {},
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, globalRole: true },
  });
  if (!user) throw new Error("NOT_FOUND: usuario no encontrado");

  await prisma.user.update({
    where: { id: userId },
    data: {
      mfaEnabled: false,
      mfaSecret: null,
      mfaRecoveryCodes: Prisma.JsonNull,
      mfaEnabledAt: null,
    },
  });

  await revokeAllUserSessions(userId, "MFA_DISABLED");

  await logAuditEvent({
    actorUserId,
    module: "mfa",
    action: "MFA_DISABLED",
    entityType: "User",
    entityId: userId,
    metadataJson: {
      targetUsername: user.username,
      byAdmin: actorUserId !== userId,
    },
    ...auditContext,
  });

  await createSecurityAlert({
    severity: actorUserId !== userId ? "HIGH" : "MEDIUM",
    type: "MFA_DISABLED",
    title: "MFA desactivado",
    description: actorUserId !== userId
      ? `Un administrador desactivó el MFA del usuario ${user.username}.`
      : `El usuario ${user.username} desactivó su propio MFA.`,
    actorUserId,
    metadataJson: { targetUserId: userId, targetUsername: user.username },
  });
}
