"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Eye, FileText, RefreshCw } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type Branch = { id: string; code: string; name: string };

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

function buildQuery(input: {
  dateFrom: string;
  dateTo: string;
  branchId: string;
  status: string;
  actorUsername: string;
  format?: "csv" | "json" | "pdf";
}) {
  const params = new URLSearchParams();
  if (input.dateFrom) params.set("dateFrom", input.dateFrom);
  if (input.dateTo) params.set("dateTo", input.dateTo);
  if (input.branchId) params.set("branchId", input.branchId);
  if (input.status) params.set("status", input.status);
  if (input.actorUsername) params.set("actorUsername", input.actorUsername);
  if (input.format) params.set("format", input.format);
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function ReportsHub() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedReportKey, setSelectedReportKey] = useState(REPORTS[0].key);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [branchId, setBranchId] = useState("");
  const [status, setStatus] = useState("");
  const [actorUsername, setActorUsername] = useState("");
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);

  const selectedReport = REPORTS.find((report) => report.key === selectedReportKey) ?? REPORTS[0];
  const baseQuery = useMemo(
    () => buildQuery({ dateFrom, dateTo, branchId, status, actorUsername }),
    [dateFrom, dateTo, branchId, status, actorUsername],
  );

  useEffect(() => {
    apiFetch("/api/branches")
      .then((response) => response.json())
      .then((raw) => setBranches(unwrapApiData(raw) as Branch[]))
      .catch(() => setMessage("No se pudieron cargar las sucursales."));
  }, []);

  async function loadPreview() {
    setLoadingPreview(true);
    setMessage("");
    try {
      const response = await apiFetch(
        `${selectedReport.endpoint}${buildQuery({ dateFrom, dateTo, branchId, status, actorUsername, format: "json" })}`,
      );
      const raw = await response.json();
      if (!response.ok) {
        setMessage(raw?.message ?? "No se pudo generar la vista previa.");
        return;
      }
      setPreview(raw as Record<string, unknown>);
    } catch {
      setMessage("No se pudo generar la vista previa.");
    } finally {
      setLoadingPreview(false);
    }
  }

  const exportCsvHref = `${selectedReport.endpoint}${baseQuery}`;
  const exportPdfHref = `${selectedReport.endpoint}${buildQuery({ dateFrom, dateTo, branchId, status, actorUsername, format: "pdf" })}`;

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text)]">Reportes exportables</h1>
        <p className="text-sm text-[var(--color-text-muted)]">Vista previa y descarga por modulo en CSV o PDF.</p>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-5">
          <label className="space-y-1 text-sm">
            <span className="text-[var(--color-text-muted)]">Reporte</span>
            <select className="hm-input w-full rounded-lg" value={selectedReportKey} onChange={(event) => setSelectedReportKey(event.target.value)}>
              {REPORTS.map((report) => (
                <option key={report.key} value={report.key}>
                  {report.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[var(--color-text-muted)]">Sucursal</span>
            <select className="hm-input w-full rounded-lg" value={branchId} onChange={(event) => setBranchId(event.target.value)}>
              <option value="">Todas las sucursales</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.code} - {branch.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[var(--color-text-muted)]">Fecha desde</span>
            <input className="hm-input w-full rounded-lg" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[var(--color-text-muted)]">Fecha hasta</span>
            <input className="hm-input w-full rounded-lg" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[var(--color-text-muted)]">Estado / accion</span>
            <input className="hm-input w-full rounded-lg" list="report-status-options" value={status} onChange={(event) => setStatus(event.target.value)} />
            <datalist id="report-status-options">
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value} label={option.label} />
              ))}
            </datalist>
          </label>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <label className="space-y-1 text-sm">
            <span className="text-[var(--color-text-muted)]">Usuario actor</span>
            <input className="hm-input w-full rounded-lg" value={actorUsername} onChange={(event) => setActorUsername(event.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={loadingPreview} icon={<Eye className="h-4 w-4" />} onClick={loadPreview}>
              Vista previa
            </Button>
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => { window.location.href = exportCsvHref; }}>
              CSV
            </Button>
            <Button icon={<FileText className="h-4 w-4" />} onClick={() => { window.location.href = exportPdfHref; }}>
              PDF
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text)]">{selectedReport.label}</h2>
            <p className="text-xs text-[var(--color-text-muted)]">JSON de muestra para validar filtros antes de descargar.</p>
          </div>
          <Button variant="ghost" size="sm" loading={loadingPreview} icon={<RefreshCw className="h-4 w-4" />} onClick={loadPreview}>
            Actualizar
          </Button>
        </div>
        <pre className="max-h-[420px] overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-xs text-[var(--color-text-secondary)]">
          {preview ? JSON.stringify(preview, null, 2) : "Sin vista previa cargada."}
        </pre>
      </Card>

      {message ? <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-sm text-[var(--color-text-secondary)]">{message}</p> : null}
    </section>
  );
}
