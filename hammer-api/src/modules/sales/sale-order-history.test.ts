import assert from "node:assert/strict";
import test from "node:test";
import { canViewSalesHistoryForBranch, getSaleOrderDetailForManagement } from "@/modules/sales/service";

/**
 * prompt-historial-sucursal.md Fase 1 — GET /api/sales/order-history y
 * /[id] (hermanas de las rutas master, acotadas a una sucursal).
 *
 * canViewSalesHistoryForBranch fija la decisión que comparten las dos
 * rutas nuevas (403 en la lista, 404 en el detalle, mismo booleano). Ni
 * canInBranch ni isMaster se vuelven a testear acá — ya están cubiertos en
 * rbac/cross-branch-access.test.ts; esto solo prueba la combinación real
 * que usan las rutas.
 *
 * getSaleOrderDetailForManagement no seguía (ni sigue) el patrón
 * tx-inyectable de otros módulos de esta sesión — se le agregó un
 * parámetro `db` inyectable (igual que DbClient en
 * purchase-orders/payables.ts) solo para poder probar includeAuditHistory
 * sin una base real.
 */

test("canViewSalesHistoryForBranch: Master siempre pasa, aunque no tenga la capability", () => {
  assert.equal(canViewSalesHistoryForBranch(true, false), true);
});

test("canViewSalesHistoryForBranch: sucursal con SALES_VIEW pasa", () => {
  assert.equal(canViewSalesHistoryForBranch(false, true), true);
});

test("canViewSalesHistoryForBranch: sucursal sin SALES_VIEW no pasa", () => {
  assert.equal(canViewSalesHistoryForBranch(false, false), false);
});

function fakeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    orderNumber: "SO-B1-1",
    status: "PAID",
    requiresTransport: false,
    transportAmount: 0,
    createdAt: new Date("2026-09-01T10:00:00Z"),
    updatedAt: new Date("2026-09-01T10:00:00Z"),
    notes: null,
    branch: { id: "branch-1", code: "B1", name: "Sucursal 1" },
    createdBy: null,
    customer: null,
    subtotal: 100,
    discountTotal: 0,
    taxTotal: 0,
    grandTotal: 100,
    documentMode: null,
    requiresManualInvoice: false,
    manualInvoiceSeries: null,
    manualInvoiceNumber: null,
    manualInvoiceDate: null,
    manualInvoiceCustomerName: null,
    manualInvoiceCustomerRuc: null,
    manualInvoiceStatus: "NONE",
    manualInvoiceRegisteredBy: null,
    manualInvoiceRegisteredAt: null,
    manualInvoiceNotes: null,
    lines: [],
    payments: [],
    returns: [],
    cancellations: [
      { id: "cancel-1", status: "REQUESTED", reason: "Cliente se arrepintió", createdAt: new Date("2026-09-02T10:00:00Z"), executedAt: null },
    ],
    ...overrides,
  };
}

function fakeDb(order: ReturnType<typeof fakeOrder> | null, auditLogCalls: { count: number }) {
  return {
    saleOrder: { findUnique: async () => order },
    auditLog: {
      findMany: async () => {
        auditLogCalls.count += 1;
        return [{ id: "log-1", occurredAt: new Date(), action: "TEST", module: "sales", metadataJson: null, actor: null }];
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

test("getSaleOrderDetailForManagement: includeAuditHistory=false no consulta auditLog y devuelve auditTrail vacío", async () => {
  const auditLogCalls = { count: 0 };
  const db = fakeDb(fakeOrder(), auditLogCalls);
  const result = await getSaleOrderDetailForManagement("order-1", { includeAuditHistory: false }, db);
  assert.equal(auditLogCalls.count, 0);
  assert.deepEqual(result.auditTrail, []);
});

test("getSaleOrderDetailForManagement: includeAuditHistory=true sí consulta auditLog (comportamiento de master sin cambios)", async () => {
  const auditLogCalls = { count: 0 };
  const db = fakeDb(fakeOrder(), auditLogCalls);
  const result = await getSaleOrderDetailForManagement("order-1", { includeAuditHistory: true }, db);
  assert.equal(auditLogCalls.count, 1);
  assert.equal(result.auditTrail.length, 1);
});

test("getSaleOrderDetailForManagement: expone cancellations mapeadas", async () => {
  const db = fakeDb(fakeOrder(), { count: 0 });
  const result = await getSaleOrderDetailForManagement("order-1", { includeAuditHistory: false }, db);
  assert.equal(result.cancellations.length, 1);
  assert.equal(result.cancellations[0].id, "cancel-1");
  assert.equal(result.cancellations[0].status, "REQUESTED");
  assert.equal(result.cancellations[0].reason, "Cliente se arrepintió");
  assert.equal(result.cancellations[0].executedAt, null);
});

test("getSaleOrderDetailForManagement: sin cancelaciones devuelve arreglo vacío", async () => {
  const db = fakeDb(fakeOrder({ cancellations: [] }), { count: 0 });
  const result = await getSaleOrderDetailForManagement("order-1", { includeAuditHistory: false }, db);
  assert.deepEqual(result.cancellations, []);
});
