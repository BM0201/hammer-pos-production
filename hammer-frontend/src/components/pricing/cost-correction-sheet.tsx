"use client";

import { useEffect, useMemo, useState } from "react";
import { X, ChevronDown, ChevronRight, AlertTriangle, RefreshCcw } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money, fmtDatePadded } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { useSubmitting } from "@/lib/client/use-submitting";
import { computeGainBreakdown, formatGainThreeWays, priceColorState, type GainOrderPreference } from "@/lib/pricing-tray-logic";
import {
  shouldWarnSuggestedIncrease,
  canConfirmCorrectionItem,
  buildCorrectionSummary,
  buildCorrectionPayloadItem,
  recalculateReferencePrices,
  type CorrectionMode,
  type CostAction,
} from "@/lib/cost-correction-logic";
import type { TrayRowData } from "@/components/pricing/tray-row";

/**
 * D · Fase 2 (prompt-completo-pendientes-2026-10.md) — "Revisar y aplicar":
 * reemplaza el modal "Confirmar aplicación en lote". Una tarjeta por
 * producto, Automático o Manual, con el origen del costo a la vista y la
 * ganancia recalculada en vivo. Reusa computeGainBreakdown/priceColorState
 * (C.4) — misma ganancia en los mismos tres formatos en toda la Bandeja.
 */

type CostSuspicion = { code: string; message: string };
export type CostSourceDescription = {
  effectiveCost: number | null;
  costSource: "BRANCH" | "GLOBAL" | "GLOBAL_AVERAGE" | "WAC_ESTIMATE" | "LAST_PURCHASE" | "NONE";
  responsibleFieldLabel: string;
  history: {
    lastPurchase: { cost: number; date: string; supplierName: string | null } | null;
    otherBranchCosts: Array<{ branchId: string; branchName: string; cost: number }>;
    averageCost: number | null;
    globalCost: number | null;
    recentSaleCostSnapshots: Array<{ saleDate: string; cost: number }>;
    branchCostOrigin: { action: string; occurredAt: string; actorName: string | null } | null;
  };
  suspicions: CostSuspicion[];
  allowedCorrections: CostAction[];
};

type DoneItem = { decisionId: string; costBefore: number | null; costAfter: number | null; priceBefore: number | null; priceAfter: number | null };
type FailedItem = { decisionId: string; reason: string };
type CorrectResponse = { done: DoneItem[]; failed: FailedItem[] };

type ItemState = {
  mode: CorrectionMode;
  costAction: CostAction | null;
  costInput: string;
  priceInput: string;
  keepPrice: boolean;
  removed: boolean;
  historyOpen: boolean;
};

const REASON_CHIPS = ["Error de carga del costo", "Subió el proveedor", "Ajuste de precio"];
const XYZ_ROTATION_LABEL: Record<string, string> = { X: "alta rotación", Y: "rotación media", Z: "baja rotación" };
function describeAbcXyzClass(combinedClass: string | undefined): string | null {
  if (!combinedClass || combinedClass.length < 2) return null;
  const xyz = combinedClass.charAt(1);
  return `${XYZ_ROTATION_LABEL[xyz] ?? "rotación"} (${combinedClass})`;
}

export function fallbackCostAfterClear(h: CostSourceDescription["history"]): number | null {
  return h.averageCost ?? h.globalCost ?? h.lastPurchase?.cost ?? null;
}

function defaultItemState(mode: CorrectionMode, row: TrayRowData): ItemState {
  return { mode, costAction: null, costInput: row.effectiveCost !== null ? String(row.effectiveCost) : "", priceInput: row.currentPrice !== null ? String(row.currentPrice) : "", keepPrice: false, removed: false, historyOpen: false };
}

export function CostCorrectionSheet({
  rows,
  branchName,
  gainOrderPreference,
  onClose,
  onDone,
}: {
  rows: TrayRowData[];
  branchName?: string;
  gainOrderPreference: GainOrderPreference;
  onClose: () => void;
  onDone: () => void;
}) {
  const [globalMode, setGlobalMode] = useState<CorrectionMode>("AUTO");
  const [items, setItems] = useState<Record<string, ItemState>>(() => Object.fromEntries(rows.map((r) => [r.decisionId, defaultItemState("AUTO", r)])));
  const [costSources, setCostSources] = useState<Record<string, CostSourceDescription | null>>({});
  const [reason, setReason] = useState("");
  const [submitting, run] = useSubmitting();
  const [result, setResult] = useState<CorrectResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all(rows.map(async (row) => {
      const res = await apiFetch(`/api/master/pricing/tray/${row.decisionId}/cost-source`);
      const raw = await res.json().catch(() => null);
      if (!res.ok) return [row.decisionId, null] as const;
      return [row.decisionId, unwrapApiData(raw) as CostSourceDescription] as const;
    })).then((pairs) => { if (!cancelled) setCostSources(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateItem(decisionId: string, patch: Partial<ItemState>) {
    setItems((prev) => ({ ...prev, [decisionId]: { ...prev[decisionId], ...patch } }));
  }

  function setMode(decisionId: string, mode: CorrectionMode) {
    updateItem(decisionId, { mode });
  }

  const activeRows = rows.filter((r) => !items[r.decisionId]?.removed);

  const summary = useMemo(() => {
    return buildCorrectionSummary(rows.map((row) => {
      const item = items[row.decisionId];
      const newCost = item.costAction ? Number(item.costInput) : row.effectiveCost;
      const costChanged = item.costAction !== null && Number.isFinite(newCost) && newCost !== row.effectiveCost;
      const newPrice = item.keepPrice ? row.currentPrice : (item.mode === "MANUAL" ? Number(item.priceInput) : row.suggestedPrice);
      return { removed: item.removed, costChanged, keepPrice: item.keepPrice, previousPrice: row.currentPrice, newPrice: Number.isFinite(newPrice) ? newPrice : null };
    }));
  }, [rows, items]);

  const canSubmit = reason.trim().length >= 5 && activeRows.length > 0 && activeRows.every((row) => {
    const item = items[row.decisionId];
    const newCost = item.costAction ? Number(item.costInput) : row.effectiveCost;
    return canConfirmCorrectionItem({ keepPrice: item.keepPrice, mode: item.mode, price: item.mode === "MANUAL" ? (item.priceInput.trim() === "" ? null : Number(item.priceInput)) : row.suggestedPrice, cost: Number.isFinite(newCost) ? newCost : null });
  });

  async function handleSubmit() {
    await run(async () => {
      const payloadItems = activeRows.map((row) => {
        const item = items[row.decisionId];
        return buildCorrectionPayloadItem({
          decisionId: row.decisionId,
          mode: item.mode,
          costAction: item.costAction,
          costValue: item.costAction && item.costAction !== "CLEAR_BRANCH_COST" ? Number(item.costInput) : null,
          price: item.mode === "MANUAL" ? (item.priceInput.trim() === "" ? null : Number(item.priceInput)) : null,
          keepPrice: item.keepPrice,
        });
      });
      const res = await apiFetch("/api/master/pricing/tray/correct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: payloadItems, reason }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo aplicar.");
      const parsed = unwrapApiData(raw) as CorrectResponse;
      setResult(parsed);
      if (parsed.failed.length === 0) onDone();
    });
  }

  async function retryOne(decisionId: string) {
    const row = rows.find((r) => r.decisionId === decisionId);
    if (!row) return;
    const item = items[decisionId];
    const payloadItem = buildCorrectionPayloadItem({
      decisionId,
      mode: item.mode,
      costAction: item.costAction,
      costValue: item.costAction && item.costAction !== "CLEAR_BRANCH_COST" ? Number(item.costInput) : null,
      price: item.mode === "MANUAL" ? (item.priceInput.trim() === "" ? null : Number(item.priceInput)) : null,
      keepPrice: item.keepPrice,
    });
    const res = await apiFetch("/api/master/pricing/tray/correct", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [payloadItem], reason }),
    });
    const raw = await res.json().catch(() => null);
    if (!res.ok) return;
    const parsed = unwrapApiData(raw) as CorrectResponse;
    setResult((prev) => prev ? {
      done: [...prev.done, ...parsed.done],
      failed: prev.failed.filter((f) => f.decisionId !== decisionId).concat(parsed.failed),
    } : parsed);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="flex h-full w-full max-w-2xl flex-col bg-[var(--color-surface)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-[var(--color-text)]">
              Revisar {rows.length} producto{rows.length === 1 ? "" : "s"}{branchName ? ` · ${branchName}` : ""}
            </h2>
            {!result && (
              <div className="mt-1 flex gap-1 text-xs">
                <button type="button" onClick={() => { setGlobalMode("AUTO"); setItems((prev) => Object.fromEntries(Object.entries(prev).map(([id, it]) => [id, { ...it, mode: "AUTO" }]))); }}
                  className={["rounded-full px-2.5 py-1 font-medium", globalMode === "AUTO" ? "bg-[var(--color-primary-600)] text-white" : "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]"].join(" ")}>Automático</button>
                <button type="button" onClick={() => { setGlobalMode("MANUAL"); setItems((prev) => Object.fromEntries(Object.entries(prev).map(([id, it]) => [id, { ...it, mode: "MANUAL" }]))); }}
                  className={["rounded-full px-2.5 py-1 font-medium", globalMode === "MANUAL" ? "bg-[var(--color-primary-600)] text-white" : "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]"].join(" ")}>Manual</button>
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center text-[var(--color-text-soft)]" aria-label="Cerrar"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {result ? (
            <div className="space-y-2">
              {result.done.map((d) => {
                const row = rows.find((r) => r.decisionId === d.decisionId);
                return (
                  <div key={d.decisionId} className="rounded-lg border border-[var(--color-success-300)] bg-[var(--color-success-50)] p-3 text-sm">
                    <p className="font-medium text-[var(--color-text)]">{row?.productName ?? d.decisionId}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Costo {d.costBefore !== null ? money(d.costBefore) : "—"} → {d.costAfter !== null ? money(d.costAfter) : "—"} · Precio {d.priceBefore !== null ? money(d.priceBefore) : "—"} → {d.priceAfter !== null ? money(d.priceAfter) : "—"}
                    </p>
                  </div>
                );
              })}
              {result.failed.map((f) => {
                const row = rows.find((r) => r.decisionId === f.decisionId);
                return (
                  <div key={f.decisionId} className="rounded-lg border border-[var(--color-danger-300)] bg-[var(--color-danger-50)] p-3 text-sm">
                    <p className="font-medium text-[var(--color-danger-700)]">{row?.productName ?? f.decisionId}</p>
                    <p className="text-xs text-[var(--color-danger-700)]">{f.reason}</p>
                    <button type="button" onClick={() => void retryOne(f.decisionId)} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-primary-600)]">
                      <RefreshCcw className="h-3 w-3" /> Reintentar este
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map((row) => {
                const item = items[row.decisionId];
                if (item.removed) {
                  return (
                    <div key={row.decisionId} className="flex items-center justify-between rounded-lg border border-dashed border-[var(--color-border)] p-3 text-sm text-[var(--color-text-soft)]">
                      <span>{row.productName} — quitado de este lote</span>
                      <button type="button" onClick={() => updateItem(row.decisionId, { removed: false })} className="text-xs font-semibold text-[var(--color-primary-600)]">Deshacer</button>
                    </div>
                  );
                }
                return <ProductCorrectionCard key={row.decisionId} row={row} item={item} costSource={costSources[row.decisionId] ?? null} gainOrderPreference={gainOrderPreference} onChange={(patch) => updateItem(row.decisionId, patch)} onSetMode={(m) => setMode(row.decisionId, m)} onRemove={() => updateItem(row.decisionId, { removed: true })} />;
              })}
            </div>
          )}
        </div>

        {!result && (
          <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {REASON_CHIPS.map((chip) => (
                <button key={chip} type="button" onClick={() => setReason(chip)} className="rounded-full border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]">{chip}</button>
              ))}
            </div>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Motivo (obligatorio, mínimo 5 caracteres)"
              className="h-11 w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
            />
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              {summary.count} producto{summary.count === 1 ? "" : "s"}
              {summary.costCorrectedCount > 0 ? ` · ${summary.costCorrectedCount} costo corregido` : ""}
              {summary.priceUpCount > 0 ? ` · ${summary.priceUpCount} precio sube` : ""}
              {summary.priceDownCount > 0 ? ` · ${summary.priceDownCount} precio baja` : ""}
              {summary.sameCount > 0 ? ` · ${summary.sameCount} sin cambio` : ""}
            </p>
            <div className="mt-3 flex justify-end">
              <Button type="button" variant="success" onClick={() => void handleSubmit()} loading={submitting} disabled={!canSubmit}>Aplicar</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProductCorrectionCard({
  row, item, costSource, gainOrderPreference, onChange, onSetMode, onRemove,
}: {
  row: TrayRowData;
  item: ItemState;
  costSource: CostSourceDescription | null;
  gainOrderPreference: GainOrderPreference;
  onChange: (patch: Partial<ItemState>) => void;
  onSetMode: (mode: CorrectionMode) => void;
  onRemove: () => void;
}) {
  const newCost = item.costAction === "CLEAR_BRANCH_COST"
    ? (costSource ? fallbackCostAfterClear(costSource.history) : row.effectiveCost)
    : (item.costInput.trim() === "" ? row.effectiveCost : (Number.isFinite(Number(item.costInput)) ? Number(item.costInput) : row.effectiveCost));

  const live = recalculateReferencePrices({
    newCost: newCost ?? 0,
    oldCost: row.effectiveCost,
    oldPrice: row.currentPrice,
    recommendedMarginPercent: typeof row.evidence.recommendedMarginPercent === "number" ? row.evidence.recommendedMarginPercent : null,
    minMarginPercent: typeof row.evidence.policyMinMarginPercent === "number" ? row.evidence.policyMinMarginPercent : null,
    realizedMarginPct: row.realizedMarginPct,
  });

  const previewPrice = item.keepPrice ? row.currentPrice : (item.mode === "AUTO" ? live.suggested : (item.priceInput.trim() === "" ? null : Number(item.priceInput)));
  const gain = computeGainBreakdown(previewPrice, newCost);
  const colorState = priceColorState(previewPrice, newCost, typeof row.evidence.policyMinMarginPercent === "number" ? row.evidence.policyMinMarginPercent : null);
  const colorClass = colorState === "BELOW_COST" ? "text-[var(--color-danger-600)]" : colorState === "BELOW_MIN" ? "text-[var(--color-warning-700)]" : colorState === "OK" ? "text-[var(--color-success-700)]" : "text-[var(--color-text-muted)]";
  const blocked = !canConfirmCorrectionItem({ keepPrice: item.keepPrice, mode: item.mode, price: item.mode === "MANUAL" ? (item.priceInput.trim() === "" ? null : Number(item.priceInput)) : previewPrice, cost: newCost });
  const bigIncrease = item.mode === "AUTO" && shouldWarnSuggestedIncrease(row.currentPrice, live.suggested);
  const abcLabel = describeAbcXyzClass(typeof row.evidence.commercialClass === "string" ? row.evidence.commercialClass : undefined);

  return (
    <div className="rounded-xl border border-[var(--color-border-strong)] p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--color-text)]">{row.productName}</p>
          <p className="text-xs text-[var(--color-text-soft)]">{row.productSku} · {row.branchName}</p>
        </div>
        <button type="button" onClick={onRemove} className="shrink-0 text-xs text-[var(--color-text-soft)] underline underline-offset-2">Quitar de este lote</button>
      </div>

      {costSource && costSource.suspicions.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {costSource.suspicions.map((s) => (
            <span key={s.code} className="inline-flex items-center gap-1 rounded-full bg-[var(--color-warning-50)] px-2 py-0.5 text-xs text-[var(--color-warning-700)]">
              <AlertTriangle className="h-3 w-3" /> {s.message}
            </span>
          ))}
        </div>
      )}

      <div className="mb-2 text-xs text-[var(--color-text-muted)]">
        De dónde sale el costo: <strong className="text-[var(--color-text)]">{costSource?.responsibleFieldLabel ?? "cargando…"}</strong>{" "}
        {costSource && (
          <button type="button" onClick={() => onChange({ historyOpen: !item.historyOpen })} className="inline-flex items-center text-[var(--color-primary-600)]">
            {item.historyOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} Ver historial
          </button>
        )}
      </div>
      {item.historyOpen && costSource && (
        <div className="mb-3 space-y-1 rounded-lg bg-[var(--color-surface-alt)] p-2 text-xs text-[var(--color-text-muted)]">
          {costSource.history.lastPurchase && <p>Última compra: {money(costSource.history.lastPurchase.cost)} ({fmtDatePadded(costSource.history.lastPurchase.date)}{costSource.history.lastPurchase.supplierName ? `, ${costSource.history.lastPurchase.supplierName}` : ""})</p>}
          {costSource.history.otherBranchCosts.map((b) => <p key={b.branchId}>Costo en {b.branchName}: {money(b.cost)}</p>)}
          {costSource.history.averageCost !== null && <p>Costo promedio: {money(costSource.history.averageCost)}</p>}
          {costSource.history.recentSaleCostSnapshots.length > 0 && <p>Últimas ventas: {costSource.history.recentSaleCostSnapshots.map((s) => money(s.cost)).join(", ")}</p>}
        </div>
      )}

      <div className="mb-2 flex gap-1 text-xs">
        <button type="button" onClick={() => onSetMode("AUTO")} className={["rounded-full px-2.5 py-1 font-medium", item.mode === "AUTO" ? "bg-[var(--color-primary-600)] text-white" : "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]"].join(" ")}>Automático</button>
        <button type="button" onClick={() => onSetMode("MANUAL")} className={["rounded-full px-2.5 py-1 font-medium", item.mode === "MANUAL" ? "bg-[var(--color-primary-600)] text-white" : "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]"].join(" ")}>Manual</button>
      </div>

      {item.mode === "AUTO" ? (
        <div className="space-y-1.5 text-sm">
          <p className="text-[var(--color-text)]">
            Precio: {row.currentPrice !== null ? money(row.currentPrice) : "—"} → <strong>{live.suggested !== null ? money(live.suggested) : "—"}</strong>
            {abcLabel && <span className="text-xs text-[var(--color-text-muted)]"> · {row.evidence.marginObjetivo as number ?? "?"}% meta + {row.evidence.marginDelta as number ?? 0}% por {abcLabel} = {(row.evidence.recommendedMarginPercent as number ?? 0).toFixed(0)}%</span>}
          </p>
          {bigIncrease && (
            <div className="flex items-center justify-between rounded-lg bg-[var(--color-warning-50)] p-2 text-xs text-[var(--color-warning-700)]">
              <span><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />Sube más del 50%. ¿El costo está bien?</span>
              <button type="button" onClick={() => onSetMode("MANUAL")} className="font-semibold underline underline-offset-2">Revisar el costo</button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Costo</label>
            <input type="number" value={item.costAction === "CLEAR_BRANCH_COST" ? "" : item.costInput} disabled={item.costAction === "CLEAR_BRANCH_COST"}
              onChange={(e) => onChange({ costInput: e.target.value, costAction: "SET_BRANCH_COST" })}
              placeholder={item.costAction === "CLEAR_BRANCH_COST" && newCost !== null ? `quedaría ${money(newCost)}` : undefined}
              className="h-11 w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]" />
            {costSource && (
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                {costSource.history.lastPurchase && (
                  <button type="button" onClick={() => onChange({ costAction: "SET_BRANCH_COST", costInput: String(costSource.history.lastPurchase!.cost) })} className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]">Usar última compra ({money(costSource.history.lastPurchase.cost)})</button>
                )}
                {costSource.history.otherBranchCosts.map((b) => (
                  <button key={b.branchId} type="button" onClick={() => onChange({ costAction: "SET_BRANCH_COST", costInput: String(b.cost) })} className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]">Usar costo de {b.branchName} ({money(b.cost)})</button>
                ))}
                {costSource.allowedCorrections.includes("CLEAR_BRANCH_COST") && (
                  <button type="button" onClick={() => onChange({ costAction: "CLEAR_BRANCH_COST" })} className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]">Quitar costo de sucursal{fallbackCostAfterClear(costSource.history) !== null ? ` → quedaría ${money(fallbackCostAfterClear(costSource.history)!)}` : ""}</button>
                )}
                <button type="button" onClick={() => onChange({ costAction: null, costInput: row.effectiveCost !== null ? String(row.effectiveCost) : "" })} className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]">Dejar el costo como está</button>
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            <input type="checkbox" checked={item.keepPrice} onChange={(e) => onChange({ keepPrice: e.target.checked })} className="h-5 w-5 rounded border-[var(--color-border-strong)]" />
            Solo corregir el costo; el precio está bien
          </label>

          {!item.keepPrice && (
            <div>
              <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Precio</label>
              <input type="number" value={item.priceInput} onChange={(e) => onChange({ priceInput: e.target.value })}
                className={["h-11 w-full rounded-lg border-2 px-3 text-sm font-semibold tabular-nums", colorState === "BELOW_COST" ? "border-[var(--color-danger-400)]" : colorState === "BELOW_MIN" ? "border-[var(--color-warning-400)]" : "border-[var(--color-border-strong)]"].join(" ")} />
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                {live.suggested !== null && <button type="button" onClick={() => onChange({ priceInput: String(live.suggested) })} className="rounded-full border border-[var(--color-border)] px-2 py-0.5 hover:bg-[var(--color-surface-alt)]">Sugerido ({money(live.suggested)})</button>}
                {live.policyMin !== null && <button type="button" onClick={() => onChange({ priceInput: String(live.policyMin) })} className="rounded-full border border-[var(--color-border)] px-2 py-0.5 hover:bg-[var(--color-surface-alt)]">Mínimo de política ({money(live.policyMin)})</button>}
                {live.realizedMargin !== null && <button type="button" onClick={() => onChange({ priceInput: String(live.realizedMargin) })} className="rounded-full border border-[var(--color-border)] px-2 py-0.5 hover:bg-[var(--color-surface-alt)]">Como lo venís vendiendo ({money(live.realizedMargin)})</button>}
                {live.keepGainAmount !== null && <button type="button" onClick={() => onChange({ priceInput: String(live.keepGainAmount) })} className="rounded-full border border-[var(--color-border)] px-2 py-0.5 hover:bg-[var(--color-surface-alt)]">Misma ganancia en C$ ({money(live.keepGainAmount)})</button>}
              </div>
            </div>
          )}

          <p className={["text-sm font-medium", colorClass].join(" ")}>
            {item.keepPrice ? "Precio sin cambio." : blocked ? "El precio queda bajo el costo — no se puede confirmar." : `Ganancia: ${formatGainThreeWays(gain, gainOrderPreference, money)}`}
          </p>
        </div>
      )}
    </div>
  );
}
