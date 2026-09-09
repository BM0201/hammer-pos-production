import assert from "node:assert/strict";
import test from "node:test";
import { countCriticalInventory } from "@/modules/dashboard/service";

/**
 * prompt-inventario-critico-fusion.md — la tarjeta "Inventario crítico" del
 * dashboard de Supervisión de Sucursal (getBranchAdminDashboardSummary)
 * contaba cada miembro DERIVADO (no canónico) de una fusión activa como
 * "crítico", porque su balance propio vive en 0 por diseño (el stock real
 * está en el canónico) — doble conteo + ruido falso. Diagnóstico contra
 * producción (2026-09-09): 183 balances con quantityOnHand<=5 sin filtro,
 * 157 con excludeDerivedStockGroupMembers() (25 derivados no-canónicos +
 * 1 inactivo excluidos) — confirmado que la causa es esta y no otra cosa.
 *
 * countCriticalInventory recibe un `db` inyectable (mismo patrón que
 * findSafeAccountForBranch en treasury/service.ts) — acá se le da un fake
 * en memoria que reproduce el where exacto que la función arma
 * (branchId/quantityOnHand/product.isActive/excludeDerivedStockGroupMembers()),
 * sin base de datos real.
 */

type FakeMembership = { isActive: boolean; isCanonical: boolean; stockGroupIsActive: boolean };
type FakeBalance = {
  branchId: string;
  productId: string;
  quantityOnHand: number;
  productIsActive: boolean;
  memberships: FakeMembership[];
};

const BRANCH_ID = "branch-1";

function buildFakeDb(balances: FakeBalance[]) {
  return {
    inventoryBalance: {
      count: async ({ where }: { where: { branchId: { in: string[] }; quantityOnHand: { lte: number }; product: { isActive: boolean } } }) => {
        return balances.filter((b) => {
          if (!where.branchId.in.includes(b.branchId)) return false;
          if (!(b.quantityOnHand <= where.quantityOnHand.lte)) return false;
          if (b.productIsActive !== where.product.isActive) return false;
          // excludeDerivedStockGroupMembers() = NOT (some membership activa,
          // no-canónica, de un stockGroup activo) — mismo predicado que
          // derivedStockGroupMemberFilter() en catalog/service.ts.
          const isDerivedMember = b.memberships.some((m) => m.isActive && !m.isCanonical && m.stockGroupIsActive);
          return !isDerivedMember;
        }).length;
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

test("producto normal (sin fusión) bajo de stock → cuenta", async () => {
  const db = buildFakeDb([
    { branchId: BRANCH_ID, productId: "prod-normal", quantityOnHand: 3, productIsActive: true, memberships: [] },
  ]);
  const count = await countCriticalInventory([BRANCH_ID], db);
  assert.equal(count, 1);
});

test("producto INACTIVO bajo de stock → NO cuenta", async () => {
  const db = buildFakeDb([
    { branchId: BRANCH_ID, productId: "prod-inactivo", quantityOnHand: 2, productIsActive: false, memberships: [] },
  ]);
  const count = await countCriticalInventory([BRANCH_ID], db);
  assert.equal(count, 0);
});

test("miembro DERIVADO (no canónico) de una fusión activa, balance en 0 → NO cuenta", async () => {
  const db = buildFakeDb([
    {
      branchId: BRANCH_ID,
      productId: "prod-derivado",
      quantityOnHand: 0,
      productIsActive: true,
      memberships: [{ isActive: true, isCanonical: false, stockGroupIsActive: true }],
    },
  ]);
  const count = await countCriticalInventory([BRANCH_ID], db);
  assert.equal(count, 0);
});

test("el CANÓNICO de esa misma fusión, bajo de stock → SÍ cuenta", async () => {
  const db = buildFakeDb([
    {
      branchId: BRANCH_ID,
      productId: "prod-derivado",
      quantityOnHand: 0,
      productIsActive: true,
      memberships: [{ isActive: true, isCanonical: false, stockGroupIsActive: true }],
    },
    {
      branchId: BRANCH_ID,
      productId: "prod-canonico",
      quantityOnHand: 4,
      productIsActive: true,
      memberships: [{ isActive: true, isCanonical: true, stockGroupIsActive: true }],
    },
  ]);
  const count = await countCriticalInventory([BRANCH_ID], db);
  assert.equal(count, 1, "solo el canónico cuenta — el derivado sigue excluido");
});

test("los cuatro casos juntos (el escenario completo del pedido) → cuenta exactamente 2", async () => {
  const db = buildFakeDb([
    { branchId: BRANCH_ID, productId: "prod-normal", quantityOnHand: 3, productIsActive: true, memberships: [] },
    { branchId: BRANCH_ID, productId: "prod-inactivo", quantityOnHand: 2, productIsActive: false, memberships: [] },
    {
      branchId: BRANCH_ID,
      productId: "prod-derivado",
      quantityOnHand: 0,
      productIsActive: true,
      memberships: [{ isActive: true, isCanonical: false, stockGroupIsActive: true }],
    },
    {
      branchId: BRANCH_ID,
      productId: "prod-canonico",
      quantityOnHand: 4,
      productIsActive: true,
      memberships: [{ isActive: true, isCanonical: true, stockGroupIsActive: true }],
    },
  ]);
  const count = await countCriticalInventory([BRANCH_ID], db);
  assert.equal(count, 2, "producto normal + canónico — inactivo y derivado quedan fuera");
});

/**
 * Diagnóstico de producción (check-critical-inventory-filter-gap.ts) —
 * membresías INACTIVAS de fusiones ya disueltas no deben excluir un
 * producto que hoy es canónico de una fusión activa (caso real: LATA DE
 * ARENA, con 3 membresías viejas inactivas de grupos disueltos + su
 * membresía canónica activa en ARENA_2).
 */
test("membresía vieja INACTIVA (fusión disuelta) no excluye un producto hoy canónico y activo", async () => {
  const db = buildFakeDb([
    {
      branchId: BRANCH_ID,
      productId: "prod-lata-arena",
      quantityOnHand: 0,
      productIsActive: true,
      memberships: [
        { isActive: false, isCanonical: false, stockGroupIsActive: false }, // fusión vieja disuelta
        { isActive: true, isCanonical: true, stockGroupIsActive: true }, // fusión actual, canónico
      ],
    },
  ]);
  const count = await countCriticalInventory([BRANCH_ID], db);
  assert.equal(count, 1, "la membresía inactiva no debe tapar que hoy es canónico de una fusión activa");
});

test("branchIds filtra correctamente — un balance de otra sucursal no cuenta", async () => {
  const db = buildFakeDb([
    { branchId: "branch-otra", productId: "prod-normal", quantityOnHand: 1, productIsActive: true, memberships: [] },
  ]);
  const count = await countCriticalInventory([BRANCH_ID], db);
  assert.equal(count, 0);
});
