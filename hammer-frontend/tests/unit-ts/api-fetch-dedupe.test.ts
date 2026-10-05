/**
 * prompt-seguridad-basica.md Fase 2 — apiFetch deduplica mutaciones
 * IDÉNTICAS en vuelo (mismo método+URL+body): un doble click que dispara
 * dos requests antes de que la primera responda debe pegarle al servidor
 * UNA sola vez, no dos. GET nunca se deduplica, ni un body FormData/Blob
 * (no es seguro serializarlos para comparar), ni cuando el llamador pasa
 * allowDuplicate:true.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { apiFetch, buildMutationDedupeKey } from "@/lib/client/api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const csrfOk = () => jsonResponse({ ok: true, data: { csrfToken: "tok-1" } });

test("buildMutationDedupeKey — GET y HEAD nunca se deduplican", () => {
  assert.equal(buildMutationDedupeKey("GET", "/api/x", undefined), null);
  assert.equal(buildMutationDedupeKey("HEAD", "/api/x", undefined), null);
  assert.equal(buildMutationDedupeKey("get", "/api/x", "{}"), null);
});

test("buildMutationDedupeKey — mismo metodo+URL+body da la MISMA clave", () => {
  const a = buildMutationDedupeKey("POST", "/api/widgets", JSON.stringify({ name: "A" }));
  const b = buildMutationDedupeKey("POST", "/api/widgets", JSON.stringify({ name: "A" }));
  assert.ok(a);
  assert.equal(a, b);
});

test("buildMutationDedupeKey — bodies distintos dan claves distintas", () => {
  const a = buildMutationDedupeKey("POST", "/api/widgets", JSON.stringify({ name: "A" }));
  const b = buildMutationDedupeKey("POST", "/api/widgets", JSON.stringify({ name: "B" }));
  assert.notEqual(a, b);
});

test("buildMutationDedupeKey — FormData/Blob nunca se deduplican (null)", () => {
  assert.equal(buildMutationDedupeKey("POST", "/api/upload", new FormData()), null);
  assert.equal(buildMutationDedupeKey("POST", "/api/upload", new Blob(["x"])), null);
});

test("LA QUE IMPORTA — doble click (mutaciones identicas en paralelo): un solo fetch real, ambos llamadores reciben la misma respuesta", async () => {
  let widgetCalls = 0;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string) => {
    if (url === "/api/auth/csrf") return csrfOk();
    if (url === "/api/widgets") {
      widgetCalls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return jsonResponse({ ok: true, data: { id: "widget-1" } });
    }
    throw new Error(`fetch inesperado: ${url}`);
  }) as typeof fetch;

  const [res1, res2] = await Promise.all([
    apiFetch("/api/widgets", { method: "POST", body: JSON.stringify({ name: "A" }) }),
    apiFetch("/api/widgets", { method: "POST", body: JSON.stringify({ name: "A" }) }),
  ]);
  const [json1, json2] = await Promise.all([res1.json(), res2.json()]);

  assert.equal(widgetCalls, 1, "solo debe golpear el servidor una vez");
  assert.deepEqual(json1, { ok: true, data: { id: "widget-1" } });
  assert.deepEqual(json2, { ok: true, data: { id: "widget-1" } });
});

test("bodies distintos no se deduplican: dos fetches reales", async () => {
  let widgetCalls = 0;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string) => {
    if (url === "/api/auth/csrf") return csrfOk();
    if (url === "/api/widgets") {
      widgetCalls += 1;
      return jsonResponse({ ok: true, data: { call: widgetCalls } });
    }
    throw new Error(`fetch inesperado: ${url}`);
  }) as typeof fetch;

  await Promise.all([
    apiFetch("/api/widgets", { method: "POST", body: JSON.stringify({ name: "A" }) }),
    apiFetch("/api/widgets", { method: "POST", body: JSON.stringify({ name: "B" }) }),
  ]);
  assert.equal(widgetCalls, 2);
});

test("GET nunca se deduplica, aunque la URL sea identica", async () => {
  let calls = 0;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => {
    calls += 1;
    return jsonResponse({ ok: true, data: { n: calls } });
  }) as typeof fetch;

  await Promise.all([apiFetch("/api/widgets"), apiFetch("/api/widgets")]);
  assert.equal(calls, 2);
});

test("allowDuplicate:true se respeta — dos llamadas identicas, dos fetches reales", async () => {
  let widgetCalls = 0;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string) => {
    if (url === "/api/auth/csrf") return csrfOk();
    if (url === "/api/widgets") {
      widgetCalls += 1;
      return jsonResponse({ ok: true, data: { call: widgetCalls } });
    }
    throw new Error(`fetch inesperado: ${url}`);
  }) as typeof fetch;

  await Promise.all([
    apiFetch("/api/widgets", { method: "POST", body: JSON.stringify({ name: "A" }), allowDuplicate: true }),
    apiFetch("/api/widgets", { method: "POST", body: JSON.stringify({ name: "A" }), allowDuplicate: true }),
  ]);
  assert.equal(widgetCalls, 2);
});
