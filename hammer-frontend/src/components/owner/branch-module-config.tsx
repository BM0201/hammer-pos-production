"use client";

import { useEffect, useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Building2,
  CreditCard,
  Package,
  Save,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Settings2,
  Layers,
  ArrowRight,
} from "lucide-react";
import { apiFetch } from "@/lib/client/api";

type BranchConfig = {
  branchId: string;
  enableCashier: boolean;
  enableDispatch: boolean;
  branch: { id: string; code: string; name: string; isActive: boolean };
};

type LocalConfig = BranchConfig & { dirty: boolean };

function describeWorkflow(enableCashier: boolean, enableDispatch: boolean): { label: string; color: string } {
  if (enableCashier && enableDispatch) return { label: "Completo: Venta \u2192 Caja \u2192 Despacho", color: "var(--color-success-600, #16a34a)" };
  if (enableCashier && !enableDispatch) return { label: "Sin despacho: Venta \u2192 Caja \u2192 Entregado", color: "var(--color-warning-600, #d97706)" };
  if (!enableCashier && enableDispatch) return { label: "Sin caja: Venta+Cobro \u2192 Despacho", color: "var(--color-warning-600, #d97706)" };
  return { label: "Directo: Venta+Cobro+Entrega", color: "var(--color-danger-600, #dc2626)" };
}

export function BranchModuleConfigPanel() {
  const [configs, setConfigs] = useState<LocalConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [bulkSaving, setBulkSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [selectedBranches, setSelectedBranches] = useState<Set<string>>(new Set());

  const loadConfigs = useCallback(() => {
    setLoading(true);
    fetch("/api/branch-config")
      .then((r) => r.json())
      .then((data: any) => {
        const arr = Array.isArray(data) ? data : [];
        setConfigs(arr.map((c: BranchConfig) => ({ ...c, dirty: false })));
      })
      .catch(() => setConfigs([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadConfigs(); }, [loadConfigs]);

  const toggleModule = (branchId: string, field: "enableCashier" | "enableDispatch") => {
    setConfigs((prev) =>
      (prev ?? []).map((c: LocalConfig) =>
        c?.branchId === branchId ? { ...c, [field]: !c[field], dirty: true } : c
      )
    );
    setFeedback(null);
  };

  const saveSingle = async (branchId: string) => {
    const cfg = (configs ?? []).find((c: LocalConfig) => c?.branchId === branchId);
    if (!cfg) return;
    setSaving((prev) => ({ ...(prev ?? {}), [branchId]: true }));
    try {
      const res = await apiFetch("/api/branch-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          enableCashier: cfg.enableCashier,
          enableDispatch: cfg.enableDispatch,
        }),
      });
      if (!res.ok) throw new Error("Error al guardar");
      setConfigs((prev) =>
        (prev ?? []).map((c: LocalConfig) => (c?.branchId === branchId ? { ...c, dirty: false } : c))
      );
      setFeedback({ type: "success", text: `Configuracion de ${cfg?.branch?.name ?? ""} guardada exitosamente.` });
    } catch {
      setFeedback({ type: "error", text: "Error al guardar la configuracion." });
    } finally {
      setSaving((prev) => ({ ...(prev ?? {}), [branchId]: false }));
    }
  };

  const toggleSelect = (branchId: string) => {
    setSelectedBranches((prev) => {
      const next = new Set(prev);
      if (next.has(branchId)) next.delete(branchId);
      else next.add(branchId);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedBranches.size === (configs?.length ?? 0)) {
      setSelectedBranches(new Set());
    } else {
      setSelectedBranches(new Set((configs ?? []).map((c: LocalConfig) => c?.branchId ?? "")));
    }
  };

  const bulkApply = async (enableCashier: boolean, enableDispatch: boolean) => {
    if (selectedBranches.size === 0) return;
    setBulkSaving(true);
    try {
      const res = await apiFetch("/api/branch-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchIds: Array.from(selectedBranches),
          enableCashier,
          enableDispatch,
        }),
      });
      if (!res.ok) throw new Error("Error");
      loadConfigs();
      setSelectedBranches(new Set());
      setFeedback({ type: "success", text: `Configuracion masiva aplicada a ${selectedBranches.size} sucursales.` });
    } catch {
      setFeedback({ type: "error", text: "Error al aplicar configuracion masiva." });
    } finally {
      setBulkSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--color-text)]">Configuracion de Modulos</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          Active o desactive los modulos de Caja y Despacho por sucursal para adaptar el flujo de trabajo.
        </p>
      </div>

      {/* Feedback */}
      {feedback && (
        <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
          feedback.type === "success" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"
        }`}>
          {feedback.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {feedback.text}
        </div>
      )}

      {/* Bulk Actions */}
      {selectedBranches.size > 0 && (
        <Card className="p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4" style={{ color: "var(--color-owner-600)" }} />
              <span className="text-sm font-semibold text-[var(--color-text)]">
                {selectedBranches.size} sucursal{selectedBranches.size > 1 ? "es" : ""} seleccionada{selectedBranches.size > 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="primary" onClick={() => bulkApply(true, true)} disabled={bulkSaving}>
                {bulkSaving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Flujo completo
              </Button>
              <Button size="sm" variant="secondary" onClick={() => bulkApply(true, false)} disabled={bulkSaving}>
                Sin despacho
              </Button>
              <Button size="sm" variant="secondary" onClick={() => bulkApply(false, true)} disabled={bulkSaving}>
                Sin caja
              </Button>
              <Button size="sm" variant="secondary" onClick={() => bulkApply(false, false)} disabled={bulkSaving}>
                Directo
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Branch Cards */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--color-text-muted)]" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Select all */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={selectedBranches.size === (configs?.length ?? 0) && (configs?.length ?? 0) > 0}
              onChange={selectAll}
              className="h-4 w-4 rounded border-gray-300"
            />
            <span className="text-xs text-[var(--color-text-muted)]">Seleccionar todas</span>
          </div>

          {(configs ?? []).map((cfg: LocalConfig) => {
            const workflow = describeWorkflow(cfg?.enableCashier ?? true, cfg?.enableDispatch ?? true);
            const isSaving = saving?.[cfg?.branchId ?? ""] ?? false;
            const isSelected = selectedBranches.has(cfg?.branchId ?? "");

            return (
              <Card key={cfg?.branchId ?? ""} className={`p-5 transition-all ${isSelected ? "ring-2" : ""}`} style={isSelected ? { borderColor: "var(--color-owner-400)" } : {}}>
                <div className="flex flex-col gap-4">
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(cfg?.branchId ?? "")}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <div className="p-2 rounded-lg bg-[var(--color-owner-100)]">
                        <Building2 className="h-5 w-5" style={{ color: "var(--color-owner-600)" }} />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-[var(--color-text)]">{cfg?.branch?.name ?? ""}</h3>
                        <p className="text-xs" style={{ color: workflow.color }}>{workflow.label}</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={cfg?.dirty ? "primary" : "ghost"}
                      disabled={!cfg?.dirty || isSaving}
                      onClick={() => saveSingle(cfg?.branchId ?? "")}
                      icon={isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                    >
                      {isSaving ? "Guardando..." : "Guardar"}
                    </Button>
                  </div>

                  {/* Module Toggles */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Cashier Module */}
                    <button
                      onClick={() => toggleModule(cfg?.branchId ?? "", "enableCashier")}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                        cfg?.enableCashier
                          ? "border-green-200 bg-green-50 hover:bg-green-100"
                          : "border-gray-200 bg-gray-50 hover:bg-gray-100"
                      }`}
                    >
                      <CreditCard className={`h-5 w-5 ${cfg?.enableCashier ? "text-green-600" : "text-gray-400"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[var(--color-text)]">Modulo de Caja</p>
                        <p className="text-xs text-[var(--color-text-muted)]">
                          {cfg?.enableCashier ? "Cajero recibe pagos por separado" : "Vendedor cobra directamente"}
                        </p>
                      </div>
                      <Badge variant={cfg?.enableCashier ? "success" : "neutral"}>
                        {cfg?.enableCashier ? "Activo" : "Inactivo"}
                      </Badge>
                    </button>

                    {/* Dispatch Module */}
                    <button
                      onClick={() => toggleModule(cfg?.branchId ?? "", "enableDispatch")}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                        cfg?.enableDispatch
                          ? "border-green-200 bg-green-50 hover:bg-green-100"
                          : "border-gray-200 bg-gray-50 hover:bg-gray-100"
                      }`}
                    >
                      <Package className={`h-5 w-5 ${cfg?.enableDispatch ? "text-green-600" : "text-gray-400"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[var(--color-text)]">Modulo de Despacho</p>
                        <p className="text-xs text-[var(--color-text-muted)]">
                          {cfg?.enableDispatch ? "Bodega despacha por separado" : "Entrega inmediata tras pago"}
                        </p>
                      </div>
                      <Badge variant={cfg?.enableDispatch ? "success" : "neutral"}>
                        {cfg?.enableDispatch ? "Activo" : "Inactivo"}
                      </Badge>
                    </button>
                  </div>

                  {/* Workflow Preview */}
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-surface-alt)]">
                    <Settings2 className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                    <span className="text-xs text-[var(--color-text-muted)]">Flujo actual:</span>
                    <div className="flex items-center gap-1 text-xs font-medium text-[var(--color-text)]">
                      <span>Vendedor</span>
                      {(cfg?.enableCashier ?? true) && (
                        <><ArrowRight className="h-3 w-3" /><span>Caja</span></>
                      )}
                      {(cfg?.enableDispatch ?? true) && (
                        <><ArrowRight className="h-3 w-3" /><span>Despacho</span></>
                      )}
                      {!(cfg?.enableCashier ?? true) && !(cfg?.enableDispatch ?? true) && (
                        <span className="ml-1 text-[var(--color-text-muted)]">(todo en un paso)</span>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
