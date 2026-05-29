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
  const res = toApiErrorResponse({ code: "PAYMENT_ALREADY_POSTED", message: "PAYMENT_ALREADY_POSTED" });
  // code-based matching
  const res2 = toApiErrorResponse(new Error("PAYMENT_ALREADY_POSTED"));
  assert.equal(res2.status, 409);
});

// ─── Not found ──────────────────────────────────────────────────

test("errors: NOT_FOUND returns 404", async () => {
  const res = toApiErrorResponse(new Error("NOT_FOUND"));
  assert.equal(res.status, 404);
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
