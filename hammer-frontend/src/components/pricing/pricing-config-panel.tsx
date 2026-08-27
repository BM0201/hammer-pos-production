"use client";

import { useCallback, useEffect, useState } from "react";
import { Settings, Percent, Package, PieChart, Info, Save, Receipt } from "lucide-react";
import { showToast } from "@/components/ui/toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { type ExpenseSummary } from "@/components/expenses/expense-manager.types";

/**
 * Fase 1 (prompt-mudanza-zona-precios.md) — el formulario de configForm
 * (margen deseado, unidades estimadas, método de prorrateo), en su propio
 * archivo con estado propio. Es el mismo formulario que pricing-calculator-panel.tsx
 * embebe en su columna izquierda (ese overlap es deliberado — ver el comentario
 * de archivo de ese panel); acá vive standalone para el tab "Configuración" de
 * la zona Precios (Fase 2), sin necesidad de abrir la calculadora.
 */
export function PricingConfigPanel({ branchId, onSaved }: { branchId: string; onSaved?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [configForm, setConfigForm] = useState({
    desiredMarginPercent: "30",
    estimatedMonthlyUnits: "1000",
    prorationMethod: "BY_QUANTITY",
  });

  const formatC = (n: number) =>
    `C$${n.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const [sumRes, cfgRes] = await Promise.all([
        fetch(`/api/expenses?branchId=${branchId}&summary=true`),
        fetch(`/api/pricing/config?branchId=${branchId}`),
      ]);
      const sumData = unwrapApiData(await sumRes.json());
      const cfgData = unwrapApiData(await cfgRes.json());
      setSummary(sumData as ExpenseSummary);
      if (cfgData && (cfgData as { id?: string }).id) {
        const cfg = cfgData as { desiredMarginPercent: number; estimatedMonthlyUnits: number; prorationMethod: string };
        setConfigForm({
          desiredMarginPercent: String(cfg.desiredMarginPercent),
          estimatedMonthlyUnits: String(cfg.estimatedMonthlyUnits),
          prorationMethod: cfg.prorationMethod || "BY_QUANTITY",
        });
      }
    } catch (e) {
      console.error("Error loading pricing config:", e);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaveConfig = async () => {
    if (!branchId) return;
    try {
      const res = await apiFetch("/api/pricing/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          desiredMarginPercent: parseFloat(configForm.desiredMarginPercent),
          estimatedMonthlyUnits: parseFloat(configForm.estimatedMonthlyUnits),
          prorationMethod: configForm.prorationMethod,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      showToast("success", "Configuración guardada");
      load();
      onSaved?.();
    } catch (e) {
      showToast("error", "Error al guardar configuración");
      console.error(e);
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-[var(--color-text-muted)]">Cargando datos...</div>;
  }

  return (
    <div className="max-w-xl">
      <div className="relative overflow-hidden rounded-2xl border border-[var(--color-info-200)] bg-[var(--color-surface)] shadow-md">
        <div className="hm-card-header-blue px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/20">
              <Settings className="h-5 w-5 text-white" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">Configuración de Precios</h4>
              <p className="text-xs text-blue-100">Parámetros para el cálculo automático</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Margen */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
              <Percent className="h-3.5 w-3.5 text-[var(--color-info-600)]" />
              Margen de Utilidad
            </label>
            <div className="relative">
              <input
                type="number"
                min="0.1"
                max="99.9"
                step="0.1"
                value={configForm.desiredMarginPercent}
                onChange={(e) => setConfigForm((p) => ({ ...p, desiredMarginPercent: e.target.value }))}
                className="w-full rounded-xl border-2 border-slate-300 bg-white px-4 py-3 text-2xl font-bold text-[var(--color-text)] transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 focus:outline-none"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-500">%</span>
            </div>
            <p className="text-xs text-slate-600 flex items-center gap-1">
              <Info className="h-3 w-3 text-blue-500" />
              Porcentaje de ganancia sobre el precio de venta final
            </p>
          </div>

          {/* Unidades */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
              <Package className="h-3.5 w-3.5 text-[var(--color-info-600)]" />
              Unidades vendidas estimadas al mes en esta sucursal
            </label>
            <div className="relative">
              <input
                type="number"
                min="1"
                step="1"
                value={configForm.estimatedMonthlyUnits}
                onChange={(e) => setConfigForm((p) => ({ ...p, estimatedMonthlyUnits: e.target.value }))}
                className="w-full rounded-xl border-2 border-slate-300 bg-white px-4 py-3 text-2xl font-bold text-[var(--color-text)] transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 focus:outline-none"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-500">/ mes</span>
            </div>
            <p className="text-xs text-slate-600 flex items-center gap-1">
              <Info className="h-3 w-3 text-blue-500" />
              Cantidad total aproximada de unidades fisicas vendidas al mes. No significa SKUs distintos.
            </p>
          </div>

          {/* Método de prorrateo */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
              <PieChart className="h-3.5 w-3.5 text-[var(--color-info-600)]" />
              Método de Prorrateo
            </label>
            <select
              className="w-full rounded-xl border-2 border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-[var(--color-text)] transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 focus:outline-none"
              value={configForm.prorationMethod}
              onChange={(e) => setConfigForm((p) => ({ ...p, prorationMethod: e.target.value }))}
            >
              <option value="BY_QUANTITY">Por cantidad (unidades)</option>
              <option value="BY_VALUE">Por valor (C$)</option>
            </select>
            <p className="text-xs text-slate-600">
              {configForm.prorationMethod === "BY_VALUE"
                ? "Gastos se reparten segun participacion economica del producto o lote."
                : "Gastos se dividen equitativamente entre unidades vendidas."}
            </p>
          </div>

          {/* Resumen rápido de gastos */}
          {summary && (
            <div className="rounded-xl bg-amber-50 border-2 border-amber-300 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Receipt className="h-4 w-4 text-amber-700" />
                <span className="text-sm font-bold text-amber-800">Gastos Operativos Mensuales</span>
              </div>
              <p className="text-2xl font-extrabold text-amber-700">{formatC(summary.grandTotal)}</p>
              <p className="text-xs font-medium text-amber-700 mt-1">
                Prorrateado: {formatC(summary.grandTotal / Math.max(Number(configForm.estimatedMonthlyUnits) || 1, 1))} por unidad
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={handleSaveConfig}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold py-3.5 px-6 shadow-lg shadow-blue-600/30 hover:shadow-blue-600/40 transition-all duration-200"
          >
            <Save className="h-4 w-4" />
            Guardar Configuración
          </button>
        </div>
      </div>
    </div>
  );
}
