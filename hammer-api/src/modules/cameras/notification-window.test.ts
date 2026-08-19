import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldFireNotification, wasNotifiedThisEpisode } from "./notification-window";

const WINDOW = 3 * 60 * 1000;

describe("shouldFireNotification: antirruido por tiempo, no por ciclos", () => {
  it("el cambio acaba de ocurrir (0 min) -> no avisa todavía", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    assert.equal(shouldFireNotification({ changedAt: now, notifiedAt: null, now, windowMs: WINDOW }), false);
  });

  it("una cámara que oscila cada minuto nunca acumula 3 minutos seguidos -> nunca avisa (caso 5 del prompt)", () => {
    // Simula: cada vez que cambia de estado, changedAt se resetea (fila nueva).
    // Con oscilación cada 1 min, el máximo elapsed antes del próximo cambio es 1 min < 3.
    const changedAt = new Date("2026-01-01T00:00:00Z");
    const oneMinuteLater = new Date(changedAt.getTime() + 60_000);
    assert.equal(shouldFireNotification({ changedAt, notifiedAt: null, now: oneMinuteLater, windowMs: WINDOW }), false);
  });

  it("sostenido 3 minutos exactos -> ya avisa", () => {
    const changedAt = new Date("2026-01-01T00:00:00Z");
    const now = new Date(changedAt.getTime() + WINDOW);
    assert.equal(shouldFireNotification({ changedAt, notifiedAt: null, now, windowMs: WINDOW }), true);
  });

  it("ya se avisó este episodio -> no vuelve a avisar aunque siga fallando", () => {
    const changedAt = new Date("2026-01-01T00:00:00Z");
    const notifiedAt = new Date(changedAt.getTime() + WINDOW);
    const now = new Date(changedAt.getTime() + WINDOW * 5);
    assert.equal(shouldFireNotification({ changedAt, notifiedAt, now, windowMs: WINDOW }), false);
  });
});

describe("wasNotifiedThisEpisode", () => {
  it("null -> no se avisó (no corresponde aviso de recuperación)", () => {
    assert.equal(wasNotifiedThisEpisode(null), false);
  });
  it("con fecha -> sí se avisó", () => {
    assert.equal(wasNotifiedThisEpisode(new Date()), true);
  });
});
