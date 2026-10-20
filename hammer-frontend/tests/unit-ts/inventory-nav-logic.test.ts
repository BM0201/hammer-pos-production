import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveActiveNav,
  groupTone,
  buildNavSearchResults,
  shouldTriggerSearchShortcut,
} from "@/lib/inventory-nav-logic";

test("LA QUE IMPORTA — grupo y subsección activos para Inicio (ruta nueva)", () => {
  assert.deepEqual(resolveActiveNav("/app/master/inventory", null), { groupKey: "home", subsectionKey: "summary" });
});

test("LA QUE IMPORTA — grupo y subsección activos para una pestaña vieja (catalog-inventory?tab=stock)", () => {
  assert.deepEqual(resolveActiveNav("/app/master/catalog-inventory", "stock"), { groupKey: "stock", subsectionKey: "stock" });
});

test("tab=movements resuelve a Existencias (cae en 'Entradas', la primera de las 3 que comparten esa pestaña vieja)", () => {
  assert.deepEqual(resolveActiveNav("/app/master/catalog-inventory", "movements"), { groupKey: "stock", subsectionKey: "intake" });
});

test("la ficha de producto (ruta con id) cae en Catálogo/Productos — de donde se viene, no una subsección propia", () => {
  assert.deepEqual(resolveActiveNav("/app/master/catalog-inventory/products/abc123", null), { groupKey: "catalog", subsectionKey: "products" });
});

test("rutas ya movidas fuera de catalog-inventory (códigos de barra, presentaciones) resuelven sin tab", () => {
  assert.deepEqual(resolveActiveNav("/app/master/catalog/barcodes", null), { groupKey: "catalog", subsectionKey: "barcodes" });
  assert.deepEqual(resolveActiveNav("/app/master/inventory-fusion", null), { groupKey: "catalog", subsectionKey: "presentations" });
});

test("Escanear productos (alta rápida) cae en Catálogo/Productos", () => {
  assert.deepEqual(resolveActiveNav("/app/master/catalog/products/quick-add", null), { groupKey: "catalog", subsectionKey: "products" });
});

test("una ruta que no es de Inventario no resuelve nada", () => {
  assert.equal(resolveActiveNav("/app/master/treasury", null), null);
});

test("Traslados y Reposición nunca quedan 'activos' dentro de Inventario (son external)", () => {
  // Aunque alguien navegue a /app/master/transfers, no hay ninguna subsección NO-external con ese path -> no matchea ninguna, cae al fallback y da null.
  assert.equal(resolveActiveNav("/app/master/transfers", null), null);
});

// ── conteos y colores de los grupos ────────────────────────────────────────

test("LA QUE IMPORTA — groupTone: Existencias en rojo con stock negativo o traslados atrasados", () => {
  assert.equal(groupTone("stock", { negativeStock: 3, staleTransfers: 0, pendingQuality: 0 }), "danger");
  assert.equal(groupTone("stock", { negativeStock: 0, staleTransfers: 1, pendingQuality: 0 }), "danger");
  assert.equal(groupTone("stock", { negativeStock: 0, staleTransfers: 0, pendingQuality: 0 }), "neutral");
});

test("groupTone: Calidad de datos en ámbar con pendientes, nunca rojo", () => {
  assert.equal(groupTone("quality", { negativeStock: 0, staleTransfers: 0, pendingQuality: 50 }), "warning");
  assert.equal(groupTone("quality", { negativeStock: 0, staleTransfers: 0, pendingQuality: 0 }), "neutral");
});

test("groupTone: Inicio y Catálogo siempre neutros (no son grupos de alerta)", () => {
  assert.equal(groupTone("home", { negativeStock: 99, staleTransfers: 99, pendingQuality: 99 }), "neutral");
  assert.equal(groupTone("catalog", { negativeStock: 99, staleTransfers: 99, pendingQuality: 99 }), "neutral");
});

// ── buscador ────────────────────────────────────────────────────────────────

const PRODUCTS = [
  { id: "p1", sku: "FER-001", name: "Clavo 2 pulgadas", barcode: "7501234567890" },
  { id: "p2", sku: "FER-002", name: "Cemento Canal", barcode: null },
];

test("LA QUE IMPORTA — buildNavSearchResults: código/SKU exacto va primero", () => {
  const groups = buildNavSearchResults("FER-002", PRODUCTS);
  const productsGroup = groups.find((g) => g.kind === "products")!;
  assert.equal(productsGroup.items[0].id, "p2");
});

test("buildNavSearchResults: código de barras exacto también va primero", () => {
  const groups = buildNavSearchResults("7501234567890", PRODUCTS);
  const productsGroup = groups.find((g) => g.kind === "products")!;
  assert.equal(productsGroup.items[0].id, "p1");
});

test("buildNavSearchResults: 'conteo' encuentra la sección Conteos", () => {
  const groups = buildNavSearchResults("conteo", []);
  const sectionsGroup = groups.find((g) => g.kind === "sections")!;
  assert.ok(sectionsGroup.items.some((i) => i.label === "Conteos"));
});

test("buildNavSearchResults: 'nuevo producto' encuentra la acción correspondiente", () => {
  const groups = buildNavSearchResults("nuevo producto", []);
  const actionsGroup = groups.find((g) => g.kind === "actions")!;
  assert.ok(actionsGroup.items.some((i) => i.label === "Nuevo producto"));
});

test("buildNavSearchResults: consulta vacía no devuelve nada", () => {
  assert.deepEqual(buildNavSearchResults("", PRODUCTS), []);
  assert.deepEqual(buildNavSearchResults("   ", PRODUCTS), []);
});

// ── atajo Ctrl+K / ───────────────────────────────────────────────────────────

test("LA QUE IMPORTA — shouldTriggerSearchShortcut: Ctrl+K dispara fuera de un input", () => {
  assert.equal(shouldTriggerSearchShortcut("k", true, "BODY"), true);
  assert.equal(shouldTriggerSearchShortcut("k", true, "DIV"), true);
});

test("shouldTriggerSearchShortcut: / dispara solo, nunca con Ctrl/Cmd (eso sería otro atajo)", () => {
  assert.equal(shouldTriggerSearchShortcut("/", false, "BODY"), true);
  assert.equal(shouldTriggerSearchShortcut("/", true, "BODY"), false);
});

test("shouldTriggerSearchShortcut: nunca se dispara mientras se escribe en un input/textarea/select", () => {
  assert.equal(shouldTriggerSearchShortcut("k", true, "INPUT"), false);
  assert.equal(shouldTriggerSearchShortcut("/", false, "TEXTAREA"), false);
  assert.equal(shouldTriggerSearchShortcut("k", true, "SELECT"), false);
});
