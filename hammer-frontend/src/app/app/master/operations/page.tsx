"use client";

import { useEffect, useState } from "react";
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
  branch: Branch;
};

export default function MasterOperationsPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [days, setDays] = useState<MasterDay[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    apiFetch("/api/branches")
      .then((response) => response.json())
      .then((raw) => {
        const list = unwrapApiData(raw) as Branch[];
        setBranches(list);
        setSelectedBranchId((current) => current || list[0]?.id || "");
      })
      .catch(() => setMessage("No se pudieron cargar sucursales."));
  }, []);

  async function loadDays() {
    const response = await apiFetch("/api/master/operations?hasIssues=false");
    const raw = await response.json();
    if (!response.ok) {
      setMessage(raw?.error?.message ?? "No se pudo cargar operacion global.");
      return;
    }
    setDays(unwrapApiData(raw) as MasterDay[]);
  }

  useEffect(() => {
    void loadDays();
  }, []);

  return (
    <main className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">Día Operativo 360</p>
            <h1 className="text-2xl font-semibold text-[var(--color-text)]">Operación global</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">Control diario por sucursal: cajas, pagos, despacho, Brain y auditoría.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select className="hm-input rounded-lg" value={selectedBranchId} onChange={(event) => setSelectedBranchId(event.target.value)}>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} - {branch.name}</option>)}
            </select>
            <Button variant="secondary" onClick={loadDays}>Actualizar lista</Button>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Días recientes</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-[var(--color-text-muted)]">
              <tr><th className="py-2">Sucursal</th><th>Fecha</th><th>Estado</th><th>Ventas</th><th>Alertas</th></tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.id} className="border-t border-[var(--color-border)]">
                  <td className="py-2">{day.branch.code}</td>
                  <td>{new Date(day.businessDate).toLocaleDateString("es-NI")}</td>
                  <td><Badge variant={day.status === "OPEN" ? "success" : "neutral"}>{day.status}</Badge></td>
                  <td>C$ {Number(day.salesTotal).toFixed(2)}</td>
                  <td>{day.autoClosedPendingReviewCount + day.pendingDispatchCount + day.criticalBrainDecisionCount}</td>
                </tr>
              ))}
              {days.length === 0 ? <tr><td className="py-4 text-[var(--color-text-muted)]" colSpan={5}>Sin días operativos registrados.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>

      {selectedBranchId ? <OperationalDayPanel branchId={selectedBranchId} masterMode /> : null}
      {message ? <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-sm text-[var(--color-text-secondary)]">{message}</p> : null}
    </main>
  );
}
