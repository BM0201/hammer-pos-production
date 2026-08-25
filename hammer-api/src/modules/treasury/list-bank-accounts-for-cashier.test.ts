import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { listBankAccountsForCashier } from "@/modules/treasury/service";

/**
 * Pruebas 8-9 del selector roto: GET /api/cashier/bank-accounts (route.ts)
 * es un passthrough delgado — sesión + doble verificación de permiso +
 * listBankAccountsForCashier — sin lógica propia que valga la pena aislar
 * de una petición HTTP real (este repo no monta un servidor de pruebas
 * para rutas de Next.js; ningún otro endpoint lo hace). Lo que sí importa,
 * y lo que estas pruebas cubren de verdad, es el FILTRO: que la consulta
 * nunca devuelva CUSTODY/SETTLEMENT/SAFE ni cuentas de otra sucursal — eso
 * vive 100% en listBankAccountsForCashier (treasury/service.ts), que ahora
 * acepta un `db` inyectable (mismo patrón que findSafeAccountForBranch)
 * para poder probar el filtro real contra un fake en memoria, no una
 * copia a mano del where.
 */

type FakeAccount = {
  id: string;
  isActive: boolean;
  type: "BANK" | "CUSTODY" | "SETTLEMENT" | "SAFE";
  branchId: string | null;
  bankName: string;
  accountAlias: string;
  accountNumber: string;
  currencyCode: "NIO" | "USD";
};

/** Interpreta el MISMO shape de `where` que construye listBankAccountsForCashier — no una copia de la lógica de negocio, el motor del filtro real de Prisma para esta forma exacta de query. */
function createFakeDb(accounts: FakeAccount[]) {
  return {
    treasuryAccount: {
      findMany: async ({ where, select, orderBy }: {
        where: { isActive: boolean; type: string; OR: Array<{ branchId: string | null }> };
        select?: Partial<Record<keyof FakeAccount, boolean>>;
        orderBy: Array<Record<string, "asc" | "desc">>;
      }) => {
        const allowedBranchIds = where.OR.map((c) => c.branchId);
        const rows = accounts.filter((a) =>
          a.isActive === where.isActive &&
          a.type === where.type &&
          allowedBranchIds.includes(a.branchId),
        );
        const sortKeys = orderBy.map((o) => Object.keys(o)[0] as keyof FakeAccount);
        const sorted = [...rows].sort((a, b) => {
          for (const key of sortKeys) {
            const cmp = String(a[key]).localeCompare(String(b[key]));
            if (cmp !== 0) return cmp;
          }
          return 0;
        });
        if (!select) return sorted;
        const selectedKeys = Object.keys(select) as Array<keyof FakeAccount>;
        return sorted.map((row) => Object.fromEntries(selectedKeys.map((key) => [key, row[key]])));
      },
    },
  } as unknown as Prisma.TransactionClient;
}

const BRANCH = "branch-1";
const OTHER_BRANCH = "branch-2";

const FIXTURES: FakeAccount[] = [
  { id: "bank-1", isActive: true, type: "BANK", branchId: BRANCH, bankName: "LAFISE", accountAlias: "Cuenta corriente", accountNumber: "111", currencyCode: "NIO" },
  { id: "bank-central", isActive: true, type: "BANK", branchId: null, bankName: "BAC", accountAlias: "Central", accountNumber: "222", currencyCode: "NIO" },
  { id: "bank-other-branch", isActive: true, type: "BANK", branchId: OTHER_BRANCH, bankName: "BANPRO", accountAlias: "Otra sucursal", accountNumber: "333", currencyCode: "NIO" },
  { id: "bank-inactive", isActive: false, type: "BANK", branchId: BRANCH, bankName: "BDF", accountAlias: "Cerrada", accountNumber: "444", currencyCode: "NIO" },
  { id: "custody-someone", isActive: true, type: "CUSTODY", branchId: BRANCH, bankName: "Custodia", accountAlias: "María López", accountNumber: "", currencyCode: "NIO" },
  { id: "settlement", isActive: true, type: "SETTLEMENT", branchId: null, bankName: "Adquirente", accountAlias: "Por liquidar", accountNumber: "", currencyCode: "NIO" },
  { id: "safe", isActive: true, type: "SAFE", branchId: BRANCH, bankName: "Caja fuerte", accountAlias: "Bóveda", accountNumber: "", currencyCode: "NIO" },
];

test("Prueba 8 — el selector del cajero no devuelve cuentas CUSTODY, SETTLEMENT ni SAFE", async () => {
  const db = createFakeDb(FIXTURES);
  const result = await listBankAccountsForCashier(BRANCH, db);
  const ids = result.map((r) => r.id);
  assert.ok(!ids.includes("custody-someone"), "ninguna CUSTODY — ni la propia ni la de otra persona");
  assert.ok(!ids.includes("settlement"), "ninguna SETTLEMENT");
  assert.ok(!ids.includes("safe"), "ninguna SAFE");
  assert.deepEqual(ids.sort(), ["bank-1", "bank-central"].sort(), "solo las BANK activas de esta sucursal + la central");
});

test("Prueba 9 — no devuelve cuentas de otra sucursal (ni la BANK inactiva de la propia)", async () => {
  const db = createFakeDb(FIXTURES);
  const result = await listBankAccountsForCashier(BRANCH, db);
  const ids = result.map((r) => r.id);
  assert.ok(!ids.includes("bank-other-branch"), "la cuenta de branch-2 no aparece pidiendo branch-1");
  assert.ok(!ids.includes("bank-inactive"), "una cuenta inactiva tampoco, aunque sea de esta sucursal");
});

test("una cuenta central (branchId null) SÍ aparece para cualquier sucursal que la pida", async () => {
  const db = createFakeDb(FIXTURES);
  const resultBranch1 = await listBankAccountsForCashier(BRANCH, db);
  const resultBranch2 = await listBankAccountsForCashier(OTHER_BRANCH, db);
  assert.ok(resultBranch1.some((r) => r.id === "bank-central"));
  assert.ok(resultBranch2.some((r) => r.id === "bank-central"));
});

test("no expone saldos — el select solo trae id/bankName/accountAlias/accountNumber/currencyCode", async () => {
  const db = createFakeDb(FIXTURES);
  const result = await listBankAccountsForCashier(BRANCH, db);
  const row = result.find((r) => r.id === "bank-1")!;
  assert.deepEqual(Object.keys(row).sort(), ["accountAlias", "accountNumber", "bankName", "currencyCode", "id"]);
});
