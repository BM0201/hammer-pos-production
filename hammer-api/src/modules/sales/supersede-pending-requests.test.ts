import assert from "node:assert/strict";
import test from "node:test";
import { supersedePendingRequestsForOrderTx } from "@/modules/sales/service";

/**
 * fix-anulacion-directa-cierra-solicitudes — supersedePendingRequestsForOrderTx
 * cierra las solicitudes de devolución/anulación en curso cuando Master
 * anula una orden directo. Fake tx (mismo patrón que
 * purchase-orders/payables.test.ts / treasury/account-payment.test.ts): el
 * fake findMany respeta el filtro status:{in:[...]} para que el test
 * pruebe de verdad que REJECTED/EXECUTED/CANCELLED quedan afuera, no solo
 * que la función "no falla".
 */

type FakeCancellation = { id: string; status: string; approvalRequestId: string | null };
type FakeReturn = { id: string; status: string; approvalRequestId: string | null };

function createFakeTx(seed: { cancellations?: FakeCancellation[]; returns?: FakeReturn[] }) {
  const cancellations = seed.cancellations ?? [];
  const returns = seed.returns ?? [];
  const cancellationUpdates: { id: string; status: string }[] = [];
  const returnUpdates: { id: string; status: string }[] = [];
  const approvalUpdates: { id: string; statusFilter: string[]; data: Record<string, unknown> }[] = [];
  const auditLogs: { action: string; entityType: string; entityId: string; metadataJson: unknown }[] = [];

  const tx = {
    saleCancellation: {
      findMany: async (args: { where: { saleOrderId: string; status: { in: string[] } } }) =>
        cancellations.filter((c) => args.where.status.in.includes(c.status)),
      update: async (args: { where: { id: string }; data: { status: string } }) => {
        cancellationUpdates.push({ id: args.where.id, status: args.data.status });
      },
    },
    saleReturn: {
      findMany: async (args: { where: { saleOrderId: string; status: { in: string[] } } }) =>
        returns.filter((r) => args.where.status.in.includes(r.status)),
      update: async (args: { where: { id: string }; data: { status: string } }) => {
        returnUpdates.push({ id: args.where.id, status: args.data.status });
      },
    },
    approvalRequest: {
      updateMany: async (args: { where: { id: string; status: { in: string[] } }; data: Record<string, unknown> }) => {
        approvalUpdates.push({ id: args.where.id, statusFilter: args.where.status.in, data: args.data });
        return { count: 1 };
      },
    },
    auditLog: {
      create: async (args: { data: { action: string; entityType: string; entityId: string; metadataJson: unknown } }) => {
        auditLogs.push(args.data);
      },
    },
  };

  return { tx, cancellationUpdates, returnUpdates, approvalUpdates, auditLogs };
}

test("supersedePendingRequestsForOrderTx: cierra una SaleCancellation REQUESTED a CANCELLED", async () => {
  const { tx, cancellationUpdates } = createFakeTx({
    cancellations: [{ id: "cancel-1", status: "REQUESTED", approvalRequestId: null }],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supersedePendingRequestsForOrderTx(tx as any, { saleOrderId: "order-1", actorUserId: "user-1" });
  assert.deepEqual(cancellationUpdates, [{ id: "cancel-1", status: "CANCELLED" }]);
});

test("supersedePendingRequestsForOrderTx: cierra una SaleCancellation APPROVED a CANCELLED", async () => {
  const { tx, cancellationUpdates } = createFakeTx({
    cancellations: [{ id: "cancel-2", status: "APPROVED", approvalRequestId: null }],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supersedePendingRequestsForOrderTx(tx as any, { saleOrderId: "order-1", actorUserId: "user-1" });
  assert.deepEqual(cancellationUpdates, [{ id: "cancel-2", status: "CANCELLED" }]);
});

test("supersedePendingRequestsForOrderTx: cierra un SaleReturn REQUESTED y uno APPROVED", async () => {
  const { tx, returnUpdates } = createFakeTx({
    returns: [
      { id: "return-1", status: "REQUESTED", approvalRequestId: null },
      { id: "return-2", status: "APPROVED", approvalRequestId: null },
    ],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supersedePendingRequestsForOrderTx(tx as any, { saleOrderId: "order-1", actorUserId: "user-1" });
  assert.deepEqual(
    returnUpdates.sort((a, b) => a.id.localeCompare(b.id)),
    [{ id: "return-1", status: "CANCELLED" }, { id: "return-2", status: "CANCELLED" }],
  );
});

test("supersedePendingRequestsForOrderTx: NO toca REJECTED/EXECUTED/CANCELLED", async () => {
  const { tx, cancellationUpdates, returnUpdates } = createFakeTx({
    cancellations: [
      { id: "cancel-rejected", status: "REJECTED", approvalRequestId: null },
      { id: "cancel-executed", status: "EXECUTED", approvalRequestId: null },
      { id: "cancel-cancelled", status: "CANCELLED", approvalRequestId: null },
    ],
    returns: [
      { id: "return-rejected", status: "REJECTED", approvalRequestId: null },
      { id: "return-executed", status: "EXECUTED", approvalRequestId: null },
      { id: "return-cancelled", status: "CANCELLED", approvalRequestId: null },
    ],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supersedePendingRequestsForOrderTx(tx as any, { saleOrderId: "order-1", actorUserId: "user-1" });
  assert.deepEqual(cancellationUpdates, []);
  assert.deepEqual(returnUpdates, []);
});

test("supersedePendingRequestsForOrderTx: cierra el ApprovalRequest vinculado con REJECTED y la nota fija", async () => {
  const { tx, approvalUpdates } = createFakeTx({
    cancellations: [{ id: "cancel-1", status: "REQUESTED", approvalRequestId: "approval-1" }],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supersedePendingRequestsForOrderTx(tx as any, { saleOrderId: "order-1", actorUserId: "user-1" });
  assert.equal(approvalUpdates.length, 1);
  assert.equal(approvalUpdates[0].id, "approval-1");
  assert.deepEqual(approvalUpdates[0].statusFilter, ["REQUESTED", "UNDER_REVIEW"]);
  assert.equal(approvalUpdates[0].data.status, "REJECTED");
  assert.equal(approvalUpdates[0].data.resolutionNotes, "Orden anulada directamente por Master");
  assert.equal(approvalUpdates[0].data.resolvedByUserId, "user-1");
});

test("supersedePendingRequestsForOrderTx: sin approvalRequestId, no llama a approvalRequest.updateMany", async () => {
  const { tx, approvalUpdates } = createFakeTx({
    cancellations: [{ id: "cancel-1", status: "REQUESTED", approvalRequestId: null }],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supersedePendingRequestsForOrderTx(tx as any, { saleOrderId: "order-1", actorUserId: "user-1" });
  assert.equal(approvalUpdates.length, 0);
});

test("supersedePendingRequestsForOrderTx: un auditLog por cada solicitud cerrada, con saleOrderId en la metadata", async () => {
  const { tx, auditLogs } = createFakeTx({
    cancellations: [{ id: "cancel-1", status: "REQUESTED", approvalRequestId: null }],
    returns: [{ id: "return-1", status: "APPROVED", approvalRequestId: null }],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supersedePendingRequestsForOrderTx(tx as any, { saleOrderId: "order-1", actorUserId: "user-1" });
  assert.equal(auditLogs.length, 2);
  const cancellationLog = auditLogs.find((l) => l.entityType === "SaleCancellation");
  const returnLog = auditLogs.find((l) => l.entityType === "SaleReturn");
  assert.equal(cancellationLog?.action, "SALE_CANCELLATION_SUPERSEDED");
  assert.equal(returnLog?.action, "SALE_RETURN_SUPERSEDED");
  assert.deepEqual(cancellationLog?.metadataJson, { saleOrderId: "order-1", previousStatus: "REQUESTED" });
  assert.deepEqual(returnLog?.metadataJson, { saleOrderId: "order-1", previousStatus: "APPROVED" });
});
