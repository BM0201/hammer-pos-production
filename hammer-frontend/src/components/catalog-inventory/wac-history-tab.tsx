"use client";

import { useEffect, useState } from "react";
import {
  History,
  Filter,
  AlertTriangle,
  Activity,
  DollarSign,
  ArrowLeftRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { money, qty, fmtDateTime } from "@/lib/format";
import { movementLabel, wacRefLabel } from "@/components/catalog-inventory/movement-history-helpers";
import { KpiMini } from "@/components/catalog-inventory/product-360";
import type { Branch } from "@/components/catalog-inventory/product-360";

/**
 * Fase 5 (prompt-flujo-velocidad.md): extraído de product-360.tsx (era la
 * pestaña "wacHistory", Parte A) para poder cargarlo con next/dynamic —
 * solo se monta cuando el usuario abre esa pestaña. Mismo comportamiento.
 */

type WacHistoryRow = {
  movementId: string;
  createdAt: string;
  movementType: string;
  referenceType: string;
  referenceId: string;
  quantity: number;
  unitCost: number;
  conversionFactorSnapshot: number | null;
  inputUnit: string | null;
  inputQuantity: number | null;
  wacBefore: number;
  wacAfter: number;
  wacDelta: number;
  wacDeltaPercent: number | null;
  actorUserId: string | null;
  actorName: string | null;
  notes: string | null;
  excludedFromReplay: boolean;
};
type WacHistoryResponse = {
  productId: string;
  branchId: string;
  requestedSku: string | null;
  requestedName: string | null;
  isDerived: boolean;
  canonicalProductId: string | null;
  canonicalSku: string | null;
  canonicalName: string | null;
  conversionFactor: number | null;
  fusionNote: string | null;
  currentWac: number;
  movementCount: number;
  breakdownByReferenceType: Record<string, number>;
  rows: WacHistoryRow[];
  reconstructed: number;
  reconstructedQty: number;
  stored: number;
  matches: boolean;
};

export function WacHistoryTab({ productId, branches }: { productId: string; branches: Branch[] }) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [data, setData] = useState<WacHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!branchId) return;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ productId, branchId });
    fetch(`/api/master/inventory/wac-history?${params}`, { cache: "no-store" })
      .then(async (response) => {
        const raw = await response.json();
        if (!response.ok) throw new Error(raw?.error?.message ?? raw?.message ?? "No se pudo cargar el historial de costo.");
        setData(raw.data as WacHistoryResponse);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo cargar el historial de costo."))
      .finally(() => setLoading(false));
  }, [productId, branchId]);

  if (branches.length === 0) {
    return (
      <Card className="p-8 text-center">
        <History className="h-10 w-10 mx-auto mb-3 text-[var(--color-text-muted)]" />
        <p className="text-sm font-medium text-[var(--color-text-secondary)]">Este producto no tiene existencias registradas en ninguna sucursal todavía.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Selector de sucursal ── */}
      <div className="flex flex-wrap items-center gap-3">
        <Filter className="h-4 w-4 text-[var(--color-text-muted)]" />
        <select
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          className="hm-input !w-auto !py-1.5 !px-3 !text-sm"
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.code} · {b.name}</option>
          ))}
        </select>
        {loading && <span className="text-xs text-[var(--color-text-muted)]">Cargando…</span>}
      </div>

      {error ? (
        <Card className="p-6 text-center">
          <AlertTriangle className="h-8 w-8 mx-auto text-red-500 mb-2" />
          <p className="text-sm font-semibold text-[var(--color-danger-700)]">{error}</p>
        </Card>
      ) : !data ? (
        <Card className="p-8 text-center">
          <div className="h-8 w-8 mx-auto mb-3 animate-spin rounded-full border-4 border-[var(--color-border)] border-t-[var(--color-info-600)]" />
        </Card>
      ) : (
        <>
          {/* ── Aviso de discrepancia: el hallazgo que importa ── */}
          {!data.matches && (
            <div className="rounded-xl border-2 border-red-300 bg-red-50 px-4 py-3 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-bold text-red-800">
                  El costo guardado ({money(data.stored)}) no coincide con el que resulta de los movimientos ({money(data.reconstructed)}).
                </p>
                <p className="text-red-700 mt-0.5">Hay una escritura del costo promedio fuera del historial de movimientos.</p>
              </div>
            </div>
          )}

          {/* ── Nota de fusión ── */}
          {data.isDerived && data.fusionNote && (
            <div className="rounded-xl border border-[var(--color-info-200)] bg-[var(--color-info-50)] px-4 py-3 flex items-start gap-3">
              <Activity className="h-4 w-4 text-[var(--color-info-600)] shrink-0 mt-0.5" />
              <p className="text-sm text-[var(--color-info-800)]">{data.fusionNote}</p>
            </div>
          )}

          {/* ── Resumen ── */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <KpiMini icon={DollarSign} label="Costo promedio actual" value={money(data.currentWac)} accent="blue" />
            <KpiMini icon={ArrowLeftRight} label="Movimientos que lo formaron" value={String(data.movementCount)} accent="indigo" />
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <p className="text-xs font-semibold text-[var(--color-text-muted)] mb-2">Por tipo de origen</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(data.breakdownByReferenceType).length === 0 ? (
                  <span className="text-xs text-[var(--color-text-muted)]">Sin movimientos</span>
                ) : (
                  Object.entries(data.breakdownByReferenceType).map(([ref, count]) => (
                    <span key={ref} className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-alt)] border border-[var(--color-border)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--color-text-secondary)]">
                      {wacRefLabel(ref)} · {count}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* ── Línea de tiempo ── */}
          <div className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden shadow-sm">
            <div className="hm-card-header-green px-5 py-3 flex items-center gap-2">
              <History className="h-5 w-5" />
              <h2 className="font-semibold">Cómo se formó el costo promedio</h2>
              <span className="ml-auto text-xs opacity-80">{data.rows.length} filas</span>
            </div>
            {data.rows.length === 0 ? (
              <div className="p-8 text-center">
                <History className="h-10 w-10 mx-auto mb-3 text-[var(--color-text-muted)]" />
                <p className="text-sm font-medium text-[var(--color-text-secondary)]">Sin movimientos registrados en esta sucursal todavía.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="hm-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Tipo</th>
                      <th>Referencia</th>
                      <th className="text-right">Cantidad</th>
                      <th className="text-right">Costo unit.</th>
                      <th className="text-right">Costo antes</th>
                      <th className="text-right">Costo después</th>
                      <th className="text-right">Δ%</th>
                      <th>Quién</th>
                      <th>Nota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => {
                      const ml = movementLabel(row.movementType);
                      const absPercent = row.wacDeltaPercent !== null ? Math.abs(row.wacDeltaPercent) : 0;
                      const rowClass = row.excludedFromReplay
                        ? "opacity-50"
                        : absPercent > 100
                          ? "bg-red-50"
                          : absPercent > 25
                            ? "bg-amber-50"
                            : "";
                      return (
                        <tr key={row.movementId} className={`${rowClass} hover:bg-[var(--color-surface-alt)]`}>
                          <td className="whitespace-nowrap text-[var(--color-text-secondary)] text-xs">{fmtDateTime(row.createdAt)}</td>
                          <td><Badge variant={ml.color}>{ml.label}</Badge></td>
                          <td>
                            <div className="text-[11px] font-medium text-[var(--color-text-secondary)]">{wacRefLabel(row.referenceType)}</div>
                            <div className="font-mono text-[10px] text-[var(--color-text-muted)]">{row.referenceId.length > 18 ? `${row.referenceId.slice(0, 16)}…` : row.referenceId}</div>
                          </td>
                          <td className="text-right font-mono text-xs">{qty(row.quantity)}</td>
                          <td className="text-right font-mono text-xs text-[var(--color-text-secondary)]">{money(row.unitCost)}</td>
                          {row.excludedFromReplay ? (
                            <td colSpan={3} className="text-center text-[11px] text-[var(--color-text-muted)] italic">Sin efecto en el costo promedio</td>
                          ) : (
                            <>
                              <td className="text-right font-mono text-xs text-[var(--color-text-secondary)]">{money(row.wacBefore)}</td>
                              <td className="text-right font-mono text-xs font-semibold text-[var(--color-text)]">{money(row.wacAfter)}</td>
                              <td className={`text-right font-mono text-xs font-bold ${absPercent > 100 ? "text-red-700" : absPercent > 25 ? "text-amber-700" : "text-[var(--color-text-secondary)]"}`}>
                                {row.wacDeltaPercent === null ? "—" : `${row.wacDeltaPercent >= 0 ? "+" : ""}${row.wacDeltaPercent.toFixed(1)}%`}
                              </td>
                            </>
                          )}
                          <td className="text-xs text-[var(--color-text-secondary)] whitespace-nowrap">{row.actorName ?? "—"}</td>
                          <td className="max-w-[160px]">
                            {row.notes?.trim() ? (
                              <span className="text-xs text-[var(--color-text-secondary)] line-clamp-2" title={row.notes}>{row.notes}</span>
                            ) : (
                              <span className="text-[10px] text-[var(--color-text-muted)]">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
