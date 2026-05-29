"use client";

import { useMemo, useState } from "react";

type ReportItem = {
  key: string;
  label: string;
  endpoint: string;
};

const REPORTS: ReportItem[] = [
  { key: "sales", label: "Ventas", endpoint: "/api/reports/sales" },
  { key: "discounts", label: "Descuentos aplicados", endpoint: "/api/reports/discounts" },
  { key: "payments", label: "Cobros", endpoint: "/api/reports/payments" },
  { key: "dispatch", label: "Despachos", endpoint: "/api/reports/dispatch" },
  { key: "approvals", label: "Aprobaciones", endpoint: "/api/reports/approvals" },
  { key: "audit", label: "Bitacora", endpoint: "/api/reports/audit" },
  { key: "inventory-critical", label: "Inventario critico", endpoint: "/api/reports/inventory-critical" },
  { key: "payroll", label: "Nomina", endpoint: "/api/reports/payroll" },
  { key: "employee-loans", label: "Prestamos empleados", endpoint: "/api/reports/employee-loans" },
];

const STATUS_OPTIONS = [
  { value: "PENDING", label: "Pendiente" },
  { value: "REQUESTED", label: "Solicitado" },
  { value: "APPROVED", label: "Aprobado" },
  { value: "REJECTED", label: "Rechazado" },
  { value: "DISPATCHED", label: "Despachado" },
  { value: "IN_TRANSIT", label: "En transito" },
  { value: "PARTIALLY_RECEIVED", label: "Parcialmente recibido" },
  { value: "RECEIVED", label: "Recibido" },
  { value: "CANCELLED", label: "Cancelado" },
  { value: "PAID", label: "Pagado" },
  { value: "COMPLETED", label: "Completado" },
  { value: "DRAFT", label: "Borrador" },
  { value: "POSTED", label: "Posteado" },
  { value: "VOIDED", label: "Anulado" },
  { value: "ACTIVE", label: "Activo" },
];

export function ReportsHub() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [branchId, setBranchId] = useState("");
  const [status, setStatus] = useState("");
  const [actorUsername, setActorUsername] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (branchId) params.set("branchId", branchId);
    if (status) params.set("status", status);
    if (actorUsername) params.set("actorUsername", actorUsername);
    const text = params.toString();
    return text ? `?${text}` : "";
  }, [dateFrom, dateTo, branchId, status, actorUsername]);

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Reportes exportables</h1>
        <p className="text-sm text-[var(--color-text-muted)]">Descarga CSV por modulo con filtros opcionales.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <label className="text-sm space-y-1">
          <span className="text-[var(--color-text-muted)]">Fecha desde</span>
          <input className="w-full rounded-lg border border-[var(--color-border)] px-2 py-1.5" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label className="text-sm space-y-1">
          <span className="text-[var(--color-text-muted)]">Fecha hasta</span>
          <input className="w-full rounded-lg border border-[var(--color-border)] px-2 py-1.5" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <label className="text-sm space-y-1">
          <span className="text-[var(--color-text-muted)]">Branch ID (CUID)</span>
          <input className="w-full rounded-lg border border-[var(--color-border)] px-2 py-1.5" value={branchId} onChange={(event) => setBranchId(event.target.value)} />
        </label>
        <label className="text-sm space-y-1">
          <span className="text-[var(--color-text-muted)]">Estado / Accion</span>
          <input className="w-full rounded-lg border border-[var(--color-border)] px-2 py-1.5" list="report-status-options" value={status} onChange={(event) => setStatus(event.target.value)} />
          <datalist id="report-status-options">
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} label={option.label} />
            ))}
          </datalist>
        </label>
        <label className="text-sm space-y-1">
          <span className="text-[var(--color-text-muted)]">Usuario actor</span>
          <input className="w-full rounded-lg border border-[var(--color-border)] px-2 py-1.5" value={actorUsername} onChange={(event) => setActorUsername(event.target.value)} />
        </label>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((report) => (
          <a
            key={report.key}
            href={`${report.endpoint}${query}`}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm hover:bg-[var(--color-surface-muted)]"
          >
            Descargar CSV - {report.label}
          </a>
        ))}
      </div>
    </section>
  );
}
