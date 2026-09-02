import type { SessionPayload } from "@/types/auth";
import { hasBranchAccess, isMaster, isSystemAdmin, isFinanceUser } from "@/modules/rbac/guards";

export function assertAuthenticated(session: SessionPayload | null): asserts session is SessionPayload {
  if (!session) {
    throw new Error("UNAUTHENTICATED");
  }
}

export function assertBranchAccess(session: SessionPayload, branchId: string): void {
  if (!hasBranchAccess(session, branchId)) {
    throw new Error("FORBIDDEN_BRANCH");
  }
}

export function assertMaster(session: SessionPayload): void {
  if (!isMaster(session)) {
    throw new Error("FORBIDDEN_MASTER_ONLY");
  }
}

/**
 * Gate del módulo de Finanzas & Contabilidad.
 *
 * Permite el acceso a Master/Owner/SystemAdmin (control total) y al Contador
 * (rol global de solo-contabilidad). Sustituye a `assertMaster` en los endpoints
 * de gastos, precios/márgenes, planilla, cortes quincenales, fletes y reportes
 * financieros: los mismos roles que antes seguían entrando (master+), y ahora
 * además el Contador — ningún otro rol gana acceso.
 */
export function assertFinanceAccess(session: SessionPayload): void {
  if (!isFinanceUser(session)) {
    throw new Error("FORBIDDEN_FINANCE_ONLY");
  }
}

export function assertSystemAdmin(session: SessionPayload): void {
  if (!isSystemAdmin(session)) {
    throw new Error("FORBIDDEN_SYSTEM_ADMIN_ONLY");
  }
}
