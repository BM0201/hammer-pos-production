"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock3, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { OperationalDayChecklist, type ClosePreview } from "@/components/operations/operational-day-checklist";
import { CloseDayDialog } from "@/components/operations/close-day-dialog";

/**
 * Día Operativo v2 Fase 5.5 — la cola que antes no existía. Los días que no
 * cerraron en su fecha viven acá, del más viejo al más nuevo, sin bloquear
 * jamás la operación de hoy. "Conciliar y cerrar" reutiliza las MISMAS rutas
 * de cierre (por id de día, no por "día actual de la sucursal"), así que
 * cierra con la ventana de SU businessDate — closeOperationalDay ya acepta
 * PENDING_CLOSE como origen cerrable.
 */

type PendingCloseDayRow = {
  id: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  businessDate: string;
  daysOverdue: number;
  salesTotal: number;
  expectedCashTotal: number;
  blockers: { autoClosedPendingReviewCount: number; openOrReconcilingCashSessionsCount: number };
};

const money = (v: number) => new Intl.NumberFormat("es-NI", { style: "currency", currency: "NIO" }).format(v);

export function PendingCloseQueue({ isMaster, onResolved }: { isMaster: boolean; onResolved?: () => void }) {
  const [rows, setRows] = useState<PendingCloseDayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reconcileId, setReconcileId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ClosePreview | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const resp = await apiFetch("/api/master/operations/pending-close");
      const raw = await resp.json();
      if (resp.ok) setRows(unwrapApiData(raw) as PendingCloseDayRow[]);
      else showToast("error", raw?.error?.message ?? "No se pudo cargar la cola de pendientes.");
    } catch {
      showToast("error", "Error de red al cargar cierres pendientes.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function openReconcile(dayId: string) {
    setReconcileId(dayId);
    setPreview(null);
  }

  async function previewClose() {
    if (!reconcileId) return;
    try {
      const resp = await apiFetch(`/api/branch/operations/${reconcileId}/close-preview`, { method: "POST" });
      const raw = await resp.json();
      if (!resp.ok) { showToast("error", raw?.error?.message ?? "No se pudo previsualizar el cierre."); return; }
      setPreview(unwrapApiData(raw) as ClosePreview);
    } catch {
      showToast("error", "Error de red al previsualizar.");
    }
  }

  async function closeIt(note: string, forceClose: boolean) {
    if (!reconcileId) return;
    try {
      const resp = await apiFetch(`/api/branch/operations/${reconcileId}/close`, {
        method: "POST",
        body: JSON.stringify({ note, forceClose }),
      });
      const raw = await resp.json();
      if (!resp.ok) { showToast("error", raw?.error?.message ?? "No se pudo cerrar el día."); return; }
      showToast("success", "Día pendiente cerrado — enviado a revisión MASTER.");
      setReconcileId(null);
      setPreview(null);
      await load();
      await onResolved?.();
    } catch {
      showToast("error", "Error de red al cerrar.");
    }
  }

  if (loading) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Clock3 className="text-[var(--color-text-muted)]" style={{ width: "0.875rem", height: "0.875rem" }} />
        <h2 className="text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
          Cierres pendientes
        </h2>
        {rows.length > 0 && <span className="hm-chip hm-chip-warning text-xs">{rows.length} día{rows.length !== 1 ? "s" : ""} esperan</span>}
        <button type="button" onClick={load} className="ml-auto text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          <RefreshCw style={{ width: "0.75rem", height: "0.75rem" }} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {rows.length === 0 ? (
        <Card className="p-4 text-sm text-[var(--color-text-muted)]">
          Sin días pendientes de cierre. Los días que pasan su fecha sin cerrarse aparecen aquí — nunca bloquean la operación de hoy, nunca se pierden.
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="hm-table w-full text-left text-sm">
            <thead className="text-xs uppercase text-[var(--color-text-muted)]">
              <tr>
                <th className="py-2">Día de negocio</th>
                <th>Sucursal</th>
                <th className="text-right">Ventas</th>
                <th className="text-right">Efectivo esperado</th>
                <th>Qué falta</th>
                <th className="text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-[var(--color-border)]">
                  <td className="py-2.5 font-semibold text-[var(--color-text)]">
                    {new Date(row.businessDate).toLocaleDateString("es-NI", { timeZone: "UTC" })}
                    <br /><span className="text-xs font-normal text-[var(--color-danger-700)]">hace {row.daysOverdue} día{row.daysOverdue !== 1 ? "s" : ""}</span>
                  </td>
                  <td className="text-[var(--color-text)]">
                    {row.branchCode} <span className="hidden text-xs text-[var(--color-text-muted)] xl:inline">{row.branchName}</span>
                  </td>
                  <td className="hm-num text-right">{money(row.salesTotal)}</td>
                  <td className="hm-num text-right">{money(row.expectedCashTotal)}</td>
                  <td>
                    {row.blockers.openOrReconcilingCashSessionsCount > 0 ? (
                      <Badge variant="warning">{row.blockers.openOrReconcilingCashSessionsCount} caja(s) abierta(s)</Badge>
                    ) : row.blockers.autoClosedPendingReviewCount > 0 ? (
                      <Badge variant="warning">{row.blockers.autoClosedPendingReviewCount} caja(s) sin revisar</Badge>
                    ) : (
                      <Badge variant="neutral">Solo falta firmar</Badge>
                    )}
                  </td>
                  <td className="text-right">
                    <Button variant="primary" size="sm" onClick={() => openReconcile(row.id)}>Conciliar y cerrar</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {reconcileId && (
        <div className="space-y-3">
          <OperationalDayChecklist preview={preview} onPreview={previewClose} />
          <CloseDayDialog preview={preview} isMaster={isMaster} onPreview={previewClose} onCloseDay={closeIt} />
          <Button variant="ghost" size="sm" onClick={() => { setReconcileId(null); setPreview(null); }}>Cancelar conciliación</Button>
        </div>
      )}

      <div className="hm-alert hm-alert-info">
        ⏪ <div><b>Regla de la cola:</b> nunca bloquea la operación de hoy, nunca se cierra sola (force) en silencio, nunca caduca ni se borra.</div>
      </div>
    </section>
  );
}
