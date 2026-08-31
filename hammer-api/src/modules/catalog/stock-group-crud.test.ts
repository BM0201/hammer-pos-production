import assert from "node:assert/strict";
import test from "node:test";
import { computeFusionMemberGlobalCost } from "@/modules/catalog/stock-group-crud";

/**
 * "es para poner el precio... una nueva linea que sea costo global de
 * fusiones, para que se entienda y no exista problemas con el WAC,
 * basandose solo en eso" — el apartado Fusiones (Catálogo e Inventario)
 * muestra el costo de compra por presentación basado ÚNICAMENTE en
 * globalCost (nunca WAC, averageCost ni branchCost — esos son los que
 * generaron la confusión de sesiones anteriores). computeFusionMemberGlobalCost
 * es la lectura pura de esa regla — la contraparte de resolveGlobalCostWriteTarget
 * (catalog/service.ts), que es la escritura.
 */

test("Prueba LA QUE IMPORTA — canónico con globalCost 26, derivado factor 30 → 26 × 30 = 780, nada de WAC en el medio", () => {
  const result = computeFusionMemberGlobalCost({
    isCanonical: false,
    ownGlobalCost: null, // un derivado NUNCA tiene su propio costo — no se lee aunque existiera
    canonicalGlobalCost: 26,
    conversionFactor: 30,
  });
  assert.equal(result, 780);
});

test("canónico → devuelve su propio globalCost tal cual, sin multiplicar por factor", () => {
  const result = computeFusionMemberGlobalCost({
    isCanonical: true,
    ownGlobalCost: 26,
    canonicalGlobalCost: 26,
    conversionFactor: 1,
  });
  assert.equal(result, 26);
});

test("canónico sin costo cargado (null) → null, no cero — cero sería un costo real, null es 'nadie lo puso'", () => {
  const result = computeFusionMemberGlobalCost({ isCanonical: true, ownGlobalCost: null, canonicalGlobalCost: null, conversionFactor: 1 });
  assert.equal(result, null);
});

test("derivado cuando el canónico no tiene costo cargado → null (no se puede derivar de la nada)", () => {
  const result = computeFusionMemberGlobalCost({
    isCanonical: false,
    ownGlobalCost: null,
    canonicalGlobalCost: null,
    conversionFactor: 30,
  });
  assert.equal(result, null);
});

test("un derivado con ownGlobalCost propio (dato viejo/corrupto, no debería existir) se IGNORA — siempre gana canonicalGlobalCost × factor", () => {
  const result = computeFusionMemberGlobalCost({
    isCanonical: false,
    ownGlobalCost: 999, // basura que no debería estar ahí — la regla de "el derivado nunca guarda su costo" sigue firme
    canonicalGlobalCost: 26,
    conversionFactor: 30,
  });
  assert.equal(result, 780, "el campo propio del derivado se ignora siempre, exactamente la regla que corrigió el desfase 18.6× de arena");
});

test("caso real de arena: LATA (canónico) × 25 = METRO → 48 × 25 = 1200", () => {
  const result = computeFusionMemberGlobalCost({ isCanonical: false, ownGlobalCost: null, canonicalGlobalCost: 48, conversionFactor: 25 });
  assert.equal(result, 1200);
});
