import assert from "node:assert/strict";
import test from "node:test";
import { classifyExpenseKind, conceptMatchesCategory } from "@/modules/pricing/expense-kind";

/**
 * prompt-gastos-semana-quincena.md Fase 1 — classifyExpenseKind documenta
 * EXACTAMENTE la misma regla que el backfill de la migración
 * (20261012000000_expense_kind_and_concept/migration.sql). Cualquier cambio
 * a uno sin el otro se nota acá, no en producción.
 */
const BASE = { isAutoCalculated: false, category: "RENT", cashMovementId: null, hasTreasuryEntryLink: false, effectiveFrom: new Date("2026-03-01T00:00:00Z"), effectiveTo: null as Date | null };

test("isAutoCalculated + PAYROLL → PAYROLL_SYNC, sin importar el resto", () => {
  const result = classifyExpenseKind({ ...BASE, isAutoCalculated: true, category: "PAYROLL", cashMovementId: "cm-1" });
  assert.equal(result, "PAYROLL_SYNC");
});

test("cashMovementId presente (pagado desde el POS) → PAID", () => {
  const result = classifyExpenseKind({ ...BASE, cashMovementId: "cm-1" });
  assert.equal(result, "PAID");
});

test("TreasuryEntry.expensePaymentId lo referencia (efectivo retenido / banco) → PAID", () => {
  const result = classifyExpenseKind({ ...BASE, hasTreasuryEntryLink: true });
  assert.equal(result, "PAID");
});

test("effectiveFrom y effectiveTo son el mismo día → PAID (un punto en el tiempo, no un rango mensual)", () => {
  const day = new Date("2026-03-15T08:00:00Z");
  const result = classifyExpenseKind({ ...BASE, effectiveFrom: day, effectiveTo: new Date("2026-03-15T20:00:00Z") });
  assert.equal(result, "PAID");
});

test("effectiveFrom y effectiveTo son días DISTINTOS → no es PAID por esa sola razón", () => {
  const result = classifyExpenseKind({ ...BASE, effectiveFrom: new Date("2026-03-01T00:00:00Z"), effectiveTo: new Date("2026-03-31T23:59:59Z") });
  assert.equal(result, "RECURRING");
});

test("sin isAutoCalculated+PAYROLL, sin cashMovementId, sin TreasuryEntry, sin effectiveTo → RECURRING (el resto)", () => {
  const result = classifyExpenseKind(BASE);
  assert.equal(result, "RECURRING");
});

test("PAYROLL_SYNC gana incluso si TAMBIÉN tiene cashMovementId (prioridad del doc: PAYROLL_SYNC primero)", () => {
  const result = classifyExpenseKind({ ...BASE, isAutoCalculated: true, category: "PAYROLL", cashMovementId: "cm-1", hasTreasuryEntryLink: true });
  assert.equal(result, "PAYROLL_SYNC");
});

test("conceptMatchesCategory — mismo concepto, misma categoría: válido", () => {
  assert.equal(conceptMatchesCategory("TRANSPORT", "TRANSPORT"), true);
});

test("conceptMatchesCategory — concepto de OTRA categoría: inválido (createOperatingExpense lo traduce a 400)", () => {
  assert.equal(conceptMatchesCategory("TRANSPORT", "UTILITIES"), false);
});
