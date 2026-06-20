"use client";

import { CheckCircle2, AlertTriangle, XCircle, ClipboardList } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type ChecklistItem = {
  key: string;
  label: string;
  status: "OK" | "WARNING" | "BLOCKING";
  count?: number;
  message?: string;
};

export type ClosePreview = {
  canClose: boolean;
  blockers: ChecklistItem[];
  warnings: ChecklistItem[];
  ok: ChecklistItem[];
};

type RowConfig = {
  container: string;
  icon: React.ElementType;
  iconColor: string;
  labelColor: string;
  badge: "danger" | "warning" | "success";
  badgeLabel: string;
};

const ROW_CONFIG: Record<ChecklistItem["status"], RowConfig> = {
  BLOCKING: {
    container: "border-[var(--color-danger-200)] bg-[color-mix(in_srgb,var(--color-danger-50)_30%,white)]",
    icon: XCircle,
    iconColor: "text-[var(--color-danger-600)]",
    labelColor: "text-[var(--color-danger-800)]",
    badge: "danger",
    badgeLabel: "Bloqueante",
  },
  WARNING: {
    container: "border-[var(--color-warning-200)] bg-[color-mix(in_srgb,var(--color-warning-50)_30%,white)]",
    icon: AlertTriangle,
    iconColor: "text-[var(--color-warning-600)]",
    labelColor: "text-[var(--color-text)]",
    badge: "warning",
    badgeLabel: "Advertencia",
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
  preview: ClosePreview | null;
  onPreview?: () => Promise<void>;
};

export function OperationalDayChecklist({ preview, onPreview }: Props) {
  const allItems = preview ? [...preview.blockers, ...preview.warnings, ...preview.ok] : [];

  return (
    <div className="hm-module-card">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <ClipboardList className="text-[var(--color-text-muted)]" style={{ width: "1rem", height: "1rem" }} />
          <h2 className="text-sm font-bold text-[var(--color-text)]">Checklist de cierre</h2>
        </div>
        {preview && (
          <div className="flex flex-wrap items-center gap-2">
            {preview.blockers.length > 0 && (
              <span className="text-xs font-semibold text-[var(--color-danger-700)]">
                {preview.blockers.length} bloqueante{preview.blockers.length !== 1 ? "s" : ""}
              </span>
            )}
            {preview.warnings.length > 0 && (
              <span className="text-xs font-semibold text-[var(--color-warning-700)]">
                {preview.warnings.length} advertencia{preview.warnings.length !== 1 ? "s" : ""}
              </span>
            )}
            {preview.canClose && (
              <span className="hm-chip hm-chip-success text-xs">Puede cerrar</span>
            )}
          </div>
        )}
      </div>

      <div className="p-4">
        {!preview ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--color-border)] px-6 py-8 text-center">
            <ClipboardList className="text-[var(--color-text-muted)] opacity-40" style={{ width: "2rem", height: "2rem" }} />
            <div>
              <p className="text-sm font-semibold text-[var(--color-text-secondary)]">Previsualiza el cierre</p>
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">Se calcularán bloqueantes y advertencias antes de cerrar el día.</p>
            </div>
            {onPreview && (
              <Button variant="secondary" size="sm" onClick={onPreview}>Previsualizar ahora</Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {preview.blockers.length > 0 && (
              <section>
                <p className="mb-2 text-[0.625rem] font-bold uppercase tracking-[0.12em] text-[var(--color-danger-700)] flex items-center gap-1.5">
                  <XCircle style={{ width: "0.75rem", height: "0.75rem" }} />
                  Bloqueantes — deben resolverse
                </p>
                <ul className="space-y-2">
                  {preview.blockers.map((item) => <ChecklistRow key={item.key} item={item} />)}
                </ul>
              </section>
            )}
            {preview.warnings.length > 0 && (
              <section>
                <p className="mb-2 text-[0.625rem] font-bold uppercase tracking-[0.12em] text-[var(--color-warning-700)] flex items-center gap-1.5">
                  <AlertTriangle style={{ width: "0.75rem", height: "0.75rem" }} />
                  Advertencias — requieren nota
                </p>
                <ul className="space-y-2">
                  {preview.warnings.map((item) => <ChecklistRow key={item.key} item={item} />)}
                </ul>
              </section>
            )}
            {preview.ok.length > 0 && (
              <section>
                <p className="mb-2 text-[0.625rem] font-bold uppercase tracking-[0.12em] text-[var(--color-success-700)] flex items-center gap-1.5">
                  <CheckCircle2 style={{ width: "0.75rem", height: "0.75rem" }} />
                  Verificado
                </p>
                <ul className="space-y-2">
                  {preview.ok.map((item) => <ChecklistRow key={item.key} item={item} />)}
                </ul>
              </section>
            )}
            {allItems.length === 0 && (
              <p className="text-sm text-[var(--color-text-muted)]">Sin items para mostrar.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
