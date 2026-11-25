/**
 * Gráficas del Resumen de Finanzas: la cascada tiene que terminar EXACTAMENTE
 * en la utilidad operativa del estado de resultados, y la tabla por sucursal
 * + Central tiene que sumar el total.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { axisMoney, buildBranchProfitRows, buildExpenseMix, buildPnlWaterfall, niceCeil } from "@/components/finance/finance-chart-data";

const pnl = {
  netSales: 417000, cogs: 310000, grossProfit: 107000,
  cashExpenses: 12000, bankExpenses: 6500, cardFees: 1500, retainedCashExpenses: 1500, payrollPaid: 45000,
  cashOverages: 195.5, cashShortages: 200, operatingProfit: 40495.5,
};

describe("cascada del estado de resultados", () => {
  it("cada paso arranca donde terminó el anterior y cierra en la utilidad operativa", () => {
    const steps = buildPnlWaterfall(pnl);
    assert.equal(steps[0].label, "Ventas netas");
    assert.deepEqual(steps[1].range, [107000, 417000]); // costo de ventas baja de 417k a 107k
    const last = steps[steps.length - 1];
    assert.equal(last.label, "Utilidad operativa");
    assert.deepEqual(last.range, [0, 40495.5]);
    const beforeLast = steps[steps.length - 2];
    assert.equal(beforeLast.label, "Faltante de caja");
    assert.equal(beforeLast.range[0], 40495.5); // el último movimiento llega justo al total
  });

  it("los pasos en cero no se dibujan y una pérdida baja de cero", () => {
    const steps = buildPnlWaterfall({ ...pnl, cardFees: 0, cashOverages: 0, cashShortages: 0, payrollPaid: 150000, operatingProfit: -63000 });
    assert.ok(!steps.some((s) => s.label === "Comisión tarjeta" || s.label === "Sobrante de caja"));
    assert.deepEqual(steps[steps.length - 1].range, [-63000, 0]);
  });
});

describe("utilidad por sucursal", () => {
  it("de mayor a menor, con Central al final en negativo", () => {
    const rows = buildBranchProfitRows(
      [{ branchCode: "RIV", branchName: null, operatingProfit: 9000 }, { branchCode: "MSY", branchName: null, operatingProfit: 42000 }],
      1500,
    );
    assert.deepEqual(rows.map((r) => [r.label, r.profit]), [["MSY", 42000], ["RIV", 9000], ["Central", -1500]]);
  });
});

describe("gastos por mes", () => {
  it("agrupa caja + banco + retenido; la comisión va aparte", () => {
    const [m] = buildExpenseMix([{ label: "nov 26", payrollPaid: 45000, cashExpenses: 12000, bankExpenses: 6500, retainedCashExpenses: 1500, cardFees: 1500 }]);
    assert.deepEqual(m, { label: "nov 26", payroll: 45000, operating: 20000, cardFees: 1500, total: 66500 });
  });
});

describe("ejes", () => {
  it("tope redondo y montos compactos", () => {
    assert.equal(niceCeil(417000), 450000);
    assert.equal(niceCeil(42000), 45000);
    assert.equal(axisMoney(450000), "450k");
    assert.equal(axisMoney(-1500), "−2k");
    assert.equal(axisMoney(1_200_000), "1.2M");
  });
});
