"use client";

import { useCallback, useState } from "react";
import { useOperationalPolling } from "@/lib/realtime/use-operational-polling";

type ApprovalItem = {
  id: string;
  type: string;
  status: string;
  branchId: string;
  reason: string;
  referenceType: string;
  referenceId: string;
  createdAt: string;
  requestedBy: { username: string; fullName: string };
};

export function ApprovalsQueue({ branchId }: { branchId?: string }) {
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const query = new URLSearchParams();
    if (branchId) query.set("branchId", branchId);
    const response = await fetch(`/api/approvals?${query.toString()}`);
    const json = (await response.json()) as { data?: ApprovalItem[]; message?: string };
    if (!response.ok) {
      setMessage(json.message ?? "No se pudo cargar la cola de aprobaciones.");
      return;
    }
    setItems(json.data ?? []);
  }, [branchId]);

  useOperationalPolling({
    task: load,
    intervalMs: 7000,
    deps: [load],
    onError: () => setMessage("No se pudo cargar la cola de aprobaciones."),
  });

  async function resolve(id: string, decision: "APPROVE" | "REJECT") {
    setBusyId(id);
    const response = await fetch(`/api/approvals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision,
        resolutionNotes: decision === "APPROVE" ? "Aprobación operativa registrada." : "Solicitud rechazada por supervisor.",
      }),
    });

    const json = (await response.json()) as { message?: string };
    if (!response.ok) {
      setMessage(json.message ?? "No se pudo resolver la solicitud.");
      setBusyId(null);
      return;
    }

    setMessage(decision === "APPROVE" ? "Solicitud aprobada." : "Solicitud rechazada.");
    setBusyId(null);
    await load();
  }

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-[var(--color-border)] p-3 text-sm bg-[var(--color-surface-muted)]">
        <strong>Cola operativa de aprobaciones</strong>
        <p className="text-[var(--color-text-muted)]">Revisa y resuelve solicitudes sensibles de sucursal.</p>
        <p className="text-xs text-[var(--color-text-soft)]">Actualización automática cada ~7 segundos.</p>
      </div>

      <div className="space-y-2">
        {items.map((item) => (
          <article key={item.id} className="rounded-lg border border-[var(--color-border)] p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <span className="rounded-lg bg-[var(--color-surface-alt)] px-2 py-1">{item.type}</span>
              <span className="rounded-lg bg-[var(--color-warning-100)] px-2 py-1">{item.status}</span>
              <span>Sucursal: {item.branchId}</span>
              <span>{new Date(item.createdAt).toLocaleString()}</span>
            </div>
            <p className="text-sm"><strong>Motivo:</strong> {item.reason}</p>
            <p className="text-xs text-[var(--color-text-muted)]">
              Referencia: {item.referenceType} / {item.referenceId} · Solicitado por {item.requestedBy.fullName} ({item.requestedBy.username})
            </p>
            <div className="flex gap-2">
              <button
                className="rounded-lg bg-[var(--color-success-700)] px-3 py-1.5 text-white text-sm disabled:opacity-60"
                disabled={busyId === item.id}
                onClick={() => resolve(item.id, "APPROVE")}
              >
                Aprobar
              </button>
              <button
                className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-60"
                disabled={busyId === item.id}
                onClick={() => resolve(item.id, "REJECT")}
              >
                Rechazar
              </button>
            </div>
          </article>
        ))}
      </div>

      {!items.length ? <p className="text-sm text-[var(--color-text-muted)]">No hay solicitudes pendientes.</p> : null}
      {message ? <p className="text-sm text-[var(--color-text-secondary)]">{message}</p> : null}
    </section>
  );
}
