import type { RoleCode } from "@prisma/client";
import { getRoleAwareHome } from "@/modules/rbac/guards";
import type { SessionPayload } from "@/types/auth";

export type ThemePreference = "light" | "dark" | null;

/**
 * Normaliza User.themePreference: cualquier valor que no sea "light" o
 * "dark" (incluido null/undefined/basura) se trata como "sin preferencia".
 * Misma regla que ya usaba api/auth/session/route.ts — unificada acá para
 * no repetirla a mano en login/mfa (prompt-pendientes-2026-09.md Fase 1).
 */
export function normalizeThemePreference(raw: string | null | undefined): ThemePreference {
  return raw === "light" || raw === "dark" ? raw : null;
}

export type LoginSuccessSource = {
  role: RoleCode;
  mustChangePassword: boolean;
  fullName: string;
  session: SessionPayload;
  themePreference: ThemePreference;
};

/**
 * Cuerpo de la respuesta cuando la sesión YA se creó (login sin MFA, o el
 * segundo paso del login con MFA). userId y themePreference viajan acá para
 * que el frontend aplique el tema del usuario ANTES de animar la transición
 * de login (evita el destello con el tema del usuario anterior en una
 * terminal compartida — PENDIENTES #2).
 */
export function buildLoginSuccessBody(result: LoginSuccessSource) {
  return {
    redirectTo: result.mustChangePassword ? "/app/change-password" : getRoleAwareHome(result.role),
    mustChangePassword: result.mustChangePassword,
    fullName: result.fullName,
    userId: result.session.userId,
    themePreference: result.themePreference,
  };
}

/**
 * Cuerpo del paso intermedio de MFA: a propósito SIN userId ni
 * themePreference — la sesión todavía no es válida en este punto.
 */
export function buildMfaRequiredBody(pendingToken: string, fullName: string) {
  return { mfaRequired: true as const, pendingToken, fullName };
}
