"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { unwrapApiData } from "@/lib/client/api";

type AuditRow = {
  id: string;
  occurredAt: string;
  module: string;
  action: string;
  entityType: string;
  entityId: string;
  metadataJson: Record<string, unknown> | null;
  branch: { id: string; code: string; name: string } | null;
  actor: { id: string; username: string; fullName: string } | null;
};

const MODULE_OPTIONS: { value: string; label: string }[] = [
  { value: "approvals",        label: "Aprobaciones" },
  { value: "auth",             label: "Autenticación" },
  { value: "mfa",              label: "Autenticación 2FA" },
  { value: "brain",            label: "Brain / Decisiones" },
  { value: "branch-config",    label: "Configuración de sucursal" },
  { value: "branches",         label: "Sucursales" },
  { value: "catalog",          label: "Catálogo" },
  { value: "catalog-inventory",label: "Catálogo · Inventario" },
  { value: "cash_session",     label: "Caja (sesiones)" },
  { value: "cash_closure",     label: "Cierre de caja" },
  { value: "discounts",        label: "Descuentos" },
  { value: "dispatch",         label: "Despacho" },
  { value: "expenses",         label: "Gastos" },
  { value: "internal-freight", label: "Flete interno" },
  { value: "inventory",        label: "Inventario" },
  { value: "operations",       label: "Día operacional" },
  { value: "payments",         label: "Pagos" },
  { value: "payroll",          label: "Nómina" },
  { value: "pricing",          label: "Precios" },
  { value: "printing",         label: "Impresión" },
  { value: "production",       label: "Producción" },
  { value: "purchase-orders",  label: "Órdenes de compra" },
  { value: "reorder",          label: "Reorden" },
  { value: "sales",            label: "Ventas" },
  { value: "sales_returns",    label: "Devoluciones" },
  { value: "sales_cancellations", label: "Anulaciones" },
  { value: "suppliers",        label: "Proveedores" },
  { value: "system-admin",     label: "Administración del sistema" },
  { value: "timber",           label: "Madera" },
  { value: "transfers",        label: "Traslados" },
  { value: "transport",        label: "Transporte" },
  { value: "users",            label: "Usuarios" },
  { value: "analytics",        label: "Analítica" },
];

const MODULE_LABEL = new Map(MODULE_OPTIONS.map(({ value, label }) => [value, label]));

function buildSummary(row: AuditRow): string {
  const meta = row.metadataJson ?? {};
  const parts: string[] = [];
  if (typeof meta.reason === "string") parts.push(meta.reason);
  if (typeof meta.status === "string") parts.push(meta.status);
  if (typeof meta.amount === "number") parts.push(`C$${meta.amount}`);
  if (typeof meta.method === "string") parts.push(meta.method);
  if (typeof meta.returnNumber === "string") parts.push(meta.returnNumber);
  if (typeof meta.orderNumber === "string") parts.push(meta.orderNumber);
  return parts.length > 0 ? parts.join(" · ") : `${row.entityType}#${row.entityId.slice(0, 12)}`;
}

function isSensitive(row: AuditRow): boolean {
  return row.module === "approvals" || row.action.includes("DENIED") || row.action.includes("REQUESTED");
}

function formatActor(actor: AuditRow["actor"]) {
  if (!actor) return "sistema";
  return actor.fullName ? `${actor.fullName} (usuario: ${actor.username})` : actor.username;
}

const PAGE_SIZE = 100;

export function AuditLogViewer({ branchFixed = false, defaultBranchId }: { branchFixed?: boolean; defaultBranchId?: string }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [message, setMessage] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [branchId, setBranchId] = useState(defaultBranchId ?? "");
  const [module, setModule] = useState("");
  const [action, setAction] = useState("");
  const [actorUsername, setActorUsername] = useState("");
  const [result, setResult] = useState("");

  const load = useCallback(async (off = 0) => {
    const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(off) });
    if (dateFrom) query.set("dateFrom", dateFrom);
    if (dateTo) query.set("dateTo", dateTo);
    if (branchId) query.set("branchId", branchId);
    if (module) query.set("module", module);
    if (action) query.set("action", action);
    if (actorUsername) query.set("actorUsername", actorUsername);
    if (result) query.set("result", result);

    const response = await fetch(`/api/audit?${query.toString()}`);
    const raw = await response.json();
    if (!response.ok) {
      setMessage(raw.error?.message ?? raw.message ?? "No se pudo cargar la bitácora.");
      return;
    }
    const data = unwrapApiData(raw) as { rows: AuditRow[]; total: number };
    setRows(Array.isArray(data.rows) ? data.rows : []);
    setTotal(data.total ?? 0);
    setOffset(off);
    setMessage("");
  }, [action, actorUsername, branchId, dateFrom, dateTo, module, result]);

  useEffect(() => {
    load(0).catch(() => setMessage("No se pudo cargar la bitácora."));
  }, [load]);

  const approvalRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          row.action.includes("APPROVAL_REQUEST_CREATED") ||
          row.action.includes("APPROVAL_REQUEST_RESOLVED") ||
          row.action.includes("APPROVAL_REQUESTED"),
      ).length,
    [rows],
  );

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-[var(--color-border)] p-3 bg-[var(--color-surface-muted)] text-sm flex items-center justify-between gap-2">
        <div>
          <strong>Bitácora operativa</strong>
          <p className="text-[var(--color-text-muted)]">Mostrando {rows.length} de {total} eventos · Aprobaciones: {approvalRows}</p>
        </div>
        <div className="flex gap-2">
          <button
            disabled={offset === 0}
            onClick={() => load(Math.max(0, offset - PAGE_SIZE)).catch(() => setMessage("Error al paginar."))}
            className="rounded px-2 py-1 text-xs border border-[var(--color-border)] disabled:opacity-40 hover:bg-[var(--color-surface-raised)] transition-colors"
          >
            ← Anterior
          </button>
          <button
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => load(offset + PAGE_SIZE).catch(() => setMessage("Error al paginar."))}
            className="rounded px-2 py-1 text-xs border border-[var(--color-border)] disabled:opacity-40 hover:bg-[var(--color-surface-raised)] transition-colors"
          >
            Siguiente →
          </button>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        <input className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-sm" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <input className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-sm" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <select className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-sm" value={module} onChange={(e) => setModule(e.target.value)}>
          <option value="">Módulo (todos)</option>
          {MODULE_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <input className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-sm" placeholder="Acción (ej: LOGIN, SALE_CREATED)" value={action} onChange={(e) => setAction(e.target.value)} />
        {!branchFixed ? (
          <input className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-sm" placeholder="Sucursal ID (opcional)" value={branchId} onChange={(e) => setBranchId(e.target.value)} />
        ) : null}
        <input className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-sm" placeholder="Usuario (username)" value={actorUsername} onChange={(e) => setActorUsername(e.target.value)} />
        <input className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-sm" placeholder="Resultado / motivo" value={result} onChange={(e) => setResult(e.target.value)} />
        <button className="rounded-lg bg-[var(--color-info-700)] hover:bg-[var(--color-info-800)] px-3 py-1 text-sm text-white" onClick={() => load(0).catch(() => setMessage("No se pudo filtrar."))}>Filtrar</button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
        <table className="min-w-full text-sm">
          <thead className="bg-[var(--color-surface-alt)]">
            <tr>
              <th className="px-2 py-2 text-left">Fecha/Hora</th>
              <th className="px-2 py-2 text-left">Sucursal</th>
              <th className="px-2 py-2 text-left">Módulo</th>
              <th className="px-2 py-2 text-left">Acción</th>
              <th className="px-2 py-2 text-left">Usuario</th>
              <th className="px-2 py-2 text-left">Resumen</th>
              <th className="px-2 py-2 text-left">Referencia</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={isSensitive(row) ? "bg-[var(--color-warning-50)]" : ""}>
                <td className="px-2 py-2">{new Date(row.occurredAt).toLocaleString()}</td>
                <td className="px-2 py-2">{row.branch ? `${row.branch.code}` : "—"}</td>
                <td className="px-2 py-2">
                  <span className="text-xs font-medium text-[var(--color-text-secondary)]">
                    {MODULE_LABEL.get(row.module) ?? row.module}
                  </span>
                </td>
                <td className="px-2 py-2 font-mono text-xs">{row.action}</td>
                <td className="px-2 py-2">{formatActor(row.actor)}</td>
                <td className="px-2 py-2">{buildSummary(row)}</td>
                <td className="px-2 py-2">{row.entityType}/{row.entityId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 ? <p className="text-sm text-[var(--color-text-muted)]">Sin resultados para los filtros actuales.</p> : null}
      {message ? <p className="text-sm text-[var(--color-text-secondary)]">{message}</p> : null}
    </section>
  );
}
