/**
 * prompt-nomina-config.md Fase 1 — buildPayrollConfigPatch solo debe
 * incluir los campos que cambiaron respecto al original.
 *
 * Ejecutar: npm run test:unit:logic
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPayrollConfigPatch, type PayrollConfigFields } from "@/components/payroll/payroll-config-patch";

const BASE: PayrollConfigFields = {
  inssRegime: "INTEGRAL",
  aguinaldoMode: "ACCRUE_MONTHLY",
  vacacionesMode: "ACCRUE_MONTHLY",
  indemnizacionMode: "ACCRUE_MONTHLY",
  salarioMinimoSectorial: 0,
};

describe("buildPayrollConfigPatch", () => {
  it("sin cambios devuelve {}", () => {
    const patch = buildPayrollConfigPatch(BASE, { ...BASE });
    assert.deepEqual(patch, {});
  });

  it("solo el régimen INSS cambiado", () => {
    const patch = buildPayrollConfigPatch(BASE, { ...BASE, inssRegime: "IVM_RP" });
    assert.deepEqual(patch, { inssRegime: "IVM_RP" });
  });

  it("solo el salario mínimo cambiado", () => {
    const patch = buildPayrollConfigPatch(BASE, { ...BASE, salarioMinimoSectorial: 8500 });
    assert.deepEqual(patch, { salarioMinimoSectorial: 8500 });
  });

  it("los tres modos de prestaciones cambiados a la vez", () => {
    const patch = buildPayrollConfigPatch(BASE, {
      ...BASE,
      aguinaldoMode: "ON_PAYMENT",
      vacacionesMode: "ON_PAYMENT",
      indemnizacionMode: "ON_PAYMENT",
    });
    assert.deepEqual(patch, {
      aguinaldoMode: "ON_PAYMENT",
      vacacionesMode: "ON_PAYMENT",
      indemnizacionMode: "ON_PAYMENT",
    });
  });

  it("todos los campos cambiados a la vez", () => {
    const edited: PayrollConfigFields = {
      inssRegime: "IVM_RP",
      aguinaldoMode: "ON_PAYMENT",
      vacacionesMode: "ON_PAYMENT",
      indemnizacionMode: "ON_PAYMENT",
      salarioMinimoSectorial: 12000,
    };
    const patch = buildPayrollConfigPatch(BASE, edited);
    assert.deepEqual(patch, edited);
  });
});
