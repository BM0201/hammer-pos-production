import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  meanLuminance,
  laplacianVariance,
  frameDifference,
  luminanceHistogram,
  histogramDistance,
  type GrayFrame,
} from "./frame-metrics.ts";

function solid(width: number, height: number, value: number): GrayFrame {
  return { width, height, pixels: new Uint8Array(width * height).fill(value) };
}

function checkerboard(width: number, height: number): GrayFrame {
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels[y * width + x] = (x + y) % 2 === 0 ? 0 : 255;
    }
  }
  return { width, height, pixels };
}

describe("meanLuminance", () => {
  it("cuadro negro -> 0", () => {
    assert.equal(meanLuminance(solid(8, 8, 0)), 0);
  });
  it("cuadro blanco -> 255", () => {
    assert.equal(meanLuminance(solid(8, 8, 255)), 255);
  });
  it("mitad y mitad -> promedio", () => {
    const pixels = new Uint8Array(4);
    pixels[0] = 0; pixels[1] = 0; pixels[2] = 255; pixels[3] = 255;
    assert.equal(meanLuminance({ width: 2, height: 2, pixels }), 127.5);
  });
});

describe("laplacianVariance", () => {
  it("cuadro liso (sin detalle) -> varianza 0 -> BLURRY candidato", () => {
    assert.equal(laplacianVariance(solid(8, 8, 120)), 0);
  });
  it("tablero de ajedrez (mucho detalle) -> varianza alta -> nítido", () => {
    const v = laplacianVariance(checkerboard(8, 8));
    assert.ok(v > 1000, `esperaba varianza alta, dio ${v}`);
  });
  it("liso < tablero, siempre", () => {
    const flat = laplacianVariance(solid(16, 16, 200));
    const sharp = laplacianVariance(checkerboard(16, 16));
    assert.ok(flat < sharp);
  });
});

describe("frameDifference", () => {
  it("cuadros idénticos -> 0", () => {
    const f = checkerboard(8, 8);
    assert.equal(frameDifference(f, f), 0);
  });
  it("negro vs blanco -> diferencia máxima (1)", () => {
    assert.equal(frameDifference(solid(4, 4, 0), solid(4, 4, 255)), 1);
  });
  it("tamaños distintos -> lanza", () => {
    assert.throws(() => frameDifference(solid(4, 4, 0), solid(8, 8, 0)), /FRAME_SIZE_MISMATCH/);
  });
});

describe("luminanceHistogram", () => {
  it("cuadro negro con 16 bins -> todo en el primer balde, suma 1", () => {
    const h = luminanceHistogram(solid(8, 8, 0), 16);
    assert.equal(h.length, 16);
    assert.equal(h[0], 1);
    assert.equal(h.slice(1).every((v) => v === 0), true);
    assert.ok(Math.abs(h.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  });
});

describe("histogramDistance", () => {
  it("histogramas idénticos -> 0", () => {
    const h = luminanceHistogram(checkerboard(8, 8), 16);
    assert.equal(histogramDistance(h, h), 0);
  });
  it("histogramas disjuntos (negro vs blanco) -> 1 (máximo)", () => {
    const black = luminanceHistogram(solid(8, 8, 0), 16);
    const white = luminanceHistogram(solid(8, 8, 255), 16);
    assert.equal(histogramDistance(black, white), 1);
  });
  it("bins distintos -> lanza", () => {
    assert.throws(() => histogramDistance([1], [0.5, 0.5]), /HISTOGRAM_SIZE_MISMATCH/);
  });
});
