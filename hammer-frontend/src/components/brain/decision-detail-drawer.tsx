"use client";

import { AlertTriangle, CalendarClock, CheckCircle2, PackageSearch, Store, UserRound, X } from "lucide-react";
import { DecisionActionButtons, type BrainDecisionAction } from "@/components/brain/decision-action-buttons";
import { DecisionEvidence } from "@/components/brain/decision-evidence";
import { DecisionTimeline } from "@/components/brain/decision-timeline";
import type { BrainDecision } from "@/components/brain/decision-card";
import { money } from "@/lib/format";

const severityChip: Record<string, string> = {
  CRITICAL: "bg-[var(--color-danger-50)] text-[var(--color-danger-700)]",
  HIGH:     "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
  MEDIUM:   "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
  LOW:      "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]",
  INFO:     "bg-[var(--color-info-50)] text-[var(--color-info-700)]",
};

const statusChipMap: Record<string, string> = {
  OPEN:          "bg-[var(--color-master-50)] text-[var(--color-master-700)]",
  APPROVED:      "bg-[var(--color-success-50)] text-[var(--color-success-700)]",
  MANUAL_REVIEW: "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
  EXECUTING:     "bg-[var(--color-info-50)] text-[var(--color-info-700)]",
  EXECUTED:      "bg-[var(--color-success-50)] text-[var(--color-success-700)]",
  DISMISSED:     "bg-[var(--color-surface-alt)] text-[var(--color-text-soft)]",
  SNOOZED:       "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]",
  FAILED:        "bg-[var(--color-danger-50)] text-[var(--color-danger-700)]",
  EXPIRED:       "bg-[var(--color-surface-alt)] text-[var(--color-text-soft)]",
};

export function DecisionDetailDrawer({
  decision,
  open,
  busy,
  onClose,
  onAction,
}: {
  decision: BrainDecision;
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onAction?: (action: BrainDecisionAction) => void;
}) {
  if (!open) return null;

  function handleRecommendedAction(action: string) {
    if (action.includes("PURCHASE")) {
      if (window.confirm("Crear o preparar borrador de compra desde esta decision?")) onAction?.("execute");
      return;
    }
    if (action.includes("TRANSFER")) {
      if (window.confirm("Crear o preparar borrador de traslado desde esta decision?")) onAction?.("execute");
      return;
    }
    if (action.includes("RECALCULATE_CASH") || action.includes("REFRESH_OPERATIONAL_DAY")) {
      if (window.confirm("Ejecutar recalculo desde esta decision?")) onAction?.("execute");
      return;
    }
    if (action.includes("PRICE") || action.includes("PRICING") || action.includes("CATEGORY_POLICY")) {
      window.location.href = "/app/master/pricing";
      return;
    }
    if (action.includes("INVENTORY") || action.includes("REORDER") || action.includes("STOCK")) {
      window.location.href = "/app/master/reorder";
      return;
    }
    if (action.includes("CASH") || action.includes("REVIEW_CASH")) {
      window.location.href = "/app/branch/cash";
      return;
    }
    if (action.includes("DISCOUNT")) {
      window.location.href = "/app/master/discounts";
      return;
    }
    if (action.includes("CONFIG") || action.includes("PRINT")) {
      window.location.href = "/app/master/settings/print";
      return;
    }
    onAction?.("manual-review");
  }

  const sevClass = severityChip[decision.severity] ?? "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]";
  const stsClass = statusChipMap[decision.status] ?? "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]";

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="h-full w-full max-w-3xl overflow-y-auto bg-[var(--color-surface)] shadow-[var(--shadow-modal)]">
        {/* Sticky header */}
        <div className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-surface)]/95">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap gap-2 text-xs font-bold uppercase">
                <span className={`rounded-full px-2.5 py-1 ${sevClass}`}>{decision.severity}</span>
                <span className="rounded-full bg-[var(--color-surface-alt)] px-2.5 py-1 text-[var(--color-text-secondary)]">{decision.category}</span>
                <span className={`rounded-full px-2.5 py-1 ${stsClass}`}>{decision.status}</span>
              </div>
              <h2 className="mt-3 text-2xl font-extrabold leading-tight text-[var(--color-text)]">{decision.title}</h2>
            </div>
            <button
              type="button"
              className="rounded-xl border border-[var(--color-border)] p-2 text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface-alt)]"
              onClick={onClose}
              aria-label="Cerrar detalle"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="space-y-5 p-5">
          {/* Info tiles grid */}
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <InfoTile icon={AlertTriangle} label="Impacto"        value={money(decision.estimatedImpactAmount ?? decision.impactAmount)} />
            <InfoTile icon={CalendarClock} label="Fecha"          value={formatDate(decision.lastDetectedAt ?? decision.createdAt)} />
            <InfoTile icon={Store}         label="Sucursal"       value={decision.branch ? `${decision.branch.code} - ${decision.branch.name}` : "General"} />
            <InfoTile icon={PackageSearch} label="Producto"       value={decision.product ? `${decision.product.sku} - ${decision.product.name}` : "No aplica"} />
            <InfoTile icon={AlertTriangle} label="Urgencia"       value={String(decision.urgencyScore ?? decision.riskScore ?? "N/D")} />
            <InfoTile icon={CheckCircle2}  label="Modulo"         value={decision.relatedModule ?? decision.category} />
            <InfoTile icon={CheckCircle2}  label="Siguiente accion" value={decision.nextBestAction ?? decision.proposedActionType ?? "N/D"} />
            <InfoTile icon={CheckCircle2}  label="Confianza"      value={decision.confidenceScore === undefined || decision.confidenceScore === null ? "N/D" : String(decision.confidenceScore)} />
          </section>

          {decision.targetUser ? (
            <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-[var(--color-text)]">
                <UserRound className="h-4 w-4 text-[var(--color-text-muted)]" />
                Usuario relacionado
              </div>
              <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                {decision.targetUser.fullName ?? decision.targetUser.username}
              </p>
            </section>
          ) : null}

          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <h3 className="text-sm font-extrabold text-[var(--color-text)]">Descripcion</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">{decision.description}</p>
          </section>

          <section className="rounded-2xl border border-[var(--color-master-100)] bg-[var(--color-master-50)] p-4">
            <h3 className="flex items-center gap-2 text-sm font-extrabold text-[var(--color-master-700)]">
              <CheckCircle2 className="h-4 w-4" />
              Recomendacion
            </h3>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text)]">{decision.recommendation}</p>
          </section>

          {decision.reasoning?.length ? (
            <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h3 className="text-sm font-extrabold text-[var(--color-text)]">Razonamiento</h3>
              <ul className="mt-2 space-y-2 text-sm leading-6 text-[var(--color-text-secondary)]">
                {decision.reasoning.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>
          ) : null}

          {decision.recommendedActions?.length ? (
            <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-4">
              <h3 className="text-sm font-extrabold text-[var(--color-text)]">Acciones recomendadas</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {decision.recommendedActions.map((action) => (
                  <button
                    key={action}
                    type="button"
                    className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-bold text-[var(--color-text-secondary)] transition hover:border-[var(--color-master-200)] hover:bg-[var(--color-master-50)] hover:text-[var(--color-master-700)]"
                    onClick={() => handleRecommendedAction(action)}
                  >
                    {labelForAction(action)}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {onAction ? (
            <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h3 className="mb-3 text-sm font-extrabold text-[var(--color-text)]">Acciones disponibles</h3>
              <DecisionActionButtons
                status={decision.status}
                proposedActionType={decision.proposedActionType}
                actionMode={decision.actionMode}
                busy={Boolean(busy)}
                onAction={onAction}
              />
            </section>
          ) : null}

          <DecisionEvidence title="Evidencia completa"      value={decision.evidenceJson} />
          <DecisionEvidence title="Evidencia interpretada" value={decision.evidence} />
          <DecisionEvidence title="Fuente de datos"         value={decision.sourceJson} />
          <DecisionEvidence title="Accion propuesta"        value={decision.proposedActionJson} />
          <DecisionEvidence title="Resultado de ejecucion"  value={decision.actionResultJson} />
          <DecisionTimeline logs={decision.actionLogs} />
        </div>
      </div>
    </div>
  );
}

function labelForAction(action: string) {
  if (action.includes("PURCHASE")) return "Crear borrador compra";
  if (action.includes("TRANSFER")) return "Crear borrador traslado";
  if (action.includes("RECALCULATE_CASH") || action.includes("REFRESH_OPERATIONAL_DAY")) return "Recalcular";
  if (action.includes("PRICE") || action.includes("PRICING")) return "Abrir pricing";
  if (action.includes("INVENTORY") || action.includes("REORDER") || action.includes("STOCK")) return "Abrir inventario";
  if (action.includes("REVIEW_CASH") || action.includes("CASH")) return "Ir a Caja";
  if (action.includes("DISCOUNT")) return "Revisar descuentos";
  if (action.includes("CONFIG") || action.includes("PRINT")) return "Abrir configuracion";
  return action;
}

function formatDate(value?: string | null) {
  if (!value) return "Sin fecha";
  return new Date(value).toLocaleString("es-NI", { dateStyle: "medium", timeStyle: "short" });
}

function InfoTile({ icon: Icon, label, value }: { icon: typeof AlertTriangle; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-[var(--color-text-muted)]">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-1 line-clamp-2 text-sm font-bold text-[var(--color-text)]">{value}</p>
    </div>
  );
}
