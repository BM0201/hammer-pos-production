import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classify, type ClassifyInput } from "./classifier.ts";
import { createBaseline, observe } from "./baseline.ts";
import type { GrayFrame } from "./frame-metrics.ts";

function solid(width: number, height: number, value: number): GrayFrame {
  return { width, height, pixels: new Uint8Array(width * height).fill(value) };
}

function checkerboard(width: number, height: number, offset = 0): GrayFrame {
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels[y * width + x] = (x + y + offset) % 2 === 0 ? 40 : 220;
    }
  }
  return { width, height, pixels };
}

const negocioNormal = { startHour: 6, endHour: 20 };
const okConnectivity = { icmpReachable: true, tcpReachable: true, rtspOpened: true };

function calibratedBaseline(frame: GrayFrame, cycles = 60) {
  let b = createBaseline();
  for (let i = 0; i < cycles; i += 1) {
    b = observe(b, { frameDifference: 0.01, laplacianVariance: 900 });
  }
  return b;
}

function baseInput(overrides: Partial<ClassifyInput>): ClassifyInput {
  return {
    connectivity: okConnectivity,
    frame: checkerboard(16, 16),
    previousFrame: checkerboard(16, 16, 1),
    baseline: calibratedBaseline(checkerboard(16, 16)),
    localHour: 12,
    litHours: negocioNormal,
    streamProfile: null,
    ...overrides,
  };
}

describe("classify: gates de conectividad, en orden", () => {
  it("ni ICMP ni TCP responden -> OFFLINE", () => {
    const state = classify(baseInput({ connectivity: { icmpReachable: false, tcpReachable: false, rtspOpened: false } }));
    assert.equal(state, "OFFLINE");
  });

  it("responde ping/TCP pero RTSP no abre -> NO_STREAM", () => {
    const state = classify(baseInput({ connectivity: { icmpReachable: true, tcpReachable: true, rtspOpened: false } }));
    assert.equal(state, "NO_STREAM");
  });

  it("RTSP abre pero no llega ningún cuadro -> NO_FRAMES", () => {
    const state = classify(baseInput({ frame: null }));
    assert.equal(state, "NO_FRAMES");
  });
});

describe("classify: FROZEN — la cámara respondiendo a ping con imagen muerta", () => {
  it("cuadro idéntico al anterior -> FROZEN, no OK (caso 7 del prompt)", () => {
    const frame = checkerboard(16, 16);
    const state = classify(baseInput({
      frame,
      previousFrame: frame,
      baseline: calibratedBaseline(frame),
    }));
    assert.equal(state, "FROZEN");
  });

  it("primer ciclo sin cuadro previo -> no puede evaluar FROZEN, sigue a las demás señales", () => {
    const state = classify(baseInput({ previousFrame: null }));
    assert.notEqual(state, "FROZEN");
  });
});

describe("classify: BLACK calibrado contra el horario, no el reloj", () => {
  it("cuadro negro a las 2am -> NO dispara BLACK (caso 8 del prompt)", () => {
    const black = solid(16, 16, 0);
    const state = classify(baseInput({
      frame: black,
      previousFrame: black,
      baseline: calibratedBaseline(black),
      localHour: 2,
    }));
    assert.notEqual(state, "BLACK");
  });

  it("cuadro negro a mediodía (dentro del horario del negocio) -> BLACK", () => {
    const black = solid(16, 16, 0);
    const state = classify(baseInput({
      frame: black,
      previousFrame: solid(16, 16, 1), // distinto del actual, para no confundir con FROZEN
      baseline: calibratedBaseline(black),
      localHour: 12,
    }));
    assert.equal(state, "BLACK");
  });
});

describe("classify: BLURRY", () => {
  it("cuadro liso (sin detalle), cámara que normalmente es nítida -> BLURRY", () => {
    const sharp = checkerboard(16, 16);
    const blurry = solid(16, 16, 128);
    const state = classify(baseInput({
      frame: blurry,
      previousFrame: solid(16, 16, 130), // distinto, evita FROZEN
      baseline: calibratedBaseline(sharp), // esta cámara aprendió que "nítido" es su normal
      localHour: 12,
    }));
    assert.equal(state, "BLURRY");
  });
});

describe("classify: MOVED", () => {
  it("la escena cambia de forma abrupta entre ciclos -> MOVED", () => {
    const state = classify(baseInput({
      frame: solid(16, 16, 250),
      previousFrame: solid(16, 16, 10),
      baseline: calibratedBaseline(checkerboard(16, 16)),
    }));
    assert.equal(state, "MOVED");
  });
});

describe("classify: DEGRADED", () => {
  it("bitrate y resolución muy por debajo del perfil declarado -> DEGRADED", () => {
    const state = classify(baseInput({
      streamProfile: {
        expectedBitrateKbps: 2000, expectedWidth: 1920, expectedHeight: 1080,
        actualBitrateKbps: 300, actualWidth: 640, actualHeight: 360,
      },
    }));
    assert.equal(state, "DEGRADED");
  });

  it("dentro de rango razonable del perfil -> no DEGRADED", () => {
    const state = classify(baseInput({
      streamProfile: {
        expectedBitrateKbps: 2000, expectedWidth: 1920, expectedHeight: 1080,
        actualBitrateKbps: 1800, actualWidth: 1920, actualHeight: 1080,
      },
    }));
    assert.notEqual(state, "DEGRADED");
  });
});

describe("classify: OK", () => {
  it("todo normal -> OK", () => {
    const state = classify(baseInput({}));
    assert.equal(state, "OK");
  });
});

describe("classify: prioridad — OFFLINE gana sobre cualquier otra señal", () => {
  it("aunque el cuadro fuera 'congelado', si no hay conectividad es OFFLINE", () => {
    const frame = checkerboard(16, 16);
    const state = classify(baseInput({
      connectivity: { icmpReachable: false, tcpReachable: false, rtspOpened: false },
      frame,
      previousFrame: frame,
    }));
    assert.equal(state, "OFFLINE");
  });
});
