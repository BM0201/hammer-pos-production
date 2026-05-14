"use client";

import { useEffect, useMemo, useState } from "react";

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

const MODULE_OPTIONS = ["sales", "cash_session", "dispatch", "inventory", "approvals", "auth", "payments"] as const;

function buildSummary(row: AuditRow): string {
  const meta = row.metadataJson ?? {};
  const reason = typeof meta.reason === "string" ? meta.reason : null;
  const status = typeof meta.status === "string" ? meta.status : null;
  const amount = typeof meta.amount === "number" ? meta.amount : null;
  const parts = [
    reason ? `Motivo: ${reason}` : null,
    status ? `Estado: ${status}` : null,
    amount !== null ? `Monto: ${amount}` : null,
  ].filter(Boolean);

  if (parts.length > 0) return parts.join(" · ");
  return `${row.entityType}#${row.entityId}`;
}

function isSensitive(row: AuditRow): boolean {
  return row.module === "approvals" || row.action.includes("DENIED") || row.action.includes("REQUESTED");
}

export function AuditLogViewer({ branchFixed = false, defaultBranchId }: { branchFixed?: boolean; defaultBranchId?: string }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [message, setMessage] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [branchId, setBranchId] = useState(defaultBranchId ?? "");
  const [module, setModule] = useState("");
  const [action, setAction] = useState("");
  const [actorUsername, setActorUsername] = useState("");
  const [result, setResult] = useState("");

  async function load() {
    const query = new URLSearchParams({ limit: "100" });
    if (dateFrom) query.set("dateFrom", dateFrom);
    if (dateTo) query.set("dateTo", dateTo);
    if (branchId) query.set("branchId", branchId);
    if (module) query.set("module", module);
    if (action) query.set("action", action);
    if (actorUsername) query.set("actorUsername", actorUsername);
    if (result) query.set("result", result);

    const response = await fetch(`/api/audit?${query.toString()}`);
    const json = (await response.json()) as { data?: AuditRow[]; message?: string };
    if (!response.ok) {
      setMessage(json.message ?? "No se pudo cargar la bitácora.");
      return;
    }

    setRows(json.data ?? []);
    setMessage("");
  }

  useEffect(() => {
    load().catch(() => setMessage("No se pudo cargar la bitácora."));
  }, []);

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
      <div className="rounded-lg border border-[var(--color-border)] p-3 bg-[var(--color-surface-muted)] text-sm">
        <strong>Bitácora operativa</strong>
        <p className="text-[var(--color-text-muted)]">Eventos cargados: {rows.length} · Eventos de aprobaciones: {approvalRows}</p>
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        <input className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-sm" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <input className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-sm" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <select className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-sm" value={module} onChange={(e) => setModule(e.target.value)}>
          <option value="">Módulo (todos)</option>
          {MODULE_OPTIONS.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <input className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-sm" placeholder="Acción exacta" value={action} onChange={(e) => setAction(e.target.value)} />
        {!branchFixed ? (
          <input className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-sm" placeholder="Sucursal ID (opcional)" value={branchId} onChange={(e) => setBranchId(e.target.value)} />
        ) : null}
        <input className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-sm" placeholder="Usuario (username)" value={actorUsername} onChange={(e) => setActorUsername(e.target.value)} />
        <input className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-sm" placeholder="Resultado / motivo" value={result} onChange={(e) => setResult(e.target.value)} />
        <button className="rounded-lg bg-[var(--color-info-700)] hover:bg-[var(--color-info-800)] px-3 py-1 text-sm text-white" onClick={() => load().catch(() => setMessage("No se pudo filtrar."))}>Filtrar</button>
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
                <td className="px-2 py-2">{row.module}</td>
                <td className="px-2 py-2">{row.action}</td>
                <td className="px-2 py-2">{row.actor?.username ?? "sistema"}</td>
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
