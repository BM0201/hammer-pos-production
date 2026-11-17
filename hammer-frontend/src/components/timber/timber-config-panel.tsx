"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { Settings2, Building2 } from "lucide-react";
import type { Branch } from "./trip-logic";
import { readJson } from "./trip-api";
import { TimberBranchCostPanel } from "./timber-branch-cost-panel";
import { TimberSalePriceRecalcPreviewPanel } from "./timber-recalc-panel";

type CubicationRow = { lengthFeet: number; varas: number; forceCuadro: boolean };
type FullConfig = {
  costPerFoot: number; pricePerInchTabla: number; pricePerInchTablilla: number; pricePerInchCuadro: number;
  classification: { cubicationTable: CubicationRow[]; tablaWidths: number[]; tablillaWidths: number[] };
  targetMarginPercent: number; targetMarginRoundingMultiple: number;
  reconciliationTolerancePercent: number; warnBelowTargetMargin: boolean; blockNegativeMargin: boolean;
  /** true solo si branchId venía con valor y existe fila propia de esa sucursal — false = viendo/heredando el default global. */
  isBranchOverride: boolean;
};

export function TimberConfigPanel() {
  const [config, setConfig] = useState<FullConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // "" = default global. Mismo selector de sucursal que la zona Precios
  // (Master), con la opción extra "Global (default)" — acá no hay un modo
  // "todas las sucursales a la vez": Configuración siempre edita UNA fila
  // (la global o la de una sucursal puntual).
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  // Después de guardar una sucursal, la vista previa de precios afectados se abre sola (no escribe nada).
  const [showRecalcForBranch, setShowRecalcForBranch] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/branches").then((r) => (r.ok ? r.json() : null)).then((raw) => { if (raw) setBranches(unwrapApiData(raw) as Branch[]); }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/timber/pricing${branchId ? `?branchId=${branchId}` : ""}`);
      const raw = await readJson(res);
      setConfig(unwrapApiData(raw));
    } catch {
      showToast("error", "No se pudo cargar la configuración.");
    } finally {
      setLoading(false);
    }
  }, [branchId]);
  useEffect(() => { void load(); }, [load]);

  function selectBranch(nextBranchId: string) {
    setBranchId(nextBranchId);
    setShowRecalcForBranch(null);
  }

  async function save() {
    if (!config) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/timber/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: branchId || undefined,
          costPerFoot: config.costPerFoot,
          pricePerInchTabla: config.pricePerInchTabla,
          pricePerInchTablilla: config.pricePerInchTablilla,
          pricePerInchCuadro: config.pricePerInchCuadro,
          cubicationTable: config.classification.cubicationTable,
          tablaWidths: config.classification.tablaWidths,
          tablillaWidths: config.classification.tablillaWidths,
          targetMarginPercent: config.targetMarginPercent,
          targetMarginRoundingMultiple: config.targetMarginRoundingMultiple,
          reconciliationTolerancePercent: config.reconciliationTolerancePercent,
          warnBelowTargetMargin: config.warnBelowTargetMargin,
          blockNegativeMargin: config.blockNegativeMargin,
        }),
      });
      const raw = await readJson(res);
      if (!res.ok) { showToast("error", raw?.error?.message ?? "No se pudo guardar la configuración."); return; }
      showToast("success", branchId ? `Configuración de ${branches.find((b) => b.id === branchId)?.name ?? "la sucursal"} guardada.` : "Configuración global guardada.");
      setConfig(unwrapApiData(raw));
      if (branchId) setShowRecalcForBranch(branchId);
    } catch {
      showToast("error", "Error de red al guardar.");
    } finally {
      setSaving(false);
    }
  }

  function updateCubicationRow(idx: number, patch: Partial<CubicationRow>) {
    if (!config) return;
    const rows = config.classification.cubicationTable.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    setConfig({ ...config, classification: { ...config.classification, cubicationTable: rows } });
  }

  if (loading || !config) {
    return <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">Cargando configuración…</div>;
  }

  const activeBranchName = branches.find((b) => b.id === branchId)?.name;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="hm-section-icon hm-section-icon-warehouse"><Settings2 className="h-4 w-4" /></div>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-[var(--color-text)]">Configuración de Madera</h1>
          <p className="text-sm text-[var(--color-text-muted)]">Tabla de cubicación, precios por pulgada, margen objetivo y alertas — todo editable, sin código.</p>
        </div>
        <span className="flex-1" />
        <div className="flex items-end gap-2">
          <Building2 className="mb-2.5 h-4 w-4 text-[var(--color-text-muted)]" />
          <div className="w-full sm:w-[220px]">
            <label htmlFor="timber-config-branch" className="mb-1 block text-xs text-[var(--color-text-muted)]">Sucursal</label>
            <select id="timber-config-branch" className="hm-input" value={branchId} onChange={(e) => selectBranch(e.target.value)}>
              <option value="">Global (default)</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
            </select>
          </div>
        </div>
        <Button variant="primary" loading={saving} onClick={save}>Guardar cambios</Button>
      </div>

      {/* Paso 1/2 — deja claro si se está editando el default global o una
          sucursal puntual, y si esa sucursal ya tiene override propio o
          todavía está heredando el global (guardar acá crea su override). */}
      {branchId ? (
        <div className="rounded-lg border border-[var(--color-info-200)] bg-[var(--color-info-50)] px-3.5 py-2 text-[12.5px] text-[var(--color-info-800)]">
          {config.isBranchOverride
            ? <>Editando la configuración propia de <b>{activeBranchName}</b>.</>
            : <>{activeBranchName} todavía no tiene configuración propia — mostrando el default global. Guardar acá crea su override, sin afectar a las demás sucursales.</>}
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3.5 py-2 text-[12.5px] text-[var(--color-text-muted)]">
          Editando el default global — aplica a toda sucursal sin configuración propia.
        </div>
      )}

      <TimberBranchCostPanel
        key={branchId || "global"}
        branchId={branchId}
        branchName={activeBranchName ?? ""}
        savedCostPerFoot={config.isBranchOverride ? config.costPerFoot : null}
        onApplied={(costPerFoot) => setConfig({ ...config, costPerFoot, isBranchOverride: true })}
      />

      {showRecalcForBranch && (
        <TimberSalePriceRecalcPreviewPanel
          branchId={showRecalcForBranch}
          branchName={branches.find((b) => b.id === showRecalcForBranch)?.name ?? "esta sucursal"}
          onClose={() => setShowRecalcForBranch(null)}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card noPadding>
          <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3.5 py-2.5"><b className="text-[12.5px]">Tabla de cubicación</b></div>
          <table className="hm-sheet-table">
            <thead><tr><th>Largo comercial</th><th className="r">Varas</th><th>Grupo forzado</th></tr></thead>
            <tbody>
              {config.classification.cubicationTable.map((row, i) => (
                <tr key={i}>
                  <td><b>{row.lengthFeet} pies</b></td>
                  <td><input type="number" value={row.varas} onChange={(e) => updateCubicationRow(i, { varas: Number(e.target.value) })} className="w-20 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-right font-mono text-[12.5px]" /></td>
                  <td>
                    <label className="flex items-center gap-1.5 text-[11.5px]">
                      <input type="checkbox" checked={row.forceCuadro} onChange={(e) => updateCubicationRow(i, { forceCuadro: e.target.checked })} />
                      CUADRO
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-[var(--color-border)] px-3.5 py-2 text-[11px] text-[var(--color-text-soft)]">Pies tablares = grueso × ancho × largo ÷ 12 · las varas solo se usan para el precio de venta</div>
        </Card>

        <div className="flex flex-col gap-3.5">
          <Card>
            <div className="hm-section-rule">Precio por pulgada</div>
            <div className="space-y-2">
              {([["TABLA", "pricePerInchTabla"], ["TABLILLA", "pricePerInchTablilla"], ["CUADRO", "pricePerInchCuadro"]] as const).map(([label, key]) => (
                <div key={key} className="flex items-center gap-2.5 text-[12.5px]">
                  <span className="w-24 font-bold">{label}</span>
                  <input type="number" value={config[key]} onChange={(e) => setConfig({ ...config, [key]: Number(e.target.value) })} className="w-24 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-right font-mono" />
                </div>
              ))}
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2.5">
              <label className="block text-[11px] font-semibold text-[var(--color-text-muted)]">
                Anchos TABLA
                <input value={config.classification.tablaWidths.join(",")} onChange={(e) => setConfig({ ...config, classification: { ...config.classification, tablaWidths: e.target.value.split(",").map((s) => Number(s.trim())).filter((v) => !Number.isNaN(v)) } })} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-[12px]" />
              </label>
              <label className="block text-[11px] font-semibold text-[var(--color-text-muted)]">
                Anchos TABLILLA
                <input value={config.classification.tablillaWidths.join(",")} onChange={(e) => setConfig({ ...config, classification: { ...config.classification, tablillaWidths: e.target.value.split(",").map((s) => Number(s.trim())).filter((v) => !Number.isNaN(v)) } })} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-[12px]" />
              </label>
            </div>
          </Card>

          <Card>
            <div className="hm-section-rule">Margen objetivo y alertas</div>
            <div className="grid grid-cols-2 gap-2.5">
              <label className="block text-[11.5px] font-semibold text-[var(--color-text-muted)]">
                Margen objetivo (%)
                {/* *100 sobre un Decimal puede arrastrar error de punto flotante
                    (0.29 * 100 = 28.999999999999996) — .toFixed(2) antes de
                    mostrarlo en el input, igual que .../3 (task PASO 3). */}
                <input type="number" value={(config.targetMarginPercent * 100).toFixed(2)} onChange={(e) => setConfig({ ...config, targetMarginPercent: Number(e.target.value) / 100 })} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-right font-mono text-[12.5px]" />
              </label>
              <label className="block text-[11.5px] font-semibold text-[var(--color-text-muted)]">
                Tolerancia conciliación (%)
                <input type="number" value={(config.reconciliationTolerancePercent * 100).toFixed(2)} onChange={(e) => setConfig({ ...config, reconciliationTolerancePercent: Number(e.target.value) / 100 })} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-right font-mono text-[12.5px]" />
              </label>
            </div>
            <div className="mt-2.5 flex flex-col gap-2 text-[12.5px]">
              <label className="flex items-center gap-2"><input type="checkbox" checked={config.warnBelowTargetMargin} onChange={(e) => setConfig({ ...config, warnBelowTargetMargin: e.target.checked })} /> Avisar si un viaje deja margen bajo el objetivo</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={config.blockNegativeMargin} onChange={(e) => setConfig({ ...config, blockNegativeMargin: e.target.checked })} /> Bloquear confirmación con margen negativo sin autorización</label>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
