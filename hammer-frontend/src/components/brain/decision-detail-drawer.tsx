"use client";

import { AlertTriangle, CalendarClock, CheckCircle2, PackageSearch, Store, UserRound, X } from "lucide-react";
import { DecisionActionButtons, type BrainDecisionAction } from "@/components/brain/decision-action-buttons";
import { DecisionEvidence } from "@/components/brain/decision-evidence";
import { DecisionTimeline } from "@/components/brain/decision-timeline";
import type { BrainDecision } from "@/components/brain/decision-card";
import { money } from "@/lib/format";

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
    if (action.includes("PRICE") || action.includes("PRICING") || action.includes("CATEGORY_POLICY")) {
      window.location.href = "/app/master/expenses";
      return;
    }
    if (action.includes("INVENTORY") || action.includes("REORDER") || action.includes("STOCK")) {
      window.location.href = "/app/master/reorder";
      return;
    }
    if (action.includes("CASH") || action.includes("DISCOUNT")) {
      window.location.href = "/app/master/discounts";
      return;
    }
    if (action.includes("CONFIG") || action.includes("PRINT")) {
      window.location.href = "/app/master/settings/print";
      return;
    }
    onAction?.("manual-review");
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="h-full w-full max-w-3xl overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap gap-2 text-xs font-bold uppercase">
                <span className="rounded-full bg-red-50 px-2.5 py-1 text-red-700">{decision.severity}</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">{decision.category}</span>
                <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-700">{decision.status}</span>
              </div>
              <h2 className="mt-3 text-2xl font-extrabold leading-tight text-slate-950">{decision.title}</h2>
            </div>
            <button type="button" className="rounded-xl border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-50" onClick={onClose} aria-label="Cerrar detalle">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="space-y-5 p-5">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <InfoTile icon={AlertTriangle} label="Impacto" value={money(decision.estimatedImpactAmount ?? decision.impactAmount)} />
            <InfoTile icon={CalendarClock} label="Fecha" value={formatDate(decision.lastDetectedAt ?? decision.createdAt)} />
            <InfoTile icon={Store} label="Sucursal" value={decision.branch ? `${decision.branch.code} - ${decision.branch.name}` : "General"} />
            <InfoTile icon={PackageSearch} label="Producto" value={decision.product ? `${decision.product.sku} - ${decision.product.name}` : "No aplica"} />
            <InfoTile icon={AlertTriangle} label="Urgencia" value={String(decision.urgencyScore ?? decision.riskScore ?? "N/D")} />
            <InfoTile icon={CheckCircle2} label="Modulo" value={decision.relatedModule ?? decision.category} />
            <InfoTile icon={CheckCircle2} label="Siguiente accion" value={decision.nextBestAction ?? decision.proposedActionType ?? "N/D"} />
            <InfoTile icon={CheckCircle2} label="Confianza" value={decision.confidenceScore === undefined || decision.confidenceScore === null ? "N/D" : String(decision.confidenceScore)} />
          </section>

          {decision.targetUser ? (
            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <UserRound className="h-4 w-4 text-slate-500" />
                Usuario relacionado
              </div>
              <p className="mt-2 text-sm text-slate-600">{decision.targetUser.fullName ?? decision.targetUser.username}</p>
            </section>
          ) : null}

          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-extrabold text-slate-950">Descripcion</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">{decision.description}</p>
          </section>

          <section className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
            <h3 className="flex items-center gap-2 text-sm font-extrabold text-blue-900">
              <CheckCircle2 className="h-4 w-4" />
              Recomendacion
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-800">{decision.recommendation}</p>
          </section>

          {decision.reasoning?.length ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-extrabold text-slate-950">Razonamiento</h3>
              <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-600">
                {decision.reasoning.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>
          ) : null}

          {decision.recommendedActions?.length ? (
            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-extrabold text-slate-950">Acciones recomendadas</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {decision.recommendedActions.map((action) => (
                  <button key={action} type="button" className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700" onClick={() => handleRecommendedAction(action)}>
                    {labelForAction(action)}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {onAction ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-sm font-extrabold text-slate-950">Acciones disponibles</h3>
              <DecisionActionButtons status={decision.status} busy={Boolean(busy)} onAction={onAction} />
            </section>
          ) : null}

          <DecisionEvidence title="Evidencia completa" value={decision.evidenceJson} />
          <DecisionEvidence title="Evidencia interpretada" value={decision.evidence} />
          <DecisionEvidence title="Fuente de datos" value={decision.sourceJson} />
          <DecisionEvidence title="Accion propuesta" value={decision.proposedActionJson} />
          <DecisionEvidence title="Resultado de ejecucion" value={decision.actionResultJson} />
          <DecisionTimeline logs={decision.actionLogs} />
        </div>
      </div>
    </div>
  );
}

function labelForAction(action: string) {
  if (action.includes("PURCHASE")) return "Crear borrador compra";
  if (action.includes("TRANSFER")) return "Crear borrador traslado";
  if (action.includes("PRICE") || action.includes("PRICING")) return "Abrir pricing";
  if (action.includes("INVENTORY") || action.includes("REORDER") || action.includes("STOCK")) return "Abrir inventario";
  if (action.includes("CASH") || action.includes("DISCOUNT")) return "Revisar caja/descuentos";
  if (action.includes("CONFIG") || action.includes("PRINT")) return "Abrir configuracion";
  return action;
}

function formatDate(value?: string | null) {
  if (!value) return "Sin fecha";
  return new Date(value).toLocaleString("es-NI", { dateStyle: "medium", timeStyle: "short" });
}

function InfoTile({ icon: Icon, label, value }: { icon: typeof AlertTriangle; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-slate-500">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-1 line-clamp-2 text-sm font-bold text-slate-950">{value}</p>
    </div>
  );
}
