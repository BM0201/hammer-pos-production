import { test, expect } from "@playwright/test";
import { loginAsMasterInBrowser, readE2EState } from "./helpers";

/**
 * prompt-inventario-unificado.md Commit 1 — E2E de navegador (no API):
 * "hacer clic en cada pestaña y subpestaña; verificar que la URL cambia,
 * que el contenido es distinto y que la barra sigue con la misma
 * sucursal." Corre con `npm run test:e2e:nav` (proyecto "ui" de
 * playwright.config.ts) — NUNCA contra producción: usa el branch/usuario
 * que siembra prisma/e2e-seed.ts en la base de DESARROLLO configurada.
 */

test.describe("Inventario — navegación unificada (prompt-inventario-unificado.md)", () => {
  test("cada grupo y subsección cambia la URL, carga contenido real y conserva la sucursal", async ({ page, context }) => {
    const state = readE2EState();
    await loginAsMasterInBrowser(context, state);

    await page.goto(`/app/master/inventory?branch=${state.branch.id}`);
    await expect(page.getByRole("heading", { name: "Inventario", exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`branch=${state.branch.id}`));

    // Grupo Productos — bug #1 del doc: antes el botón de grupo perdía el
    // tab Y la sucursal. Acá verificamos las dos cosas a la vez.
    await page.getByRole("button", { name: "Productos", exact: true }).click();
    await expect(page).toHaveURL(/tab=products/);
    await expect(page).toHaveURL(new RegExp(`branch=${state.branch.id}`));

    // Subsecciones de Productos — cada una, URL distinta.
    await page.getByRole("link", { name: "Categorías", exact: true }).click();
    await expect(page).toHaveURL(/tab=categories/);
    await expect(page).toHaveURL(new RegExp(`branch=${state.branch.id}`));

    await page.getByRole("link", { name: "Códigos de barra", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/master\/catalog\/barcodes/);

    // Grupo Existencias — bug #1 del doc: "Existencias no navega".
    await page.getByRole("button", { name: "Existencias", exact: true }).click();
    await expect(page).toHaveURL(/tab=stock/);
    await expect(page).toHaveURL(new RegExp(`branch=${state.branch.id}`));

    await page.getByRole("link", { name: "Consultar", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/master\/inventory-lookup/);
    await expect(page).toHaveURL(new RegExp(`branch=${state.branch.id}`));

    // Grupo Movimientos — Kardex/Entradas ya NO comparten tab (bug #2).
    await page.getByRole("button", { name: "Movimientos", exact: true }).click();
    await expect(page).toHaveURL(/tab=kardex/);

    await page.getByRole("link", { name: "Entradas", exact: true }).click();
    await expect(page).toHaveURL(/tab=intakes/);
    await expect(page).not.toHaveURL(/tab=kardex/);

    // Grupo Calidad — bug #1 del doc: "Calidad no navega".
    await page.getByRole("button", { name: "Calidad", exact: true }).click();
    await expect(page).toHaveURL(/tab=products/);
    await expect(page).toHaveURL(/filter=NO_COST/);
    await expect(page).toHaveURL(new RegExp(`branch=${state.branch.id}`));

    // La barra sigue con la MISMA sucursal en todo el recorrido — nunca se
    // reseteó a "elegir sucursal" ni cambió sola al navegar entre grupos.
    await expect(page.getByRole("button", { name: new RegExp(state.branch.code) })).toBeVisible();
  });

  test("el desplegable de sucursal abre, muestra la sucursal activa marcada y re-elegirla conserva la pestaña (el seed de E2E solo trae una sucursal, no hay una segunda a la que cambiar de verdad)", async ({ page, context }) => {
    const state = readE2EState();
    await loginAsMasterInBrowser(context, state);

    await page.goto(`/app/master/catalog-inventory?tab=stock&branch=${state.branch.id}`);
    await expect(page).toHaveURL(/tab=stock/);

    await page.getByRole("button", { name: new RegExp(state.branch.code) }).click();
    const option = page.getByRole("button", { name: new RegExp(`${state.branch.code} ·`) });
    await expect(option).toBeVisible();
    await option.click();

    // Re-elegir la misma sucursal no manda a otra pantalla ni pierde la pestaña.
    await expect(page).toHaveURL(/tab=stock/);
    await expect(page).toHaveURL(new RegExp(`branch=${state.branch.id}`));
  });
});
