"use client";

import { useEffect, useState } from "react";
import { X, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money, fmtDatePadded } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { useSubmitting } from "@/lib/client/use-submitting";
import { type CostAction } from "@/lib/cost-correction-logic";
import { type CostSourceDescription, fallbackCostAfterClear } from "@/components/pricing/cost-correction-sheet";

/**
 * D · Fase 3 (prompt-completo-pendientes-2026-10.md) — "la misma tarjeta, en
 * modo Manual, con su origen, historial y acciones", pero SIN decisión que
 * cerrar ni precio que aplicar (a diferencia de CostCorrectionSheet, que
 * vive en la Bandeja). Usada desde la ficha del producto y Precios vigentes.
 */
export function CostOnlyCorrectionModal({
  productId,
  branchId,
  productName,
  onClose,
  onDone,
}: {
  productId: string;
  branchId: string;
  productName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [costSource, setCostSource] = useState<CostSourceDescription | null>(null);
  const [loading, setLoading] = useState(true);
  const [costAction, setCostAction] = useState<CostAction | null>(null);
  const [costInput, setCostInput] = useState("");
  const [reason, setReason] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [submitting, run] = useSubmitting();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/master/pricing/cost-source?productId=${productId}&branchId=${branchId}`)
      .then(async (r) => {
        const raw = await r.json();
        if (!r.ok) throw new Error(raw?.error?.message ?? "No se pudo cargar el origen del costo.");
        const data = unwrapApiData(raw) as CostSourceDescription;
        if (!cancelled) {
          setCostSource(data);
          setCostInput(data.effectiveCost !== null ? String(data.effectiveCost) : "");
        }
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "No se pudo cargar el origen del costo."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [productId, branchId]);

  const newCost = costAction === "CLEAR_BRANCH_COST"
    ? (costSource ? fallbackCostAfterClear(costSource.history) : null)
    : (costInput.trim() === "" ? null : (Number.isFinite(Number(costInput)) ? Number(costInput) : null));

  const canSubmit = reason.trim().length >= 10 && costAction !== null && (costAction === "CLEAR_BRANCH_COST" || (newCost !== null && newCost > 0));

  async function handleSubmit() {
    await run(async () => {
      const res = await apiFetch("/api/master/pricing/cost-source/correct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, branchId, action: costAction, value: costAction === "CLEAR_BRANCH_COST" ? undefined : newCost, reason }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) { setError(raw?.error?.message ?? "No se pudo corregir el costo."); return; }
      onDone();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-[var(--color-text)]">Corregir costo</h3>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center text-[var(--color-text-soft)]" aria-label="Cerrar"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">{productName}</p>

        {loading ? (
          <p className="text-sm text-[var(--color-text-muted)]">Cargando…</p>
        ) : costSource ? (
          <>
            {costSource.suspicions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {costSource.suspicions.map((s) => (
                  <span key={s.code} className="inline-flex items-center gap-1 rounded-full bg-[var(--color-warning-50)] px-2 py-0.5 text-xs text-[var(--color-warning-700)]">
                    <AlertTriangle className="h-3 w-3" /> {s.message}
                  </span>
                ))}
              </div>
            )}

            <div className="text-xs text-[var(--color-text-muted)]">
              De dónde sale el costo: <strong className="text-[var(--color-text)]">{costSource.responsibleFieldLabel}</strong>{" "}
              <button type="button" onClick={() => setHistoryOpen((v) => !v)} className="inline-flex items-center text-[var(--color-primary-600)]">
                {historyOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} Ver historial
              </button>
            </div>
            {historyOpen && (
              <div className="space-y-1 rounded-lg bg-[var(--color-surface-alt)] p-2 text-xs text-[var(--color-text-muted)]">
                {costSource.history.lastPurchase && <p>Última compra: {money(costSource.history.lastPurchase.cost)} ({fmtDatePadded(costSource.history.lastPurchase.date)}{costSource.history.lastPurchase.supplierName ? `, ${costSource.history.lastPurchase.supplierName}` : ""})</p>}
                {costSource.history.otherBranchCosts.map((b) => <p key={b.branchId}>Costo en {b.branchName}: {money(b.cost)}</p>)}
                {costSource.history.averageCost !== null && <p>Costo promedio: {money(costSource.history.averageCost)}</p>}
                {costSource.history.recentSaleCostSnapshots.length > 0 && <p>Últimas ventas: {costSource.history.recentSaleCostSnapshots.map((s) => money(s.cost)).join(", ")}</p>}
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Costo nuevo</label>
              <input type="number" value={costAction === "CLEAR_BRANCH_COST" ? "" : costInput} disabled={costAction === "CLEAR_BRANCH_COST"}
                onChange={(e) => { setCostInput(e.target.value); setCostAction("SET_BRANCH_COST"); }}
                placeholder={costAction === "CLEAR_BRANCH_COST" && newCost !== null ? `quedaría ${money(newCost)}` : undefined}
                className="h-11 w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]" />
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                {costSource.history.lastPurchase && (
                  <button type="button" onClick={() => { setCostAction("SET_BRANCH_COST"); setCostInput(String(costSource.history.lastPurchase!.cost)); }} className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]">Usar última compra ({money(costSource.history.lastPurchase.cost)})</button>
                )}
                {costSource.history.otherBranchCosts.map((b) => (
                  <button key={b.branchId} type="button" onClick={() => { setCostAction("SET_BRANCH_COST"); setCostInput(String(b.cost)); }} className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]">Usar costo de {b.branchName} ({money(b.cost)})</button>
                ))}
                {costSource.allowedCorrections.includes("CLEAR_BRANCH_COST") && (
                  <button type="button" onClick={() => setCostAction("CLEAR_BRANCH_COST")} className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]">Quitar costo de sucursal{fallbackCostAfterClear(costSource.history) !== null ? ` → quedaría ${money(fallbackCostAfterClear(costSource.history)!)}` : ""}</button>
                )}
                {costSource.allowedCorrections.includes("SET_GLOBAL_COST") && (
                  <button type="button" onClick={() => { setCostAction("SET_GLOBAL_COST"); setCostInput(costSource.effectiveCost !== null ? String(costSource.effectiveCost) : ""); }} className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]">Corregir el costo global</button>
                )}
                {costSource.allowedCorrections.includes("SET_AVERAGE_COST") && (
                  <button type="button" onClick={() => { setCostAction("SET_AVERAGE_COST"); setCostInput(costSource.effectiveCost !== null ? String(costSource.effectiveCost) : ""); }} className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]">Corregir el costo promedio</button>
                )}
              </div>
            </div>

            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Motivo (obligatorio, mínimo 10 caracteres)"
              className="h-11 w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
            />

            {error && <p className="text-xs text-[var(--color-danger-600)]">{error}</p>}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>Cancelar</Button>
              <Button type="button" variant="success" onClick={() => void handleSubmit()} loading={submitting} disabled={!canSubmit}>Corregir</Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-[var(--color-danger-600)]">{error ?? "No se pudo cargar."}</p>
        )}
      </div>
    </div>
  );
}
