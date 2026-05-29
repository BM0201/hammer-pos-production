"use client";

import { DecisionEvidence } from "@/components/brain/decision-evidence";
import { DecisionTimeline } from "@/components/brain/decision-timeline";
import type { BrainDecision } from "@/components/brain/decision-card";

export function DecisionDetailDrawer({ decision, open, onClose }: { decision: BrainDecision; open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" role="dialog" aria-modal="true">
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-[var(--color-surface)] p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] pb-4">
          <div>
            <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">Detalle de decisión</p>
            <h2 className="mt-1 text-xl font-semibold text-[var(--color-text)]">{decision.title}</h2>
          </div>
          <button type="button" className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-muted)]" onClick={onClose}>Cerrar</button>
        </div>

        <div className="space-y-5 py-4">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">Recomendación</h3>
            <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm leading-6 text-[var(--color-text)]">{decision.recommendation}</p>
          </section>
          <DecisionEvidence title="Evidencia completa" value={decision.evidenceJson} />
          <DecisionEvidence title="Fuente de datos" value={decision.sourceJson} />
          <DecisionEvidence title="Acción propuesta" value={decision.proposedActionJson} />
          <DecisionEvidence title="Resultado de ejecución" value={decision.actionResultJson} />
          <DecisionTimeline logs={decision.actionLogs} />
        </div>
      </div>
    </div>
  );
}
