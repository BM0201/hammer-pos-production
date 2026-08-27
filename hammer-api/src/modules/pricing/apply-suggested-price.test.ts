import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { applySuggestedPriceTx, resolveTargetBranchIds, applyPriceAcrossBranches, assertPriceApplicable } from "@/modules/pricing/service";

/**
 * Fase 0 (prompt-motor-precios-lote-herencia-gobierno.md): applySuggestedPrice
 * escribía branchPrice sin lastPriceUpdateAt/priceUpdatedByUserId/priceSource/
 * marginPercent — la Fase 1 (bandeja de precios) necesita esos cuatro campos
 * para detectar COST_CHANGED_PRICE_STALE. applySuggestedPriceTx es el cuerpo
 * transaccional, separado del wrapper (que abre prisma.$transaction) para
 * poder probarlo con un tx en memoria — mismo patrón que
 * sendCashOutToCustodyTx/postponeCashDepositTx en el módulo de tesorería.
 *
 * Fase 2: applySuggestedPrice (el wrapper que abre prisma.$transaction real
 * por sucursal) no es probable sin base de datos — mismo límite de siempre.
 * Lo que SÍ se prueba son sus dos piezas extraídas: resolveTargetBranchIds
 * (a qué sucursales aplica, inyectable con un `db` en memoria) y
 * applyPriceAcrossBranches (el bucle de aislamiento por sucursal, con
 * applyOneBranch inyectable) — la orquestación real de la Fase 2.
 */

type FakeSetting = { branchId: string; productId: string; branchPrice: Prisma.Decimal | null };

function createFakeTx(opts: { settings?: FakeSetting[] }) {
  const settings = new Map((opts.settings ?? []).map((s) => [`${s.branchId}:${s.productId}`, s]));
  const auditLogs: Array<Record<string, unknown>> = [];
  let seq = 0;

  const tx = {
    branchProductSetting: {
      findUnique: async ({ where }: { where: { branchId_productId: { branchId: string; productId: string } } }) => {
        const key = `${where.branchId_productId.branchId}:${where.branchId_productId.productId}`;
        const s = settings.get(key);
        return s ? { branchPrice: s.branchPrice } : null;
      },
      upsert: async ({ where, create, update }: { where: { branchId_productId: { branchId: string; productId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const key = `${where.branchId_productId.branchId}:${where.branchId_productId.productId}`;
        const existing = settings.get(key);
        const data = existing ? { ...existing, ...update } : { branchId: where.branchId_productId.branchId, productId: where.branchId_productId.productId, ...create };
        settings.set(key, data as FakeSetting & Record<string, unknown>);
        return data;
      },
      update: async ({ where, data }: { where: { branchId_productId: { branchId: string; productId: string } }; data: Record<string, unknown> }) => {
        const key = `${where.branchId_productId.branchId}:${where.branchId_productId.productId}`;
        const existing = settings.get(key);
        if (!existing) throw new Error(`setting ${key} no encontrado`);
        const updated = { ...existing, ...data };
        settings.set(key, updated as FakeSetting & Record<string, unknown>);
        return updated;
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        seq += 1;
        const row = { id: `audit-${seq}`, ...data };
        auditLogs.push(row);
        return row;
      },
    },
  };

  return { tx: tx as unknown as Prisma.TransactionClient, settings, auditLogs };
}

const ACTOR = "user-1";

test("Prueba 1 (LA QUE IMPORTA) — aplicar escribe lastPriceUpdateAt, priceUpdatedByUserId, priceSource y marginPercent", async () => {
  const { tx, settings } = createFakeTx({});
  const before = new Date();

  await applySuggestedPriceTx(
    tx,
    {
      productId: "product-1",
      branchId: "branch-1",
      applyScope: "BRANCH",
      suggestedPrice: 150,
      marginPercent: 28.5,
      actorUserId: ACTOR,
    },
    "branch-1",
    [],
  );

  const row = settings.get("branch-1:product-1") as unknown as Record<string, unknown>;
  assert.ok(row, "el upsert creó la fila");
  assert.equal(row.priceSource, "CALCULATED", "distinto de MANUAL — este camino viene del motor con snapshot completo");
  assert.equal(row.marginPercent, 28.5);
  assert.equal(row.priceUpdatedByUserId, ACTOR);
  assert.ok(row.lastPriceUpdateAt instanceof Date && (row.lastPriceUpdateAt as Date).getTime() >= before.getTime(), "lastPriceUpdateAt quedó poblado con la fecha real de la aplicación");
});

test("Prueba 1b — sobre una fila existente, el update también escribe los cuatro campos (no solo el create)", async () => {
  const { tx, settings } = createFakeTx({
    settings: [{ branchId: "branch-1", productId: "product-1", branchPrice: new Prisma.Decimal(100) }],
  });

  await applySuggestedPriceTx(
    tx,
    { productId: "product-1", branchId: "branch-1", applyScope: "BRANCH", suggestedPrice: 200, marginPercent: 30, actorUserId: ACTOR },
    "branch-1",
    [],
  );

  const row = settings.get("branch-1:product-1") as unknown as Record<string, unknown>;
  assert.equal(row.priceSource, "CALCULATED");
  assert.equal(row.priceUpdatedByUserId, ACTOR);
  assert.ok(row.lastPriceUpdateAt instanceof Date);
});

test("marginPercent ausente en el input queda null, no undefined ni el valor previo", async () => {
  const { tx, settings } = createFakeTx({});
  await applySuggestedPriceTx(
    tx,
    { productId: "product-1", branchId: "branch-1", applyScope: "BRANCH", suggestedPrice: 150, actorUserId: ACTOR },
    "branch-1",
    [],
  );
  const row = settings.get("branch-1:product-1") as unknown as Record<string, unknown>;
  assert.equal(row.marginPercent, null);
});

// ─── Pruebas 2-5: Fase 2 — aplicar a varias sucursales ─────────────────────

type FakeBranch = { id: string; isActive: boolean };
function createFakeBranchDb(branches: FakeBranch[]) {
  return {
    branch: {
      findMany: async ({ where }: { where: { isActive: boolean } }) => branches.filter((b) => b.isActive === where.isActive).map((b) => ({ id: b.id })),
    },
  } as unknown as Prisma.TransactionClient;
}

test("Prueba 2 — ALL_BRANCHES resuelve solo sucursales activas, ninguna inactiva", async () => {
  const db = createFakeBranchDb([
    { id: "branch-managua", isActive: true },
    { id: "branch-masaya", isActive: true },
    { id: "branch-cerrada", isActive: false },
  ]);
  const branchIds = await resolveTargetBranchIds(db, { productId: "product-1", applyScope: "ALL_BRANCHES", suggestedPrice: 150 } as any);
  assert.deepEqual([...branchIds].sort(), ["branch-managua", "branch-masaya"]);
});

test("BRANCH devuelve exactamente esa sucursal, SELECTED_BRANCHES devuelve la lista dada", async () => {
  const db = createFakeBranchDb([]);
  assert.deepEqual(await resolveTargetBranchIds(db, { productId: "p", applyScope: "BRANCH", branchId: "branch-1", suggestedPrice: 150 } as any), ["branch-1"]);
  assert.deepEqual(
    await resolveTargetBranchIds(db, { productId: "p", applyScope: "SELECTED_BRANCHES", branchIds: ["branch-1", "branch-2"], suggestedPrice: 150 } as any),
    ["branch-1", "branch-2"],
  );
});

test("Prueba 3 (LA QUE IMPORTA) — si una sucursal falla, las demás quedan aplicadas y el resultado la reporta en failed", async () => {
  const { results } = await applyPriceAcrossBranches(["branch-1", "branch-2", "branch-3"], 150, async (branchId) => {
    if (branchId === "branch-2") throw new Error("PRICE_APPLICATION_BLOCKED");
    return { previousPrice: 100, newPrice: 150, marginPercent: 30, minMarginPercent: 15 };
  });

  assert.equal(results.length, 3, "las tres sucursales aparecen en el resultado, no solo las que tuvieron éxito");
  const byBranch = new Map(results.map((r) => [r.branchId, r]));
  assert.equal(byBranch.get("branch-1")!.applied, true);
  assert.equal(byBranch.get("branch-3")!.applied, true, "branch-3 se procesó aunque branch-2 (anterior) haya fallado — cada una en su propia transacción");
  assert.equal(byBranch.get("branch-2")!.applied, false);
  assert.equal(byBranch.get("branch-2")!.error, "PRICE_APPLICATION_BLOCKED");
});

test("Prueba 4 — una entrada de auditoría por sucursal, cada una con su branchId", async () => {
  const { tx, auditLogs } = createFakeTx({});
  const branchIds = ["branch-1", "branch-2", "branch-3"];

  for (const branchId of branchIds) {
    await applySuggestedPriceTx(tx, { productId: "product-1", applyScope: "ALL_BRANCHES", suggestedPrice: 150, actorUserId: ACTOR } as any, branchId, []);
  }

  assert.equal(auditLogs.length, 3, "una entrada por sucursal, no una sola con todas adentro");
  assert.deepEqual(auditLogs.map((a) => a.branchId), branchIds, "cada entrada trae SU branchId — es lo que permite responder 'por qué Rivas tiene este precio'");
});

test("Prueba 5 — el bloqueo por precio bajo el costo interno sigue activo sin importar el alcance (aplicar en lote no lo suspende)", () => {
  const blockedInput = { suggestedPrice: 90, totalInternalCost: 100 };
  // El guard ni siquiera mira applyScope — es la prueba de que ALL_BRANCHES/
  // SELECTED_BRANCHES no tienen ningún camino que lo esquive.
  assert.throws(() => assertPriceApplicable(blockedInput), /PRICE_APPLICATION_BLOCKED/);
});
