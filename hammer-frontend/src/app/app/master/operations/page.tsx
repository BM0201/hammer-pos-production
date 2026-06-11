"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { OperationalDayPanel } from "@/components/operations/operational-day-panel";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Branch = { id: string; code: string; name: string };
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

const money = (value: number | string | null | undefined) => `C$ ${Number(value ?? 0).toFixed(2)}`;

function timeAgo(date: Date | null) {
  if (!date) return "sin actualizar";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `actualizado hace ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `actualizado hace ${minutes} min`;
  return `actualizado hace ${Math.floor(minutes / 60)} h`;
}

export default function MasterOperationsPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [days, setDays] = useState<MasterDay[]>([]);
  const [message, setMessage] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const selectedBranch = useMemo(() => branches.find((branch) => branch.id === selectedBranchId) ?? null, [branches, selectedBranchId]);
  const totals = useMemo(
    () => ({
      paidSales: days.reduce((sum, day) => sum + Number(day.summaryJson?.paidSalesTotal ?? day.salesTotal), 0),
      expectedCash: days.reduce((sum, day) => sum + Number(day.summaryJson?.expectedCashOnHand ?? 0), 0),
      cashMovements: days.reduce((sum, day) => sum + Number(day.summaryJson?.cashMovementsNet ?? 0), 0),
      blockers: days.reduce(
        (sum, day) =>
          sum + day.openCashSessionsCount + day.autoClosedPendingReviewCount + day.pendingDispatchCount + day.criticalBrainDecisionCount,
        0,
      ),
    }),
    [days],
  );

  useEffect(() => {
    apiFetch("/api/branches")
      .then((response) => response.json())
      .then((raw) => setBranches(unwrapApiData(raw) as Branch[]))
      .catch(() => setMessage("No se pudieron cargar sucursales."));
  }, []);

  const loadDays = useCallback(async () => {
    setIsRefreshing(true);
    const params = new URLSearchParams({ hasIssues: "false" });
    if (selectedBranchId) params.set("branchId", selectedBranchId);
    try {
      const response = await apiFetch(`/api/master/operations?${params.toString()}`);
      const raw = await response.json();
      if (!response.ok) {
        setMessage(raw?.error?.message ?? "No se pudo cargar operacion global.");
        return;
      }
      setDays(unwrapApiData(raw) as MasterDay[]);
      setLastUpdatedAt(new Date());
      setMessage("");
    } finally {
      setIsRefreshing(false);
    }
  }, [selectedBranchId]);

  useEffect(() => {
    void loadDays();
    const timer = window.setInterval(() => void loadDays(), 30000);
    return () => window.clearInterval(timer);
  }, [loadDays]);

  return (
    <main className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">Dia Operativo 360</p>
            <h1 className="text-2xl font-semibold text-[var(--color-text)]">Operacion global</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">Control diario por sucursal: cajas, pagos, despacho, Brain y auditoria.</p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{timeAgo(lastUpdatedAt)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select className="hm-input rounded-lg" value={selectedBranchId} onChange={(event) => setSelectedBranchId(event.target.value)}>
              <option value="">Todas las sucursales</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.code} - {branch.name}
                </option>
              ))}
            </select>
            <Button variant="secondary" loading={isRefreshing} onClick={loadDays}>Actualizar lista</Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-3 md:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs uppercase text-[var(--color-text-muted)]">Ventas pagadas</p>
          <p className="mt-1 text-xl font-semibold text-[var(--color-text)]">{money(totals.paidSales)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-[var(--color-text-muted)]">Efectivo esperado</p>
          <p className="mt-1 text-xl font-semibold text-[var(--color-text)]">{money(totals.expectedCash)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-[var(--color-text-muted)]">Movimientos netos</p>
          <p className="mt-1 text-xl font-semibold text-[var(--color-text)]">{money(totals.cashMovements)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-[var(--color-text-muted)]">Bloqueos operativos</p>
          <p className="mt-1 text-xl font-semibold text-[var(--color-text)]">{totals.blockers}</p>
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Dias recientes</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="hm-table w-full text-left text-sm">
            <thead className="text-xs uppercase text-[var(--color-text-muted)]">
              <tr><th className="py-2">Sucursal</th><th>Fecha</th><th>Estado</th><th>Ventas</th><th>Efectivo esperado</th><th>Alertas</th></tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.id} className="border-t border-[var(--color-border)]">
                  <td className="py-2">{day.branch.code}</td>
                  <td>{new Date(day.businessDate).toLocaleDateString("es-NI")}</td>
                  <td><Badge variant={day.status === "OPEN" ? "success" : "neutral"}>{day.status}</Badge></td>
                  <td>{money(day.summaryJson?.paidSalesTotal ?? day.salesTotal)}</td>
                  <td>{money(day.summaryJson?.expectedCashOnHand ?? 0)}</td>
                  <td>{day.autoClosedPendingReviewCount + day.pendingDispatchCount + day.criticalBrainDecisionCount}</td>
                </tr>
              ))}
              {days.length === 0 ? <tr><td className="py-4 text-[var(--color-text-muted)]" colSpan={6}>Sin dias operativos registrados.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>

      {selectedBranch && selectedBranchId ? <OperationalDayPanel branchId={selectedBranchId} masterMode /> : null}
      {message ? <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-sm text-[var(--color-text-secondary)]">{message}</p> : null}
    </main>
  );
}
