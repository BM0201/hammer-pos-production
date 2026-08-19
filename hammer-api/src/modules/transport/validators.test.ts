/**
 * ════════════════════════════════════════════════════════════════
 * TRANSPORT VALIDATORS — Unit Tests
 * ════════════════════════════════════════════════════════════════
 */
import assert from "node:assert/strict";
import test from "node:test";
import { TransportServiceStatus } from "@prisma/client";
import {
  createTransportSchema,
  updateTransportStatusSchema,
  validateTransportTransition,
} from "@/modules/transport/validators";

// ─── createTransportSchema ──────────────────────────────────────

test("transport: valid createTransportSchema passes", () => {
  const result = createTransportSchema.safeParse({
    saleOrderId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
    branchId: "clyyyyyyyyyyyyyyyyyyyyyyyyy",
    customerName: "Juan Perez",
    price: 150.5,
  });
  assert.equal(result.success, true);
});

test("transport: createTransportSchema rejects empty customerName", () => {
  const result = createTransportSchema.safeParse({
    saleOrderId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
    branchId: "clyyyyyyyyyyyyyyyyyyyyyyyyy",
    customerName: "",
    price: 100,
  });
  assert.equal(result.success, false);
});

test("transport: createTransportSchema rejects zero price", () => {
  const result = createTransportSchema.safeParse({
    saleOrderId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
    branchId: "clyyyyyyyyyyyyyyyyyyyyyyyyy",
    customerName: "Test",
    price: 0,
  });
  assert.equal(result.success, false);
});

test("transport: createTransportSchema rejects negative price", () => {
  const result = createTransportSchema.safeParse({
    saleOrderId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
    branchId: "clyyyyyyyyyyyyyyyyyyyyyyyyy",
    customerName: "Test",
    price: -10,
  });
  assert.equal(result.success, false);
});

// ─── updateTransportStatusSchema ────────────────────────────────

test("transport: updateTransportStatusSchema accepts valid status", () => {
  const result = updateTransportStatusSchema.safeParse({ status: "IN_TRANSIT" });
  assert.equal(result.success, true);
});

test("transport: updateTransportStatusSchema rejects invalid status", () => {
  const result = updateTransportStatusSchema.safeParse({ status: "FLYING" });
  assert.equal(result.success, false);
});

// ─── validateTransportTransition ────────────────────────────────

test("transport: PENDING -> IN_TRANSIT is valid", () => {
  assert.equal(
    validateTransportTransition(TransportServiceStatus.PENDING, TransportServiceStatus.IN_TRANSIT),
    true,
  );
});

test("transport: PENDING -> CANCELLED is valid", () => {
  assert.equal(
    validateTransportTransition(TransportServiceStatus.PENDING, TransportServiceStatus.CANCELLED),
    true,
  );
});

test("transport: PENDING -> DELIVERED is invalid", () => {
  assert.equal(
    validateTransportTransition(TransportServiceStatus.PENDING, TransportServiceStatus.DELIVERED),
    false,
  );
});

test("transport: IN_TRANSIT -> DELIVERED is valid", () => {
  assert.equal(
    validateTransportTransition(TransportServiceStatus.IN_TRANSIT, TransportServiceStatus.DELIVERED),
    true,
  );
});

test("transport: DELIVERED -> CANCELLED is invalid (terminal)", () => {
  assert.equal(
    validateTransportTransition(TransportServiceStatus.DELIVERED, TransportServiceStatus.CANCELLED),
    false,
  );
});

test("transport: CANCELLED -> PENDING is invalid (terminal)", () => {
  assert.equal(
    validateTransportTransition(TransportServiceStatus.CANCELLED, TransportServiceStatus.PENDING),
    false,
  );
});
