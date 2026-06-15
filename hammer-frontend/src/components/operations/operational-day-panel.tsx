"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, RefreshCw, BarChart3, Banknote, CreditCard, Smartphone, Wallet } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { showToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/ui/loading-state";
import { EmptyState } from "@/components/ui/empty-state";
import { OperationalDaySummary, type OperationalDay } from "@/components/operations/operational-day-summary";
import { CashSessionStatusList } from "@/components/operations/cash-session-status-list";
import { OperationalDayChecklist, type ClosePreview } from "@/components/operations/operational-day-checklist";
import { CloseDayDialog } from "@/components/operations/close-day-dialog";

type PaymentRow = { method: string; _sum: { amount: string | number | null }; _count: { _all: number } };

type DailyReport = {
  orders: Array<{ id: string; orderNumber: string; status: string; grandTotal: string | number }>;
  paymentsByMethod: PaymentRow[];
  dispatches: Array<{ id: string; status: string }>;
  brain: Array<{ id: string; title: string; severity: string; status: string }>;
};

const METHOD_ICON: Record<string, React.ElementType> = {
  CASH: Wallet,
  CARD: CreditCard,
  TRANSFER: Banknote,
  MOBILE_PAYMENT: Smartphone,
};

const METHOD_LABEL: Record<string, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  TRANSFER: "Transferencia",
  MOBILE_PAYMENT: "Pago móvil",
  CREDIT_NOTE: "Nota de crédito",
};

function money(value: string | number | null | undefined) {
  return new Intl.NumberFormat("es-NI", { style: "currency", currency: "NIO" }).format(Number(value ?? 0));
}

export function OperationalDayPanel({ branchId, masterMode = false }: { branchId: string; masterMode?: boolean }) {
  const [day, setDay]         = useState<OperationalDay | null>(null);
  const [preview, setPreview] = useState<ClosePreview | null>(null);
  const [report, setReport]   = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/branch/operations/current?branchId=${branchId}`);
      const raw = await response.json();
      if (!response.ok) {
        showToast("error", raw?.error?.message ?? "No se pudo cargar la operación.");
        return;
      }
      setDay(unwrapApiData(raw) as OperationalDay | null);
    } catch {
      showToast("error", "Error de red al cargar el día operativo.");
    }
  }, [branchId]);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    await load();
    setLoading(false);
  }, [load]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  // Auto-refresh every 30s in branch mode (master page has its own interval)
  useEffect(() => {
    if (masterMode) return;
    intervalRef.current = setInterval(() => { void load(); }, 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [masterMode, load]);

  async function openDay() {
    try {
      const response = await apiFetch("/api/branch/operations/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId }),
      });
      const raw = await response.json();
      if (!response.ok) {
        showToast("error", raw?.error?.message ?? "No se pudo abrir el día operativo.");
        return;
      }
      showToast("success", "Día operativo abierto correctamente.");
      await load();
    } catch {
      showToast("error", "Error de red al abrir el día.");
    }
  }

  async function closePreview() {
    if (!day) return;
    const response = await apiFetch(`/api/branch/operations/${day.id}/close-preview`, { method: "POST" });
    const raw = await response.json();
    if (!response.ok) throw new Error(raw?.error?.message ?? "No se pudo previsualizar cierre.");
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
      showToast("error", raw?.error?.message ?? "No se pudo cerrar el día.");
      return;
    }
    showToast("success", "Día operativo cerrado y enviado a revisión MASTER.");
    setPreview(null);
    await load();
  }

  async function approveDay() {
    if (!day) return;
    setApproving(true);
    try {
      const response = await apiFetch(`/api/master/operations/${day.id}/approve`, { method: "POST" });
      const raw = await response.json();
      if (response.status === 409) {
        const blockerList = (raw?.data ?? []) as Array<{ label: string; count: number }>;
        const detail = blockerList.map((b) => `${b.label} (${b.count})`).join(" · ");
        showToast("warning", `No se puede aprobar: ${detail || (raw?.error?.message ?? "hay bloqueantes pendientes.")}`);
        return;
      }
      if (!response.ok) {
        showToast("error", raw?.error?.message ?? "No se pudo aprobar el día.");
        return;
      }
      showToast("success", "Día operativo aprobado.");
      await load();
    } catch {
      showToast("error", "Error de red al aprobar el día.");
    } finally {
      setApproving(false);
    }
  }

  async function loadReport() {
    if (!day) return;
    const response = await apiFetch(`/api/branch/operations/${day.id}/daily-report`);
    const raw = await response.json();
    if (!response.ok) {
      showToast("error", raw?.error?.message ?? "No se pudo cargar el reporte.");
      return;
    }
    setReport(unwrapApiData(raw) as DailyReport);
  }

  if (loading) return <LoadingState message="Cargando día operativo..." />;

  if (!day) {
    return (
      <div className="hm-module-card p-6">
        <EmptyState
          icon={<Wallet className="h-full w-full" />}
          title="Sin día operativo activo"
          description="Abre el día antes de registrar ventas, abrir caja o despachar pedidos."
          tone="info"
          action={<Button variant="primary" onClick={openDay}>Abrir día operativo</Button>}
        />
      </div>
    );
  }

  const showCloseSection = day.status === "OPEN" || day.status === "CLOSING";
  const showApproveBtn   = masterMode && day.status === "CLOSED";

  return (
    <div className="space-y-5">
      <OperationalDaySummary day={day} />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={load} icon={<RefreshCw className="h-3.5 w-3.5" />}>
          Actualizar
        </Button>
        <Button variant="secondary" size="sm" onClick={loadReport} icon={<BarChart3 className="h-3.5 w-3.5" />}>
          Ver reporte del día
        </Button>
        {showApproveBtn && (
          <Button
            variant="primary"
            size="sm"
            loading={approving}
            onClick={approveDay}
            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          >
            Aprobar día operativo
          </Button>
        )}
        {day.status === "CLOSED" && !masterMode && (
          <span className="hm-chip hm-chip-success text-xs">Día cerrado — pendiente de aprobación MASTER</span>
        )}
        {day.status === "CANCELLED" && (
          <span className="hm-chip text-xs">Día cancelado</span>
        )}
      </div>

      {/* Cash sessions + payments */}
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <CashSessionStatusList sessions={day.cashSessions ?? []} branchId={branchId} />

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-bold text-[var(--color-text)]">Ventas y pagos</h2>
          {(day.summaryJson?.paymentsByMethod?.length ?? 0) > 0 ? (
            <div className="space-y-2">
              {day.summaryJson!.paymentsByMethod!.map((row) => {
                const Icon = METHOD_ICON[row.method] ?? Banknote;
                return (
                  <div key={row.method} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Icon className="text-[var(--color-text-muted)]" style={{ width: "0.875rem", height: "0.875rem" }} />
                      <span className="text-xs font-semibold text-[var(--color-text-secondary)]">{METHOD_LABEL[row.method] ?? row.method}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-bold text-[var(--color-text)]">{money(row.amount)}</span>
                      <span className="ml-2 text-xs text-[var(--color-text-muted)]">{row.count} pago{row.count !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-[var(--color-text-secondary)]">
                <span>Pagadas</span>
                <strong>{money(day.paidOrdersTotal)}</strong>
              </div>
              <div className="flex justify-between text-[var(--color-text-secondary)]">
                <span>Pendiente</span>
                <strong className={Number(day.pendingPaymentTotal) > 0 ? "text-[var(--color-warning-700)]" : ""}>
                  {money(day.pendingPaymentTotal)}
                </strong>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Checklist + close dialog */}
      {showCloseSection && (
        <>
          <OperationalDayChecklist preview={preview} onPreview={closePreview} />
          <CloseDayDialog
            preview={preview}
            disabled={day.status !== "OPEN"}
            disabledReason={day.status === "CLOSING" ? "El día ya está en proceso de cierre." : undefined}
            onPreview={closePreview}
            onCloseDay={closeDay}
          />
        </>
      )}

      {/* Daily report */}
      {report && (
        <div className="hm-module-card">
          <div className="hm-module-card-header">
            <div className="flex items-center gap-2">
              <BarChart3 className="text-[var(--color-text-muted)]" style={{ width: "1rem", height: "1rem" }} />
              <h2 className="text-sm font-bold text-[var(--color-text)]">Reporte diario</h2>
            </div>
            <div className="flex gap-3 text-xs text-[var(--color-text-muted)]">
              <span>{report.orders.length} órdenes</span>
              <span>{report.dispatches.length} despachos</span>
              <span>{report.brain.length} decisiones Brain</span>
            </div>
          </div>

          <div className="p-4">
            {/* Payments by method table */}
            {report.paymentsByMethod.length > 0 && (
              <div className="overflow-x-auto">
                <table className="hm-table w-full text-left">
                  <thead>
                    <tr>
                      <th>Método</th>
                      <th className="text-right">Monto</th>
                      <th className="text-right">Pagos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.paymentsByMethod.map((row) => (
                      <tr key={row.method}>
                        <td>{METHOD_LABEL[row.method] ?? row.method}</td>
                        <td className="text-right font-semibold">{money(row._sum.amount)}</td>
                        <td className="text-right">
                          <Badge variant="neutral">{row._count._all}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Orders status breakdown */}
            {report.orders.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-[var(--color-text-muted)]">Órdenes del día</h3>
                <table className="hm-table w-full text-left">
                  <thead>
                    <tr>
                      <th># Orden</th>
                      <th>Estado</th>
                      <th className="text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.orders.slice(0, 20).map((order) => (
                      <tr key={order.id}>
                        <td className="font-mono text-xs">{order.orderNumber}</td>
                        <td><Badge variant={order.status === "PAID" ? "success" : order.status === "CANCELLED" ? "danger" : "neutral"}>{order.status}</Badge></td>
                        <td className="text-right font-semibold">{money(order.grandTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {report.orders.length > 20 && (
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">Mostrando 20 de {report.orders.length} órdenes.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
