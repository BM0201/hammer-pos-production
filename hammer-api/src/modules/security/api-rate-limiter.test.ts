/**
 * ════════════════════════════════════════════════════════════════
 * API RATE LIMITER — Unit Tests
 *
 * Cubre la clasificación de requests por política y el comportamiento
 * fail-open cuando Upstash Redis no está configurado.
 * ════════════════════════════════════════════════════════════════
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyApiRequest,
  checkApiRateLimit,
  isApiRateLimiterConfigured,
} from "@/modules/security/api-rate-limiter";

// ─── classifyApiRequest ─────────────────────────────────────────

test("classify: login queda fuera (tiene su propio limiter en BD)", () => {
  assert.equal(classifyApiRequest("/api/auth/login", "POST"), null);
});

test("classify: cron queda fuera (protegido por CRON_SECRET)", () => {
  assert.equal(classifyApiRequest("/api/cron/cleanup", "POST"), null);
  assert.equal(classifyApiRequest("/api/system/cron/cash-auto-close", "POST"), null);
});

test("classify: rutas fuera de /api no se limitan", () => {
  assert.equal(classifyApiRequest("/health", "GET"), null);
});

test("classify: públicos csrf/session → política public por IP (30/min)", () => {
  for (const path of ["/api/auth/csrf", "/api/auth/session"]) {
    const policy = classifyApiRequest(path, "GET");
    assert.ok(policy, `esperaba política para ${path}`);
    assert.equal(policy.name, "public");
    assert.equal(policy.scope, "ip");
    assert.equal(policy.limit, 30);
    assert.equal(policy.windowSeconds, 60);
  }
});

test("classify: import de Excel → política import por usuario (5/min)", () => {
  const policy = classifyApiRequest("/api/master/import/excel", "POST");
  assert.ok(policy);
  assert.equal(policy.name, "import");
  assert.equal(policy.scope, "user");
  assert.equal(policy.limit, 5);
});

test("classify: reportes/analytics → política analytics por usuario (20/min)", () => {
  for (const path of [
    "/api/reports/sales/summary",
    "/api/analytics/dashboard",
    "/api/master/analytics/abc-xyz/123",
    "/api/cash-closure/reports",
    "/api/branch/operations/op123/daily-report",
  ]) {
    const policy = classifyApiRequest(path, "GET");
    assert.ok(policy, `esperaba política para ${path}`);
    assert.equal(policy.name, "analytics");
    assert.equal(policy.limit, 20);
  }
});

test("classify: mutación general autenticada → política mutation por usuario (60/min)", () => {
  for (const [path, method] of [
    ["/api/branch/sales/orders", "POST"],
    ["/api/master/users/abc", "PATCH"],
    ["/api/branch/inventory/adjust", "POST"],
    ["/api/master/users/abc/memberships/m1", "DELETE"],
  ] as const) {
    const policy = classifyApiRequest(path, method);
    assert.ok(policy, `esperaba política para ${method} ${path}`);
    assert.equal(policy.name, "mutation");
    assert.equal(policy.scope, "user");
    assert.equal(policy.limit, 60);
  }
});

test("classify: GET autenticado general no se limita (polling del POS)", () => {
  assert.equal(classifyApiRequest("/api/branch/catalog/products", "GET"), null);
  assert.equal(classifyApiRequest("/api/master/users", "GET"), null);
  assert.equal(classifyApiRequest("/api/operations/current", "GET"), null);
});

test("classify: analytics gana sobre mutation para el mismo path", () => {
  // Un POST a analytics/classify sigue siendo carga pesada de BD → analytics
  const policy = classifyApiRequest("/api/analytics/classify", "POST");
  assert.ok(policy);
  assert.equal(policy.name, "analytics");
});

// ─── checkApiRateLimit: fail-open sin Redis ─────────────────────

test("checkApiRateLimit: sin Upstash configurado permite la request (fail-open)", async () => {
  // En el entorno de test no hay UPSTASH_REDIS_REST_URL/TOKEN
  assert.equal(isApiRateLimiterConfigured(), false);
  const result = await checkApiRateLimit("mutation:user-test", { limit: 1, windowSeconds: 60 });
  assert.deepEqual(result, { allowed: true });

  // Repetido: sigue permitiendo (no hay estado local que bloquee)
  const again = await checkApiRateLimit("mutation:user-test", { limit: 1, windowSeconds: 60 });
  assert.deepEqual(again, { allowed: true });
});
