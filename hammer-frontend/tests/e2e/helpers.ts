import { expect, type APIRequestContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

type ApiSuccess<T> = { ok: true; data: T };
type ApiFailure = { ok: false; error: { code: string; message: string; details?: unknown } };
type ApiBody<T> = ApiSuccess<T> | ApiFailure;

export type E2EState = {
  baseURL: string;
  credentials: {
    master: { username: string; password: string };
    cashier: { username: string; password: string };
  };
  branch: { id: string; code: string; name: string };
  cashBox: { id: string; code: string };
  category: { id: string; code: string };
  product: { id: string; sku: string; price: number };
};

export function readE2EState(): E2EState {
  const statePath = path.resolve(process.cwd(), "tests/e2e/.e2e-state.json");
  return JSON.parse(readFileSync(statePath, "utf8")) as E2EState;
}

export function ensureBranch(state = readE2EState()) {
  return state.branch;
}

export function ensureCashBox(state = readE2EState()) {
  return state.cashBox;
}

export function ensureProduct(state = readE2EState()) {
  return state.product;
}

async function parseJson<T>(response: Awaited<ReturnType<APIRequestContext["post"]>>) {
  return await response.json() as ApiBody<T>;
}

export class ApiSession {
  private csrfToken = "";

  constructor(readonly request: APIRequestContext) {}

  async login(username: string, password: string) {
    const response = await this.request.post("/api/auth/login", {
      data: { username, password },
    });
    expect(response.status()).toBe(200);
    await this.refreshCsrf();
  }

  async refreshCsrf() {
    const response = await this.request.get("/api/auth/csrf");
    expect(response.status()).toBe(200);
    const body = await parseJson<{ csrfToken: string }>(response);
    if (!body.ok) throw new Error(body.error.message);
    this.csrfToken = body.data.csrfToken;
  }

  async get<T>(url: string, expectedStatus = 200) {
    const response = await this.request.get(url);
    expect(response.status()).toBe(expectedStatus);
    return await parseJson<T>(response);
  }

  async post<T>(url: string, data: unknown, expectedStatus = 200) {
    const response = await this.request.post(url, {
      data,
      headers: { "x-csrf-token": this.csrfToken },
    });
    expect(response.status()).toBe(expectedStatus);
    return await parseJson<T>(response);
  }
}

export async function loginAsMaster(request: APIRequestContext, state = readE2EState()) {
  const session = new ApiSession(request);
  await session.login(state.credentials.master.username, state.credentials.master.password);
  return session;
}

export async function loginAsCashier(request: APIRequestContext, state = readE2EState()) {
  const session = new ApiSession(request);
  await session.login(state.credentials.cashier.username, state.credentials.cashier.password);
  return session;
}

export async function openOperationalDay(session: ApiSession, branchId: string, businessDate: string) {
  const body = await session.post<{ id: string; status: string; branchId: string }>("/api/branch/operations/open", {
    branchId,
    businessDate,
    notes: "E2E apertura operacional",
  }, 201);
  if (!body.ok) throw new Error(body.error.message);
  expect(body.data.status).toBe("OPEN");
  return body.data;
}

export async function closeOperationalDay(session: ApiSession, operationalDayId: string) {
  const body = await session.post<{ id: string; status: string }>(`/api/branch/operations/${operationalDayId}/close`, {
    note: "E2E cierre operacional",
    forceClose: false,
  });
  if (!body.ok) throw new Error(body.error.message);
  expect(body.data.status).toBe("CLOSED");
  return body.data;
}

export async function openCashSession(session: ApiSession, branchId: string, physicalCashBoxId: string) {
  const body = await session.post<{ id: string; status: string; openingAmount: string }>("/api/cashier/cash-sessions/open", {
    branchId,
    physicalCashBoxId,
    openingAmount: 100,
    notes: "E2E apertura caja",
  }, 201);
  if (!body.ok) throw new Error(body.error.message);
  expect(body.data.status).toBe("OPEN");
  return body.data;
}

export async function closeCashSession(session: ApiSession, cashSessionId: string, closingAmount: number) {
  const requestClose = await session.post<{ id: string; status: string }>("/api/cashier/cash-sessions/close-request", {
    cashSessionId,
    notes: "E2E solicitud cierre caja",
  });
  if (!requestClose.ok) throw new Error(requestClose.error.message);
  expect(requestClose.data.status).toBe("RECONCILING");

  const body = await session.post<{ id: string; status: string }>("/api/cashier/cash-sessions/close", {
    cashSessionId,
    closingAmount,
    notes: "E2E cierre caja",
  });
  if (!body.ok) throw new Error(body.error.message);
  expect(body.data.status).toBe("CLOSED");
  return body.data;
}

export async function createPendingOrder(session: ApiSession, input: {
  branchId: string;
  productId: string;
  amount: number;
}) {
  const order = await session.post<{ id: string; status: string; grandTotal: string }>("/api/sales/orders", {
    branchId: input.branchId,
    notes: "E2E POS order",
  }, 201);
  if (!order.ok) throw new Error(order.error.message);

  const line = await session.post<{ order: { id: string; grandTotal: string } }>(`/api/sales/orders/${order.data.id}/lines`, {
    productId: input.productId,
    quantity: 1,
    unitPrice: input.amount,
    discountAmount: 0,
  }, 201);
  if (!line.ok) throw new Error(line.error.message);

  const submitted = await session.post<{ id: string; status: string; grandTotal: string }>(`/api/sales/orders/${order.data.id}/submit`, {
    requiresTransport: false,
  });
  if (!submitted.ok) throw new Error(submitted.error.message);
  expect(submitted.data.status).toBe("PENDING_PAYMENT");
  return submitted.data;
}

export async function createPaidOrder(session: ApiSession, input: {
  branchId: string;
  productId: string;
  cashSessionId: string;
  amount: number;
}) {
  const pendingOrder = await createPendingOrder(session, input);

  const payment = await session.post<{ order: { id: string; status: string }; payment: { id: string } }>("/api/cashier/payments", {
    saleOrderId: pendingOrder.id,
    cashSessionId: input.cashSessionId,
    method: "CASH",
    amount: Number(pendingOrder.grandTotal),
  }, 201);
  if (!payment.ok) throw new Error(payment.error.message);
  expect(payment.data.order.status).toBe("PAID");
  return { order: payment.data.order, payment: payment.data.payment };
}
