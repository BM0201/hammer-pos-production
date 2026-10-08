"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, AlertTriangle, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/format";
import { formatTimeAgo, actionsForDecision, ACTION_LABELS, type DecisionAction } from "@/lib/brain-ui";
import { SnoozeSelect } from "@/components/brain/snooze-select";

export type DecisionGroupData = {
  type: string;
  typeLabel: string;
  area: string;
  cta: string;
  groupHref: string | null;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  count: number;
  branches: Array<{ code: string; name: string }>;
  impactAmount: number;
  oldestDetectedAt: string;
  hasReappeared: boolean;
};

export type InboxItem = {
  id: string;
  entityLabel: string;
  branchLabel: string | null;
  description: string;
  href: string | null;
  detectedAgo: string;
  status: string;
  resolution: "IN_MODULE" | "EXECUTABLE" | "ACKNOWLEDGE";
  hasReappeared: boolean;
};

const SEVERITY_BADGE: Record<DecisionGroupData["severity"], { label: string; className: string }> = {
  CRITICAL: { label: "CRÍTICA", className: "bg-[var(--color-danger-50)] text-[var(--color-danger-700)] border-[var(--color-danger-200)]" },
  HIGH: { label: "ALTA", className: "bg-[var(--color-warning-50)] text-[var(--color-warning-700)] border-[var(--color-warning-200)]" },
  MEDIUM: { label: "MEDIA", className: "bg-[var(--color-info-50)] text-[var(--color-info-700)] border-[var(--color-info-200)]" },
  LOW: { label: "BAJA", className: "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] border-[var(--color-border)]" },
  INFO: { label: "INFO", className: "bg-[var(--color-surface-alt)] text-[var(--color-text-soft)] border-[var(--color-border)]" },
};

export function DecisionGroupRow({
  group,
  expanded,
  onToggleExpand,
  items,
  loadingItems,
  allowBulkSelection,
  onRowAction,
  onBulkAction,
  onOpenDetail,
  actionBusyId,
}: {
  group: DecisionGroupData;
  expanded: boolean;
  onToggleExpand: () => void;
  items: InboxItem[] | null;
  loadingItems: boolean;
  allowBulkSelection: boolean;
  onRowAction: (itemId: string, action: DecisionAction, extra?: { days?: number }) => void;
  onBulkAction: (ids: string[], action: DecisionAction, extra?: { days?: number }) => void;
  onOpenDetail: (itemId: string) => void;
  actionBusyId: string | null;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const badge = SEVERITY_BADGE[group.severity];

  function toggleItem(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="border-b border-[var(--color-border)] last:border-0">
      <button
        type="button"
        onClick={onToggleExpand}
        className="flex w-full flex-wrap items-center gap-3 px-3 py-3 text-left hover:bg-[var(--color-surface-alt)]"
      >
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" /> : <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />}
        <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${badge.className}`}>{badge.label}</span>
        <span className="min-w-0 flex-1 font-medium text-[var(--color-text)]">
          {group.typeLabel} · <span className="text-[var(--color-text-muted)]">{group.count}</span>
          {group.hasReappeared && <span className="ml-2 text-xs font-normal text-[var(--color-warning-700)]">Volvió a aparecer</span>}
        </span>
        <span className="shrink-0 text-xs text-[var(--color-text-muted)]">
          {group.branches.length > 0 && `${group.branches.map((b) => b.code).join(", ")} · `}
          {group.impactAmount > 0 && `${money(group.impactAmount)} · `}
          {formatTimeAgo(new Date(group.oldestDetectedAt))}
        </span>
      </button>

      {expanded && (
        <div className="space-y-3 px-3 pb-3">
          <div className="flex flex-wrap gap-2 pl-7">
            {group.groupHref && (
              <Link href={group.groupHref as never} className="hm-btn hm-btn-secondary hm-btn-sm">{group.cta}</Link>
            )}
            {selected.size > 0 && (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <span className="text-xs text-[var(--color-text-muted)]">{selected.size} seleccionada{selected.size === 1 ? "" : "s"}</span>
                <Button type="button" variant="success" size="sm" onClick={() => onBulkAction([...selected], "RESOLVE")}>{ACTION_LABELS.RESOLVE}</Button>
                <SnoozeSelect onPick={(days) => onBulkAction([...selected], "SNOOZE", { days })} />
                <Button type="button" variant="ghost" size="sm" onClick={() => onBulkAction([...selected], "DISMISS")}>{ACTION_LABELS.DISMISS}</Button>
              </div>
            )}
          </div>

          {loadingItems ? (
            <p className="pl-7 text-xs text-[var(--color-text-muted)] animate-pulse">Cargando…</p>
          ) : (
            <ul className="space-y-1.5 pl-7">
              {(items ?? []).map((item) => {
                const rowActions = actionsForDecision({ resolution: item.resolution, status: item.status });
                const busy = actionBusyId === item.id;
                return (
                  <li key={item.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--color-surface-alt)] px-3 py-2 text-sm">
                    {allowBulkSelection && (
                      <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleItem(item.id)} aria-label={`Seleccionar ${item.entityLabel}`} />
                    )}
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpenDetail(item.id)}>
                      <span className="block truncate font-medium text-[var(--color-text)]">{item.entityLabel}</span>
                      <span className="block text-xs text-[var(--color-text-muted)]">
                        {item.branchLabel ? `${item.branchLabel} · ` : ""}{formatTimeAgo(new Date(item.detectedAgo))}
                        {item.hasReappeared && <span className="ml-1 text-[var(--color-warning-700)]">· Volvió a aparecer</span>}
                      </span>
                    </button>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {rowActions.includes("GO_RESOLVE") && item.href && (
                        <Link href={item.href as never} className="hm-btn hm-btn-secondary hm-btn-sm">{ACTION_LABELS.GO_RESOLVE}</Link>
                      )}
                      {rowActions.includes("RUN") && (
                        <Button type="button" variant="success" size="sm" onClick={() => onRowAction(item.id, "RUN")} loading={busy} icon={<AlertTriangle className="h-3.5 w-3.5" />}>{ACTION_LABELS.RUN}</Button>
                      )}
                      {rowActions.includes("ACKNOWLEDGE") && (
                        <Button type="button" variant="success" size="sm" onClick={() => onRowAction(item.id, "ACKNOWLEDGE")} loading={busy}>{ACTION_LABELS.ACKNOWLEDGE}</Button>
                      )}
                      {rowActions.includes("RESOLVE") && (
                        <Button type="button" variant="success" size="sm" onClick={() => onRowAction(item.id, "RESOLVE")} loading={busy}>{ACTION_LABELS.RESOLVE}</Button>
                      )}
                      {rowActions.includes("SNOOZE") && <SnoozeSelect disabled={busy} onPick={(days) => onRowAction(item.id, "SNOOZE", { days })} />}
                      {rowActions.includes("DISMISS") && (
                        <Button type="button" variant="ghost" size="sm" onClick={() => onRowAction(item.id, "DISMISS")} disabled={busy}>{ACTION_LABELS.DISMISS}</Button>
                      )}
                      {rowActions.includes("REOPEN") && (
                        <Button type="button" variant="secondary" size="sm" onClick={() => onRowAction(item.id, "REOPEN")} loading={busy} icon={<RefreshCcw className="h-3.5 w-3.5" />}>{ACTION_LABELS.REOPEN}</Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
