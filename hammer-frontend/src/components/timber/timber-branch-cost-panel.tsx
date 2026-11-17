"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { numFixed as fmt } from "@/lib/format";
import { readJson } from "./trip-api";

/* ─────────────────────────── Costo por pie por sucursal y existencias en pies ─────────────────────────── */

type BranchCostRow = {
  productId: string;
  sku: string;
  name: string;
  thickness: number;
  width: number;
  lengthFeet: number;
  boardFeet: number;
  stock: number;
  totalFeet: number;
  currentCost: number | null;
  newCost: number | null;
  price: number | null;
};
type BranchCostPreview = {
  rows: BranchCostRow[];
  unreadable: string[];
  totals: { pieces: number; feet: number; currentValue: number; newValue: number; saleValue: number; belowCost: number };
  byBranch: Array<{ branchId: string; code: string; name: string; pieces: number; feet: number }>;
};

export function TimberBranchCostPanel({ branchId, branchName, savedCostPerFoot, onApplied }: {
  branchId: string; branchName: string; savedCostPerFoot: number | null; onApplied: (costPerFoot: number) => void;
}) {
  const [costText, setCostText] = useState(savedCostPerFoot ? String(savedCostPerFoot) : "");
  const [preview, setPreview] = useState<BranchCostPreview | null>(null);
  const [applying, setApplying] = useState(false);
  const costPerFoot = Number(costText) > 0 ? Number(costText) : null;

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (branchId) params.set("branchId", branchId);
    if (costPerFoot) params.set("costPerFoot", String(costPerFoot));
    try {
      const res = await apiFetch(`/api/timber/branch-cost?${params.toString()}`);
      const raw = await readJson(res);
      if (!res.ok) { showToast("error", raw?.error?.message ?? "No se pudieron leer las existencias de madera."); return; }
      setPreview(unwrapApiData(raw) as BranchCostPreview);
    } catch {
      showToast("error", "Error de red al leer las existencias de madera.");
    }
  }, [branchId, costPerFoot]);

  useEffect(() => {
    const handle = setTimeout(() => { void load(); }, 300);
    return () => clearTimeout(handle);
  }, [load]);

  async function apply() {
    if (!costPerFoot) return;
    setApplying(true);
    try {
      const res = await apiFetch("/api/timber/branch-cost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, costPerFoot }),
      });
      const raw = await readJson(res);
      if (!res.ok) { showToast("error", raw?.error?.message ?? "No se pudo fijar el costo."); return; }
      showToast("success", `Costo de ${unwrapApiData(raw).applied} medidas fijado en ${branchName}.`);
      onApplied(costPerFoot);
      await load();
    } catch {
      showToast("error", "Error de red al fijar el costo.");
    } finally {
      setApplying(false);
    }
  }

  const totals = preview?.totals;
  const costChanges = (preview?.rows ?? []).some((row) => row.newCost !== null && row.newCost !== row.currentCost);

  return (
    <Card noPadding>
      <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3.5 py-2.5">
        <b className="text-[12.5px]">Costo por pie y existencias de madera</b>
        <p className="text-[11.5px] text-[var(--color-text-muted)]">Usa el mismo stock y costo del inventario general.</p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-[var(--color-border)] px-3.5 py-2.5">
        {(preview?.byBranch ?? []).map((b) => (
          <div key={b.branchId} className={`rounded-lg border px-3 py-1.5 text-[12px] ${b.branchId === branchId ? "border-[var(--color-master-500)]" : "border-[var(--color-border)]"}`}>
            <b>{b.code}</b> <span className="font-mono">{fmt(b.feet)} pies</span> <span className="text-[var(--color-text-muted)]">· {fmt(b.pieces, 0)} piezas</span>
          </div>
        ))}
      </div>

      {!branchId ? (
        <p className="px-3.5 py-6 text-center text-sm text-[var(--color-text-muted)]">Elegí una sucursal arriba para fijar su costo por pie y ver cada medida.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3 border-b border-[var(--color-border)] px-3.5 py-3">
            <label className="block text-[11.5px] font-semibold text-[var(--color-text-muted)]">
              Costo total de la madera por pie en {branchName} (C$)
              <input type="number" min={0} step="0.01" value={costText} onChange={(e) => setCostText(e.target.value)} placeholder="49" className="mt-1 block w-32 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-right font-mono text-sm" />
            </label>
            <Button variant="primary" loading={applying} disabled={!costPerFoot || !costChanges} onClick={apply}>
              {costPerFoot ? `Fijar C$ ${fmt(costPerFoot)} por pie` : "Fijar costo"}
            </Button>
            {totals && (
              <div className="ml-auto flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]">
                <span><span className="text-[var(--color-text-muted)]">Total </span><b className="font-mono">{fmt(totals.feet)} pies</b></span>
                <span><span className="text-[var(--color-text-muted)]">Valor al costo </span><b className="font-mono">C$ {fmt(totals.newValue)}</b></span>
                <span><span className="text-[var(--color-text-muted)]">Ganancia si se vende todo </span><b className="font-mono">C$ {fmt(totals.saleValue - totals.newValue)}</b></span>
              </div>
            )}
          </div>

          {totals && totals.belowCost > 0 && (
            <div className="border-b border-[var(--color-warning-300)] bg-[var(--color-warning-50)] px-3.5 py-2 text-[12.5px] text-[var(--color-warning-800)]">
              ⚠ {totals.belowCost} medida{totals.belowCost === 1 ? "" : "s"} con el precio por debajo de este costo. Revisá su precio en esta sucursal.
            </div>
          )}
          {(preview?.unreadable.length ?? 0) > 0 && (
            <div className="border-b border-[var(--color-warning-300)] bg-[var(--color-warning-50)] px-3.5 py-2 text-[12.5px] text-[var(--color-warning-800)]">
              No reciben costo porque el nombre no trae la medida: {preview?.unreadable.join(", ")}.
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="hm-sheet-table">
              <thead>
                <tr><th>Medida</th><th className="r">Existencia</th><th className="r">Pies/pza</th><th className="r">Pies total</th><th className="r">Costo</th><th className="r">Precio</th><th className="r">Ganancia/pza</th><th className="r">Margen</th></tr>
              </thead>
              <tbody>
                {(preview?.rows ?? []).map((row) => {
                  const cost = row.newCost ?? row.currentCost;
                  const profit = cost !== null && row.price !== null ? row.price - cost : null;
                  const negative = profit !== null && profit < 0;
                  const changed = row.newCost !== null && row.newCost !== row.currentCost;
                  return (
                    <tr key={row.productId}>
                      <td>
                        <b>{row.name}</b>
                        <br /><span className="text-[11px] text-[var(--color-text-muted)]">{row.thickness}×{row.width}×{row.lengthFeet} pies</span>
                      </td>
                      <td className="hm-num">{fmt(row.stock, 0)}</td>
                      <td className="hm-num text-[var(--color-text-muted)]">{fmt(row.boardFeet, 3)}</td>
                      <td className="hm-num">{fmt(row.totalFeet)}</td>
                      <td className="hm-num">
                        {changed && <span className="text-[var(--color-text-soft)]">{row.currentCost !== null ? fmt(row.currentCost) : "—"} → </span>}
                        <b>{cost !== null ? fmt(cost) : "—"}</b>
                      </td>
                      <td className="hm-num">{row.price !== null ? fmt(row.price) : "—"}</td>
                      <td className="hm-num" style={negative ? { color: "var(--color-danger-700)" } : undefined}>{profit !== null ? fmt(profit) : "—"}</td>
                      <td className="hm-num" style={negative ? { color: "var(--color-danger-700)", fontWeight: 600 } : undefined}>{profit !== null && row.price ? `${fmt((profit / row.price) * 100, 1)}%` : "—"}</td>
                    </tr>
                  );
                })}
                {preview && preview.rows.length === 0 && (
                  <tr><td colSpan={8} className="text-center text-[var(--color-text-muted)]">Esta sucursal no tiene productos de madera.</td></tr>
                )}
              </tbody>
              {totals && preview && preview.rows.length > 0 && (
                <tfoot>
                  <tr><td>TOTALES</td><td className="hm-num">{fmt(totals.pieces, 0)}</td><td /><td className="hm-num">{fmt(totals.feet)}</td><td className="hm-num">{fmt(totals.newValue)}</td><td className="hm-num">{fmt(totals.saleValue)}</td><td /><td /></tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
