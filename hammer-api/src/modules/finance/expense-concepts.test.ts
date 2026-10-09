import assert from "node:assert/strict";
import test from "node:test";
import { listExpenseConcepts, createExpenseConcept, updateExpenseConcept } from "@/modules/finance/expense-concepts";

function buildFakeDb(initial: Array<{ id: string; category: string; name: string; isActive: boolean; sortOrder: number }>) {
  const rows = [...initial];
  return {
    expenseConcept: {
      findMany: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy: unknown }) => {
        void orderBy;
        let filtered = rows;
        if (where.category) filtered = filtered.filter((r) => r.category === where.category);
        if (where.isActive === true) filtered = filtered.filter((r) => r.isActive);
        return [...filtered].sort((a, b) => a.category.localeCompare(b.category) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
      },
      aggregate: async ({ where }: { where: { category: string } }) => {
        const matching = rows.filter((r) => r.category === where.category);
        const max = matching.length > 0 ? Math.max(...matching.map((r) => r.sortOrder)) : null;
        return { _max: { sortOrder: max } };
      },
      create: async ({ data }: { data: { category: string; name: string; sortOrder: number } }) => {
        const row = { id: `oc-${rows.length + 1}`, isActive: true, ...data };
        rows.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<{ name: string; isActive: boolean; sortOrder: number }> }) => {
        const row = rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
  } as never;
}

test("listExpenseConcepts — solo activos por default, ordenados por categoría y sortOrder", async () => {
  const db = buildFakeDb([
    { id: "c1", category: "UTILITIES", name: "Internet", isActive: true, sortOrder: 1 },
    { id: "c2", category: "UTILITIES", name: "Agua", isActive: true, sortOrder: 0 },
    { id: "c3", category: "UTILITIES", name: "Vieja", isActive: false, sortOrder: 2 },
  ]);
  const rows = await listExpenseConcepts({}, db);
  assert.deepEqual(rows.map((r) => r.name), ["Agua", "Internet"]);
});

test("listExpenseConcepts — includeInactive trae también los desactivados", async () => {
  const db = buildFakeDb([
    { id: "c1", category: "UTILITIES", name: "Agua", isActive: true, sortOrder: 0 },
    { id: "c2", category: "UTILITIES", name: "Vieja", isActive: false, sortOrder: 1 },
  ]);
  const rows = await listExpenseConcepts({ includeInactive: true }, db);
  assert.equal(rows.length, 2);
});

test("createExpenseConcept — sin sortOrder explícito, se agrega al final de su categoría", async () => {
  const db = buildFakeDb([{ id: "c1", category: "UTILITIES", name: "Agua", isActive: true, sortOrder: 0 }]);
  const created = await createExpenseConcept({ category: "UTILITIES", name: "Internet" }, db);
  assert.equal(created.sortOrder, 1);
});

test("createExpenseConcept — nombre vacío falla", async () => {
  const db = buildFakeDb([]);
  await assert.rejects(() => createExpenseConcept({ category: "OTHER", name: "   " }, db), /VALIDATION_ERROR/);
});

test("updateExpenseConcept — desactivar no borra el nombre ni la categoría", async () => {
  const db = buildFakeDb([{ id: "c1", category: "RENT", name: "Alquiler local", isActive: true, sortOrder: 0 }]);
  const updated = await updateExpenseConcept("c1", { isActive: false }, db);
  assert.equal(updated.isActive, false);
  assert.equal(updated.name, "Alquiler local");
});

test("updateExpenseConcept — concepto inexistente falla con NOT_FOUND", async () => {
  const db = buildFakeDb([]);
  await assert.rejects(() => updateExpenseConcept("nope", { name: "X" }, db), /NOT_FOUND/);
});
