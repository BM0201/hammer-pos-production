import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { paydayFor, nextPayday } from "./payday-calendar";

describe("Test 5: 2ª quincena con el día 30 cayendo domingo", () => {
  it("paydayFor(2026, 8, 2) -> 29 de agosto, no el 30 ni el 31", () => {
    const result = paydayFor(2026, 8, 2);
    assert.equal(result.date.getUTCFullYear(), 2026);
    assert.equal(result.date.getUTCMonth(), 7); // agosto, 0-indexado
    assert.equal(result.date.getUTCDate(), 29);
    assert.equal(result.adjustedReason, "SUNDAY");
    assert.equal(result.adjusted, true);
  });
});

describe("Test 6: mes sin día 30 (febrero)", () => {
  it("paydayFor(2026, 2, 2) -> 28 de febrero, SHORT_MONTH", () => {
    const result = paydayFor(2026, 2, 2);
    assert.equal(result.date.getUTCDate(), 28);
    assert.equal(result.adjustedReason, "SHORT_MONTH");
    assert.equal(result.adjusted, true);
  });
});

describe("Test 7: independiente de la zona horaria del proceso", () => {
  it("el resultado es idéntico sin importar process.env.TZ", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "UTC";
      const utcResult = paydayFor(2026, 8, 2);
      process.env.TZ = "America/Managua";
      const managuaResult = paydayFor(2026, 8, 2);
      assert.equal(utcResult.date.getTime(), managuaResult.date.getTime());
      assert.equal(utcResult.date.getUTCDate(), 29);
      assert.equal(managuaResult.date.getUTCDate(), 29);
    } finally {
      if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
    }
  });

  it("se construye al mediodía de Managua (18:00 UTC) — ningún corte de día lo mueve", () => {
    const result = paydayFor(2026, 8, 1); // 1ª quincena de un mes cualquiera, sin ajustes
    assert.equal(result.date.getUTCHours(), 18);
  });
});

describe("Test 9: ninguna fecha generada cae en domingo, en ningún mes de un año completo", () => {
  it("los 24 paydays de 2026 (dos por mes) nunca caen domingo", () => {
    for (let month = 1; month <= 12; month += 1) {
      for (const half of [1, 2] as const) {
        const result = paydayFor(2026, month, half);
        assert.notEqual(result.date.getUTCDay(), 0, `${result.date.toISOString()} (mes ${month}, quincena ${half}) cayó domingo`);
      }
    }
  });

  it("también se cumple en 2027 y 2028 (evita que sea casualidad de un solo año)", () => {
    for (const year of [2027, 2028]) {
      for (let month = 1; month <= 12; month += 1) {
        for (const half of [1, 2] as const) {
          const result = paydayFor(year, month, half);
          assert.notEqual(result.date.getUTCDay(), 0);
        }
      }
    }
  });
});

describe("nextPayday: pregunta de calendario ('¿cuál es el próximo día de pago?')", () => {
  it("16 de agosto 2026 (mediodía Managua) -> sigue devolviendo la 2ª quincena (correcto para el widget de próximo pago)", () => {
    const now = new Date(Date.UTC(2026, 7, 16, 18, 0, 0)); // 16 ago, mediodía Managua
    const result = nextPayday(now);
    assert.equal(result.half, 2);
    assert.equal(result.year, 2026);
    assert.equal(result.month, 8);
    assert.equal(result.date.getUTCDate(), 29, "2ª quincena de agosto 2026 ajustada por domingo");
  });

  it("13 de agosto 2026 -> todavía la 1ª quincena (15 de agosto no ha pasado)", () => {
    const now = new Date(Date.UTC(2026, 7, 13, 18, 0, 0));
    const result = nextPayday(now);
    assert.equal(result.half, 1);
    assert.equal(result.date.getUTCDate(), 15);
  });

  it("31 de diciembre 2026 -> pasa al año siguiente sin desbordar (1ª quincena de enero 2027)", () => {
    const now = new Date(Date.UTC(2026, 11, 31, 18, 0, 0));
    const result = nextPayday(now);
    assert.equal(result.half, 1);
    assert.equal(result.year, 2027);
    assert.equal(result.month, 1);
    assert.equal(result.date.getUTCFullYear(), 2027);
  });

  it("resuelve 'hoy' en America/Managua, no en la hora del proceso", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "Asia/Tokyo"; // UTC+9 — el día calendario ahí puede diferir del de Managua
      const now = new Date(Date.UTC(2026, 7, 16, 18, 0, 0)); // 16 ago mediodía Managua == 17 ago 03:00 Tokio
      const result = nextPayday(now);
      assert.equal(result.half, 2, "debe seguir viendo el 16 de agosto en Managua, no el 17 en Tokio");
    } finally {
      if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
    }
  });
});

describe("paydayFor: casos base", () => {
  it("1ª quincena en un mes sin ajustes -> día 15 exacto", () => {
    // 2026-06-15 es lunes -> sin ajuste de domingo.
    const result = paydayFor(2026, 6, 1);
    assert.equal(result.date.getUTCDate(), 15);
    assert.equal(result.nominalDay, 15);
    assert.equal(result.adjusted, false);
    assert.equal(result.adjustedReason, null);
  });

  it("2ª quincena en un mes de 31 días sin domingo -> día 30 exacto", () => {
    // 2026-05-30 es sábado -> sin ajuste.
    const result = paydayFor(2026, 5, 2);
    assert.equal(result.date.getUTCDate(), 30);
    assert.equal(result.adjusted, false);
  });

  it("nominalDay siempre es 15 o 30, incluso cuando el resultado quedó ajustado", () => {
    assert.equal(paydayFor(2026, 8, 2).nominalDay, 30);
    assert.equal(paydayFor(2026, 2, 2).nominalDay, 30);
  });
});
