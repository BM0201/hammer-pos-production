import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adjustPriority, verdictFor, verdictForScope, learningKey, type LearningBook } from "@/modules/brain/learning";
import { judgePriceChange, summarizeLines } from "@/modules/brain/outcomes";

const rec = (acted: number, notApplicable: number, measuredGood = 0, measuredBad = 0, ignored = 0) => ({ acted, notApplicable, measuredGood, measuredBad, ignored });

describe("lo que Brain aprende de tus respuestas", () => {
  it("con menos de 5 respuestas no saca conclusiones", () => {
    const v = verdictFor(rec(3, 1));
    assert.equal(v.level, "LEARNING");
    assert.equal(v.priorityFactor, 1);
    assert.match(v.text, /4 de 5/);
  });

  it("si casi siempre actuás, sube; si casi siempre es 'No aplica', baja", () => {
    assert.equal(verdictFor(rec(8, 2)).level, "USEFUL");
    assert.equal(verdictFor(rec(8, 2)).priorityFactor, 1.15);
    const down = verdictFor(rec(2, 8));
    assert.equal(down.level, "NOT_USEFUL");
    assert.equal(down.priorityFactor, 0.7);
    assert.match(down.text, /no la esconde/);
    assert.equal(verdictFor(rec(5, 5)).level, "NORMAL");
  });

  it("lo que hiciste pero salió mal a los 7 días no cuenta como que te sirvió", () => {
    // 8 actuadas, pero 6 de esas salieron mal → útiles 2 de 10.
    const v = verdictFor(rec(8, 2, 2, 6));
    assert.equal(v.level, "NOT_USEFUL");
    assert.match(v.text, /2 salieron bien y 6 no/);
  });

  it("la sucursal manda solo cuando ya tiene 5 respuestas propias", () => {
    const key = learningKey("REVIEW_PRICE_MARGIN_POLICY", "PRICING");
    const book: LearningBook = {
      byType: new Map([[key, rec(9, 1)]]),
      byTypeBranch: new Map([[`${key}|MSY`, rec(0, 6)], [`${key}|RIV`, rec(0, 2)]]),
    };
    assert.equal(verdictForScope(book, key, "MSY").level, "NOT_USEFUL");
    assert.equal(verdictForScope(book, key, "RIV").level, "USEFUL"); // pocas propias → usa todas
    assert.equal(verdictForScope(book, key, null).level, "USEFUL");
  });

  it("lo que nadie toca en 30 días también le enseña: baja aunque nadie conteste", () => {
    const v = verdictFor(rec(0, 0, 0, 0, 12));
    assert.equal(v.level, "IGNORED");
    assert.equal(v.priorityFactor, 0.7);
    assert.match(v.text, /12 llevan más de 30 días abiertas/);
    assert.equal(verdictFor(rec(0, 0, 0, 0, 3)).level, "LEARNING");
    // Si actuás en la mayoría, lo ignorado no la hunde.
    assert.equal(verdictFor(rec(8, 0, 0, 0, 2)).level, "USEFUL");
  });

  it("una CRÍTICA nunca baja de prioridad", () => {
    assert.equal(adjustPriority(80, "CRITICAL", 0.7), 80);
    assert.equal(adjustPriority(80, "MEDIUM", 0.7), 56);
    assert.equal(adjustPriority(90, "HIGH", 1.15), 100); // tope 100
  });
});

describe("¿el cambio de precio dejó más plata?", () => {
  it("compara ganancia antes y después cuando hay costo", () => {
    const before = summarizeLines([{ quantity: 10, lineSubtotal: 1000, costSnapshot: 95 }]); // ganancia 50
    const after = summarizeLines([{ quantity: 9, lineSubtotal: 1080, costSnapshot: 95 }]); // ganancia 225
    const r = judgePriceChange(before, after, 14);
    assert.equal(r.successScore, 75);
    assert.equal(r.actualImpact, 175);
    assert.match(r.notes, /ganancia/);
  });

  it("si vendiste mucho menos y ganaste menos, salió mal", () => {
    const r = judgePriceChange(
      summarizeLines([{ quantity: 20, lineSubtotal: 2000, costSnapshot: 80 }]), // 400
      summarizeLines([{ quantity: 5, lineSubtotal: 600, costSnapshot: 80 }]), // 200
      7,
    );
    assert.equal(r.successScore, 30);
    assert.match(r.notes, /Dejó menos/);
  });

  it("sin costo compara la venta; sin ventas no opina", () => {
    const r = judgePriceChange(summarizeLines([{ quantity: 1, lineSubtotal: 100, costSnapshot: null }]), summarizeLines([{ quantity: 1, lineSubtotal: 120, costSnapshot: 90 }]), 7);
    assert.match(r.notes, /de venta/);
    assert.equal(judgePriceChange(summarizeLines([]), summarizeLines([]), 7).successScore, null);
  });
});
