"use client";

import { X, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { money, qty } from "@/lib/format";
import { formatTimeAgo, actionsForDecision, ACTION_LABELS, type DecisionAction } from "@/lib/brain-ui";
import { SnoozeSelect } from "@/components/brain/snooze-select";

type EvidenceItem = { key: string; label: string; value: unknown; format: "money" | "percent" | "number" | "date" | "text" };
type HistoryItem = { id: string; action: string; actionLabel: string; note: string | null; actorName: string | null; createdAt: string };

export type DecisionDetail = {
  id: string;
  title: string;
  description: string;
  recommendation: string;
  severity: string;
  status: string;
  typeLabel: string;
  area: string;
  cta: string;
  href: string | null;
  resolution: "IN_MODULE" | "EXECUTABLE" | "ACKNOWLEDGE";
  evidence: EvidenceItem[];
  history: HistoryItem[];
  branch: { code: string; name: string } | null;
  product: { sku: string; name: string } | null;
  createdAt: string;
  lastDetectedAt: string;
};

function formatEvidenceValue(item: EvidenceItem): string {
  const value = item.value;
  if (item.format === "money" && typeof value === "number") return money(value);
  if (item.format === "percent" && typeof value === "number") return `${value.toFixed(1)}%`;
  if (item.format === "number" && typeof value === "number") return qty(value);
  if (item.format === "date") {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("es-NI", { timeZone: "America/Managua" });
  }
  return String(value);
}

export function DecisionDrawer({
  decision,
  onClose,
  onAction,
  busy,
}: {
  decision: DecisionDetail;
  onClose: () => void;
  onAction: (action: DecisionAction, extra?: { days?: number }) => void;
  busy: boolean;
}) {
  const actions = actionsForDecision({ resolution: decision.resolution, status: decision.status });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="flex h-full w-full max-w-lg flex-col bg-[var(--color-surface)] shadow-2xl sm:h-auto sm:max-h-full">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">{decision.typeLabel}</h2>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          <div>
            <p className="text-sm text-[var(--color-text)]">{decision.description}</p>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]"><strong className="text-[var(--color-text)]">Por qué importa:</strong> {decision.recommendation}</p>
          </div>

          {(decision.branch || decision.product) && (
            <div className="flex flex-wrap gap-2 text-xs text-[var(--color-text-muted)]">
              {decision.branch && <span className="rounded-full border border-[var(--color-border)] px-2 py-1">{decision.branch.code} · {decision.branch.name}</span>}
              {decision.product && <span className="rounded-full border border-[var(--color-border)] px-2 py-1">{decision.product.sku} · {decision.product.name}</span>}
            </div>
          )}

          {decision.evidence.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Evidencia</h3>
              <dl className="space-y-1.5 rounded-lg bg-[var(--color-surface-alt)] p-3 text-sm">
                {decision.evidence.map((item) => (
                  <div key={item.key} className="flex items-baseline justify-between gap-3">
                    <dt className="text-[var(--color-text-muted)]">{item.label}</dt>
                    <dd className="font-medium text-[var(--color-text)]">{formatEvidenceValue(item)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {decision.history.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Historial</h3>
              <ul className="space-y-2">
                {decision.history.map((entry) => (
                  <li key={entry.id} className="text-sm">
                    <span className="font-medium text-[var(--color-text)]">{entry.actionLabel}</span>
                    {entry.actorName && <span className="text-[var(--color-text-muted)]"> · {entry.actorName}</span>}
                    <span className="text-[var(--color-text-soft)]"> · {formatTimeAgo(new Date(entry.createdAt))}</span>
                    {entry.note && <p className="text-[var(--color-text-muted)]">{entry.note}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] px-4 py-3">
          {actions.includes("GO_RESOLVE") && decision.href && (
            <Link href={decision.href as never} className="hm-btn hm-btn-primary" onClick={onClose}>{decision.cta}</Link>
          )}
          {actions.includes("RUN") && (
            <Button type="button" variant="success" onClick={() => onAction("RUN")} loading={busy} icon={<AlertTriangle className="h-4 w-4" />}>{ACTION_LABELS.RUN}</Button>
          )}
          {actions.includes("ACKNOWLEDGE") && (
            <Button type="button" variant="success" onClick={() => onAction("ACKNOWLEDGE")} loading={busy}>{ACTION_LABELS.ACKNOWLEDGE}</Button>
          )}
          {actions.includes("RESOLVE") && (
            <Button type="button" variant="success" onClick={() => onAction("RESOLVE")} loading={busy}>{ACTION_LABELS.RESOLVE}</Button>
          )}
          {actions.includes("SNOOZE") && <SnoozeSelect disabled={busy} onPick={(days) => onAction("SNOOZE", { days })} />}
          {actions.includes("DISMISS") && (
            <Button type="button" variant="ghost" onClick={() => onAction("DISMISS")} disabled={busy}>{ACTION_LABELS.DISMISS}</Button>
          )}
          {actions.includes("REOPEN") && (
            <Button type="button" variant="secondary" onClick={() => onAction("REOPEN")} loading={busy}>{ACTION_LABELS.REOPEN}</Button>
          )}
        </div>
      </div>
    </div>
  );
}
