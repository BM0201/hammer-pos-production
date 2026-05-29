"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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

function row(item: ChecklistItem) {
  return (
    <li key={item.key} className="flex flex-col gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-sm font-semibold text-[var(--color-text)]">{item.label}</div>
        {item.message ? <div className="text-xs text-[var(--color-text-muted)]">{item.message}</div> : null}
      </div>
      <Badge variant={item.status === "OK" ? "success" : item.status === "WARNING" ? "warning" : "danger"}>
        {item.status}{typeof item.count === "number" ? ` · ${item.count}` : ""}
      </Badge>
    </li>
  );
}

export function OperationalDayChecklist({ preview }: { preview: ClosePreview | null }) {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-[var(--color-text)]">Checklist de cierre</h2>
      {!preview ? <p className="mt-2 text-sm text-[var(--color-text-muted)]">Previsualiza el cierre para calcular bloqueantes y advertencias.</p> : null}
      {preview ? (
        <div className="mt-3 space-y-4">
          {preview.blockers.length ? <section><h3 className="mb-2 text-xs font-semibold uppercase text-[var(--color-danger-700)]">Bloqueantes</h3><ul className="space-y-2">{preview.blockers.map(row)}</ul></section> : null}
          {preview.warnings.length ? <section><h3 className="mb-2 text-xs font-semibold uppercase text-[var(--color-warning-700)]">Advertencias</h3><ul className="space-y-2">{preview.warnings.map(row)}</ul></section> : null}
          <section><h3 className="mb-2 text-xs font-semibold uppercase text-[var(--color-success-700)]">OK</h3><ul className="space-y-2">{preview.ok.map(row)}</ul></section>
        </div>
      ) : null}
    </Card>
  );
}
