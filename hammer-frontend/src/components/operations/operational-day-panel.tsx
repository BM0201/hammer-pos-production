"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { OperationalDaySummary, type OperationalDay } from "@/components/operations/operational-day-summary";
import { CashSessionStatusList } from "@/components/operations/cash-session-status-list";
import { OperationalDayChecklist, type ClosePreview } from "@/components/operations/operational-day-checklist";
import { CloseDayDialog } from "@/components/operations/close-day-dialog";

type DailyReport = {
  orders: Array<{ id: string; orderNumber: string; status: string; grandTotal: string | number }>;
  paymentsByMethod: Array<{ method: string; _sum: { amount: string | number | null }; _count: { _all: number } }>;
  dispatches: Array<{ id: string; status: string }>;
  brain: Array<{ id: string; title: string; severity: string; status: string }>;
};

export function OperationalDayPanel({ branchId, masterMode = false }: { branchId: string; masterMode?: boolean }) {
  const [day, setDay] = useState<OperationalDay | null>(null);
  const [preview, setPreview] = useState<ClosePreview | null>(null);
  const [report, setReport] = useState<DailyReport | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiFetch(`/api/branch/operations/current?branchId=${branchId}`);
      const raw = await response.json();
      if (!response.ok) throw new Error(raw?.error?.message ?? raw?.message ?? "No se pudo cargar la operacion.");
      setDay(unwrapApiData(raw) as OperationalDay | null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo cargar la operacion.");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDay() {
    const response = await apiFetch("/api/branch/operations/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchId }),
    });
    const raw = await response.json();
    if (!response.ok) {
      setMessage(raw?.error?.message ?? raw?.message ?? "No se pudo abrir el dia operativo.");
      return;
    }
    setMessage("Dia operativo abierto correctamente.");
    await load();
  }

  async function closePreview() {
    if (!day) return;
    const response = await apiFetch(`/api/branch/operations/${day.id}/close-preview`, { method: "POST" });
    const raw = await response.json();
    if (!response.ok) throw new Error(raw?.error?.message ?? raw?.message ?? "No se pudo previsualizar cierre.");
    setPreview(unwrapApiData(raw) as ClosePreview);
  }

  async function closeDay(note: string, forceClose: boolean) {
    if (!day) return;
    const response = await apiFetch(`/api/branch/operations/${day.id}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note, forceClose }),
    });
    const raw = await response.json();
    if (!response.ok) {
      setMessage(raw?.error?.message ?? raw?.message ?? "No se pudo cerrar el dia.");
      return;
    }
    setMessage("Dia operativo cerrado correctamente.");
    setPreview(null);
    await load();
  }

  async function loadReport() {
    if (!day) return;
    const response = await apiFetch(`/api/branch/operations/${day.id}/daily-report`);
    const raw = await response.json();
    if (!response.ok) {
      setMessage(raw?.error?.message ?? raw?.message ?? "No se pudo cargar el reporte.");
      return;
    }
    setReport(unwrapApiData(raw) as DailyReport);
  }

  if (loading) return <p className="text-[var(--color-text-muted)] animate-pulse">Cargando operacion...</p>;

  if (!day) {
    return (
      <Card className="space-y-4 p-6">
        <div>
          <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">Dia Operativo 360</p>
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">No hay dia operativo abierto</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">Abre la operacion de hoy antes de abrir caja y cobrar.</p>
        </div>
        <Button variant="primary" onClick={openDay}>Abrir dia operativo</Button>
        {message ? <p className="rounded-lg bg-[var(--color-surface-muted)] p-3 text-sm text-[var(--color-text-secondary)]">{message}</p> : null}
      </Card>
    );
  }

  return (
    <main className="space-y-5">
      <OperationalDaySummary day={day} />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={load}>Actualizar</Button>
        <Button variant="secondary" onClick={loadReport}>Ver reporte del dia</Button>
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <CashSessionStatusList sessions={day.cashSessions ?? []} />
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Ventas y pagos</h2>
          <div className="mt-3 space-y-2 text-sm text-[var(--color-text-secondary)]">
            <div>Pagadas: <strong>C$ {Number(day.paidOrdersTotal).toFixed(2)}</strong></div>
            <div>Pendientes: <strong>C$ {Number(day.pendingPaymentTotal).toFixed(2)}</strong></div>
            {(day.summaryJson?.paymentsByMethod ?? []).map((row) => (
              <div key={row.method}>{row.method}: <strong>C$ {Number(row.amount).toFixed(2)}</strong> · {row.count} pago(s)</div>
            ))}
          </div>
        </Card>
      </div>
      <OperationalDayChecklist preview={preview} />
      <CloseDayDialog preview={preview} disabled={day.status !== "OPEN" || !masterMode && false} onPreview={closePreview} onCloseDay={closeDay} />
      {report ? (
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Reporte diario</h2>
          <div className="mt-3 grid gap-3 text-sm md:grid-cols-4">
            <div>Ordenes: <strong>{report.orders.length}</strong></div>
            <div>Pagos por metodo: <strong>{report.paymentsByMethod.length}</strong></div>
            <div>Despachos: <strong>{report.dispatches.length}</strong></div>
            <div>Brain: <strong>{report.brain.length}</strong></div>
          </div>
        </Card>
      ) : null}
      {message ? <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-sm text-[var(--color-text-secondary)]">{message}</p> : null}
    </main>
  );
}
