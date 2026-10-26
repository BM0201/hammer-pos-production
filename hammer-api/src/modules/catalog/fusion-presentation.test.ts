import assert from "node:assert/strict";
import test from "node:test";
import { findAddedMembersWithStock } from "@/modules/catalog/stock-group-crud";
import { factorAgainstCanonical } from "@/modules/catalog/fusion-wizard-service";

test("agregar a una fusión existente: solo bloquea los productos AGREGADOS que tienen stock", () => {
  const balances = [
    { productId: "varilla", branchCode: "MGA", quantityOnHand: 112 }, // ya estaba en la fusión
    { productId: "quintal", branchCode: "MGA", quantityOnHand: 0 },
    { productId: "quintal", branchCode: "MSY", quantityOnHand: 8 },
    { productId: "kilo", branchCode: "MGA", quantityOnHand: 0 },
  ];
  assert.deepEqual(findAddedMembersWithStock(["quintal", "kilo"], balances), [
    { productId: "quintal", branchCode: "MSY", quantityOnHand: 8 },
  ]);
  assert.deepEqual(findAddedMembersWithStock(["kilo"], balances), []);
});

test("stock negativo también bloquea — no es 'sin stock'", () => {
  assert.equal(findAddedMembersWithStock(["x"], [{ productId: "x", branchCode: "MGA", quantityOnHand: -2 }]).length, 1);
});

test("factor contra la base: si se eligió un derivado, se multiplica por su factor", () => {
  // 1 QUINTAL = 14 VARILLA, la varilla es la base
  assert.equal(factorAgainstCanonical(14, null), 14);
  assert.equal(factorAgainstCanonical(14, { conversionFactor: 1 }), 14);
  // 1 TONELADA = 20 QUINTAL, y 1 QUINTAL = 14 VARILLA (base) → 280 varillas
  assert.equal(factorAgainstCanonical(20, { conversionFactor: 14 }), 280);
});
