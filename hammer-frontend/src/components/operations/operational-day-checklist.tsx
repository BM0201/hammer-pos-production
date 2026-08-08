"use client";

import { CheckCircle2, AlertTriangle, ClipboardList } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type ChecklistItem = {
  key: string;
  label: string;
  status: "OK" | "ATTENTION";
  count?: number;
  message?: string;
};

/** Checklist informativo — Día Operativo 360. Ningún ítem bloquea nada. */
export type DayChecklist = {
  items: ChecklistItem[];
  attention: ChecklistItem[];
  ok: ChecklistItem[];
};

type RowConfig = {
  container: string;
  icon: React.ElementType;
  iconColor: string;
  labelColor: string;
  badge: "warning" | "success";
  badgeLabel: string;
};

const ROW_CONFIG: Record<ChecklistItem["status"], RowConfig> = {
  ATTENTION: {
    container: "border-[var(--color-warning-200)] bg-[color-mix(in_srgb,var(--color-warning-50)_30%,white)]",
    icon: AlertTriangle,
    iconColor: "text-[var(--color-warning-600)]",
    labelColor: "text-[var(--color-text)]",
    badge: "warning",
    badgeLabel: "Atención",
  },
  OK: {
    container: "border-[var(--color-border)] bg-[var(--color-surface-muted)]",
    icon: CheckCircle2,
    iconColor: "text-[var(--color-success-600)]",
    labelColor: "text-[var(--color-text-secondary)]",
    badge: "success",
    badgeLabel: "OK",
  },
};

function ChecklistRow({ item }: { item: ChecklistItem }) {
  const cfg = ROW_CONFIG[item.status];
  const Icon = cfg.icon;
  return (
    <li className={`flex items-start gap-3 rounded-lg border px-3.5 py-2.5 ${cfg.container}`}>
      <Icon className={`mt-0.5 flex-shrink-0 ${cfg.iconColor}`} style={{ width: "1rem", height: "1rem" }} />
      <div className="min-w-0 flex-1">
        <span className={`text-sm font-semibold leading-tight ${cfg.labelColor}`}>{item.label}</span>
        {typeof item.count === "number" && (
          <span className={`ml-1.5 text-xs font-bold ${cfg.iconColor}`}>({item.count})</span>
        )}
        {item.message && (
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)] leading-relaxed">{item.message}</p>
        )}
      </div>
      <Badge variant={cfg.badge} className="flex-shrink-0 self-start">{cfg.badgeLabel}</Badge>
    </li>
  );
}

type Props = {
  checklist: DayChecklist | null;
  onPreview?: () => Promise<void>;
};

/**
 * Checklist puramente informativo — Día Operativo 360. Ningún ítem bloquea la
 * confirmación; los que están en atención solo exigen que Master deje una
 * nota al firmar (ver ConfirmDayDialog).
 */
export function OperationalDayChecklist({ checklist, onPreview }: Props) {
  return (
    <div className="hm-module-card">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <ClipboardList className="text-[var(--color-text-muted)]" style={{ width: "1rem", height: "1rem" }} />
          <h2 className="text-sm font-bold text-[var(--color-text)]">Checklist — informativo</h2>
        </div>
        {checklist && (
          <div className="flex flex-wrap items-center gap-2">
            {checklist.attention.length > 0 ? (
              <span className="text-xs font-semibold text-[var(--color-warning-700)]">
                {checklist.attention.length} en atención
              </span>
            ) : (
              <span className="hm-chip hm-chip-success text-xs">Todo en orden</span>
            )}
          </div>
        )}
      </div>

      <div className="p-4">
        {!checklist ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--color-border)] px-6 py-8 text-center">
            <ClipboardList className="text-[var(--color-text-muted)] opacity-40" style={{ width: "2rem", height: "2rem" }} />
            <div>
              <p className="text-sm font-semibold text-[var(--color-text-secondary)]">Nada bloquea, solo informa</p>
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">Calcula el checklist para ver qué necesita una nota al confirmar.</p>
            </div>
            {onPreview && (
              <Button variant="secondary" size="sm" onClick={onPreview}>Calcular ahora</Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {checklist.attention.length > 0 && (
              <section>
                <p className="mb-2 text-[0.625rem] font-bold uppercase tracking-[0.12em] text-[var(--color-warning-700)] flex items-center gap-1.5">
                  <AlertTriangle style={{ width: "0.75rem", height: "0.75rem" }} />
                  En atención — no bloquean, pero piden nota al confirmar
                </p>
                <ul className="space-y-2">
                  {checklist.attention.map((item) => <ChecklistRow key={item.key} item={item} />)}
                </ul>
              </section>
            )}
            {checklist.ok.length > 0 && (
              <section>
                <p className="mb-2 text-[0.625rem] font-bold uppercase tracking-[0.12em] text-[var(--color-success-700)] flex items-center gap-1.5">
                  <CheckCircle2 style={{ width: "0.75rem", height: "0.75rem" }} />
                  Verificado
                </p>
                <ul className="space-y-2">
                  {checklist.ok.map((item) => <ChecklistRow key={item.key} item={item} />)}
                </ul>
              </section>
            )}
            {checklist.items.length === 0 && (
              <p className="text-sm text-[var(--color-text-muted)]">Sin items para mostrar.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
