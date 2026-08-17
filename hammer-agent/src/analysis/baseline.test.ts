import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createBaseline, observe, isCalibrated, frozenThreshold, blurryThreshold } from "./baseline.ts";

describe("baseline: calibración", () => {
  it("arranca sin calibrar", () => {
    assert.equal(isCalibrated(createBaseline()), false);
  });

  it("se calibra tras suficientes observaciones", () => {
    let b = createBaseline();
    for (let i = 0; i < 30; i += 1) {
      b = observe(b, { frameDifference: 0.01, laplacianVariance: 200 });
    }
    assert.equal(isCalibrated(b), true);
  });

  it("no calibrada -> usa el piso por defecto, no explota", () => {
    const b = createBaseline();
    assert.ok(frozenThreshold(b) > 0);
    assert.ok(blurryThreshold(b) > 0);
  });
});

describe("baseline: bodega quieta de noche no es FROZEN", () => {
  it("una cámara con ruido de sensor bajo pero real no cruza su propio umbral de frozen", () => {
    let b = createBaseline();
    // Escena quieta: diff siempre chico pero nunca cero (ruido del sensor).
    for (let i = 0; i < 200; i += 1) {
      b = observe(b, { frameDifference: 0.004 + (i % 3) * 0.0005, laplacianVariance: 180 });
    }
    const threshold = frozenThreshold(b);
    // El "quieto normal" de esta cámara (~0.004) debe quedar POR ENCIMA del
    // umbral de frozen -- si no, cada noche tranquila dispararía la alarma.
    assert.ok(0.004 > threshold, `el ruido normal (0.004) debería estar por encima del umbral (${threshold})`);
  });

  it("un freeze real (diff exactamente 0 sostenido) sí cruza el umbral de esa misma cámara", () => {
    let b = createBaseline();
    for (let i = 0; i < 200; i += 1) {
      b = observe(b, { frameDifference: 0.004 + (i % 3) * 0.0005, laplacianVariance: 180 });
    }
    const threshold = frozenThreshold(b);
    assert.ok(0 <= threshold, `un cuadro repetido exacto (diff=0) debe estar en o bajo el umbral (${threshold})`);
  });
});

describe("baseline: umbral de nitidez por cámara", () => {
  it("una cámara naturalmente poco nítida (lente barato) no queda con un umbral imposible de superar", () => {
    let b = createBaseline();
    for (let i = 0; i < 100; i += 1) {
      b = observe(b, { frameDifference: 0.02, laplacianVariance: 40 + (i % 5) });
    }
    const threshold = blurryThreshold(b);
    assert.ok(40 > threshold, `la nitidez normal de esta cámara (40) debería estar por encima de su umbral (${threshold})`);
  });
});
