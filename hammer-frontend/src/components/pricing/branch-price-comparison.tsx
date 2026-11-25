"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money } from "@/lib/format";

type ComparisonRow = {
  branchId: string;
  branchName: string;
  configExists: boolean;
  monthlyExpenses: number;
  monthlySales: number;
  expenseRatePercent: number | null;
  operatingExpensePerUnit: number;
  totalInternalCost: number;
  marginPercent: number;
  suggestedPrice: number;
  currentPrice: number | null;
  diffPercent: number | null;
  profitAfterExpensesAtCurrent: number | null;
};

type Comparison = {
  rows: ComparisonRow[];
  spread: { min: number; max: number; spreadPercent: number } | null;
};

/**
 * Precio sugerido del mismo producto en cada sucursal: mismo costo de compra,
 * pero el % de gasto (gasto del mes ÷ venta del mes) y el margen de cada sucursal.
 */
export function BranchPriceComparison({
  productId,
  baseCost,
  taxPercent,
  includeTaxInCost,
  roundingRule,
  onApplied,
}: {
  productId: string;
  baseCost: number;
  taxPercent: number;
  includeTaxInCost: boolean;
  roundingRule: string;
  onApplied?: () => void;
}) {
  const [data, setData] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  // Cambió el producto o el costo: la tabla vieja ya no corresponde.
  useEffect(() => setData(null), [productId, baseCost, taxPercent, includeTaxInCost, roundingRule]);

  async function load() {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        productId,
        baseCost: String(baseCost),
        taxPercent: String(taxPercent),
        includeTaxInCost: String(includeTaxInCost),
        ...(roundingRule && roundingRule !== "NONE" ? { roundingRule } : {}),
      });
      const res = await apiFetch(`/api/pricing/branch-comparison?${qs}`);
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo comparar las sucursales.");
      setData(unwrapApiData(raw) as Comparison);
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "No se pudo comparar las sucursales.");
    } finally {
      setLoading(false);
    }
  }

  async function apply(row: ComparisonRow) {
    setApplyingId(row.branchId);
    try {
      const res = await apiFetch(`/api/master/pricing/product/${productId}/branches/${row.branchId}/set-price`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          price: row.suggestedPrice,
          reason: `Calculadora: gasto ${row.expenseRatePercent ?? 0}% de la venta (C$${row.operatingExpensePerUnit.toFixed(2)} por unidad), margen ${row.marginPercent}%`,
        }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo guardar el precio.");
      showToast("success", `Precio de ${row.branchName} actualizado a ${money(row.suggestedPrice)}`);
      onApplied?.();
      await load();
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "No se pudo guardar el precio.");
    } finally {
      setApplyingId(null);
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--color-text)]">
            <Building2 className="h-4 w-4 text-[var(--color-master-600)]" />
            Comparar por sucursal
          </h3>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Mismo costo de compra ({money(baseCost)}). Cada sucursal con su % de gasto: de cada C$100 que vende, cuánto se va en gastos (presupuesto del mes ÷ venta promedio de los últimos 3 meses; sin compras, equipo ni gastos personales).
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" loading={loading} onClick={() => void load()}>
          {data ? "Recalcular" : "Comparar sucursales"}
        </Button>
      </div>

      {data && data.spread && data.spread.spreadPercent > 10 && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-3 py-2 text-xs text-[var(--color-warning-700)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>
            Entre sucursales hay {data.spread.spreadPercent}% de diferencia ({money(data.spread.min)} a {money(data.spread.max)}).
            Si es un producto que el cliente compara, conviene no pasar de 10%.
          </span>
        </div>
      )}

      {data && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <table className="w-full min-w-[800px] text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-alt)] text-left text-[var(--color-text-muted)]">
                <th className="px-2 py-1.5">Sucursal</th>
                <th className="px-2 py-1.5 text-right">% de gasto</th>
                <th className="px-2 py-1.5 text-right">Gasto por unidad</th>
                <th className="px-2 py-1.5 text-right">Costo total</th>
                <th className="px-2 py-1.5 text-right">Margen</th>
                <th className="px-2 py-1.5 text-right">Sugerido</th>
                <th className="px-2 py-1.5 text-right">Actual</th>
                <th className="px-2 py-1.5 text-right">Dif.</th>
                <th className="px-2 py-1.5 text-right" title="Precio actual − costo − su parte de los gastos">Te queda hoy</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const same = row.currentPrice !== null && Math.abs(row.currentPrice - row.suggestedPrice) < 0.005;
                const below = row.diffPercent !== null && row.diffPercent < 0;
                return (
                  <tr key={row.branchId} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-2 py-1.5 text-[var(--color-text)]">
                      {row.branchName}
                      {!row.configExists && (
                        <span className="ml-1 text-[10px] text-[var(--color-text-muted)]" title="Sin configuración de precios: usa margen 30%">
                          (sin config.)
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums" title={`Gasto del mes ${money(row.monthlyExpenses)} ÷ venta del mes ${money(row.monthlySales)}`}>
                      {row.expenseRatePercent === null ? <span className="text-[var(--color-text-muted)]">Sin ventas</span> : `${row.expenseRatePercent}%`}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(row.operatingExpensePerUnit)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(row.totalInternalCost)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{row.marginPercent}%</td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-[var(--color-success-700)]">{money(row.suggestedPrice)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{row.currentPrice === null ? "Sin precio" : money(row.currentPrice)}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${below ? "font-semibold text-[var(--color-danger-700)]" : "text-[var(--color-text-muted)]"}`}
                      title={below ? "Vende por debajo de lo que piden los gastos de esta sucursal" : undefined}>
                      {row.diffPercent === null ? "—" : `${row.diffPercent > 0 ? "+" : ""}${row.diffPercent}%`}
                    </td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${row.profitAfterExpensesAtCurrent !== null && row.profitAfterExpensesAtCurrent < 0 ? "font-semibold text-[var(--color-danger-700)]" : ""}`}>
                      {row.profitAfterExpensesAtCurrent === null ? "—" : money(row.profitAfterExpensesAtCurrent)}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <Button type="button" variant="success" size="sm" disabled={same || applyingId !== null}
                        loading={applyingId === row.branchId} onClick={() => void apply(row)}>
                        {same ? "Al día" : "Aplicar"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
