import assert from "node:assert/strict";
import test from "node:test";
import { DECISION_CATALOG } from "@/modules/brain/decision-catalog";
import { buildDecisionSuggestion, HELP_BY_TYPE } from "@/modules/brain/suggestions";

const base = { category: "PRICING", status: "OPEN", href: "/app/master/pricing?tab=tray", evidence: {}, action: {} };

test("todo tipo del catálogo tiene ayuda propia", () => {
  const missing = Object.keys(DECISION_CATALOG).filter((type) => !HELP_BY_TYPE[type]);
  assert.deepEqual(missing, []);
});

test("bajo el costo con sugerido → recomienda aplicar el precio, sin 'mantener'", () => {
  const s = buildDecisionSuggestion({ ...base, proposedActionType: "REVIEW_PRICE_BELOW_COST", evidence: { effectiveCost: 100 }, action: { currentPrice: 90, suggestedPrice: 130 } });
  assert.equal(s.recommended?.kind, "APPLY_PRICE");
  assert.equal(s.recommended?.price, 130);
  assert.equal(s.recommended?.needsConfirm, true);
  assert.match(s.recommended!.explain, /C\$ 90\.00.*C\$ 130\.00.*margen 23\.1%/);
  assert.ok(!s.alternatives.some((o) => o.kind === "KEEP_PRICE"));
  assert.deepEqual(s.alternatives.map((o) => o.kind), ["GO_RESOLVE", "RESOLVE"]);
});

test("margen bajo → aplicar recomendado y mantener como alternativa", () => {
  const s = buildDecisionSuggestion({ ...base, proposedActionType: "REVIEW_PRICE_MARGIN_POLICY", action: { currentPrice: 110, suggestedPrice: 130 } });
  assert.equal(s.recommended?.kind, "APPLY_PRICE");
  assert.equal(s.alternatives[0].kind, "KEEP_PRICE");
});

test("costo dudoso → nunca ofrece aplicar ni mantener, manda a revisar el costo", () => {
  const s = buildDecisionSuggestion({ ...base, proposedActionType: "COST_CHANGED_PRICE_STALE", evidence: { costLooksWrong: true }, action: { suggestedPrice: 130 } });
  assert.equal(s.recommended?.kind, "GO_RESOLVE");
  assert.ok(![s.recommended, ...s.alternatives].some((o) => o?.kind === "APPLY_PRICE" || o?.kind === "KEEP_PRICE"));
});

test("sugerido de relleno (C$2 o menos) o igual al actual → no se ofrece aplicar", () => {
  for (const action of [{ suggestedPrice: 2 }, { currentPrice: 50, suggestedPrice: 50 }, {}]) {
    const s = buildDecisionSuggestion({ ...base, proposedActionType: "REVIEW_PRICE_BELOW_COST", action });
    assert.notEqual(s.recommended?.kind, "APPLY_PRICE");
  }
});

test("precio solo se aplica con la decisión OPEN (la Bandeja rechaza los demás)", () => {
  const s = buildDecisionSuggestion({ ...base, status: "FAILED", proposedActionType: "REVIEW_PRICE_BELOW_COST", action: { suggestedPrice: 130 } });
  assert.equal(s.recommended?.kind, "GO_RESOLVE");
});

test("ejecutable → RUN recomendado con confirmación", () => {
  const s = buildDecisionSuggestion({ ...base, category: "CASH", proposedActionType: "RECALCULATE_CASH_SESSION", href: "/app/master/cash-closure-reports" });
  assert.equal(s.recommended?.kind, "RUN");
  assert.equal(s.recommended?.needsConfirm, true);
});

test("solo revisión → 'Ya lo revisé' sin enlace; cerrada → solo ayuda", () => {
  const ack = buildDecisionSuggestion({ ...base, category: "SECURITY", proposedActionType: "REVIEW_CAMERA_HEALTH", href: "/app/master/cameras" });
  assert.equal(ack.recommended?.kind, "RESOLVE");
  assert.equal(ack.recommended?.label, "Ya lo revisé");
  assert.deepEqual(ack.alternatives, []);

  const closed = buildDecisionSuggestion({ ...base, status: "RESOLVED", proposedActionType: "REVIEW_PRICE_BELOW_COST", action: { suggestedPrice: 130 } });
  assert.equal(closed.recommended, null);
  assert.ok(closed.help.length > 0);
});

test("tipo desconocido → ayuda por área, nunca vacía", () => {
  const s = buildDecisionSuggestion({ ...base, category: "CASH", proposedActionType: "ALGO_NUEVO" });
  assert.match(s.help, /caja/i);
});
