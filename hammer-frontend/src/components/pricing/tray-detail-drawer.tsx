"use client";

import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money, qty, fmtDatePadded } from "@/lib/format";
import { PriceDecisionBody, type TrayRowData, type TrayRowProps } from "@/components/pricing/tray-row";
import { type PriceApplyMethod } from "@/lib/pricing-tray-logic";

/**
 * Parte C.4.2 (prompt-completo-pendientes-2026-10.md) — "Detalle (drawer)":
 * panel lateral en desktop, pantalla completa en tablet/móvil. Abre con el
 * contexto de la Fase 2 (GET .../tray/[decisionId]/context) — todas las
 * referencias, no solo las que la fila ya trae en evidenceJson.
 */

export type PricingTrayDecisionContext = {
  references: Array<{ method: PriceApplyMethod; label: string; price: number | null; gainAmount: number | null; marginOnPrice: number | null; markupOnCost: number | null; basis: string | null; available: boolean; reason?: string }>;
  sales90d: { units: number; amount: number };
  weeklyUnits: Array<{ weekStart: string; units: number }>;
  daysInStock: number | null;
  realizedMarginPct: number | null;
  otherBranches: Array<{ branchId: string; branchName: string; price: number; marginHere: number | null }>;
  priceHistory: Array<{ changedAt: string; previousPrice: number | null; newPrice: number | null; actorName: string | null }>;
  lastReview: { reviewedAt: string; reviewedPrice: number | null; reviewedCost: number | null; byUserName: string | null; note: string | null } | null;
};

export function TrayDetailDrawer({
  row,
  rowProps,
  onClose,
}: {
  row: TrayRowData;
  rowProps: TrayRowProps;
  onClose: () => void;
}) {
  const [context, setContext] = useState<PricingTrayDecisionContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch(`/api/master/pricing/tray/${row.decisionId}/context`)
      .then(async (r) => {
        const raw = await r.json();
        if (!r.ok) throw new Error(raw?.error?.message ?? "No se pudo cargar el detalle.");
        if (!cancelled) setContext(unwrapApiData(raw) as PricingTrayDecisionContext);
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "No se pudo cargar el detalle."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [row.decisionId]);

  const suggestedRef = context?.references.find((r) => r.method === "SUGGESTED");

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="h-full w-full max-w-lg overflow-y-auto bg-[var(--color-surface)] shadow-2xl sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-[var(--color-text)]">{row.productName}</h2>
            <p className="text-xs text-[var(--color-text-muted)]">{row.productSku} · {row.branchName}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center text-[var(--color-text-soft)]" aria-label="Cerrar"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-5 p-5">
          <PriceDecisionBody {...rowProps} references={context?.references.map((r) => ({ method: r.method, label: r.label, price: r.price, available: r.available, reason: r.reason })) ?? rowProps.references} />

          {loading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-[var(--color-master-500)]" /></div>
          ) : error ? (
            <p className="text-sm text-[var(--color-danger-600)]">{error}</p>
          ) : context ? (
            <>
              {suggestedRef?.basis && (
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-xs text-[var(--color-text-secondary)]">
                  <p className="mb-1 font-semibold text-[var(--color-text)]">De dónde sale la referencia de política</p>
                  {suggestedRef.basis}
                </div>
              )}

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Ventas por semana (90 días)</p>
                {context.weeklyUnits.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-muted)]">Sin ventas en este período.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={120}>
                    <BarChart data={context.weeklyUnits.map((w) => ({ name: fmtDatePadded(w.weekStart), units: w.units }))} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                      <YAxis tick={{ fontSize: 9 }} width={28} />
                      <Tooltip formatter={(v: unknown) => [qty(Number(v)), "Unidades"]} />
                      <Bar dataKey="units" fill="var(--color-master-500)" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">{qty(context.sales90d.units)} unidades · {money(context.sales90d.amount)} en 90 días{context.daysInStock !== null ? ` · ${context.daysInStock.toFixed(0)} días de inventario` : ""}</p>
              </div>

              {context.otherBranches.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Precio en otras sucursales</p>
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-[var(--color-text-muted)]"><th className="py-1">Sucursal</th><th className="py-1 text-right">Precio</th><th className="py-1 text-right">Margen acá</th></tr></thead>
                    <tbody>
                      {context.otherBranches.map((b) => (
                        <tr key={b.branchId} className="border-t border-[var(--color-border)]">
                          <td className="py-1">{b.branchName}</td>
                          <td className="py-1 text-right tabular-nums">{money(b.price)}</td>
                          <td className="py-1 text-right tabular-nums">{b.marginHere !== null ? `${b.marginHere.toFixed(1)}%` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {context.lastReview && (
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-xs text-[var(--color-text-secondary)]">
                  <p className="font-semibold text-[var(--color-text)]">Última revisión</p>
                  <p>{fmtDatePadded(context.lastReview.reviewedAt)} · {context.lastReview.byUserName ?? "—"}{context.lastReview.note ? ` · "${context.lastReview.note}"` : ""}</p>
                </div>
              )}

              {context.priceHistory.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Historial de cambios</p>
                  <ul className="space-y-1 text-xs text-[var(--color-text-secondary)]">
                    {context.priceHistory.map((h, i) => (
                      <li key={i}>{fmtDatePadded(h.changedAt)} — {h.previousPrice !== null ? money(h.previousPrice) : "—"} → {h.newPrice !== null ? money(h.newPrice) : "—"}{h.actorName ? ` · ${h.actorName}` : ""}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
