import type { SessionPayload } from "@/types/auth";
import { CAPABILITIES, type Capability } from "@/modules/rbac/policies";
import { canInBranch, isPrivilegedGlobal } from "@/modules/rbac/guards";

/**
 * ============================================================================
 *  CONTROL DE ACCESO — BITÁCORA DE VENTAS DE SUCURSAL (branch sales log)
 * ============================================================================
 *
 * La bitácora de ventas es una vista de SOLO LECTURA del historial de ventas
 * válidas de UNA sucursal, pensada para los roles operativos de sucursal
 * (cajero, vendedor, administrador de sucursal). A diferencia del panel de
 * gestión de Master (`/api/master/sales-management`), aquí el usuario NUNCA
 * puede consultar ventas de una sucursal a la que no pertenece.
 *
 * Reglas de seguridad (defensa en profundidad):
 *   1. El `branchId` recibido por query es solo un SELECTOR. Si no se envía, se
 *      resuelve desde la sesión (sucursal primaria o primera asignada).
 *   2. Un usuario global privilegiado (MASTER/OWNER/SYSTEM_ADMIN) puede ver
 *      cualquier sucursal.
 *   3. Un usuario de sucursal solo puede consultar sucursales donde tenga
 *      membresía vigente. Cualquier otra → `FORBIDDEN_BRANCH`.
 *   4. Además debe poseer alguna de las capacidades de lectura de la bitácora
 *      en esa sucursal. De lo contrario → `FORBIDDEN_CAPABILITY`.
 */

/**
 * Capacidades que habilitan la consulta de la bitácora de ventas en una
 * sucursal. El rol CASHIER posee `CASH_PAYMENTS_VIEW`; los roles SALES y
 * BRANCH_ADMIN poseen `SALES_HISTORY_VIEW`. Cualquiera de ellas es suficiente.
 */
export const BRANCH_SALES_LOG_CAPABILITIES: Capability[] = [
  CAPABILITIES.CASH_PAYMENTS_VIEW,
  CAPABILITIES.SALES_HISTORY_VIEW,
];

function assignedBranchIds(session: SessionPayload): string[] {
  return Array.from(new Set(session.branchMemberships.map((membership) => membership.branchId)));
}

/**
 * Determina si el usuario tiene permiso de lectura de la bitácora en alguna de
 * las capacidades habilitadas para la sucursal indicada.
 */
function canViewSalesLogInBranch(session: SessionPayload, branchId: string): boolean {
  return BRANCH_SALES_LOG_CAPABILITIES.some((capability) => canInBranch(session, branchId, capability));
}

/**
 * Resuelve y valida la sucursal sobre la que el usuario puede consultar la
 * bitácora de ventas. Lanza `FORBIDDEN_BRANCH` / `FORBIDDEN_CAPABILITY` cuando
 * el acceso no procede. Reutilizable por el endpoint de lista y el de detalle.
 */
export function resolveBranchSalesLogAccess(input: {
  session: SessionPayload;
  requestedBranchId?: string;
}): { branchId: string } {
  const { session, requestedBranchId } = input;
  const sessionBranchIds = assignedBranchIds(session);
  const branchId = requestedBranchId ?? session.primaryBranchId ?? sessionBranchIds[0];

  if (!branchId) {
    throw new Error("FORBIDDEN_BRANCH");
  }

  // Usuario global privilegiado: acceso a cualquier sucursal.
  if (isPrivilegedGlobal(session)) {
    return { branchId };
  }

  // Usuario de sucursal: debe pertenecer a la sucursal solicitada.
  if (!sessionBranchIds.includes(branchId)) {
    throw new Error("FORBIDDEN_BRANCH");
  }

  // …y poseer alguna capacidad de lectura de la bitácora en esa sucursal.
  if (!canViewSalesLogInBranch(session, branchId)) {
    throw new Error("FORBIDDEN_CAPABILITY");
  }

  return { branchId };
}

/**
 * Variante para el detalle de una venta concreta: además de resolver la
 * sucursal autorizada, valida que la venta consultada pertenezca a una sucursal
 * a la que el usuario tiene acceso. Para usuarios globales privilegiados se
 * permite cualquier sucursal de la venta.
 */
export function assertCanViewSaleInBranch(session: SessionPayload, saleBranchId: string): void {
  if (isPrivilegedGlobal(session)) return;

  const sessionBranchIds = assignedBranchIds(session);
  if (!sessionBranchIds.includes(saleBranchId)) {
    throw new Error("FORBIDDEN_BRANCH");
  }

  if (!canViewSalesLogInBranch(session, saleBranchId)) {
    throw new Error("FORBIDDEN_CAPABILITY");
  }
}
