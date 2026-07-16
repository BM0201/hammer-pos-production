import assert from "node:assert/strict";
import test from "node:test";
import {
  ARCHIVE_RETENTION_DAYS,
  CANCELLED_LOAN_RETENTION_DAYS,
  INACTIVE_AUTO_EXPENSE_RETENTION_DAYS,
  LOGIN_ATTEMPT_RETENTION_DAYS,
  STALE_PAYROLL_DRAFT_RETENTION_DAYS,
  retentionCutoff,
} from "./policy";

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

test("retention: ventanas de obsoletos operativos — cortas pero nunca del mes en curso", () => {
  // Un borrador de nómina del mes en curso se recalcula seguido (updatedAt
  // fresco); 45 días garantiza que solo caen los de meses YA cerrados.
  assert.ok(STALE_PAYROLL_DRAFT_RETENTION_DAYS >= 35, "un DRAFT del mes en curso jamás debe caer en el sweep");
  // Préstamos cancelados: margen de un trimestre para reclamos antes de purgar.
  assert.ok(CANCELLED_LOAN_RETENTION_DAYS >= 60);
  // Gastos automáticos apagados: se conservan ~medio año como referencia.
  assert.ok(INACTIVE_AUTO_EXPENSE_RETENTION_DAYS >= 90);
  // Ninguna ventana operativa debe acercarse a la de ARCHIVO (3 años).
  for (const days of [STALE_PAYROLL_DRAFT_RETENTION_DAYS, CANCELLED_LOAN_RETENTION_DAYS, INACTIVE_AUTO_EXPENSE_RETENTION_DAYS]) {
    assert.ok(days < ARCHIVE_RETENTION_DAYS);
  }
});
