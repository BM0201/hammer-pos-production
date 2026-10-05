import assert from "node:assert/strict";
import test from "node:test";
import { ApprovalStatus } from "@prisma/client";
import { resolveRequestTx } from "@/modules/approvals/service";

/**
 * prompt-seguridad-basica.md Fase 1, hallazgo del barrido src/modules —
 * resolveRequest es la compuerta GENÉRICA detrás de STOCK_ADJUSTMENT/
 * DISPATCH_OVERRIDE/RETAINED_CASH_EXPENSE/PRICE_OVERRIDE: leía fuera de
 * transacción y actualizaba sin condición. Un doble click en "Aprobar"
 * pasaba el chequeo dos veces y la ruta ejecutaba la acción real (ajuste de
 * inventario, despacho forzado, gasto de caja retenida, override de precio)
 * DOS VECES — el defecto estaba un nivel arriba de las funciones ya
 * endurecidas, no en ellas.
 */

const REQUEST_ID = "approval-1";

function createApprovalFakeStore(opts: { status?: ApprovalStatus; requestedByUserId?: string } = {}) {
  const request = {
    id: REQUEST_ID,
    type: "STOCK_ADJUSTMENT",
    status: opts.status ?? ApprovalStatus.REQUESTED,
    branchId: "branch-1",
    referenceType: "Product",
    referenceId: "prod-1",
    reason: "Conteo fisico",
    payloadJson: null as unknown,
    requestedByUserId: opts.requestedByUserId ?? "user-requester",
    resolvedByUserId: null as string | null,
    resolvedAt: null as Date | null,
    resolutionNotes: null as string | null,
  };

  const auditLogs: Array<Record<string, unknown>> = [];

  const tx = {
    $queryRaw: async () => [],
    approvalRequest: {
      findUniqueOrThrow: async () => ({ ...request }),
      updateMany: async ({ where, data }: { where: { id: string; status: ApprovalStatus }; data: Record<string, unknown> }) => {
        if (where.id !== request.id || where.status !== request.status) return { count: 0 };
        Object.assign(request, data);
        return { count: 1 };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditLogs.push(data);
        return data;
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { tx, request, auditLogs };
}

test("LA QUE IMPORTA — doble click en 'Aprobar': el segundo intento falla y la ruta no ejecuta la accion real dos veces", async () => {
  const { tx, request } = createApprovalFakeStore();
  const first = await resolveRequestTx(tx, { requestId: REQUEST_ID, actorUserId: "user-reviewer", decision: "APPROVE" });
  assert.equal(first.status, "APPROVED");
  assert.equal(request.status, "APPROVED");

  await assert.rejects(
    () => resolveRequestTx(tx, { requestId: REQUEST_ID, actorUserId: "user-reviewer", decision: "APPROVE" }),
    /APPROVAL_ALREADY_RESOLVED/,
  );
  assert.equal(request.status, "APPROVED", "el segundo intento no debe tocar el estado");
});

test("auto-revision: se rechaza y queda auditado, sin resolver la solicitud", async () => {
  const { tx, request, auditLogs } = createApprovalFakeStore({ requestedByUserId: "same-user" });
  await assert.rejects(
    () => resolveRequestTx(tx, { requestId: REQUEST_ID, actorUserId: "same-user", decision: "APPROVE" }),
    /APPROVAL_SELF_REVIEW_FORBIDDEN/,
  );
  assert.equal(request.status, "REQUESTED", "la solicitud sigue pendiente, no se resuelve por auto-revision");
  assert.ok(auditLogs.some((log) => log.action === "APPROVAL_SELF_REVIEW_DENIED"));
});
