"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, AlertTriangle, RefreshCcw, ClipboardList, MoreHorizontal } from "lucide-react";
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
  branches: Array<{ id: string; code: string; name: string }>;
  impactAmount: number;
  oldestDetectedAt: string;
  hasReappeared: boolean;
  productIds: string[];
};

export type InboxItem = {
  id: string;
  entityLabel: string;
  branchLabel: string | null;
  description: string;
  metrics: Array<{ label: string; value: unknown }>;
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
  onCreatePriceLoad,
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
  onCreatePriceLoad: (group: DecisionGroupData) => void;
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

  const canCreatePriceLoad = group.area === "PRICING" && group.productIds.length > 0;

  return (
    <div className="border-b border-[var(--color-border)] last:border-0">
      {/* Parte A · Commit 2.4 — en 390px el título no se come con los metadatos
          (sucursales/impacto/"hace…"): esos van en su PROPIA línea, debajo,
          en vez de compartir la fila con shrink-0 (lo que forzaba el ancho
          total por encima del viewport). De sm en adelante vuelven a la
          misma línea, alineados a la derecha, como antes. */}
      <button
        type="button"
        onClick={onToggleExpand}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3 text-left hover:bg-[var(--color-surface-alt)]"
      >
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" /> : <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />}
        <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${badge.className}`}>{badge.label}</span>
        <span className="min-w-0 flex-1 font-medium text-[var(--color-text)]">
          {group.typeLabel} · <span className="text-[var(--color-text-muted)]">{group.count}</span>
          {group.hasReappeared && <span className="ml-2 text-xs font-normal text-[var(--color-warning-700)]">Volvió a aparecer</span>}
        </span>
        <span className="w-full pl-7 text-xs text-[var(--color-text-muted)] sm:w-auto sm:shrink-0 sm:pl-0">
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
            {canCreatePriceLoad && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onCreatePriceLoad(group)} icon={<ClipboardList className="h-3.5 w-3.5" />}>
                Crear carga de precios
              </Button>
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
                // Parte A · Commit 2.3 — en tablet (<xl) 4 botones aplastaban
                // el nombre del producto a "CEM-C…". Posponer/No aplica/Ver
                // detalle pasan a un menú "⋯" ahí; el nombre nunca se corta
                // a menos de una línea completa (ya no comparte min-w-0 con
                // los botones en la misma fila por debajo de xl).
                const hasOverflowMenu = rowActions.includes("SNOOZE") || rowActions.includes("DISMISS");
                return (
                  <li key={item.id} className="flex flex-col gap-2 rounded-lg bg-[var(--color-surface-alt)] px-3 py-2 text-sm xl:flex-row xl:items-center">
                    <div className="flex items-start gap-2">
                      {allowBulkSelection && (
                        <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleItem(item.id)} aria-label={`Seleccionar ${item.entityLabel}`} className="mt-1" />
                      )}
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpenDetail(item.id)}>
                        <span className="block font-medium text-[var(--color-text)]">{item.entityLabel}</span>
                        {item.description && <span className="block text-xs text-[var(--color-text-secondary)]">{item.description}</span>}
                        {item.metrics.length > 0 && (
                          <span className="block text-xs text-[var(--color-text-muted)]">
                            {item.metrics.map((m) => `${m.label}: ${String(m.value)}`).join(" · ")}
                          </span>
                        )}
                        <span className="block text-xs text-[var(--color-text-muted)]">
                          {item.branchLabel ? `${item.branchLabel} · ` : ""}{formatTimeAgo(new Date(item.detectedAgo))}
                          {item.hasReappeared && <span className="ml-1 text-[var(--color-warning-700)]">· Volvió a aparecer</span>}
                        </span>
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 pl-6 xl:pl-0">
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
                      {rowActions.includes("REOPEN") && (
                        <Button type="button" variant="secondary" size="sm" onClick={() => onRowAction(item.id, "REOPEN")} loading={busy} icon={<RefreshCcw className="h-3.5 w-3.5" />}>{ACTION_LABELS.REOPEN}</Button>
                      )}
                      {/* Pantallas angostas: Posponer/No aplica/Ver detalle en un menú "⋯". De sm en adelante, los botones completos (como antes). */}
                      {hasOverflowMenu && (
                        <>
                          <div className="flex items-center gap-1.5 sm:hidden">
                            <details className="relative">
                              <summary className="hm-icon-btn inline-flex cursor-pointer list-none items-center justify-center" aria-label="Más acciones">
                                <MoreHorizontal className="h-4 w-4" />
                              </summary>
                              <div className="absolute right-0 top-full z-10 mt-1 w-44 space-y-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 shadow-lg">
                                <button type="button" className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--color-surface-alt)]" onClick={() => onOpenDetail(item.id)}>Ver detalle</button>
                                {rowActions.includes("SNOOZE") && (
                                  <div className="px-1">
                                    <SnoozeSelect disabled={busy} onPick={(days) => onRowAction(item.id, "SNOOZE", { days })} />
                                  </div>
                                )}
                                {rowActions.includes("DISMISS") && (
                                  <button type="button" className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]" onClick={() => onRowAction(item.id, "DISMISS")} disabled={busy}>{ACTION_LABELS.DISMISS}</button>
                                )}
                              </div>
                            </details>
                          </div>
                          <div className="hidden items-center gap-1.5 sm:flex">
                            {rowActions.includes("SNOOZE") && <SnoozeSelect disabled={busy} onPick={(days) => onRowAction(item.id, "SNOOZE", { days })} />}
                            {rowActions.includes("DISMISS") && (
                              <Button type="button" variant="ghost" size="sm" onClick={() => onRowAction(item.id, "DISMISS")} disabled={busy}>{ACTION_LABELS.DISMISS}</Button>
                            )}
                          </div>
                        </>
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
