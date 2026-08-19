/**
 * Reescritura de la capa de presentaciones de fusión — pruebas 10 y 11 del
 * prompt, sobre el asistente de creación (FusionCreateWizard en
 * inventory-fusion-manager.tsx). Convención del repo backend (sin DB/React):
 * se inlinea un espejo puro de la lógica de decisión de `addProduct` y
 * `markAsBase` — mismas reglas, sin montar el componente. Si cambia la
 * lógica real, actualizar acá también.
 *
 * Ejecutar: npm run test:unit:logic
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

type Draft = { productId: string; saleUnit: string; conversionFactor: number; isCanonical: boolean };

// ─── Espejo de addProduct (inventory-fusion-manager.tsx) ────────────────────
// isFirst -> canónico, factor 1. Cualquier otro -> factor 0 (nunca un estado
// compartido de pantalla completa, nunca 1 por default).
function addProduct(members: Draft[], productId: string, suggestedUnit: string): Draft[] {
  const isFirst = members.length === 0;
  return [...members, { productId, saleUnit: suggestedUnit, conversionFactor: isFirst ? 1 : 0, isCanonical: isFirst }];
}

// ─── Espejo de markAsBase ────────────────────────────────────────────────────
// Cambiar la base invalida TODOS los factores de los demás — se ponen en 0,
// nunca se arrastran (equivalencias falsas que nadie revisa).
function markAsBase(members: Draft[], productId: string): Draft[] {
  return members.map((m) => (
    m.productId === productId
      ? { ...m, isCanonical: true, conversionFactor: 1 }
      : { ...m, isCanonical: false, conversionFactor: 0 }
  ));
}

// ── Test 10: agregar dos productos seguidos — ambos con factor 0 ───────────

describe("Test 10: agregar productos seguidos en el asistente", () => {
  it("el primero (canónico) llega con factor 1; el segundo y el tercero llegan con factor 0", () => {
    let members: Draft[] = [];
    members = addProduct(members, "p-lata", "UNIDAD");
    assert.equal(members[0].conversionFactor, 1);
    assert.equal(members[0].isCanonical, true);

    members = addProduct(members, "p-palada", "UNIDAD");
    members = addProduct(members, "p-metro", "UNIDAD");

    assert.equal(members[1].conversionFactor, 0, "el 2do producto no hereda ningún factor compartido");
    assert.equal(members[2].conversionFactor, 0, "el 3ro tampoco — cada fila exige su propio factor");
    assert.equal(members[1].isCanonical, false);
    assert.equal(members[2].isCanonical, false);
  });

  it("la validación de 'Continuar' no deja avanzar hasta cargar cada factor", () => {
    let members: Draft[] = [];
    members = addProduct(members, "p-lata", "LATA");
    members = addProduct(members, "p-palada", "PALADA");
    members = addProduct(members, "p-metro", "METRO");

    const hasMissingFactor = members.some((m) => !m.isCanonical && !(m.conversionFactor > 0));
    assert.equal(hasMissingFactor, true, "con los tres recién agregados, la validación debe bloquear 'Continuar'");

    members = members.map((m) => (m.isCanonical ? m : { ...m, conversionFactor: m.productId === "p-palada" ? 8 : 176 }));
    assert.equal(members.some((m) => !m.isCanonical && !(m.conversionFactor > 0)), false, "cargados los factores, ya no bloquea");
  });
});

// ── Test 11: cambiar la base — los factores de las demás vuelven a 0 ───────

describe("Test 11: cambiar cuál presentación es la base", () => {
  it("los factores de las demás presentaciones vuelven a 0 (no se arrastran)", () => {
    let members: Draft[] = [
      { productId: "p-lata", saleUnit: "LATA", conversionFactor: 1, isCanonical: true },
      { productId: "p-palada", saleUnit: "PALADA", conversionFactor: 8, isCanonical: false },
      { productId: "p-metro", saleUnit: "METRO", conversionFactor: 176, isCanonical: false },
    ];

    members = markAsBase(members, "p-metro");

    const metro = members.find((m) => m.productId === "p-metro")!;
    const lata = members.find((m) => m.productId === "p-lata")!;
    const palada = members.find((m) => m.productId === "p-palada")!;

    assert.equal(metro.isCanonical, true);
    assert.equal(metro.conversionFactor, 1);
    assert.equal(lata.isCanonical, false);
    assert.equal(lata.conversionFactor, 0, "LATA ya no es la base — su factor viejo (implícito 1) no se arrastra");
    assert.equal(palada.isCanonical, false);
    assert.equal(palada.conversionFactor, 0, "el factor 8 (contra la base anterior) ya no significa lo mismo");
  });
});
