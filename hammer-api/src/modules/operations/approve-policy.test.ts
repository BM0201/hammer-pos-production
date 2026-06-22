/**
 * Tests for the operational-day approval policy + blocker computation.
 *
 * These avoid a live DB by:
 *  - exercising the pure policy helpers directly, and
 *  - passing a hand-rolled fake Prisma.TransactionClient to computeApprovalBlockers.
 *
 * Run via the project test script (node --import tsx --test).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { isHardApproveBlocker } from "@/modules/operations/approve-policy";
import {
  normalizeApprovalPolicy,
  DEFAULT_APPROVAL_POLICY,
  assertCanApproveOperationalDay,
} from "@/modules/operations/approve-policy-config";
import { computeApprovalBlockers } from "@/modules/operations/service";
import type { SessionPayload } from "@/types/auth";
import type { Prisma } from "@prisma/client";

// ─── isHardApproveBlocker ────────────────────────────────────────────────────

test("isHardApproveBlocker: cash session + pending payment son duros", () => {
  assert.equal(isHardApproveBlocker("OPEN_OR_UNREVIEWED_CASH_SESSION"), true);
  assert.equal(isHardApproveBlocker("PENDING_PAYMENT_ORDER"), true);
});

test("isHardApproveBlocker: devoluciones/anulaciones/transportes son suaves", () => {
  assert.equal(isHardApproveBlocker("PENDING_SALE_RETURN"), false);
  assert.equal(isHardApproveBlocker("PENDING_SALE_CANCELLATION"), false);
  assert.equal(isHardApproveBlocker("PENDING_TRANSPORT"), false);
  assert.equal(isHardApproveBlocker("OPEN_CREDIT_RECEIVABLE"), false);
});

// ─── normalizeApprovalPolicy ─────────────────────────────────────────────────

test("normalizeApprovalPolicy: null → defaults", () => {
  assert.deepEqual(normalizeApprovalPolicy(null), DEFAULT_APPROVAL_POLICY);
});

test("normalizeApprovalPolicy: respeta overrides válidos y null en maxSalesTotal", () => {
  const p = normalizeApprovalPolicy({
    branchAdminApprovalEnabled: true,
    maxCashDifferenceForDelegate: 250,
    autoApproveEnabled: true,
    autoApproveAfterHours: 6,
    maxSalesTotalForDelegate: null,
  });
  assert.equal(p.branchAdminApprovalEnabled, true);
  assert.equal(p.maxCashDifferenceForDelegate, 250);
  assert.equal(p.autoApproveEnabled, true);
  assert.equal(p.autoApproveAfterHours, 6);
  assert.equal(p.maxSalesTotalForDelegate, null);
});

// ─── assertCanApproveOperationalDay ──────────────────────────────────────────

function masterSession(): SessionPayload {
  return {
    userId: "u-master",
    username: "master",
    globalRoles: ["MASTER"] as unknown as SessionPayload["globalRoles"],
    branchMemberships: [],
    primaryBranchId: null,
    roleCode: "MASTER" as unknown as SessionPayload["roleCode"],
    branchIds: [],
    sessionVersion: 1,
    exp: 0,
  };
}

function branchAdminSession(branchId: string): SessionPayload {
  return {
    userId: "u-ba",
    username: "ba",
    globalRoles: [] as unknown as SessionPayload["globalRoles"],
    branchMemberships: [{ branchId, roleCode: "BRANCH_ADMIN" as unknown as SessionPayload["roleCode"] }],
    primaryBranchId: branchId,
    roleCode: "BRANCH_ADMIN" as unknown as SessionPayload["roleCode"],
    branchIds: [branchId],
    sessionVersion: 1,
    exp: 0,
  };
}

test("assertCanApprove: MASTER siempre permitido", () => {
  assert.doesNotThrow(() =>
    assertCanApproveOperationalDay(masterSession(), { branchId: "b1", cashDifferenceTotal: 99999 }, DEFAULT_APPROVAL_POLICY),
  );
});

test("assertCanApprove: BRANCH_ADMIN bloqueado si la delegación está deshabilitada", () => {
  assert.throws(
    () => assertCanApproveOperationalDay(branchAdminSession("b1"), { branchId: "b1", cashDifferenceTotal: 0 }, DEFAULT_APPROVAL_POLICY),
    /OPERATIONAL_DAY_APPROVAL_REQUIRES_MASTER/,
  );
});

test("assertCanApprove: BRANCH_ADMIN permitido dentro de umbrales", () => {
  const policy = normalizeApprovalPolicy({ branchAdminApprovalEnabled: true, maxCashDifferenceForDelegate: 100 });
  assert.doesNotThrow(() =>
    assertCanApproveOperationalDay(branchAdminSession("b1"), { branchId: "b1", cashDifferenceTotal: -50 }, policy),
  );
});

test("assertCanApprove: BRANCH_ADMIN bloqueado si diferencia de caja excede el tope", () => {
  const policy = normalizeApprovalPolicy({ branchAdminApprovalEnabled: true, maxCashDifferenceForDelegate: 100 });
  assert.throws(
    () => assertCanApproveOperationalDay(branchAdminSession("b1"), { branchId: "b1", cashDifferenceTotal: 250 }, policy),
    /OPERATIONAL_DAY_APPROVAL_REQUIRES_MASTER/,
  );
});

test("assertCanApprove: BRANCH_ADMIN bloqueado si el día fue forzado al cerrar", () => {
  const policy = normalizeApprovalPolicy({ branchAdminApprovalEnabled: true, blockDelegateOnForcedClose: true });
  assert.throws(
    () =>
      assertCanApproveOperationalDay(
        branchAdminSession("b1"),
        { branchId: "b1", cashDifferenceTotal: 0, closeChecklistJson: { canClose: false, blockers: [{ key: "x" }] } as unknown as Prisma.JsonValue },
        policy,
      ),
    /OPERATIONAL_DAY_APPROVAL_REQUIRES_MASTER/,
  );
});

test("assertCanApprove: BRANCH_ADMIN bloqueado si supera tope de ventas", () => {
  const policy = normalizeApprovalPolicy({ branchAdminApprovalEnabled: true, maxSalesTotalForDelegate: 1000 });
  assert.throws(
    () => assertCanApproveOperationalDay(branchAdminSession("b1"), { branchId: "b1", cashDifferenceTotal: 0, salesTotal: 5000 }, policy),
    /OPERATIONAL_DAY_APPROVAL_REQUIRES_MASTER/,
  );
});

// ─── computeApprovalBlockers (fake tx) ───────────────────────────────────────

type FakeData = {
  saleReturn?: unknown[];
  saleCancellation?: unknown[];
  transportService?: unknown[];
  cashSession?: unknown[];
  saleOrder?: unknown[];
};

function makeFakeTx(data: FakeData): Prisma.TransactionClient {
  const findMany = (rows: unknown[] | undefined) => async () => rows ?? [];
  return {
    saleReturn: { findMany: findMany(data.saleReturn) },
    saleCancellation: { findMany: findMany(data.saleCancellation) },
    transportService: { findMany: findMany(data.transportService) },
    cashSession: { findMany: findMany(data.cashSession) },
    saleOrder: { findMany: findMany(data.saleOrder) },
  } as unknown as Prisma.TransactionClient;
}

const DAY = { id: "day-1", branchId: "b1", businessDate: new Date("2026-06-20T00:00:00.000Z") };

test("computeApprovalBlockers: día limpio no produce bloqueadores ni warnings", async () => {
  const tx = makeFakeTx({});
  const { blockers, warnings } = await computeApprovalBlockers(tx, DAY);
  assert.equal(blockers.length, 0);
  assert.equal(warnings.length, 0);
});

test("Tarea 1: orden PENDING_PAYMENT de contado → bloqueador duro PENDING_PAYMENT_ORDER", async () => {
  const tx = makeFakeTx({
    saleOrder: [
      { id: "o1", orderNumber: "SO-1", status: "PENDING_PAYMENT", createdAt: new Date(), customerId: null, customer: null },
    ],
  });
  const { blockers, warnings } = await computeApprovalBlockers(tx, DAY);
  const codes = blockers.map((b) => b.code);
  assert.ok(codes.includes("PENDING_PAYMENT_ORDER"));
  assert.equal(warnings.length, 0);
});

test("Tarea 1: orden PENDING_PAYMENT de cliente con crédito activo → warning, no bloquea", async () => {
  const tx = makeFakeTx({
    saleOrder: [
      {
        id: "o2",
        orderNumber: "SO-2",
        status: "PENDING_PAYMENT",
        createdAt: new Date(),
        customerId: "c1",
        customer: { creditProfiles: [{ id: "cp1" }] },
      },
    ],
  });
  const { blockers, warnings } = await computeApprovalBlockers(tx, DAY);
  assert.ok(!blockers.some((b) => b.code === "PENDING_PAYMENT_ORDER"));
  assert.ok(warnings.some((w) => w.code === "OPEN_CREDIT_RECEIVABLE"));
});

test("Tarea 5: cada referencia de bloqueador lleva un hint resolve", async () => {
  const tx = makeFakeTx({
    saleReturn: [{ id: "r1", returnNumber: "RN-1", status: "REQUESTED", createdAt: new Date() }],
  });
  const { blockers } = await computeApprovalBlockers(tx, DAY);
  const ret = blockers.find((b) => b.code === "PENDING_SALE_RETURN");
  assert.ok(ret);
  assert.equal(ret!.references[0].resolve?.kind, "SALE_RETURN");
  assert.ok(ret!.references[0].resolve?.href.length);
});
