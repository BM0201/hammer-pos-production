"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money } from "@/lib/format";
import { readJson } from "./trip-api";

/* ─────────────────────────── Recálculo masivo de precio de venta (Paso 3/4) ─────────────────────────── */

type RecalcRow = {
  productId: string;
  sku: string;
  name: string;
  branchId: string;
  branchName: string;
  currentPrice: number;
  newPrice: number;
  difference: number;
};

/**
 * Vista previa (GET, nada escrito todavía) → revisar → Aplicar (POST, escribe
 * branchPrice de esa sucursal). Mismo patrón de "nunca escribir en masa sin
 * mostrar antes qué va a cambiar" que ya usa el resto de la app (ej. la
 * bandeja de Precios, la inyección de un viaje de madera).
 */
export function TimberSalePriceRecalcPreviewPanel({ branchId, branchName, onClose }: { branchId: string; branchName: string; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<RecalcRow[] | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/timber/pricing/recalc-sale-prices?branchId=${branchId}`);
      const raw = await readJson(res);
      if (!res.ok) { showToast("error", raw?.error?.message ?? "No se pudo calcular la vista previa."); return; }
      setRows(unwrapApiData(raw) as RecalcRow[]);
    } catch {
      showToast("error", "Error de red al calcular la vista previa.");
    } finally {
      setLoading(false);
    }
  }, [branchId]);
  useEffect(() => { void load(); }, [load]);

  async function apply() {
    setApplying(true);
    try {
      const res = await apiFetch("/api/timber/pricing/recalc-sale-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId }),
      });
      const raw = await readJson(res);
      if (!res.ok) { showToast("error", raw?.error?.message ?? "No se pudo aplicar el recálculo."); return; }
      const result = unwrapApiData(raw) as { applied: number };
      showToast("success", `${result.applied} precio(s) de venta actualizado(s) en ${branchName}.`);
      setApplied(true);
    } catch {
      showToast("error", "Error de red al aplicar.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <Card noPadding>
      <div className="flex items-center gap-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3.5 py-2.5">
        <b className="text-[12.5px]">Productos afectados en {branchName}</b>
        <span className="flex-1" />
        <button type="button" onClick={onClose} className="text-[var(--color-text-soft)]" aria-label="Cerrar"><X className="h-4 w-4" /></button>
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-[var(--color-text-muted)] animate-pulse">Calculando…</p>
      ) : !rows || rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--color-text-muted)]">Ningún producto de madera cambia de precio en {branchName} con la configuración vigente.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="hm-sheet-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="r">Precio actual</th>
                  <th className="r">Precio nuevo</th>
                  <th className="r">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.productId}>
                    <td>
                      <span className="block font-medium">{row.name}</span>
                      <span className="block text-[11px] text-[var(--color-text-soft)]">{row.sku}</span>
                    </td>
                    <td className="r tabular-nums">{money(row.currentPrice)}</td>
                    <td className="r font-medium tabular-nums text-[var(--color-success-700)]">{money(row.newPrice)}</td>
                    <td className={`r tabular-nums ${row.difference >= 0 ? "text-[var(--color-success-700)]" : "text-[var(--color-danger-600)]"}`}>
                      {row.difference >= 0 ? "+" : ""}{money(row.difference)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] px-3.5 py-2.5">
            <span className="text-[11.5px] text-[var(--color-text-soft)]">
              Aplicar solo actualiza el precio de venta (branchPrice) de {branchName} — no toca costos ni otras sucursales.
            </span>
            {applied ? (
              <span className="text-[12.5px] font-medium text-[var(--color-success-700)]">Aplicado.</span>
            ) : (
              <Button type="button" variant="success" size="sm" loading={applying} onClick={apply}>
                Aplicar {rows.length} precio{rows.length === 1 ? "" : "s"}
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
