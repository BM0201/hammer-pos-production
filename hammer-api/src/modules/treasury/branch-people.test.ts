import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { listBranchPeopleForCashHandover } from "@/modules/treasury/service";

/**
 * Parte A.4 (prompt-destino-efectivo-rediseno.md) — /api/branches/[id]/members
 * solo mira UserBranchRole: Master, si solo vive en User.globalRole sin
 * membresía de sucursal, no aparecía en ningún selector — y "yo se lo llevo
 * a alguien" existe justamente para poder entregarle a Master.
 * listBranchPeopleForCashHandover une membresía de sucursal + globalRole
 * MASTER/OWNER, contra un `db` en memoria (mismo patrón que
 * getLastDepositCutoff/sendCashOutToCustodyTx) — es de solo lectura, no
 * necesita transacción real.
 */

type FakeRole = { userId: string; branchId: string; roleCode: string; isActive: boolean };
type FakeUser = { id: string; fullName: string; isActive: boolean; globalRole: string | null };

function createFakeDb(opts: { roles: FakeRole[]; users: FakeUser[] }) {
  const users = new Map(opts.users.map((u) => [u.id, u]));

  const db = {
    userBranchRole: {
      findMany: async ({ where }: { where: { branchId: string; isActive: boolean; user: { isActive: boolean; id: { not: string } } } }) => {
        const rows: Array<{ roleCode: string; user: { id: string; fullName: string } }> = [];
        for (const r of opts.roles) {
          if (r.branchId !== where.branchId || r.isActive !== where.isActive) continue;
          if (r.userId === where.user.id.not) continue;
          const u = users.get(r.userId);
          if (!u || u.isActive !== where.user.isActive) continue;
          rows.push({ roleCode: r.roleCode, user: { id: u.id, fullName: u.fullName } });
        }
        return rows;
      },
    },
    user: {
      findMany: async ({ where }: { where: { isActive: boolean; id: { not: string }; globalRole: { in: string[] } } }) =>
        [...users.values()]
          .filter((u) => u.isActive === where.isActive && u.id !== where.id.not && u.globalRole !== null && where.globalRole.in.includes(u.globalRole))
          .map((u) => ({ id: u.id, fullName: u.fullName, globalRole: u.globalRole })),
    },
  };

  return { db: db as unknown as Prisma.TransactionClient };
}

test("Prueba 7 (LA QUE IMPORTA) — devuelve un Master que NO tiene UserBranchRole en esa sucursal", async () => {
  const master: FakeUser = { id: "user-master", fullName: "Elena Bermúdez", isActive: true, globalRole: "MASTER" };
  const cashier: FakeUser = { id: "user-cashier", fullName: "Juan Cajero", isActive: true, globalRole: "CASHIER" };
  const { db } = createFakeDb({
    roles: [{ userId: "user-cashier", branchId: "branch-1", roleCode: "CASHIER", isActive: true }],
    users: [master, cashier],
  });
  const result = await listBranchPeopleForCashHandover(db, "branch-1", "user-someone-else");
  const found = result.find((p) => p.id === "user-master");
  assert.ok(found, "Master aparece aunque no tenga UserBranchRole en la sucursal — es exactamente el caso que motivó este endpoint");
  assert.equal(found?.roleLabel, "Master");
});

test("Prueba 8 — no devuelve al usuario de sesión, sea cual sea su fuente (membresía de sucursal o globalRole)", async () => {
  const master: FakeUser = { id: "user-master", fullName: "Elena Bermúdez", isActive: true, globalRole: "MASTER" };
  const cashier: FakeUser = { id: "user-cashier", fullName: "Juan Cajero", isActive: true, globalRole: "CASHIER" };
  const { db } = createFakeDb({
    roles: [{ userId: "user-cashier", branchId: "branch-1", roleCode: "CASHIER", isActive: true }],
    users: [master, cashier],
  });
  const resultExcludingCashier = await listBranchPeopleForCashHandover(db, "branch-1", "user-cashier");
  assert.ok(!resultExcludingCashier.some((p) => p.id === "user-cashier"), "el cajero de sucursal queda afuera cuando es el actor");

  const resultExcludingMaster = await listBranchPeopleForCashHandover(db, "branch-1", "user-master");
  assert.ok(!resultExcludingMaster.some((p) => p.id === "user-master"), "el Master global queda afuera cuando es el actor");
});

test("Prueba 9 — no devuelve usuarios inactivos ni de otra sucursal", async () => {
  const inactiveCashier: FakeUser = { id: "user-inactive", fullName: "Ex Empleado", isActive: false, globalRole: "CASHIER" };
  const otherBranchCashier: FakeUser = { id: "user-other-branch", fullName: "De otra sucursal", isActive: true, globalRole: "CASHIER" };
  const inactiveMaster: FakeUser = { id: "user-master-inactive", fullName: "Master Ex", isActive: false, globalRole: "MASTER" };
  const { db } = createFakeDb({
    roles: [
      { userId: "user-inactive", branchId: "branch-1", roleCode: "CASHIER", isActive: true },
      { userId: "user-other-branch", branchId: "branch-2", roleCode: "CASHIER", isActive: true },
    ],
    users: [inactiveCashier, otherBranchCashier, inactiveMaster],
  });
  const result = await listBranchPeopleForCashHandover(db, "branch-1", "user-someone-else");
  assert.equal(result.length, 0, "inactivo, otra sucursal e inactivo-Master quedan todos afuera");
});

test("Prueba 10 — un usuario con membresía de sucursal Y globalRole MASTER/OWNER aparece una sola vez, con el rol de sucursal (más específico)", async () => {
  const ownerWithBranchRole: FakeUser = { id: "user-owner-branch", fullName: "Elena Bermúdez", isActive: true, globalRole: "OWNER" };
  const { db } = createFakeDb({
    roles: [{ userId: "user-owner-branch", branchId: "branch-1", roleCode: "BRANCH_ADMIN", isActive: true }],
    users: [ownerWithBranchRole],
  });
  const result = await listBranchPeopleForCashHandover(db, "branch-1", "user-someone-else");
  assert.equal(result.filter((p) => p.id === "user-owner-branch").length, 1, "aparece una sola vez, no duplicado por las dos fuentes");
  assert.equal(result[0].roleLabel, "Administradora de sucursal", "el rol de sucursal gana sobre el globalRole cuando la persona tiene ambos");
});
