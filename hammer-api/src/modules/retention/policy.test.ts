import assert from "node:assert/strict";
import test from "node:test";
import { ARCHIVE_RETENTION_DAYS, LOGIN_ATTEMPT_RETENTION_DAYS, retentionCutoff } from "./policy";

test("retention: el minimo de archivo es 3 anos (requisito del negocio, no bajar)", () => {
  assert.ok(
    ARCHIVE_RETENTION_DAYS >= 1095,
    `ARCHIVE_RETENTION_DAYS=${ARCHIVE_RETENTION_DAYS} viola el minimo de 3 anos (1095 dias) definido por el negocio`,
  );
});

test("retention: login attempts cubren las ventanas de rate-limit (15 min) y Security Center (24h)", () => {
  assert.ok(LOGIN_ATTEMPT_RETENTION_DAYS >= 2);
});

test("retention: cutoff resta exactamente los dias indicados", () => {
  const now = new Date("2026-07-02T09:00:00.000Z");
  const cutoff = retentionCutoff(1095, now);
  const diffDays = (now.getTime() - cutoff.getTime()) / (24 * 60 * 60 * 1000);
  assert.equal(diffDays, 1095);
  assert.ok(cutoff < now);
});

test("retention: cutoff con dias=0 es ahora mismo", () => {
  const now = new Date("2026-07-02T09:00:00.000Z");
  assert.equal(retentionCutoff(0, now).getTime(), now.getTime());
});
