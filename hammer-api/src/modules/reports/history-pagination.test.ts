import assert from "node:assert/strict";
import test from "node:test";

/**
 * Auditoría 2026-07-22 (ALTO Reportes): /api/master/history mezcla 4 fuentes
 * (ventas, pagos, producción, días operativos) ordenadas por fecha. El bug:
 * cada fuente se paginaba de forma INDEPENDIENTE (mismo skip=(page-1)*limit
 * por fuente), pero la página 2 del listado GLOBAL ya intercalado no
 * corresponde a "los siguientes N de cada fuente" — así que una fuente poco
 * frecuente (ej. producción) perdía registros (saltados) mientras una fuente
 * muy frecuente (ej. pagos) los repetía.
 *
 * El fix: cada fuente trae TODO desde el inicio hasta el corte de esta
 * página (page*limit, sin skip), se mezcla, se ordena por fecha global y
 * recién ahí se corta la ventana exacta de la página.
 *
 * Este test simula el escenario exacto: una fuente frecuente ("payment", 50
 * registros) y una poco frecuente ("production", 3 registros), con limit=10,
 * y compara la estrategia vieja (buggy) contra la nueva (fix) frente al
 * "ground truth" de mezclar TODO y paginar una sola vez al final.
 */

type Entry = { id: string; date: number };

function buildSources() {
  // "payment": un registro por dia, del mas reciente (dia 0) al mas viejo (dia 49).
  const payments: Entry[] = Array.from({ length: 50 }, (_, i) => ({ id: `payment-${i}`, date: 1000 - i }));
  // "production": solo 3 registros, intercalados cerca del tope (dias 2, 15, 40).
  const production: Entry[] = [
    { id: "production-0", date: 998 },
    { id: "production-1", date: 985 },
    { id: "production-2", date: 960 },
  ];
  return { payments, production };
}

function groundTruthPage(page: number, limit: number): Entry[] {
  const { payments, production } = buildSources();
  const merged = [...payments, ...production].sort((a, b) => b.date - a.date);
  return merged.slice((page - 1) * limit, page * limit);
}

// Estrategia BUGGY (antes del fix): take=limit, skip=(page-1)*limit POR FUENTE.
function buggyPage(page: number, limit: number): Entry[] {
  const { payments, production } = buildSources();
  const skip = (page - 1) * limit;
  const paymentsPage = payments.slice(skip, skip + limit);
  const productionPage = production.slice(skip, skip + limit);
  const merged = [...paymentsPage, ...productionPage].sort((a, b) => b.date - a.date);
  return merged.slice(0, limit);
}

// Estrategia FIX: take=page*limit (sin skip) POR FUENTE, merge, sort, y recien
// ahi se corta la ventana exacta de la pagina.
function fixedPage(page: number, limit: number): Entry[] {
  const { payments, production } = buildSources();
  const fetchDepth = page * limit;
  const paymentsPage = payments.slice(0, fetchDepth);
  const productionPage = production.slice(0, fetchDepth);
  const merged = [...paymentsPage, ...productionPage].sort((a, b) => b.date - a.date);
  return merged.slice((page - 1) * limit, page * limit);
}

test("bug documentado: la estrategia vieja salta el registro de production en la pagina 2", () => {
  const truth = groundTruthPage(2, 10).map((e) => e.id);
  const buggy = buggyPage(2, 10).map((e) => e.id);

  // production-1 (dia 985) SI pertenece a la pagina 2 real...
  assert.ok(truth.includes("production-1"), "el ground truth debe incluir production-1 en la pagina 2");
  // ...pero la estrategia vieja lo salta: production.slice(10,20) esta vacio (production solo tiene 3 items).
  assert.ok(!buggy.includes("production-1"), "la estrategia vieja salta production-1 (bug reproducido)");
});

test("fix: la nueva estrategia coincide exactamente con el ground truth en la pagina 2", () => {
  const truth = groundTruthPage(2, 10).map((e) => e.id);
  const fixed = fixedPage(2, 10).map((e) => e.id);
  assert.deepEqual(fixed, truth);
});

test("fix: tambien coincide en la pagina 1 y la pagina 5, sin duplicados entre paginas", () => {
  const limit = 10;
  const seen = new Set<string>();
  for (let page = 1; page <= 5; page++) {
    const truth = groundTruthPage(page, limit).map((e) => e.id);
    const fixed = fixedPage(page, limit).map((e) => e.id);
    assert.deepEqual(fixed, truth, `pagina ${page} debe coincidir con el ground truth`);
    for (const id of fixed) {
      assert.ok(!seen.has(id), `${id} no debe repetirse entre paginas (visto en pagina ${page})`);
      seen.add(id);
    }
  }
});
