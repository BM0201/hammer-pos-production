import path from "node:path";
import { expect, test } from "@playwright/test";

const adminStorageState = process.env.E2E_ADMIN_STORAGE_STATE ?? "tests/e2e/.auth/admin.json";
const cashierStorageState = process.env.E2E_CASHIER_STORAGE_STATE ?? "tests/e2e/.auth/cashier.json";

test.describe("POS operational flow", () => {
  test("POS -> enviar a caja -> cobro -> despacho", async ({ browser, baseURL }) => {
    const adminContext = await browser.newContext({
      baseURL,
      storageState: path.resolve(adminStorageState),
    });

    const cashierContext = await browser.newContext({
      baseURL,
      storageState: path.resolve(cashierStorageState),
    });

    const adminPage = await adminContext.newPage();
    await adminPage.goto("/app/branch/sales/orders");
    await expect(adminPage.getByTestId("pos-root")).toBeVisible();

    await adminPage.getByTestId("pos-search-input").fill("SKU-00001");
    await adminPage.keyboard.press("ArrowDown");
    await adminPage.keyboard.press("Enter");

    await expect(adminPage.getByTestId("pos-ticket-lines")).toContainText(/.+/);
    await adminPage.getByTestId("pos-send-to-payment").click();

    const cashierPage = await cashierContext.newPage();
    await cashierPage.goto("/app/branch/cashier/payments");
    await expect(cashierPage.getByTestId("cashier-payments-root")).toBeVisible();

    await cashierPage.getByTestId("cashier-method-CASH").click();
    await cashierPage.getByTestId("cashier-submit-payment").click();

    await adminPage.goto("/app/branch/warehouse/dispatch");
    await expect(adminPage.getByTestId("dispatch-root")).toBeVisible();

    const firstDispatchButton = adminPage.locator('[data-testid^="dispatch-action-"]').first();
    await firstDispatchButton.click();
    await expect(adminPage.getByTestId("dispatch-message")).toContainText("Despacho registrado");

    await adminContext.close();
    await cashierContext.close();
  });

  test("deniega cobro sin sesión abierta (mensaje operativo)", async ({ page }) => {
    await page.goto("/app/branch/cashier/payments");
    await expect(page.getByTestId("cashier-payments-root")).toBeVisible();

    await page.route("**/api/cashier/orders/pending-payment**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [{ id: "o1", orderNumber: "SO-TEST-01", status: "PENDING_PAYMENT", grandTotal: "10.00", branchId: "b1" }],
        }),
      });
    });

    await page.route("**/api/cashier/cash-sessions/active**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: null }) });
    });

    await page.reload();
    await page.getByTestId("cashier-submit-payment").click();
    await expect(page.getByTestId("cashier-message")).toContainText("sin sesión de caja abierta");
  });

  test("previene acción duplicada en despacho en UI", async ({ page }) => {
    await page.goto("/app/branch/warehouse/dispatch");
    await expect(page.getByTestId("dispatch-root")).toBeVisible();

    await page.route("**/api/warehouse/dispatch/*/dispatch", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 900));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: {} }) });
    });

    const button = page.locator('[data-testid^="dispatch-action-"]').first();
    await button.click();
    await expect(button).toBeDisabled();
  });

  test("envía requiresTransport=true al submit desde POS", async ({ page }) => {
    let submitPayload: any = null;

    await page.route("**/api/sales/orders?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              id: "ord_pos_transport",
              orderNumber: "SO-TRANSPORT-001",
              status: "DRAFT",
              grandTotal: "25.00",
              subtotal: "25.00",
              discountTotal: "0.00",
              lines: [
                {
                  id: "line_1",
                  productId: "prod_1",
                  quantity: "1",
                  unitPrice: "25.00",
                  discountAmount: "0.00",
                  lineSubtotal: "25.00",
                  product: { name: "Producto Demo", sku: "SKU-00001" },
                },
              ],
            },
          ],
        }),
      });
    });

    await page.route("**/api/catalog/products?**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) });
    });

    await page.route("**/api/sales/orders/ord_pos_transport/submit", async (route) => {
      submitPayload = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { id: "ord_pos_transport" } }) });
    });

    await page.goto("/app/branch/sales/orders");
    await expect(page.getByTestId("pos-root")).toBeVisible();

    await page.getByTestId("pos-transport-toggle").locator("input[type='checkbox']").check();
    await page.getByTestId("pos-send-to-payment").click();

    expect(submitPayload?.requiresTransport).toBe(true);
    await expect(page.getByTestId("pos-notice")).toContainText("marca de transporte");
  });

  test("muestra etiquetas operativas de transporte en Despacho y registra transporte", async ({ page }) => {
    let transportPayload: any = null;

    await page.route("**/api/warehouse/dispatch/pending?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              id: "ord_dispatch_transport_1",
              orderNumber: "SO-DSP-TR-001",
              status: "DISPATCH_PENDING",
              grandTotal: "50.00",
              requiresTransport: true,
              branch: { code: "SUC-01", name: "Sucursal 1" },
              transportServices: [],
            },
          ],
        }),
      });
    });

    await page.route("**/api/warehouse/dispatch/history?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              id: "ticket_1",
              saleOrder: {
                orderNumber: "SO-HIST-TR-001",
                requiresTransport: true,
                transportServices: [{ id: "tr_hist_1", customerName: "Cliente Hist", status: "DELIVERED" }],
              },
              branch: { code: "SUC-01" },
              dispatchedAt: new Date().toISOString(),
            },
          ],
        }),
      });
    });

    await page.route("**/api/transport", async (route) => {
      transportPayload = route.request().postDataJSON();
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ data: { id: "tr_1" } }) });
    });

    await page.goto("/app/branch/warehouse/dispatch");
    await expect(page.getByTestId("dispatch-root")).toBeVisible();

    await expect(page.getByTestId("dispatch-transport-zone")).toContainText("Órdenes que requieren transporte");
    await expect(page.getByTestId("dispatch-transport-zone")).toContainText("Sin registro");
    await expect(page.getByTestId("dispatch-history-list")).toContainText("Entregado");
    await expect(page.getByTestId("dispatch-history-list")).not.toContainText("DELIVERED");

    await page.getByLabel("Nombre del cliente").fill("Cliente QA");
    await page.getByLabel("Precio del transporte").fill("15.5");
    await page.getByRole("button", { name: /Registrar transporte/i }).click();

    expect(transportPayload?.saleOrderId).toBe("ord_dispatch_transport_1");
    expect(transportPayload?.customerName).toBe("Cliente QA");
    expect(transportPayload?.price).toBe(15.5);
  });
});
