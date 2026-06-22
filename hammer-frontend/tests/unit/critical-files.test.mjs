/**
 * critical-files.test.mjs
 * ────────────────────────────────────────────────────────────────────────────
 * Tests de integridad estructural para los archivos críticos del frontend.
 *
 * Estos tests NO requieren backend ni servidor: leen el código fuente y
 * verifican que los layouts/páginas críticos no se hayan vaciado o roto
 * (la clase de regresión introducida por el commit 77429df).
 *
 * Ejecutar:  node --test tests/unit/
 *            npm run test:unit
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "..", "..", "src");

function read(rel) {
  const abs = join(SRC, rel);
  assert.ok(existsSync(abs), `El archivo crítico no existe: ${rel}`);
  return readFileSync(abs, "utf8");
}

test("app/app/layout.tsx monta el shell autenticado (AppShellRouter)", () => {
  const c = read("app/app/layout.tsx");
  assert.match(c, /AppShellRouter/, "Debe renderizar <AppShellRouter> (sidebar/header).");
  assert.match(c, /\/api\/auth\/session/, "Debe verificar la sesión vía /api/auth/session.");
  assert.ok(c.trim().length > 200, "El layout no debe ser un passthrough vacío.");
});

test("app/layout.tsx (raíz) renderiza html/body y providers", () => {
  const c = read("app/layout.tsx");
  assert.match(c, /<html/, "Debe renderizar <html>.");
  assert.match(c, /<body/, "Debe renderizar <body>.");
});

test("AppShellRouter monta sidebar y header", () => {
  const c = read("components/layout/app-shell-router.tsx");
  assert.match(c, /AppSidebar/, "Debe montar <AppSidebar>.");
  assert.match(c, /<header/, "Debe renderizar el <header>.");
});

test("login conserva el envío de credenciales", () => {
  const c = read("app/login/page.tsx");
  assert.match(c, /\/api\/auth\/login/, "El login debe llamar a /api/auth/login.");
});

test("ninguna página redirige a su propia ruta (sin bucles)", () => {
  const pages = [
    "app/app/master/timber/page.tsx",
    "app/app/master/timber/trips/page.tsx",
    "app/app/master/inventory/page.tsx",
    "app/app/master/employees/page.tsx",
    "app/app/master/catalog/products/page.tsx",
  ];
  for (const rel of pages) {
    const c = read(rel);
    const m = c.match(/redirect\(\s*["'`]([^"'`?]+)/);
    if (!m) continue;
    const target = m[1].replace(/\/$/, "");
    const ownRoute =
      "/" + rel.replace(/^app\//, "").replace(/\/page\.tsx$/, "");
    assert.notEqual(
      target,
      ownRoute,
      `${rel} hace redirect a su propia ruta (${target}) → bucle infinito.`,
    );
  }
});
