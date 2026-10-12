import assert from "node:assert/strict";
import test from "node:test";
import {
  listOrderTemplates,
  createOrderTemplate,
  updateOrderTemplate,
  deleteOrderTemplate,
  resolveOrderTemplateForUse,
} from "@/modules/purchase-orders/order-template-service";

function buildFakeDb(opts: { templates?: Array<Record<string, unknown>>; products?: Array<Record<string, unknown>> } = {}) {
  const templates = opts.templates ?? [];
  const products = opts.products ?? [{ id: "p1", sku: "CEM-001", name: "Cemento", isActive: true, mergedIntoProductId: null }];

  return {
    orderTemplate: {
      findMany: async ({ where }: { where: { kind?: string; isActive?: boolean } }) =>
        templates
          .filter((t) => !where.kind || t.kind === where.kind)
          .filter((t) => where.isActive === undefined || t.isActive === where.isActive),
      findUnique: async ({ where }: { where: { id: string } }) => templates.find((t) => t.id === where.id) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `tpl-${templates.length + 1}`, isActive: true, ...data };
        templates.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = templates.find((t) => t.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const idx = templates.findIndex((t) => t.id === where.id);
        templates.splice(idx, 1);
        return {};
      },
    },
    product: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => products.filter((p) => where.id.in.includes(p.id as string)),
    },
  } as never;
}

test("createOrderTemplate — nombre vacío falla", async () => {
  const db = buildFakeDb();
  await assert.rejects(() => createOrderTemplate({ name: "  ", kind: "PURCHASE", branchIds: [], lines: [{ productId: "p1", quantity: 1 }], actorUserId: "u1" }, db), /VALIDATION_ERROR/);
});

test("createOrderTemplate — sin líneas falla", async () => {
  const db = buildFakeDb();
  await assert.rejects(() => createOrderTemplate({ name: "Pedido mensual", kind: "PURCHASE", branchIds: [], lines: [], actorUserId: "u1" }, db), /VALIDATION_ERROR/);
});

test("listOrderTemplates — filtra por kind y por activas por default", async () => {
  const db = buildFakeDb({
    templates: [
      { id: "t1", kind: "PURCHASE", isActive: true, name: "A" },
      { id: "t2", kind: "PURCHASE", isActive: false, name: "B" },
      { id: "t3", kind: "TRANSFER", isActive: true, name: "C" },
    ],
  });
  const purchaseTemplates = await listOrderTemplates({ kind: "PURCHASE" }, db);
  assert.deepEqual(purchaseTemplates.map((t) => t.id), ["t1"]);
});

test("updateOrderTemplate — plantilla inexistente da NOT_FOUND", async () => {
  const db = buildFakeDb();
  await assert.rejects(() => updateOrderTemplate("no-existe", { name: "X" }, db), /NOT_FOUND/);
});

test("deleteOrderTemplate — borra la plantilla", async () => {
  const db = buildFakeDb({ templates: [{ id: "t1", kind: "PURCHASE", isActive: true, name: "A" }] });
  await deleteOrderTemplate("t1", db);
  assert.deepEqual(await listOrderTemplates({}, db), []);
});

test("LA QUE IMPORTA — resolveOrderTemplateForUse saca los productos inactivos o unificados, sin bloquear el resto", async () => {
  const db = buildFakeDb({
    templates: [{
      id: "t1", kind: "PURCHASE", isActive: true, name: "Pedido típico", supplierId: null, branchIds: ["b1", "b2"],
      linesJson: [
        { productId: "p1", quantity: 10 },
        { productId: "p2", quantity: 5 },
        { productId: "p3", quantity: 3 },
      ],
    }],
    products: [
      { id: "p1", sku: "CEM-001", name: "Cemento", isActive: true, mergedIntoProductId: null },
      { id: "p2", sku: "VAR-OLD", name: "Varilla vieja", isActive: true, mergedIntoProductId: "p1" },
      { id: "p3", sku: "CLV-001", name: "Clavo", isActive: false, mergedIntoProductId: null },
    ],
  });

  const resolved = await resolveOrderTemplateForUse("t1", db);
  assert.equal(resolved.lines.length, 1, "solo p1 sobrevive — p2 está unificada, p3 está inactiva");
  assert.equal(resolved.lines[0].productId, "p1");
  assert.equal(resolved.removedProducts.length, 2);
});

test("resolveOrderTemplateForUse — plantilla inexistente da NOT_FOUND", async () => {
  const db = buildFakeDb();
  await assert.rejects(() => resolveOrderTemplateForUse("no-existe", db), /NOT_FOUND/);
});
