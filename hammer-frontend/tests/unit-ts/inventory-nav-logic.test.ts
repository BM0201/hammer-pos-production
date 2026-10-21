import assert from "node:assert/strict";
import test from "node:test";
import {
  INVENTORY_GROUPS,
  resolveActiveNav,
  buildInventoryHref,
  groupTone,
  buildNavSearchResults,
  shouldTriggerSearchShortcut,
} from "@/lib/inventory-nav-logic";

// ── Commit 1 (prompt-inventario-unificado.md) — "un test de configuración
// que recorre TODAS las subsecciones y verifica, por cada una: que la URL
// sea única; que resolveActiveNav(url) devuelva esa misma subsección; que
// el botón del grupo lleve a la primera, con su tab" ────────────────────

function urlFor(sub: { path: string; tab?: string; params?: Record<string, string> }): string {
  const qs = new URLSearchParams();
  if (sub.tab) qs.set("tab", sub.tab);
  if (sub.params) for (const [k, v] of Object.entries(sub.params)) qs.set(k, v);
  const q = qs.toString();
  return q ? `${sub.path}?${q}` : sub.path;
}

test("LA QUE IMPORTA — cada subsección tiene una URL única (ninguna repite path+tab+params con otra)", () => {
  const urls = INVENTORY_GROUPS.flatMap((g) => g.subsections.map((s) => urlFor(s)));
  const unique = new Set(urls);
  assert.equal(unique.size, urls.length, `hay URLs repetidas: ${urls.filter((u, i) => urls.indexOf(u) !== i).join(", ")}`);
});

test("LA QUE IMPORTA — cada subsección resuelve a SÍ MISMA con resolveActiveNav(su propia URL)", () => {
  for (const group of INVENTORY_GROUPS) {
    for (const sub of group.subsections) {
      const resolved = resolveActiveNav(sub.path, sub.tab ?? null, sub.params ?? {});
      assert.deepEqual(resolved, { groupKey: group.key, subsectionKey: sub.key }, `subsección "${group.key}/${sub.key}" (${urlFor(sub)}) no resuelve a sí misma — dio ${JSON.stringify(resolved)}`);
    }
  }
});

test("LA QUE IMPORTA — el botón del grupo (buildInventoryHref a la primera subsección) lleva a una URL que resuelve de vuelta a esa primera subsección", () => {
  for (const group of INVENTORY_GROUPS) {
    const first = group.subsections[0];
    const href = buildInventoryHref(first, { branch: "b-mga" });
    const [path, query] = href.split("?");
    const params = query ? Object.fromEntries(new URLSearchParams(query).entries()) : {};
    const tab = params.tab ?? null;
    assert.equal(resolveActiveNav(path, tab, params)?.subsectionKey, first.key);
  }
});

// ── buildInventoryHref ──────────────────────────────────────────────────

test("LA QUE IMPORTA — buildInventoryHref conserva el alcance de sucursal (bug #1 del doc: el botón de grupo lo perdía)", () => {
  const sub = INVENTORY_GROUPS.find((g) => g.key === "stock")!.subsections[0];
  const href = buildInventoryHref(sub, { branch: "b-mga" });
  assert.match(href, /branch=b-mga/);
  assert.match(href, /tab=stock/);
});

test("buildInventoryHref: sin sucursal (Toda la red / sin elegir aún), no agrega el parámetro", () => {
  const sub = INVENTORY_GROUPS.find((g) => g.key === "products")!.subsections[0];
  const href = buildInventoryHref(sub, { branch: null });
  assert.ok(!href.includes("branch="));
});

test("buildInventoryHref: agrega los params fijos de la subsección (Pendientes = Productos con filtro ya aplicado, no la misma pantalla)", () => {
  const pending = INVENTORY_GROUPS.find((g) => g.key === "quality")!.subsections.find((s) => s.key === "pending")!;
  const href = buildInventoryHref(pending, { branch: null });
  assert.match(href, /filter=NO_COST/);
  assert.match(href, /tab=products/);
});

// ── resolveActiveNav — casos puntuales que motivaron el doc ────────────

test("LA QUE IMPORTA — Existencias ahora SÍ resuelve a su propia subsección (antes el push sin tab caía en la pestaña por defecto del admin viejo)", () => {
  assert.deepEqual(resolveActiveNav("/app/master/catalog-inventory", "stock"), { groupKey: "stock", subsectionKey: "by-branch" });
});

test("LA QUE IMPORTA — Calidad/Pendientes y Productos/Lista comparten tab=products pero resuelven DISTINTO según el filtro en la URL (nunca la misma subsección)", () => {
  assert.deepEqual(resolveActiveNav("/app/master/catalog-inventory", "products"), { groupKey: "products", subsectionKey: "list" }, "sin filtro, es Lista");
  assert.deepEqual(resolveActiveNav("/app/master/catalog-inventory", "products", { filter: "NO_COST" }), { groupKey: "quality", subsectionKey: "pending" }, "con filter=NO_COST, es Pendientes");
  assert.deepEqual(resolveActiveNav("/app/master/catalog-inventory", "products", { filter: "NEGATIVE_STOCK" }), { groupKey: "products", subsectionKey: "list" }, "otro filtro cualquiera sigue siendo Lista, no Pendientes");
});

test("LA QUE IMPORTA — Kardex, Entradas y Conteos ya NO comparten tab (causa real de 'Entradas marcada, se ve Kardex')", () => {
  assert.deepEqual(resolveActiveNav("/app/master/catalog-inventory", "kardex"), { groupKey: "movements", subsectionKey: "kardex" });
  assert.deepEqual(resolveActiveNav("/app/master/catalog-inventory", "intakes"), { groupKey: "movements", subsectionKey: "intakes" });
  assert.deepEqual(resolveActiveNav("/app/master/catalog-inventory", "counts"), { groupKey: "stock", subsectionKey: "counts" });
});

test("tab=movements (viejo, de antes de separar Movimientos) cae en Kardex, no se pierde", () => {
  assert.deepEqual(resolveActiveNav("/app/master/catalog-inventory", "movements"), { groupKey: "movements", subsectionKey: "kardex" });
});

test("Traslados y Reposición ahora resuelven DENTRO de Inventario (ya no son 'external' — se montan con la barra) y son pestañas DISTINTAS de la misma pantalla de verdad", () => {
  assert.deepEqual(resolveActiveNav("/app/master/replenishment", null), { groupKey: "stock", subsectionKey: "replenishment" }, "sin tab = Reposición (la pestaña por defecto real de esa pantalla)");
  assert.deepEqual(resolveActiveNav("/app/master/replenishment", "transit"), { groupKey: "movements", subsectionKey: "transfers" }, "?tab=transit = Traslados");
});

test("Consultar (escaneo) tiene su propia ruta real, no un ancla a otra pantalla", () => {
  assert.deepEqual(resolveActiveNav("/app/master/inventory-lookup", null), { groupKey: "stock", subsectionKey: "lookup" });
});

test("la ficha de producto cae en Productos/Lista — de donde se viene, no una subsección propia", () => {
  assert.deepEqual(resolveActiveNav("/app/master/catalog-inventory/products/abc123", null), { groupKey: "products", subsectionKey: "list" });
});

test("rutas ya movidas fuera de catalog-inventory (códigos de barra, presentaciones) resuelven sin tab", () => {
  assert.deepEqual(resolveActiveNav("/app/master/catalog/barcodes", null), { groupKey: "products", subsectionKey: "barcodes" });
  assert.deepEqual(resolveActiveNav("/app/master/inventory-fusion", null), { groupKey: "products", subsectionKey: "presentations" });
});

test("Escanear productos (alta rápida) cae en Productos/Lista", () => {
  assert.deepEqual(resolveActiveNav("/app/master/catalog/products/quick-add", null), { groupKey: "products", subsectionKey: "list" });
});

test("una ruta que no es de Inventario no resuelve nada", () => {
  assert.equal(resolveActiveNav("/app/master/treasury", null), null);
});

// ── conteos y colores de los grupos ────────────────────────────────────

test("groupTone: Existencias en rojo con stock negativo o traslados atrasados", () => {
  assert.equal(groupTone("stock", { negativeStock: 3, staleTransfers: 0, pendingQuality: 0 }), "danger");
  assert.equal(groupTone("stock", { negativeStock: 0, staleTransfers: 1, pendingQuality: 0 }), "danger");
  assert.equal(groupTone("stock", { negativeStock: 0, staleTransfers: 0, pendingQuality: 0 }), "neutral");
});

test("groupTone: Calidad en ámbar con pendientes, nunca rojo", () => {
  assert.equal(groupTone("quality", { negativeStock: 0, staleTransfers: 0, pendingQuality: 50 }), "warning");
  assert.equal(groupTone("quality", { negativeStock: 0, staleTransfers: 0, pendingQuality: 0 }), "neutral");
});

test("groupTone: Inicio y Productos siempre neutros (no son grupos de alerta)", () => {
  assert.equal(groupTone("home", { negativeStock: 99, staleTransfers: 99, pendingQuality: 99 }), "neutral");
  assert.equal(groupTone("products", { negativeStock: 99, staleTransfers: 99, pendingQuality: 99 }), "neutral");
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
