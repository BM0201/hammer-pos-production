"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { CashSessionRow } from "@/components/operations/operational-day-summary";

function money(value: string | number | null | undefined) {
  return new Intl.NumberFormat("es-NI", { style: "currency", currency: "NIO" }).format(Number(value ?? 0));
}

function statusVariant(status: string) {
  if (status === "OPEN") return "success";
  if (status === "AUTO_CLOSED_PENDING_REVIEW" || status === "RECONCILING") return "warning";
  return "neutral";
}

export function CashSessionStatusList({ sessions }: { sessions: CashSessionRow[] }) {
  return (
    <Card className="p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Cajas del dia</h2>
        <p className="text-xs text-[var(--color-text-muted)]">{sessions.length} sesion{sessions.length !== 1 ? "es" : ""}</p>
      </div>
      <div className="space-y-2">
        {sessions.length === 0 ? <p className="rounded-lg border border-dashed border-[var(--color-border)] p-3 text-sm text-[var(--color-text-muted)]">No hay sesiones de caja asociadas.</p> : null}
        {sessions.map((session) => (
          <div key={session.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-semibold text-[var(--color-text)]">{session.physicalCashBox?.code ?? "Caja"}</div>
                <div className="text-xs text-[var(--color-text-muted)]">Abierta {new Date(session.openedAt).toLocaleString("es-NI")} · {session.openedBy?.fullName ?? session.openedBy?.username ?? "usuario"}</div>
              </div>
              <Badge variant={statusVariant(session.status)}>{session.status === "AUTO_CLOSED_PENDING_REVIEW" ? "Auto-cerrada pendiente" : session.status}</Badge>
            </div>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
              <span>Apertura: <strong>{money(session.openingAmount)}</strong></span>
              <span>Esperado: <strong>{money(session.expectedCashAmount)}</strong></span>
              <span>Contado: <strong>{money(session.countedCashAmount)}</strong></span>
              <span>Diferencia: <strong>{money(session.differenceAmount)}</strong></span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
