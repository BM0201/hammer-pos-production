import assert from "node:assert/strict";
import test from "node:test";
import {
  decideQuickAddStep,
  shouldIgnoreRepeatedCode,
  loadRememberedProductDefaults,
  saveRememberedProductDefaults,
  QUICK_ADD_DEFAULTS_STORAGE_KEY,
  type QuickAddProductMatch,
  type KeyValueStorage,
} from "@/lib/quick-add-product";

const PRODUCT: QuickAddProductMatch = {
  id: "p1",
  name: "Cemento Canal",
  sku: "GEN-0001",
  barcode: "7501234567890",
  unit: "SACO",
  standardSalePrice: 350,
  isActive: true,
  category: { id: "c1", code: "GEN", name: "General" },
};

test("decideQuickAddStep — producto encontrado por barcode: tarjeta, nunca formulario", () => {
  const step = decideQuickAddStep({ code: "7501234567890", response: { product: PRODUCT, matchedBy: "barcode" } });
  assert.deepEqual(step, { kind: "FOUND", product: PRODUCT, matchedBy: "barcode" });
});

test("decideQuickAddStep — producto encontrado por sku", () => {
  const step = decideQuickAddStep({ code: "GEN-0001", response: { product: PRODUCT, matchedBy: "sku" } });
  assert.equal(step.kind, "FOUND");
});

test("decideQuickAddStep — sin coincidencia: abre el formulario con el código", () => {
  const step = decideQuickAddStep({ code: "9999999999999", response: { product: null, matchedBy: null } });
  assert.deepEqual(step, { kind: "NOT_FOUND", code: "9999999999999" });
});

test("decideQuickAddStep — response null (nunca se consultó): tambien NOT_FOUND", () => {
  const step = decideQuickAddStep({ code: "abc", response: null });
  assert.equal(step.kind, "NOT_FOUND");
});

test("decideQuickAddStep — error de red/servidor: ERROR, nunca abre el formulario a ciegas", () => {
  const step = decideQuickAddStep({ code: "abc", response: null, errorMessage: "Error de red" });
  assert.deepEqual(step, { kind: "ERROR", code: "abc", message: "Error de red" });
});

test("shouldIgnoreRepeatedCode — mismo codigo dentro de 1.5s: se ignora", () => {
  assert.equal(shouldIgnoreRepeatedCode("123", 1000, { code: "123", at: 0 }), true);
  assert.equal(shouldIgnoreRepeatedCode("123", 1499, { code: "123", at: 0 }), true);
});

test("shouldIgnoreRepeatedCode — mismo codigo pero fuera de la ventana: no se ignora", () => {
  assert.equal(shouldIgnoreRepeatedCode("123", 1500, { code: "123", at: 0 }), false);
  assert.equal(shouldIgnoreRepeatedCode("123", 5000, { code: "123", at: 0 }), false);
});

test("shouldIgnoreRepeatedCode — codigo distinto: nunca se ignora, aunque sea instantaneo", () => {
  assert.equal(shouldIgnoreRepeatedCode("456", 1, { code: "123", at: 0 }), false);
});

test("shouldIgnoreRepeatedCode — sin lectura previa: nunca se ignora", () => {
  assert.equal(shouldIgnoreRepeatedCode("123", 1000, null), false);
});

function createFakeStorage(): KeyValueStorage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value); },
  };
}

test("defaults recordados — sin nada guardado: null", () => {
  const storage = createFakeStorage();
  assert.equal(loadRememberedProductDefaults(storage), null);
});

test("defaults recordados — guarda y vuelve a leer exactamente lo mismo", () => {
  const storage = createFakeStorage();
  saveRememberedProductDefaults(storage, { categoryId: "c1", unit: "SACO", allowsFraction: false });
  assert.deepEqual(loadRememberedProductDefaults(storage), { categoryId: "c1", unit: "SACO", allowsFraction: false });
});

test("defaults recordados — JSON corrupto: null, no revienta", () => {
  const storage = createFakeStorage();
  storage.setItem(QUICK_ADD_DEFAULTS_STORAGE_KEY, "{esto no es json");
  assert.equal(loadRememberedProductDefaults(storage), null);
});

test("defaults recordados — forma incompleta (falta un campo): null", () => {
  const storage = createFakeStorage();
  storage.setItem(QUICK_ADD_DEFAULTS_STORAGE_KEY, JSON.stringify({ categoryId: "c1", unit: "SACO" }));
  assert.equal(loadRememberedProductDefaults(storage), null);
});

test("defaults recordados — getItem/setItem que lanzan (modo privado): no revienta", () => {
  const throwingStorage: KeyValueStorage = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
  };
  assert.equal(loadRememberedProductDefaults(throwingStorage), null);
  assert.doesNotThrow(() => saveRememberedProductDefaults(throwingStorage, { categoryId: "c1", unit: "SACO", allowsFraction: true }));
});
