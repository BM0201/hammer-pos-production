import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSustain, feed } from "./sustain.ts";

describe("sustain: confirmación requiere N observaciones seguidas", () => {
  it("una sola observación distinta no confirma el cambio", () => {
    let s = createSustain("OK");
    s = feed(s, "OFFLINE", 3);
    assert.equal(s.confirmed, "OK");
    assert.equal(s.pending, "OFFLINE");
    assert.equal(s.pendingCount, 1);
  });

  it("N observaciones seguidas sí confirman", () => {
    let s = createSustain("OK");
    s = feed(s, "OFFLINE", 3);
    s = feed(s, "OFFLINE", 3);
    s = feed(s, "OFFLINE", 3);
    assert.equal(s.confirmed, "OFFLINE");
  });

  it("una observación distinta en el medio reinicia el conteo (no promedia)", () => {
    let s = createSustain("OK");
    s = feed(s, "OFFLINE", 3);
    s = feed(s, "OFFLINE", 3);
    s = feed(s, "OK", 3); // vuelve a lo confirmado -> limpia pendiente
    s = feed(s, "OFFLINE", 3);
    assert.equal(s.confirmed, "OK", "todavía no debería confirmar, el conteo se reinició");
    assert.equal(s.pendingCount, 1);
  });

  it("la cámara que oscila OK/OFFLINE cada ciclo nunca confirma el cambio (antirruido)", () => {
    let s = createSustain("OK");
    for (let i = 0; i < 10; i += 1) {
      s = feed(s, i % 2 === 0 ? "OFFLINE" : "OK", 3);
    }
    assert.equal(s.confirmed, "OK", "nunca sostuvo OFFLINE 3 veces seguidas, no debe haber confirmado el cambio");
  });

  it("tras confirmar, tres observaciones del valor previo lo revierten (recuperación)", () => {
    let s = createSustain("OK");
    s = feed(s, "OFFLINE", 3);
    s = feed(s, "OFFLINE", 3);
    s = feed(s, "OFFLINE", 3);
    assert.equal(s.confirmed, "OFFLINE");
    s = feed(s, "OK", 3);
    s = feed(s, "OK", 3);
    s = feed(s, "OK", 3);
    assert.equal(s.confirmed, "OK");
  });
});
