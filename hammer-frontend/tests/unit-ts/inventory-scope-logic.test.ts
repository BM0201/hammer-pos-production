import assert from "node:assert/strict";
import test from "node:test";
import { canShowNetworkOption, orderScopeBranches, resolveInventoryScope, scopeToParamValue, type ScopeBranch } from "@/lib/inventory-scope-logic";

const BRANCHES: ScopeBranch[] = [
  { id: "b-riv", code: "RIV", name: "Rivas", isActive: true },
  { id: "b-mga", code: "MGA", name: "Managua Central", isActive: true },
  { id: "b-msy", code: "MSY", name: "Masaya", isActive: true },
];

test("LA QUE IMPORTA — orderScopeBranches: la principal primero (★), el resto por código, sin ninguna sucursal fija en el código", () => {
  const ordered = orderScopeBranches(BRANCHES, "b-mga");
  assert.deepEqual(ordered.map((b) => b.code), ["MGA", "MSY", "RIV"]);
});

test("orderScopeBranches: sin principal configurada, todas quedan ordenadas por código", () => {
  const ordered = orderScopeBranches(BRANCHES, null);
  assert.deepEqual(ordered.map((b) => b.code), ["MGA", "MSY", "RIV"]);
});

test("orderScopeBranches: una sucursal desactivada desaparece del orden", () => {
  const withInactive = [...BRANCHES, { id: "b-leo", code: "LEO", name: "León", isActive: false }];
  const ordered = orderScopeBranches(withInactive, "b-mga");
  assert.ok(!ordered.some((b) => b.code === "LEO"));
});

test("LA QUE IMPORTA — orderScopeBranches: una sucursal NUEVA (creada en el test, nunca mencionada en el código) aparece sola, en su lugar alfabético", () => {
  const withNew = [...BRANCHES, { id: "b-leo", code: "LEO", name: "León", isActive: true }];
  const ordered = orderScopeBranches(withNew, "b-mga");
  assert.deepEqual(ordered.map((b) => b.code), ["MGA", "LEO", "MSY", "RIV"]);
});

test("canShowNetworkOption: con 2+ sucursales activas sí, con 1 o 0 no", () => {
  assert.equal(canShowNetworkOption(BRANCHES), true);
  assert.equal(canShowNetworkOption([BRANCHES[0]]), false);
  assert.equal(canShowNetworkOption([]), false);
  assert.equal(canShowNetworkOption([{ ...BRANCHES[0], isActive: false }, BRANCHES[1]]), false, "una sola ACTIVA, aunque haya 2 filas");
});

test("LA QUE IMPORTA — resolveInventoryScope: la URL manda sobre todo lo demás", () => {
  const scope = resolveInventoryScope({ urlValue: "b-riv", storedValue: "b-msy", primaryBranchId: "b-mga", branches: BRANCHES });
  assert.deepEqual(scope, { mode: "branch", branchId: "b-riv" });
});

test("resolveInventoryScope: 'all' en la URL es Toda la red", () => {
  const scope = resolveInventoryScope({ urlValue: "all", storedValue: "b-msy", primaryBranchId: "b-mga", branches: BRANCHES });
  assert.deepEqual(scope, { mode: "all", branchId: null });
});

test("resolveInventoryScope: sin URL, cae a lo guardado en localStorage", () => {
  const scope = resolveInventoryScope({ urlValue: null, storedValue: "b-msy", primaryBranchId: "b-mga", branches: BRANCHES });
  assert.deepEqual(scope, { mode: "branch", branchId: "b-msy" });
});

test("LA QUE IMPORTA — resolveInventoryScope: sucursal guardada que ya no existe (o perdió acceso) cae a la principal sin error", () => {
  const scope = resolveInventoryScope({ urlValue: null, storedValue: "b-ya-no-existe", primaryBranchId: "b-mga", branches: BRANCHES });
  assert.deepEqual(scope, { mode: "branch", branchId: "b-mga" });
});

test("resolveInventoryScope: tampoco hay principal válida — cae a la primera activa por código", () => {
  const scope = resolveInventoryScope({ urlValue: null, storedValue: null, primaryBranchId: "b-ya-no-existe-tampoco", branches: BRANCHES });
  assert.deepEqual(scope, { mode: "branch", branchId: "b-mga" }, "MGA es la primera por código (M-G-A), no por estar hardcodeada");
});

test("resolveInventoryScope: acepta el código además del id (compat con ?branchId= viejo que a veces guardaba el id, nunca el código — pero la resolución es simétrica)", () => {
  const scope = resolveInventoryScope({ urlValue: "RIV", storedValue: null, primaryBranchId: "b-mga", branches: BRANCHES });
  assert.deepEqual(scope, { mode: "branch", branchId: "b-riv" });
});

test("resolveInventoryScope: usuario sin ninguna sucursal visible — Toda la red por descarte, sin reventar", () => {
  const scope = resolveInventoryScope({ urlValue: null, storedValue: null, primaryBranchId: null, branches: [] });
  assert.deepEqual(scope, { mode: "all", branchId: null });
});

test("scopeToParamValue: mismo formato para URL y localStorage", () => {
  assert.equal(scopeToParamValue({ mode: "all", branchId: null }), "all");
  assert.equal(scopeToParamValue({ mode: "branch", branchId: "b-mga" }), "b-mga");
});
