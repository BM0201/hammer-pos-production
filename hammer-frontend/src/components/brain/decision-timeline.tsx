"use client";

export type BrainDecisionLog = {
  id: string;
  action: string;
  note?: string | null;
  createdAt: string;
  actor?: { id: string; username: string; fullName?: string | null } | null;
};

export function DecisionTimeline({ logs }: { logs?: BrainDecisionLog[] }) {
  if (!logs?.length) {
    return <div className="rounded-lg border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm text-[var(--color-text-muted)]">Sin historial registrado.</div>;
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-[var(--color-text)]">Historial</h3>
      <ol className="space-y-2">
        {logs.map((log) => (
          <li key={log.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-[var(--color-text)]">{log.action}</span>
              <span className="text-xs text-[var(--color-text-muted)]">{new Date(log.createdAt).toLocaleString("es-NI")}</span>
            </div>
            <div className="mt-1 text-xs text-[var(--color-text-muted)]">{log.actor?.fullName ?? log.actor?.username ?? "SYSTEM"}</div>
            {log.note ? <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{log.note}</p> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
