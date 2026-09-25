/**
 * ════════════════════════════════════════════════════════════════
 * API ERROR RESPONSES — Unit Tests
 * ════════════════════════════════════════════════════════════════
 */
import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { toApiErrorResponse, parseJsonBody } from "@/lib/api/errors";

async function jsonBody(response: Response) {
  return response.json();
}

// ─── ZodError handling ──────────────────────────────────────────

test("errors: ZodError returns 400 VALIDATION_ERROR", async () => {
  const schema = z.object({ name: z.string() });
  const err = schema.safeParse({});
  assert.equal(err.success, false);
  if (!err.success) {
    const res = toApiErrorResponse(err.error);
    assert.equal(res.status, 400);
    const body = await jsonBody(res);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "VALIDATION_ERROR");
  }
});

// ─── Auth errors ────────────────────────────────────────────────

test("errors: UNAUTHENTICATED returns 401", async () => {
  const res = toApiErrorResponse(new Error("UNAUTHENTICATED"));
  assert.equal(res.status, 401);
  const body = await jsonBody(res);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "UNAUTHENTICATED");
});

test("errors: NOT_AUTHENTICATED returns 401", async () => {
  const res = toApiErrorResponse(new Error("NOT_AUTHENTICATED"));
  assert.equal(res.status, 401);
});

// ─── Forbidden errors ───────────────────────────────────────────

test("errors: FORBIDDEN_BRANCH returns 403", async () => {
  const res = toApiErrorResponse(new Error("FORBIDDEN_BRANCH"));
  assert.equal(res.status, 403);
  const body = await jsonBody(res);
  assert.equal(body.error.code, "FORBIDDEN");
});

test("errors: FORBIDDEN_CAPABILITY returns 403", async () => {
  const res = toApiErrorResponse(new Error("FORBIDDEN_CAPABILITY"));
  assert.equal(res.status, 403);
});

test("errors: FORBIDDEN_MASTER_ONLY returns 403", async () => {
  const res = toApiErrorResponse(new Error("FORBIDDEN_MASTER_ONLY"));
  assert.equal(res.status, 403);
});

// ─── Workflow module errors ─────────────────────────────────────

test("errors: CASHIER_MODULE_DISABLED returns 403", async () => {
  const res = toApiErrorResponse(new Error("CASHIER_MODULE_DISABLED"));
  assert.equal(res.status, 403);
  const body = await jsonBody(res);
  assert.equal(body.ok, false);
  assert.match(body.error.message, /caja/i);
});

test("errors: CASHIER_MODULE_ENABLED returns 403", async () => {
  const res = toApiErrorResponse(new Error("CASHIER_MODULE_ENABLED"));
  assert.equal(res.status, 403);
});

test("errors: DISPATCH_MODULE_DISABLED returns 403", async () => {
  const res = toApiErrorResponse(new Error("DISPATCH_MODULE_DISABLED"));
  assert.equal(res.status, 403);
});

// ─── Conflict errors ────────────────────────────────────────────

test("errors: INSUFFICIENT_STOCK returns 409", async () => {
  const res = toApiErrorResponse(new Error("INSUFFICIENT_STOCK"));
  assert.equal(res.status, 409);
});

test("errors: PAYMENT_ALREADY_POSTED returns 409", async () => {
  const res = toApiErrorResponse(new Error("PAYMENT_ALREADY_POSTED"));
  assert.equal(res.status, 409);
});

// ─── Not found ──────────────────────────────────────────────────

test("errors: NOT_FOUND returns 404", async () => {
  const res = toApiErrorResponse(new Error("NOT_FOUND"));
  assert.equal(res.status, 404);
});

// ─── Sale returns (prompt-pendientes-2026-09.md Fase 3) ─────────
// Antes de esto, ninguno de estos codigos estaba mapeado y todos caian en
// el 500 generico — ver el comentario en errors.ts. Cada uno conserva su
// propio code (no "CONFLICT" genérico) para que el mapa de mensajes del
// frontend (que busca por code) pueda distinguirlos.

test("errors: SALE_ORDER_NOT_RETURNABLE returns 409 with its own code", async () => {
  const res = toApiErrorResponse(new Error("SALE_ORDER_NOT_RETURNABLE"));
  assert.equal(res.status, 409);
  const body = await jsonBody(res);
  assert.equal(body.error.code, "SALE_ORDER_NOT_RETURNABLE");
});

test("errors: SALE_ORDER_NOT_PAID returns 409 with its own code", async () => {
  const res = toApiErrorResponse(new Error("SALE_ORDER_NOT_PAID"));
  assert.equal(res.status, 409);
  const body = await jsonBody(res);
  assert.equal(body.error.code, "SALE_ORDER_NOT_PAID");
});

test("errors: SALE_RETURN_QUANTITY_EXCEEDS_SOLD returns 400", async () => {
  const res = toApiErrorResponse(new Error("SALE_RETURN_QUANTITY_EXCEEDS_SOLD"));
  assert.equal(res.status, 400);
  const body = await jsonBody(res);
  assert.equal(body.error.code, "SALE_RETURN_QUANTITY_EXCEEDS_SOLD");
});

test("errors: RETURN_ITEM_* codes return 400", async () => {
  const res = toApiErrorResponse(new Error("RETURN_ITEM_GOOD_MUST_GO_TO_SELLABLE"));
  assert.equal(res.status, 400);
});

test("errors: SALE_RETURN_NOT_REQUESTED returns 409 with its own code", async () => {
  const res = toApiErrorResponse(new Error("SALE_RETURN_NOT_REQUESTED"));
  assert.equal(res.status, 409);
  const body = await jsonBody(res);
  assert.equal(body.error.code, "SALE_RETURN_NOT_REQUESTED");
});

test("errors: SALE_CANCELLATION_NOT_REQUESTED returns 409 with its own code", async () => {
  const res = toApiErrorResponse(new Error("SALE_CANCELLATION_NOT_REQUESTED"));
  assert.equal(res.status, 409);
  const body = await jsonBody(res);
  assert.equal(body.error.code, "SALE_CANCELLATION_NOT_REQUESTED");
});

test("errors: SALE_RETURN_NOT_APPROVED returns 409 with its own code", async () => {
  const res = toApiErrorResponse(new Error("SALE_RETURN_NOT_APPROVED"));
  assert.equal(res.status, 409);
  const body = await jsonBody(res);
  assert.equal(body.error.code, "SALE_RETURN_NOT_APPROVED");
});

test("errors: SALE_RETURN_ALREADY_EXECUTED returns 409 with its own code", async () => {
  const res = toApiErrorResponse(new Error("SALE_RETURN_ALREADY_EXECUTED"));
  assert.equal(res.status, 409);
  const body = await jsonBody(res);
  assert.equal(body.error.code, "SALE_RETURN_ALREADY_EXECUTED");
});

test("errors: CASH_SESSION_REQUIRED_FOR_CASH_REFUND returns 400", async () => {
  const res = toApiErrorResponse(new Error("CASH_SESSION_REQUIRED_FOR_CASH_REFUND"));
  assert.equal(res.status, 400);
  const body = await jsonBody(res);
  assert.equal(body.error.code, "CASH_SESSION_REQUIRED_FOR_CASH_REFUND");
});

test("errors: REFUND_EXCEEDS_AMOUNT_PAID returns 409 with its own code", async () => {
  const res = toApiErrorResponse(new Error("REFUND_EXCEEDS_AMOUNT_PAID"));
  assert.equal(res.status, 409);
  const body = await jsonBody(res);
  assert.equal(body.error.code, "REFUND_EXCEEDS_AMOUNT_PAID");
});

test("errors: REFUND_METHOD_MISMATCH_REQUIRES_MASTER_EXCEPTION returns 409 with its own code", async () => {
  const res = toApiErrorResponse(new Error("REFUND_METHOD_MISMATCH_REQUIRES_MASTER_EXCEPTION"));
  assert.equal(res.status, 409);
  const body = await jsonBody(res);
  assert.equal(body.error.code, "REFUND_METHOD_MISMATCH_REQUIRES_MASTER_EXCEPTION");
});

test("errors: CUSTOMER_REQUIRED_FOR_CREDIT_NOTE returns 400", async () => {
  const res = toApiErrorResponse(new Error("CUSTOMER_REQUIRED_FOR_CREDIT_NOTE"));
  assert.equal(res.status, 400);
});

// ─── Unknown error returns 500 ──────────────────────────────────

test("errors: unknown error returns 500", async () => {
  const res = toApiErrorResponse(new Error("SOMETHING_UNEXPECTED_XYZ"));
  assert.equal(res.status, 500);
  const body = await jsonBody(res);
  assert.equal(body.error.code, "INTERNAL_SERVER_ERROR");
});

// ─── parseJsonBody ──────────────────────────────────────────────

test("errors: parseJsonBody validates successfully", async () => {
  const schema = z.object({ amount: z.number() });
  const req = new Request("http://test.local", {
    method: "POST",
    body: JSON.stringify({ amount: 100 }),
    headers: { "Content-Type": "application/json" },
  });
  const data = await parseJsonBody(req, schema);
  assert.deepEqual(data, { amount: 100 });
});

test("errors: parseJsonBody throws ZodError on invalid", async () => {
  const schema = z.object({ amount: z.number() });
  const req = new Request("http://test.local", {
    method: "POST",
    body: JSON.stringify({ amount: "not-a-number" }),
    headers: { "Content-Type": "application/json" },
  });
  await assert.rejects(
    () => parseJsonBody(req, schema),
    (err: unknown) => err instanceof z.ZodError,
  );
});
