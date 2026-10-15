import assert from "node:assert/strict";
import test from "node:test";
import { listInventoryMovementsPaginated } from "@/modules/inventory/service";

/**
 * Fase 3 (prompt-entrada-inventario.md) — "los movimientos de una entrada
 * muestran 'Entrada IM-000123 (Sumar/Conteo/Carga inicial)' con enlace al
 * documento". Fake-db mínimo: solo lo que listInventoryMovementsPaginated
 * necesita (findMany/count de InventoryMovement, findMany de User y de
 * MultiBranchIntake).
 */
function buildFakeDb(opts: {
  movements: Array<{ id: string; referenceType: string; referenceId: string; userId: string | null }>;
  intakes?: Array<{ id: string; code: string; kind: string }>;
}) {
  const movements = opts.movements.map((m) => ({
    createdAt: new Date(), movementType: "ADJUSTMENT_IN", quantity: 1, unitCost: 0,
    notes: null, reason: "r", inputUnit: null, inputQuantity: null, baseUnit: null,
    product: { id: "p1", sku: "SKU-1", name: "Producto 1" }, branch: { id: "b1", code: "MGA", name: "Managua" },
    ...m,
  }));
  const intakes = opts.intakes ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake db
  const db: any = {
    inventoryMovement: {
      findMany: async () => movements,
      count: async () => movements.length,
    },
    user: { findMany: async () => [] },
    multiBranchIntake: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => intakes.filter((i) => where.id.in.includes(i.id)),
    },
  };
  return db;
}

test("LA QUE IMPORTA — un movimiento con referenceType MULTI_BRANCH_INTAKE trae code+kind del documento", async () => {
  const db = buildFakeDb({
    movements: [{ id: "mv-1", referenceType: "MULTI_BRANCH_INTAKE", referenceId: "intake-1", userId: null }],
    intakes: [{ id: "intake-1", code: "IM-000123", kind: "ADD_STOCK" }],
  });
  const result = await listInventoryMovementsPaginated({}, db);
  assert.deepEqual(result.rows[0].intakeDocument, { code: "IM-000123", kind: "ADD_STOCK" });
});

test("un movimiento de otro referenceType nunca trae intakeDocument, aunque el id coincida con uno real", async () => {
  const db = buildFakeDb({
    movements: [{ id: "mv-1", referenceType: "PURCHASE", referenceId: "intake-1", userId: null }],
    intakes: [{ id: "intake-1", code: "IM-000123", kind: "ADD_STOCK" }],
  });
  const result = await listInventoryMovementsPaginated({}, db);
  assert.equal(result.rows[0].intakeDocument, null);
});

test("un intake referenciado que ya no existe (borrado/corrupto) deja intakeDocument en null, no rompe", async () => {
  const db = buildFakeDb({
    movements: [{ id: "mv-1", referenceType: "MULTI_BRANCH_INTAKE", referenceId: "intake-ghost", userId: null }],
    intakes: [],
  });
  const result = await listInventoryMovementsPaginated({}, db);
  assert.equal(result.rows[0].intakeDocument, null);
});

test("sin ningún movimiento de entrada en la página, no se consulta MultiBranchIntake", async () => {
  let called = false;
  const db = buildFakeDb({ movements: [{ id: "mv-1", referenceType: "PURCHASE", referenceId: "po-1", userId: null }] });
  db.multiBranchIntake.findMany = async () => { called = true; return []; };
  await listInventoryMovementsPaginated({}, db);
  assert.equal(called, false, "no tiene sentido pagar la consulta si ninguna fila es de una entrada");
});
