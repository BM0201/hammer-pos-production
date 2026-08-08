"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, BarChart3, Banknote, CreditCard, Smartphone, Wallet, AlertTriangle, Info, Activity, LogOut } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { useOperationalPolling } from "@/lib/realtime/use-operational-polling";
import { showToast } from "@/components/ui/toast";
import { useSession } from "@/lib/client/session";
import { canInAnyAssignedBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { isMasterOrAbove } from "@/modules/rbac/role-routing";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/ui/loading-state";
import { EmptyState } from "@/components/ui/empty-state";
import { OperationalDaySummary, type OperationalDay } from "@/components/operations/operational-day-summary";
import { CashSessionStatusList } from "@/components/operations/cash-session-status-list";
import { OperationalDayChecklist, type DayChecklist } from "@/components/operations/operational-day-checklist";
import { ConfirmDayDialog } from "@/components/operations/confirm-day-dialog";
import { OperationalDayScanner } from "@/components/operations/operational-day-scanner";

type PaymentRow = { method: string; _sum: { amount: string | number | null }; _count: { _all: number } };

type DailyReport = {
  orders: Array<{ id: string; orderNumber: string; status: string; grandTotal: string | number }>;
  paymentsByMethod: PaymentRow[];
  dispatches: Array<{ id: string; status: string }>;
  brain: Array<{ id: string; title: string; severity: string; status: string }>;
  operations?: {
    returns?: Array<{ id: string }>;
    cancellations?: Array<{ id: string }>;
    transports?: Array<{ id: string }>;
  };
  legacyFallback?: { ordersWithoutOperationalDay: number; paymentsWithoutOperationalDay: number };
  // Día Operativo 360: número firmado (snapshot inmutable) para un día
  // CONFIRMED — nunca se recalcula, así una venta offline tardía no lo cambia.
  summary?: {
    salesTotal?: number;
    expectedCashTotal?: number;
    cashDifferenceTotal?: number;
    paidSalesCount?: number;
  };
  summarySource?: "SNAPSHOT" | "LIVE";
  lateActivity?: {
    count: number;
    orders: Array<{ id: string; orderNumber: string; grandTotal: string | number; syncedAt: string | null }>;
  };
};

type OperationalDayState = "NO_DAY" | "ACTIVE_TODAY" | "AWAITING_REVIEW" | "CONFIRMED";
type CurrentEnvelope = { day: OperationalDay | null; state: OperationalDayState };

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
  const sessionState = useSession();
  const canOpenDay = sessionState.status === "authenticated" &&
    canInAnyAssignedBranch(sessionState.session, CAPABILITIES.OPERATIONAL_DAY_OPEN);
  const isMaster = sessionState.status === "authenticated" &&
    isMasterOrAbove(sessionState.session.roleCode as string, sessionState.session.globalRoles as unknown as string[]);
  const [day, setDay]         = useState<OperationalDay | null>(null);
  const [cashDifferenceTolerance, setCashDifferenceTolerance] = useState(100);
  const [dayState, setDayState] = useState<OperationalDayState>("NO_DAY");
  const [checklist, setChecklist] = useState<DayChecklist | null>(null);
  const [previewSummary, setPreviewSummary] = useState<Record<string, unknown> | null>(null);
  const [report, setReport]   = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [endingShift, setEndingShift] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/branch/operations/current?branchId=${branchId}`);
      const raw = await response.json();
      if (!response.ok) {
        showToast("error", raw?.error?.message ?? "No se pudo cargar la operación.");
        return;
      }
      const envelope = unwrapApiData(raw) as CurrentEnvelope;
      setDay(envelope.day);
      setDayState(envelope.state);
    } catch {
      showToast("error", "Error de red al cargar el día operativo.");
    }
  }, [branchId]);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    await load();
    setLoading(false);
  }, [load]);

  // Tolerancia configurable por sucursal — se carga una vez; el checklist
  // real usa la del backend, esto es solo para colorear la UI.
  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/master/operations/cash-tolerance-config")
      .then((r) => r.json())
      .then((raw) => {
        if (cancelled) return;
        const config = unwrapApiData(raw) as { defaultToleranceAmount: number; byBranch: Record<string, number> };
        setCashDifferenceTolerance(config.byBranch?.[branchId] ?? config.defaultToleranceAmount ?? 100);
      })
      .catch(() => { /* keep fallback default */ });
    return () => { cancelled = true; };
  }, [branchId]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  // Limpia el checklist calculado cuando el día cambia de identidad/lifecycle.
  useEffect(() => {
    setChecklist(null);
    setPreviewSummary(null);
  }, [day?.id, day?.lifecycle]);

  // Auto-refresh every 30s in branch mode (pauses on hidden tab, backoff on errors).
  // In masterMode, the parent page (master/operations) manages its own polling
  // to avoid double-refresh and maintain a single source of truth for all branches.
  useOperationalPolling({
    task: load,
    intervalMs: 30_000,
    enabled: !masterMode,
    immediate: false, // loadInitial already runs the first fetch
    deps: [load],
  });

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

  async function previewChecklist() {
    if (!day) return;
    try {
      const response = await apiFetch(`/api/branch/operations/${day.id}/close-preview`);
      const raw = await response.json();
      if (!response.ok) throw new Error(raw?.error?.message ?? "No se pudo calcular el checklist.");
      const data = unwrapApiData(raw) as { summary: Record<string, unknown>; checklist: DayChecklist };
      setPreviewSummary(data.summary);
      setChecklist(data.checklist);
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Error al calcular el checklist.");
    }
  }

  async function endShift() {
    if (!day) return;
    setEndingShift(true);
    try {
      const response = await apiFetch(`/api/branch/operations/${day.id}/end-shift`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const raw = await response.json();
      if (!response.ok) {
        showToast("error", raw?.error?.message ?? "No se pudo cerrar la jornada.");
        return;
      }
      showToast("success", "Jornada cerrada — el día pasa a espera de confirmación de Master.");
      await load();
    } catch {
      showToast("error", "Error de red al cerrar la jornada.");
    } finally {
      setEndingShift(false);
    }
  }

  const confirmDay = useCallback(async (note: string) => {
    if (!day) return;
    try {
      const response = await apiFetch(`/api/master/operations/${day.id}/confirm`, {
        method: "POST",
        body: JSON.stringify({ note: note || null }),
      });
      const raw = await response.json();
      if (!response.ok) {
        showToast("error", raw?.error?.message ?? "No se pudo confirmar el día.");
        return;
      }
      showToast("success", "Día operativo confirmado.");
      setChecklist(null);
      setPreviewSummary(null);
      await load();
    } catch {
      showToast("error", "Error de red al confirmar el día.");
    }
  }, [day, load]);

  async function loadReport() {
    if (!day) return;
    setReportLoading(true);
    try {
      const response = await apiFetch(`/api/branch/operations/${day.id}/daily-report`);
      const raw = await response.json();
      if (!response.ok) {
        showToast("error", raw?.error?.message ?? "No se pudo cargar el reporte.");
        return;
      }
      setReport(unwrapApiData(raw) as DailyReport);
    } catch {
      showToast("error", "Error de red al cargar el reporte.");
    } finally {
      setReportLoading(false);
    }
  }

  if (loading) return <LoadingState message="Cargando día operativo..." />;

  if (!day) {
    return (
      <div className="hm-module-card p-6">
        <EmptyState
          icon={<Wallet className="h-full w-full" />}
          title="Sin día operativo activo"
          description={
            canOpenDay
              ? "Se abre solo con la primera venta o apertura de caja. También podés abrirlo manualmente."
              : "Se abrirá solo en cuanto se registre una venta o se abra una caja."
          }
          tone="info"
          action={canOpenDay ? <Button variant="primary" onClick={openDay}>Abrir día operativo</Button> : undefined}
        />
      </div>
    );
  }

  const showEndShiftSection = day.lifecycle === "ACTIVE";
  const showConfirmSection = isMaster && day.reviewStatus === "PENDING";

  return (
    <div className="space-y-5">
      <OperationalDaySummary day={day} cashDifferenceTolerance={cashDifferenceTolerance} />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={load} icon={<RefreshCw className="h-3.5 w-3.5" />}>
          Actualizar
        </Button>
        <Button variant="secondary" size="sm" onClick={loadReport} loading={reportLoading} icon={<BarChart3 className="h-3.5 w-3.5" />}>
          Ver reporte del día
        </Button>
        {showEndShiftSection && canOpenDay && (
          <Button variant="secondary" size="sm" onClick={endShift} loading={endingShift} icon={<LogOut className="h-3.5 w-3.5" />}>
            Cerrar jornada
          </Button>
        )}
        {masterMode && (
          <Button
            variant={showScanner ? "primary" : "secondary"}
            size="sm"
            onClick={() => setShowScanner((v) => !v)}
            icon={<Activity className="h-3.5 w-3.5" />}
          >
            {showScanner ? "Ocultar escáner" : "Escanear cajas atascadas"}
          </Button>
        )}
        {dayState === "AWAITING_REVIEW" && !isMaster && (
          <span className="hm-chip hm-chip-warning text-xs">Esperando confirmación de Master — no bloquea nada</span>
        )}
        {day.lifecycle === "CANCELLED" && (
          <span className="hm-chip text-xs">Día anulado</span>
        )}
      </div>

      {/* Operational day scanner (master-only): diagnoses stuck cash sessions. */}
      {masterMode && showScanner && (
        <OperationalDayScanner
          branchId={branchId}
          onResolved={async () => { await load(); }}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* Cash sessions + payments */}
      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <CashSessionStatusList sessions={day.cashSessions ?? []} branchId={branchId} dayLifecycle={day.lifecycle} />

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

      {/* Checklist + firma (solo Master, mientras siga PENDING) */}
      {showConfirmSection && (
        <>
          <OperationalDayChecklist checklist={checklist} onPreview={previewChecklist} />
          <ConfirmDayDialog
            summary={previewSummary as never}
            checklist={checklist}
            cashDifferenceTolerance={cashDifferenceTolerance}
            onPreview={previewChecklist}
            onConfirm={confirmDay}
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
              {report.summarySource === "SNAPSHOT" && <span className="hm-chip hm-chip-info text-xs">📸 Snapshot firmado</span>}
              {report.summarySource === "LIVE" && <span className="hm-chip text-xs">En vivo — día en curso</span>}
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-[var(--color-text-muted)]">
              <span>{report.orders.length} órdenes</span>
              <span>{report.dispatches.length} despachos</span>
              {(report.operations?.returns?.length ?? 0) > 0 && <span>{report.operations!.returns!.length} devoluciones</span>}
              {(report.operations?.cancellations?.length ?? 0) > 0 && <span>{report.operations!.cancellations!.length} anulaciones</span>}
              <span>{report.brain.length} decisiones Brain</span>
            </div>
          </div>

          {/* Número firmado (snapshot) — nunca cambia con actividad tardía */}
          {report.summary && (
            <div className="grid gap-3 border-b border-[var(--color-border)] p-4 sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
                <p className="text-xs text-[var(--color-text-muted)]">Ventas pagadas{report.summarySource === "SNAPSHOT" ? " (firmado)" : ""}</p>
                <p className="hm-num text-lg font-bold text-[var(--color-text)]">{money(report.summary.salesTotal)}</p>
              </div>
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
                <p className="text-xs text-[var(--color-text-muted)]">Efectivo esperado</p>
                <p className="hm-num text-lg font-bold text-[var(--color-text)]">{money(report.summary.expectedCashTotal)}</p>
              </div>
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
                <p className="text-xs text-[var(--color-text-muted)]">Diferencia de caja</p>
                <p className="hm-num text-lg font-bold" style={{ color: Number(report.summary.cashDifferenceTotal ?? 0) !== 0 ? "var(--color-warning-700)" : "var(--color-text)" }}>
                  {money(report.summary.cashDifferenceTotal)}
                </p>
              </div>
            </div>
          )}

          {/* Actividad que entró DESPUÉS de que el día dejó de estar en curso */}
          {(report.lateActivity?.count ?? 0) > 0 && (
            <div className="mx-4 mt-3 rounded-lg border border-[var(--color-warning-200)] bg-[color-mix(in_srgb,var(--color-warning-50)_30%,white)] p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[var(--color-warning-800)]">
                <AlertTriangle style={{ width: "0.875rem", height: "0.875rem" }} />
                Entró después (fuera del snapshot)
              </div>
              <div className="overflow-x-auto">
                <table className="hm-table w-full text-left text-xs">
                  <thead><tr><th>Referencia</th><th>Sincronizada</th><th className="text-right">Monto</th></tr></thead>
                  <tbody>
                    {report.lateActivity!.orders.map((order) => (
                      <tr key={order.id}>
                        <td className="font-mono">{order.orderNumber}</td>
                        <td>{order.syncedAt ? new Date(order.syncedAt).toLocaleString("es-NI") : "—"} <span className="hm-chip hm-chip-warning ml-1">tardía</span></td>
                        <td className="hm-num text-right font-semibold">{money(order.grandTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Aviso de datos legacy sin operationalDayId (pendientes de backfill) */}
          {((report.legacyFallback?.ordersWithoutOperationalDay ?? 0) > 0 ||
            (report.legacyFallback?.paymentsWithoutOperationalDay ?? 0) > 0) && (
            <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-[var(--color-warning-200)] bg-[color-mix(in_srgb,var(--color-warning-50)_30%,white)] px-3 py-2">
              <Info className="mt-0.5 flex-shrink-0 text-[var(--color-warning-700)]" style={{ width: "0.875rem", height: "0.875rem" }} />
              <p className="text-xs text-[var(--color-warning-800)]">
                Hay {report.legacyFallback?.ordersWithoutOperationalDay ?? 0} órdenes y {report.legacyFallback?.paymentsWithoutOperationalDay ?? 0} pagos
                de esta ventana sin día operativo asignado (datos legacy). Se incluyen por fecha hasta aplicar la migración de backfill.
              </p>
            </div>
          )}

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
