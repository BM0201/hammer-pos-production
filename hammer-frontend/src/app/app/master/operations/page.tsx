"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, CheckCircle2, AlertTriangle, Building2, TrendingUp, Activity, CalendarRange } from "lucide-react";
import { OperationalDayPanel } from "@/components/operations/operational-day-panel";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { showToast } from "@/components/ui/toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";

type Branch   = { id: string; code: string; name: string };
type MasterDay = {
  id: string;
  status: string;
  businessDate: string;
  salesTotal: string | number;
  openCashSessionsCount: number;
  autoClosedPendingReviewCount: number;
  pendingDispatchCount: number;
  criticalBrainDecisionCount: number;
  summaryJson?: {
    openingCashTotal?: number;
    cashTenderNetTotal?: number;
    cashMovementsNet?: number;
    expectedCashOnHand?: number;
    paidSalesTotal?: number;
    pendingPaymentTotal?: number;
    cancelledSalesTotal?: number;
    postedPaymentsCount?: number;
    voidedPaymentsCount?: number;
  } | null;
  branch: Branch;
};

const money = (v: number | string | null | undefined) =>
  new Intl.NumberFormat("es-NI", { style: "currency", currency: "NIO" }).format(Number(v ?? 0));

function timeAgo(date: Date | null) {
  if (!date) return "sin actualizar";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `hace ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  return `hace ${Math.floor(minutes / 60)} h`;
}

const STATUS_LABEL: Record<string, string> = {
  OPEN: "Abierto", CLOSING: "En cierre", CLOSED: "Cerrado", CANCELLED: "Cancelado",
};
const STATUS_BADGE: Record<string, "success" | "warning" | "neutral" | "danger"> = {
  OPEN: "success", CLOSING: "warning", CLOSED: "neutral", CANCELLED: "danger",
};

export default function MasterOperationsPage() {
  const [branches, setBranches]           = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [days, setDays]                   = useState<MasterDay[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing]   = useState(false);
  const [approvingId, setApprovingId]     = useState<string | null>(null);

  const today = new Date().toISOString().split("T")[0];
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const [dateFrom, setDateFrom] = useState(sevenDaysAgo);
  const [dateTo, setDateTo]     = useState(today);

  const selectedBranch = useMemo(
    () => branches.find((b) => b.id === selectedBranchId) ?? null,
    [branches, selectedBranchId],
  );

  const totals = useMemo(
    () => ({
      paidSales:      days.reduce((s, d) => s + Number(d.summaryJson?.paidSalesTotal ?? d.salesTotal), 0),
      expectedCash:   days.reduce((s, d) => s + Number(d.summaryJson?.expectedCashOnHand ?? 0), 0),
      cashMovements:  days.reduce((s, d) => s + Number(d.summaryJson?.cashMovementsNet ?? 0), 0),
      blockers:       days.reduce(
        (s, d) => s + d.openCashSessionsCount + d.autoClosedPendingReviewCount + d.pendingDispatchCount + d.criticalBrainDecisionCount, 0,
      ),
      closedPending:  days.filter((d) => d.status === "CLOSED").length,
    }),
    [days],
  );

  useEffect(() => {
    apiFetch("/api/branches")
      .then((r) => r.json())
      .then((raw) => setBranches(unwrapApiData(raw) as Branch[]))
      .catch(() => showToast("error", "No se pudieron cargar sucursales."));
  }, []);

  const loadDays = useCallback(async () => {
    setIsRefreshing(true);
    const params = new URLSearchParams();
    if (selectedBranchId) params.set("branchId", selectedBranchId);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo)   params.set("dateTo",   dateTo);
    try {
      const response = await apiFetch(`/api/master/operations?${params.toString()}`);
      const raw = await response.json();
      if (!response.ok) {
        showToast("error", raw?.error?.message ?? "No se pudo cargar operación global.");
        return;
      }
      setDays(unwrapApiData(raw) as MasterDay[]);
      setLastUpdatedAt(new Date());
    } finally {
      setIsRefreshing(false);
    }
  }, [selectedBranchId, dateFrom, dateTo]);

  useEffect(() => {
    void loadDays();
    const timer = window.setInterval(() => void loadDays(), 30_000);
    return () => window.clearInterval(timer);
  }, [loadDays]);

  async function approveDay(dayId: string, branchCode: string) {
    setApprovingId(dayId);
    try {
      const response = await apiFetch(`/api/master/operations/${dayId}/approve`, { method: "POST" });
      const raw = await response.json();
      if (response.status === 409) {
        const blockerList = (raw?.data ?? []) as Array<{ label: string; count: number }>;
        const detail = blockerList.map((b) => `${b.label} (${b.count})`).join(" · ");
        showToast("warning", `${branchCode}: No se puede aprobar — ${detail || (raw?.error?.message ?? "hay bloqueantes.")}`);
        return;
      }
      if (!response.ok) {
        showToast("error", `${branchCode}: ${raw?.error?.message ?? "No se pudo aprobar el día."}`);
        return;
      }
      showToast("success", `Día de ${branchCode} aprobado correctamente.`);
      await loadDays();
    } catch {
      showToast("error", "Error de red al aprobar el día.");
    } finally {
      setApprovingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Operación Global"
        description="Control diario por sucursal: cajas, pagos, despacho, Brain y auditoría."
        breadcrumbs={[{ label: "Master", href: "/app/master" }, { label: "Día Operativo 360" }]}
      />

      {/* KPI tiles */}
      <div className="hm-kpi-grid">
        <KpiCard
          label="Ventas pagadas"
          value={money(totals.paidSales)}
          tone="ok"
          roleAccent="MASTER"
          helper={`Actualizado ${timeAgo(lastUpdatedAt)}`}
        />
        <KpiCard
          label="Efectivo esperado"
          value={money(totals.expectedCash)}
          roleAccent="MASTER"
          helper="Total esperado en cajas"
        />
        <KpiCard
          label="Bloqueos operativos"
          value={totals.blockers}
          tone={totals.blockers > 0 ? "alert" : "ok"}
          roleAccent="MASTER"
          helper={totals.blockers > 0 ? "Requieren atención" : "Sin bloqueos"}
        />
        <KpiCard
          label="Días listos para aprobar"
          value={totals.closedPending}
          tone={totals.closedPending > 0 ? "ok" : "default"}
          roleAccent="MASTER"
          helper={totals.closedPending > 0 ? "Esperan aprobación MASTER" : "Sin días cerrados pendientes"}
        />
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <CalendarRange className="text-[var(--color-text-muted)]" style={{ width: "1rem", height: "1rem" }} />
            <span className="text-sm font-semibold text-[var(--color-text)]">Filtros</span>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1">
              <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Desde</span>
              <input
                type="date"
                className="hm-input rounded-lg text-sm"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Hasta</span>
              <input
                type="date"
                className="hm-input rounded-lg text-sm"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide flex items-center gap-1">
                <Building2 style={{ width: "0.75rem", height: "0.75rem" }} />
                Sucursal
              </span>
              <select
                className="hm-input rounded-lg text-sm"
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
              >
                <option value="">Todas</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.code} — {b.name}</option>
                ))}
              </select>
            </label>
            <Button variant="secondary" size="sm" loading={isRefreshing} onClick={loadDays} icon={<RefreshCw className="h-3.5 w-3.5" />}>
              Aplicar
            </Button>
          </div>
        </div>
      </Card>

      {/* Days table */}
      <div className="hm-module-card">
        <div className="hm-module-card-header">
          <div className="flex items-center gap-2">
            <Activity className="text-[var(--color-text-muted)]" style={{ width: "1rem", height: "1rem" }} />
            <h2 className="text-sm font-bold text-[var(--color-text)]">Días recientes</h2>
            <span className="hm-chip hm-chip-info text-xs">{days.length} día{days.length !== 1 ? "s" : ""}</span>
          </div>
          {isRefreshing && (
            <span className="text-xs text-[var(--color-text-muted)] animate-pulse">Actualizando...</span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="hm-table w-full text-left text-sm">
            <thead className="text-xs uppercase text-[var(--color-text-muted)]">
              <tr>
                <th className="py-2">Sucursal</th>
                <th>Fecha</th>
                <th>Estado</th>
                <th className="text-right">Ventas</th>
                <th className="text-right">Efectivo esp.</th>
                <th className="text-right">
                  <span className="flex items-center justify-end gap-1">
                    <AlertTriangle style={{ width: "0.75rem", height: "0.75rem" }} />
                    Alertas
                  </span>
                </th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => {
                const alerts = day.openCashSessionsCount + day.autoClosedPendingReviewCount + day.pendingDispatchCount + day.criticalBrainDecisionCount;
                const canApprove = day.status === "CLOSED";
                return (
                  <tr key={day.id} className={`border-t border-[var(--color-border)] ${selectedBranchId === day.branch.id ? "bg-[color-mix(in_srgb,var(--color-info-50)_30%,white)]" : ""}`}>
                    <td className="py-2.5 font-semibold text-[var(--color-text)]">
                      <button
                        type="button"
                        className="hover:underline text-left text-[var(--color-info-700)] transition-colors"
                        onClick={() => setSelectedBranchId(selectedBranchId === day.branch.id ? "" : day.branch.id)}
                      >
                        {day.branch.code}
                      </button>
                      <span className="ml-1.5 hidden text-xs text-[var(--color-text-muted)] xl:inline">{day.branch.name}</span>
                    </td>
                    <td className="text-[var(--color-text-secondary)]">
                      {new Date(day.businessDate).toLocaleDateString("es-NI", { timeZone: "UTC" })}
                    </td>
                    <td>
                      <Badge variant={STATUS_BADGE[day.status] ?? "neutral"}>
                        {STATUS_LABEL[day.status] ?? day.status}
                      </Badge>
                    </td>
                    <td className="text-right font-semibold">{money(day.summaryJson?.paidSalesTotal ?? day.salesTotal)}</td>
                    <td className="text-right">{money(day.summaryJson?.expectedCashOnHand ?? 0)}</td>
                    <td className="text-right">
                      {alerts > 0 ? (
                        <span className="inline-flex items-center gap-1 text-[var(--color-danger-700)] font-semibold">
                          <AlertTriangle style={{ width: "0.75rem", height: "0.75rem" }} />
                          {alerts}
                        </span>
                      ) : (
                        <span className="text-[var(--color-success-700)]">
                          <CheckCircle2 style={{ width: "0.875rem", height: "0.875rem", display: "inline" }} />
                        </span>
                      )}
                    </td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedBranchId(selectedBranchId === day.branch.id ? "" : day.branch.id)}
                          className="text-xs"
                        >
                          {selectedBranchId === day.branch.id ? "Ocultar" : "Ver 360"}
                        </Button>
                        {canApprove && (
                          <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            loading={approvingId === day.id}
                            onClick={() => approveDay(day.id, day.branch.code)}
                            icon={<CheckCircle2 className="h-3 w-3" />}
                            className="text-xs"
                          >
                            Aprobar
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {days.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm text-[var(--color-text-muted)]">
                    Sin días operativos registrados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Panel 360 for selected branch */}
      {selectedBranch && selectedBranchId && (
        <div>
          <p className="mb-3 text-[0.625rem] font-bold uppercase tracking-[0.14em] text-[var(--color-text-muted)] flex items-center gap-1.5">
            <TrendingUp style={{ width: "0.75rem", height: "0.75rem" }} />
            Vista 360 — {selectedBranch.code}: {selectedBranch.name}
          </p>
          <OperationalDayPanel branchId={selectedBranchId} masterMode />
        </div>
      )}
    </div>
  );
}
