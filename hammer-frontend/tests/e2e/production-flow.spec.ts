import { expect, test } from "@playwright/test";
import {
  closeCashSession,
  closeOperationalDay,
  createPaidOrder,
  createPendingOrder,
  ensureBranch,
  ensureCashBox,
  ensureProduct,
  loginAsCashier,
  loginAsMaster,
  openCashSession,
  openOperationalDay,
  readE2EState,
} from "./helpers";

test.describe.serial("H.A.M.M.E.R. V3 produccion minima", () => {
  test("login, jornada operativa, caja, POS, pago y cierre manual", async ({ request }) => {
    const state = readE2EState();
    const branch = ensureBranch(state);
    const cashBox = ensureCashBox(state);
    const product = ensureProduct(state);
    const cashier = await loginAsCashier(request, state);

    const day = await openOperationalDay(cashier, branch.id, "2031-01-01");
    const cashSession = await openCashSession(cashier, branch.id, cashBox.id);

    await createPaidOrder(cashier, {
      branchId: branch.id,
      productId: product.id,
      cashSessionId: cashSession.id,
      amount: product.price,
    });

    await closeCashSession(cashier, cashSession.id, 125);
    await closeOperationalDay(cashier, day.id);

    const current = await cashier.get<null>(`/api/branch/operations/current?branchId=${branch.id}`);
    expect(current.ok).toBe(true);
    if (current.ok) expect(current.data).toBeNull();
  });

  test("auto-cierre bloquea cobros y permite cerrar dia despues de revision", async ({ request }) => {
    const state = readE2EState();
    const branch = ensureBranch(state);
    const cashBox = ensureCashBox(state);
    const product = ensureProduct(state);
    const cashier = await loginAsCashier(request, state);

    const day = await openOperationalDay(cashier, branch.id, "2031-01-02");
    const cashSession = await openCashSession(cashier, branch.id, cashBox.id);
    const pendingOrder = await createPendingOrder(cashier, {
      branchId: branch.id,
      productId: product.id,
      amount: product.price,
    });

    const cron = await request.post("/api/system/cron/cash-auto-close?now=2031-01-06T23:21:00.000Z", {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? "e2e-cron-secret"}` },
    });
    expect(cron.status()).toBe(200);
    const pendingReview = await cashier.get<Array<{ id: string; status: string }>>(
      `/api/branch/cash/sessions/auto-closed-pending?branchId=${branch.id}&physicalCashBoxId=${cashBox.id}`,
    );
    expect(pendingReview.ok).toBe(true);
    if (!pendingReview.ok) throw new Error(pendingReview.error.message);
    expect(pendingReview.data.some((session) => session.id === cashSession.id && session.status === "AUTO_CLOSED_PENDING_REVIEW")).toBe(true);

    const blockedPayment = await cashier.post("/api/cashier/payments", {
      saleOrderId: pendingOrder.id,
      cashSessionId: cashSession.id,
      method: "CASH",
      amount: Number(pendingOrder.grandTotal),
    }, 409);
    expect(blockedPayment.ok).toBe(false);
    if (blockedPayment.ok) throw new Error("El pago debio bloquearse.");
    expect(blockedPayment.error.message).toContain("caja fue cerrada automaticamente");

    const reviewed = await cashier.post<{ id: string; status: string; requiresReview: boolean }>(
      `/api/branch/cash/sessions/${cashSession.id}/review-auto-close`,
      { countedCashAmount: 100, note: "Revision E2E de cierre automatico" },
    );
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) throw new Error(reviewed.error.message);
    expect(reviewed.data.status).toBe("CLOSED");
    expect(reviewed.data.requiresReview).toBe(false);

    const master = await loginAsMaster(request, state);
    await master.post(`/api/branch/operations/${day.id}/close`, {
      note: "E2E cierre con orden pendiente tras bloqueo esperado",
      forceClose: true,
    });
  });

  test("permisos: usuario normal no accede master ni cierra OperationalDay", async ({ request }) => {
    const state = readE2EState();
    const branch = ensureBranch(state);
    const cashier = await loginAsCashier(request, state);
    const master = await loginAsMaster(request, state);

    const branches = await cashier.get<Array<{ id: string }>>("/api/branches");
    expect(branches.ok).toBe(true);
    if (!branches.ok) throw new Error(branches.error.message);
    expect(branches.data.map((item) => item.id)).toEqual([branch.id]);

    const forbiddenMaster = await cashier.get("/api/master/catalog-inventory", 403);
    expect(forbiddenMaster.ok).toBe(false);

    const day = await openOperationalDay(master, branch.id, "2031-01-03");
    const forbiddenClose = await cashier.post(`/api/branch/operations/${day.id}/close`, {
      note: "E2E intento cajero",
      forceClose: false,
    }, 403);
    expect(forbiddenClose.ok).toBe(false);

    await closeOperationalDay(master, day.id);
  });

  test("importacion trabaja por batchId y no ejecuta dos veces", async ({ request }) => {
    const state = readE2EState();
    const branch = ensureBranch(state);
    const master = await loginAsMaster(request, state);
    const fileContent = [
      "sku,name,quantity,cost,price",
      "E2E-IMPORT-001,E2E Producto importado,5,7,15",
    ].join("\n");

    const preview = await master.post<{
      batchId: string;
      status: string;
      summary: { readyRows: number; errorRows: number; status: string };
    }>("/api/master/catalog-inventory/import", {
      mode: "preview",
      importType: "CATALOG_WITH_INITIAL_INVENTORY",
      destinationMode: "SINGLE",
      defaultBranchId: branch.id,
      createMissingProducts: true,
      defaultCategoryId: state.category.id,
      defaultUnit: "UN",
      defaultStandardSalePrice: 15,
      fileContent,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error(preview.error.message);
    expect(preview.data.status).toBe("PREVIEWED");
    expect(preview.data.summary.readyRows).toBe(1);
    expect(preview.data.summary.errorRows).toBe(0);

    const executed = await master.post<{ batchId: string; status: string; executedLines: number }>(
      "/api/master/catalog-inventory/import",
      { mode: "execute", batchId: preview.data.batchId },
    );
    expect(executed.ok).toBe(true);
    if (!executed.ok) throw new Error(executed.error.message);
    expect(executed.data.status).toBe("EXECUTED");
    expect(executed.data.executedLines).toBe(1);

    const secondExecution = await master.post(
      "/api/master/catalog-inventory/import",
      { mode: "execute", batchId: preview.data.batchId },
      400,
    );
    expect(secondExecution.ok).toBe(false);
    if (secondExecution.ok) throw new Error("La segunda ejecucion debio bloquearse.");
    expect(secondExecution.error.message).toContain("ya fue ejecutado");
  });
});
