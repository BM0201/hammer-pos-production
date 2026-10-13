"use client";

import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronRight, Flame, MoreVertical, ArrowRight } from "lucide-react";
import { money, qty } from "@/lib/format";
import {
  computeGainBreakdown,
  formatGainThreeWays,
  priceColorState,
  shouldWarnRealizedGap,
  type GainOrderPreference,
  type PriceApplyMethod,
} from "@/lib/pricing-tray-logic";

/**
 * Parte C.4 (prompt-completo-pendientes-2026-10.md) — "la Bandeja como mesa
 * de decisión": reemplaza RowGroup. El precio nuevo es un input editable,
 * precargado con el precio ACTUAL (no el sugerido) — el dueño decide.
 */

export type TrayRowData = {
  decisionId: string;
  severity: string;
  branchId: string;
  branchName: string;
  productId: string;
  productSku: string;
  productName: string;
  currentPrice: number | null;
  suggestedPrice: number | null;
  effectiveCost: number | null;
  marginObjetivo: number | null;
  stockAtRisk: number | null;
  impactAmount: number;
  applicable: boolean;
  costLooksWrong: boolean;
  referenceCost: number | null;
  realizedMarginPct: number | null;
  units90d: number | null;
  otherBranchPrices: { min: number; max: number; count: number } | null;
  evidence: Record<string, unknown>;
};

export type ReferenceChip = { method: PriceApplyMethod; label: string; price: number | null; available: boolean; reason?: string };

function severityDot(severity: string) {
  if (severity === "CRITICAL") return "bg-[var(--color-danger-600)]";
  if (severity === "HIGH") return "bg-[var(--color-warning-600)]";
  return "bg-[var(--color-text-soft)]";
}

function colorClasses(state: ReturnType<typeof priceColorState>) {
  if (state === "BELOW_COST") return { border: "border-[var(--color-danger-400)]", bg: "bg-[var(--color-danger-50)]", text: "text-[var(--color-danger-700)]" };
  if (state === "BELOW_MIN") return { border: "border-[var(--color-warning-400)]", bg: "bg-[var(--color-warning-50)]", text: "text-[var(--color-warning-700)]" };
  if (state === "OK") return { border: "border-[var(--color-success-400)]", bg: "bg-[var(--color-success-50)]", text: "text-[var(--color-success-700)]" };
  return { border: "border-[var(--color-border)]", bg: "", text: "text-[var(--color-text-muted)]" };
}

function colorLabel(state: ReturnType<typeof priceColorState>) {
  if (state === "BELOW_COST") return "no se puede aplicar";
  if (state === "BELOW_MIN") return "bajo el mínimo";
  if (state === "OK") return "dentro de la política";
  return null;
}

export type TrayRowProps = {
  row: TrayRowData;
  priceInput: string;
  onPriceInputChange: (value: string) => void;
  method: PriceApplyMethod;
  onSelectReference: (method: PriceApplyMethod, price: number) => void;
  references: ReferenceChip[] | null;
  selected: boolean;
  onToggleSelect: () => void;
  expanded: boolean;
  onToggleExpand: () => void;
  onApply: () => void;
  onKeep: () => void;
  onOpenMenu: () => void;
  gainOrderPreference: GainOrderPreference;
  /** Enter en el input: aplica (con confirmación si pasa de ±30%, manejado por el padre). */
  onEnterKey: () => void;
  /** ↑/↓: mueve el foco a la fila anterior/siguiente — lo resuelve el padre, que conoce el orden de TODAS las filas visibles. */
  onArrowKey?: (direction: -1 | 1) => void;
  registerInputRef: (el: HTMLInputElement | null) => void;
};

/** El cuerpo compartido: input + ganancia en vivo + chips — usado por la fila de escritorio, la tarjeta de tablet/móvil y el drawer. */
export function PriceDecisionBody({ row, priceInput, onPriceInputChange, method, onSelectReference, references, onApply, onKeep, gainOrderPreference, onEnterKey, onArrowKey, registerInputRef }: Pick<TrayRowProps, "row" | "priceInput" | "onPriceInputChange" | "method" | "onSelectReference" | "references" | "onApply" | "onKeep" | "gainOrderPreference" | "onEnterKey" | "onArrowKey" | "registerInputRef">) {
  const parsedPrice = priceInput.trim() === "" ? null : Number(priceInput);
  const validPrice = parsedPrice !== null && Number.isFinite(parsedPrice) ? parsedPrice : null;
  const gain = computeGainBreakdown(validPrice, row.effectiveCost);
  const colorState = priceColorState(validPrice, row.effectiveCost, row.marginObjetivo);
  const colors = colorClasses(colorState);
  const label = colorLabel(colorState);
  const warnGap = shouldWarnRealizedGap(gain.marginOnPrice, row.realizedMarginPct);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--color-text-soft)]">C$</span>
          <input
            ref={registerInputRef}
            type="text"
            inputMode="decimal"
            value={priceInput}
            onChange={(e) => onPriceInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); onEnterKey(); }
              else if (e.key === "ArrowDown" && onArrowKey) { e.preventDefault(); onArrowKey(1); }
              else if (e.key === "ArrowUp" && onArrowKey) { e.preventDefault(); onArrowKey(-1); }
            }}
            className={`h-11 w-28 rounded-lg border-2 pl-7 pr-2 text-right text-sm font-semibold tabular-nums ${colors.border} ${colors.bg} ${colors.text}`}
          />
        </div>
        {label && <span className={`text-xs font-semibold ${colors.text}`}>{label}</span>}
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">
        {formatGainThreeWays(gain, gainOrderPreference, money)}
        {warnGap && row.realizedMarginPct !== null && (
          <span className="ml-1 inline-flex items-center gap-0.5 text-[var(--color-warning-700)]" title={`Vendés a ${row.realizedMarginPct.toFixed(1)}%, este precio da ${gain.marginOnPrice?.toFixed(1)}%`}>
            <ArrowRight className="h-3 w-3" /> vendés a {row.realizedMarginPct.toFixed(1)}%
          </span>
        )}
      </p>
      {references && references.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {references.filter((r) => r.method !== "MANUAL").map((ref) => (
            <button
              key={ref.method}
              type="button"
              disabled={!ref.available || ref.price === null}
              onClick={() => ref.price !== null && onSelectReference(ref.method, ref.price)}
              title={!ref.available ? ref.reason : undefined}
              className={`rounded-full border px-2.5 py-1 text-[0.7rem] font-medium transition-colors ${
                method === ref.method
                  ? "border-[var(--color-master-600)] bg-[var(--color-master-50)] text-[var(--color-master-700)]"
                  : ref.available
                    ? "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]"
                    : "border-[var(--color-border)] text-[var(--color-text-soft)] opacity-50"
              }`}
            >
              {ref.label}{ref.available && ref.price !== null ? ` · ${money(ref.price)}` : ""}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onApply} disabled={colorState === "BELOW_COST" || validPrice === null} className="rounded-lg bg-[var(--color-master-600)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--color-master-700)] disabled:opacity-40">
          Aplicar
        </button>
        <button type="button" onClick={onKeep} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]">
          Mantener
        </button>
      </div>
    </div>
  );
}

export function TrayRow(props: TrayRowProps) {
  const { row, selected, onToggleSelect, expanded, onToggleExpand, onOpenMenu } = props;
  const evidence = row.evidence;
  const isTopMover = evidence.abcClass === "A";

  return (
    <>
      {/* Escritorio (≥1280) */}
      <tr className={["hidden xl:table-row border-b border-[var(--color-border)] last:border-0 align-top", !row.applicable ? "opacity-60" : ""].join(" ")}>
        <td className="px-3 py-3">
          {row.costLooksWrong ? (
            <AlertTriangle className="h-4 w-4 text-[var(--color-warning-600)]" aria-hidden="true" />
          ) : (
            <input type="checkbox" checked={selected} onChange={onToggleSelect} disabled={!row.applicable} className="h-4 w-4 rounded border-[var(--color-border-strong)]" />
          )}
        </td>
        <td className="px-3 py-3">
          <Link href={`/app/master/catalog-inventory/products/${row.productId}`} className="flex items-center gap-1.5 group">
            <span className={["h-2 w-2 shrink-0 rounded-full", severityDot(row.severity)].join(" ")} aria-hidden="true" />
            {isTopMover && <span title="Uno de los productos que más se mueve (clase A)"><Flame className="h-3.5 w-3.5 shrink-0 text-[var(--color-danger-500)]" aria-hidden="true" /></span>}
            <span className="min-w-0">
              <span className="block truncate font-medium text-[var(--color-text)] group-hover:underline">{row.productName}</span>
              <span className="block text-xs text-[var(--color-text-soft)]">{row.productSku}</span>
            </span>
          </Link>
        </td>
        <td className="px-3 py-3 text-[var(--color-text-muted)]">{row.branchName}</td>
        <td className="px-3 py-3 text-right tabular-nums">{row.costLooksWrong ? <span className="font-semibold text-[var(--color-warning-700)]">{money(row.effectiveCost ?? 0)}</span> : (row.effectiveCost !== null ? money(row.effectiveCost) : "—")}</td>
        <td className="px-3 py-3 text-right tabular-nums">{row.currentPrice !== null ? money(row.currentPrice) : "—"}</td>
        <td className="px-3 py-3">
          <PriceDecisionBody {...props} />
        </td>
        <td className="px-3 py-3 text-right text-xs text-[var(--color-text-muted)]">
          {row.units90d !== null && row.units90d > 0 ? (
            <>
              <span className="block">{qty(row.units90d)} u.</span>
              {row.realizedMarginPct !== null && <span className="block">{row.realizedMarginPct.toFixed(1)}% real</span>}
            </>
          ) : "—"}
        </td>
        <td className="px-3 py-3">
          <div className="flex items-center gap-1">
            <button type="button" onClick={onToggleExpand} className="text-[var(--color-text-soft)]" aria-label="Ver detalle">
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            <button type="button" onClick={onOpenMenu} className="text-[var(--color-text-soft)]" aria-label="Más acciones">
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>
        </td>
      </tr>
      {row.costLooksWrong && (
        <tr className="hidden xl:table-row border-b border-[var(--color-border)] bg-[var(--color-warning-50)] last:border-0">
          <td />
          <td colSpan={7} className="px-3 py-2 text-xs text-[var(--color-warning-700)]">
            <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
            Costo de sucursal {money(row.effectiveCost ?? 0)} · promedio del producto {row.referenceCost !== null ? money(row.referenceCost) : "—"}.{" "}
            <Link href={`/app/master/catalog-inventory/products/${row.productId}`} className="font-semibold underline underline-offset-2">Revisar el costo primero</Link>
          </td>
        </tr>
      )}

      {/* Tablet/móvil (<1280) — tarjeta */}
      <tr className="xl:hidden">
        <td colSpan={1} className="block border-b border-[var(--color-border)] bg-[var(--color-surface)] p-3 last:border-0">
          <div className={["rounded-xl border p-3", !row.applicable ? "opacity-60" : "", row.costLooksWrong ? "border-[var(--color-warning-300)] bg-[var(--color-warning-50)]" : "border-[var(--color-border-strong)]"].join(" ")}>
            <div className="mb-2 flex items-start justify-between gap-2">
              <Link href={`/app/master/catalog-inventory/products/${row.productId}`} className="flex min-w-0 items-center gap-1.5">
                <span className={["h-2 w-2 shrink-0 rounded-full", severityDot(row.severity)].join(" ")} aria-hidden="true" />
                {isTopMover && <Flame className="h-3.5 w-3.5 shrink-0 text-[var(--color-danger-500)]" aria-hidden="true" />}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-[var(--color-text)]">{row.productName}</span>
                  <span className="block text-xs text-[var(--color-text-soft)]">{row.productSku} · {row.branchName}</span>
                </span>
              </Link>
              <div className="flex shrink-0 items-center gap-1">
                {!row.costLooksWrong && <input type="checkbox" checked={selected} onChange={onToggleSelect} disabled={!row.applicable} className="h-5 w-5 rounded border-[var(--color-border-strong)]" />}
                <button type="button" onClick={onOpenMenu} className="flex h-11 w-11 items-center justify-center text-[var(--color-text-soft)]" aria-label="Más acciones"><MoreVertical className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="mb-2 grid grid-cols-2 gap-2 text-xs text-[var(--color-text-muted)]">
              <span>Costo: <strong className="text-[var(--color-text)]">{row.effectiveCost !== null ? money(row.effectiveCost) : "—"}</strong></span>
              <span>Precio actual: <strong className="text-[var(--color-text)]">{row.currentPrice !== null ? money(row.currentPrice) : "—"}</strong></span>
              {row.units90d !== null && row.units90d > 0 && <span className="col-span-2">Vendido 90d: <strong className="text-[var(--color-text)]">{qty(row.units90d)} u.{row.realizedMarginPct !== null ? ` · ${row.realizedMarginPct.toFixed(1)}% real` : ""}</strong></span>}
            </div>
            <PriceDecisionBody {...props} />
            <button type="button" onClick={onToggleExpand} className="mt-2 w-full rounded-lg border border-[var(--color-border)] py-2 text-xs font-semibold text-[var(--color-text-secondary)]">
              {expanded ? "Ocultar detalle" : "Ver detalle"}
            </button>
          </div>
        </td>
      </tr>
    </>
  );
}
