"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { CheckCircle2, RefreshCw, BarChart3, Banknote, CreditCard, Smartphone, Wallet, AlertTriangle, Info, ArrowRight, Activity } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { showToast } from "@/components/ui/toast";
import { useSession } from "@/lib/client/session";
import { canInAnyAssignedBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/ui/loading-state";
import { EmptyState } from "@/components/ui/empty-state";
import { OperationalDaySummary, type OperationalDay } from "@/components/operations/operational-day-summary";
import { CashSessionStatusList } from "@/components/operations/cash-session-status-list";
import { OperationalDayChecklist, type ClosePreview } from "@/components/operations/operational-day-checklist";
import { CloseDayDialog } from "@/components/operations/close-day-dialog";
import { OperationalDayScanner } from "@/components/operations/operational-day-scanner";

type PaymentRow = { method: string; _sum: { amount: string | number | null }; _count: { _all: number } };

type DailyReport = {
  orders: Array<{ id: string; orderNumber: string; status: string; grandTotal: string | number }>;
  paymentsByMethod: PaymentRow[];
  dispatches: Array<{ id: string; status: string }>;
  brain: Array<{ id: string; title: string; severity: string; status: string }>;
};

type BlockerReference = {
  id: string;
  ref?: string;
  status?: string;
  date?: string;
  resolve?: { kind: string; href: string; entityId: string };
};

type Blocker = {
  code: string;
  label: string;
  count: number;
  references: BlockerReference[];
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
  const sessionState = useSession();
  const canOpenDay = sessionState.status === "authenticated" &&
    canInAnyAssignedBranch(sessionState.session, CAPABILITIES.OPERATIONAL_DAY_OPEN);
  const [day, setDay]         = useState<OperationalDay | null>(null);
  const [preview, setPreview] = useState<ClosePreview | null>(null);
  const [report, setReport]   = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [approveBlockers, setApproveBlockers] = useState<Blocker[]>([]);
  const [approveWarnings, setApproveWarnings] = useState<Blocker[]>([]);
  const [showScanner, setShowScanner] = useState(false);
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

  // Clear approval blockers/warnings when day changes (after reload/status change)
  useEffect(() => {
    setApproveBlockers([]);
    setApproveWarnings([]);
  }, [day?.id, day?.status]);

  // Auto-refresh every 30s in branch mode.
  // In masterMode, the parent page (master/operations) manages its own polling
  // to avoid double-refresh and maintain a single source of truth for all branches.
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
    try {
      const response = await apiFetch(`/api/branch/operations/${day.id}/close-preview`, { method: "POST" });
      const raw = await response.json();
      if (!response.ok) throw new Error(raw?.error?.message ?? "No se pudo previsualizar cierre.");
      setPreview(unwrapApiData(raw) as ClosePreview);
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Error al previsualizar cierre.");
    }
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

  const approveDay = useCallback(async () => {
    if (!day) return;
    setApproving(true);
    try {
      const response = await apiFetch(`/api/master/operations/${day.id}/approve`, { method: "POST" });
      const raw = await response.json();
      if (response.status === 409 && raw?.error?.code === "OPERATIONAL_DAY_REVIEW_HAS_BLOCKERS") {
        const detail = (raw?.data ?? {}) as { blockers?: Blocker[]; warnings?: Blocker[] };
        setApproveBlockers(detail.blockers ?? []);
        setApproveWarnings(detail.warnings ?? []);
        showToast("warning", "No se puede aprobar: hay pendientes que resolver.");
        return;
      }
      if (!response.ok) {
        showToast("error", raw?.error?.message ?? "No se pudo aprobar el día.");
        return;
      }
      setApproveBlockers([]);
      setApproveWarnings([]);
      showToast("success", "Día operativo aprobado.");
      await load();
    } catch {
      showToast("error", "Error de red al aprobar el día.");
    } finally {
      setApproving(false);
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
              ? "Abre el día antes de registrar ventas, abrir caja o despachar pedidos."
              : "No hay un día operativo abierto. Un administrador debe abrirlo antes de que puedas abrir caja."
          }
          tone="info"
          action={canOpenDay ? <Button variant="primary" onClick={openDay}>Abrir día operativo</Button> : undefined}
        />
      </div>
    );
  }

  const showCloseSection = day.status === "OPEN" || day.status === "CLOSING";
  const showApproveBtn   = masterMode && day.status === "CLOSED" && !day.approvedAt;

  return (
    <div className="space-y-5">
      <OperationalDaySummary day={day} />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={load} icon={<RefreshCw className="h-3.5 w-3.5" />}>
          Actualizar
        </Button>
        <Button variant="secondary" size="sm" onClick={loadReport} loading={reportLoading} icon={<BarChart3 className="h-3.5 w-3.5" />}>
          Ver reporte del día
        </Button>
        {masterMode && (
          <Button
            variant={showScanner ? "primary" : "secondary"}
            size="sm"
            onClick={() => setShowScanner((v) => !v)}
            icon={<Activity className="h-3.5 w-3.5" />}
          >
            {showScanner ? "Ocultar escáner" : "Escanear y forzar cierre"}
          </Button>
        )}
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

      {/* Operational day scanner (master-only): diagnoses stuck cash sessions /
          stale days and lets the master force-resolve + refresh the close. */}
      {masterMode && showScanner && (
        <OperationalDayScanner
          branchId={branchId}
          onResolved={async () => { await load(); }}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* Approval blockers / warnings */}
      {(approveBlockers.length > 0 || approveWarnings.length > 0) && (
        <Card className="space-y-4 border-[var(--color-warning-300)] p-4">
          {approveBlockers.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-[var(--color-warning-700)]" />
                <h3 className="text-sm font-bold text-[var(--color-text)]">Pendientes que impiden aprobar</h3>
              </div>
              <ul className="space-y-2">
                {approveBlockers.map((blocker) => {
                  const resolveHref = blocker.references[0]?.resolve?.href;
                  return (
                    <li
                      key={blocker.code}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-[var(--color-warning-700)]" />
                        <span className="text-xs font-semibold text-[var(--color-text-secondary)]">{blocker.label}</span>
                        <Badge variant="warning">{blocker.count}</Badge>
                      </div>
                      {resolveHref && (
                        <Link
                          href={resolveHref as Route}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-primary-700)] hover:underline"
                        >
                          Ir a resolver <ArrowRight className="h-3 w-3" />
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
              <Button
                variant="primary"
                size="sm"
                loading={approving}
                onClick={approveDay}
                icon={<RefreshCw className="h-3.5 w-3.5" />}
              >
                Reintentar aprobación
              </Button>
            </div>
          )}

          {approveWarnings.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-[var(--color-text-muted)]" />
                <h3 className="text-sm font-bold text-[var(--color-text)]">Notas informativas</h3>
              </div>
              <ul className="space-y-1">
                {approveWarnings.map((warning) => (
                  <li key={warning.code} className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                    <Info className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                    <span>{warning.label}</span>
                    <Badge variant="neutral">{warning.count}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {/* Cash sessions + payments */}
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <CashSessionStatusList sessions={day.cashSessions ?? []} branchId={branchId} dayStatus={day.status} />

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
