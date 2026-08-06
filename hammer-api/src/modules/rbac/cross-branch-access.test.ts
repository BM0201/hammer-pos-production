/**
 * ════════════════════════════════════════════════════════════════
 * CROSS-BRANCH ACCESS (ANTI-IDOR) — Suite parametrizada
 *
 * ⚠️ CONTRATO PARA TODO ENDPOINT NUEVO:
 * Si agregas un endpoint que recibe un `branchId` o que opera sobre un
 * recurso scoped a sucursal (venta, pago, sesión de caja, inventario,
 * membresía, etc.), AGREGA SU CASO a `CRITICAL_BRANCH_OPERATIONS` abajo.
 * El riesgo real en un sistema multi-sucursal no es el diseño de los
 * guards (ya existe: guards.ts + effective-permissions.ts), es que un
 * endpoint futuro olvide aplicarlos. Esta suite hace que el chequeo no
 * dependa de la memoria de cada desarrollador.
 *
 * Qué verifica por cada operación crítica:
 *  1. Un usuario con membresía SOLO en la Sucursal A NO puede usar la
 *     capability en la Sucursal B (requireBranchCapability lanza FORBIDDEN).
 *  2. hasBranchAccess(session, B) === false (lectura scoped denegada).
 *  3. Control positivo: la misma operación SÍ pasa en su propia sucursal
 *     (si el guard fallara "cerrado para todos", el test lo detectaría).
 *  4. getBranchIdsWithCapability nunca incluye la sucursal ajena.
 * ════════════════════════════════════════════════════════════════
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { RoleCode } from "@prisma/client";
import type { SessionPayload } from "@/types/auth";
import {
  requireBranchCapability,
  hasBranchAccess,
  hasBranchRole,
  getBranchIdsWithCapability,
  canInBranch,
  isMaster,
} from "@/modules/rbac/guards";
import { CAPABILITIES, type Capability } from "@/modules/rbac/policies";

const BRANCH_A = "branch-a-managua";
const BRANCH_B = "branch-b-masaya";

function sessionOnlyInBranchA(roleCode: RoleCode): SessionPayload {
  return {
    userId: "user-branch-a",
    username: "empleado.a",
    globalRoles: [],
    branchMemberships: [{ branchId: BRANCH_A, roleCode }],
    primaryBranchId: BRANCH_A,
    roleCode,
    branchIds: [BRANCH_A],
    sessionVersion: 0,
    exp: Date.now() + 60_000,
  };
}

/**
 * Operaciones críticas del sistema, mapeadas al endpoint que las expone y a
 * la capability que su guard exige. El `role` es el rol de sucursal que SÍ
 * tiene esa capability (control positivo en la sucursal propia).
 */
const CRITICAL_BRANCH_OPERATIONS: Array<{
  endpoint: string;
  capability: Capability;
  role: RoleCode;
}> = [
  // ── Ventas ──
  { endpoint: "POST /api/branch/sales/orders (crear venta)", capability: CAPABILITIES.POS_SELL, role: "SALES" },
  { endpoint: "POST /api/branch/sales/drafts (borradores)", capability: CAPABILITIES.SALES_DRAFT_MANAGE, role: "SALES" },
  { endpoint: "POST .../send-to-cashier (enviar a cobro)", capability: CAPABILITIES.POS_SEND_TO_CASHIER, role: "SALES" },
  { endpoint: "GET /api/branch/sales (historial)", capability: CAPABILITIES.SALES_VIEW, role: "SALES" },
  { endpoint: "POST .../returns (solicitar devolución)", capability: CAPABILITIES.SALE_RETURN_REQUEST, role: "CASHIER" },
  { endpoint: "POST .../returns/approve (aprobar devolución)", capability: CAPABILITIES.SALE_RETURN_APPROVE, role: "BRANCH_ADMIN" },
  { endpoint: "POST .../cancellations/approve", capability: CAPABILITIES.SALE_CANCELLATION_APPROVE, role: "BRANCH_ADMIN" },
  // ── Pagos / Caja ──
  { endpoint: "POST /api/branch/payments/collect (cobrar)", capability: CAPABILITIES.PAYMENT_COLLECT, role: "CASHIER" },
  { endpoint: "POST /api/branch/payments/refund", capability: CAPABILITIES.PAYMENT_REFUND, role: "BRANCH_ADMIN" },
  { endpoint: "POST /api/branch/cash-session (abrir caja)", capability: CAPABILITIES.CASH_SESSION_OPEN, role: "BRANCH_ADMIN" },
  { endpoint: "POST .../cash-session/use (operar caja)", capability: CAPABILITIES.CASH_SESSION_USE, role: "CASHIER" },
  { endpoint: "POST .../cash-session/close-final", capability: CAPABILITIES.CASH_SESSION_CLOSE_FINAL, role: "BRANCH_ADMIN" },
  { endpoint: "POST .../cash-movements (movimiento de caja)", capability: CAPABILITIES.CASH_MOVEMENT_CREATE, role: "CASHIER" },
  { endpoint: "POST .../cash-movements/approve", capability: CAPABILITIES.CASH_MOVEMENT_APPROVE, role: "BRANCH_ADMIN" },
  // ── Inventario / Bodega ──
  { endpoint: "POST /api/branch/inventory/adjust", capability: CAPABILITIES.INVENTORY_ADJUST, role: "WAREHOUSE" },
  { endpoint: "POST .../inventory/movements (postear movimiento)", capability: CAPABILITIES.INVENTORY_MOVEMENT_POST, role: "WAREHOUSE" },
  { endpoint: "POST .../dispatch/mark (despachar)", capability: CAPABILITIES.DISPATCH_MARK, role: "WAREHOUSE" },
  { endpoint: "POST .../damaged-inventory/adjust", capability: CAPABILITIES.DAMAGED_INVENTORY_ADJUST, role: "WAREHOUSE" },
  // ── Día operativo ──
  { endpoint: "POST /api/operations/day/open", capability: CAPABILITIES.OPERATIONAL_DAY_OPEN, role: "BRANCH_ADMIN" },
  { endpoint: "POST /api/operations/day/close", capability: CAPABILITIES.OPERATIONAL_DAY_CLOSE, role: "BRANCH_ADMIN" },
];

for (const { endpoint, capability, role } of CRITICAL_BRANCH_OPERATIONS) {
  test(`anti-IDOR: ${endpoint} — ${role} de Sucursal A no puede en Sucursal B`, () => {
    const session = sessionOnlyInBranchA(role);

    // Control positivo: el rol sí tiene la capability en SU sucursal.
    assert.equal(
      canInBranch(session, BRANCH_A, capability),
      true,
      `control positivo roto: ${role} debería poder "${capability}" en su propia sucursal`,
    );
    assert.doesNotThrow(() => requireBranchCapability(session, BRANCH_A, capability));

    // Denegación cross-branch: misma capability, recurso de OTRA sucursal.
    assert.equal(canInBranch(session, BRANCH_B, capability), false);
    assert.throws(
      () => requireBranchCapability(session, BRANCH_B, capability),
      /FORBIDDEN/,
      `${endpoint}: debería lanzar FORBIDDEN para la Sucursal B`,
    );

    // El listado de sucursales con la capability nunca incluye la ajena.
    const branchIds = getBranchIdsWithCapability(session, capability);
    assert.ok(!branchIds.includes(BRANCH_B), "getBranchIdsWithCapability filtró mal");
  });
}

// ─── Acceso de lectura scoped (hasBranchAccess / hasBranchRole) ──

test("anti-IDOR: hasBranchAccess niega la sucursal ajena para todos los roles de sucursal", () => {
  for (const role of ["BRANCH_ADMIN", "SALES", "CASHIER", "WAREHOUSE"] as RoleCode[]) {
    const session = sessionOnlyInBranchA(role);
    assert.equal(hasBranchAccess(session, BRANCH_A), true);
    assert.equal(hasBranchAccess(session, BRANCH_B), false, `${role}: acceso cruzado permitido`);
    assert.equal(hasBranchRole(session, BRANCH_B, [role]), false);
  }
});

test("anti-IDOR: sesión null nunca pasa un guard de sucursal", () => {
  assert.equal(hasBranchAccess(null, BRANCH_A), false);
  assert.equal(canInBranch(null, BRANCH_A, CAPABILITIES.POS_SELL), false);
  assert.throws(() => requireBranchCapability(null, BRANCH_A, CAPABILITIES.POS_SELL), /FORBIDDEN/);
});

// ─── Endpoints de Master (usuarios) ──────────────────────────────

test("anti-IDOR: un rol de sucursal nunca califica como MASTER (rutas /api/master/users)", () => {
  for (const role of ["BRANCH_ADMIN", "SALES", "CASHIER", "WAREHOUSE"] as RoleCode[]) {
    const session = sessionOnlyInBranchA(role);
    assert.equal(isMaster(session), false, `${role} no debe pasar assertMaster`);
  }
});

test("anti-IDOR: MASTER global sí tiene acceso a cualquier sucursal (bypass documentado)", () => {
  const master: SessionPayload = {
    ...sessionOnlyInBranchA("MASTER"),
    globalRoles: ["MASTER" as RoleCode],
    branchMemberships: [],
    branchIds: [],
    primaryBranchId: null,
  };
  assert.equal(isMaster(master), true);
  assert.equal(hasBranchAccess(master, BRANCH_B), true);
  assert.doesNotThrow(() => requireBranchCapability(master, BRANCH_B, CAPABILITIES.POS_SELL));
});
