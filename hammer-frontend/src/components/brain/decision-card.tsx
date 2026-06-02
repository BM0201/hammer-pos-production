"use client";

import { useState } from "react";
import { AlertOctagon, AlertTriangle, ArrowRight, BadgeCheck, Clock, Eye, FileText, Gauge, Target, Zap } from "lucide-react";
import { DecisionActionButtons, type BrainDecisionAction } from "@/components/brain/decision-action-buttons";
import { DecisionDetailDrawer } from "@/components/brain/decision-detail-drawer";
import { money as formatMoney } from "@/lib/format";
import { DecisionEvidence } from "@/components/brain/decision-evidence";
import type { BrainDecisionLog } from "@/components/brain/decision-timeline";

export type BrainDecisionOutcome = {
  id: string;
  outcomeType: string;
  measuredAt: string;
  expectedImpact?: string | number | null;
  actualImpact?: string | number | null;
  successScore?: string | number | null;
};

export type BrainDecision = {
  id: string;
  category: string;
  severity: string;
  status: string;
  title: string;
  description: string;
  recommendation: string;
  confidenceScore?: string | number | null;
  urgencyScore?: string | number | null;
  estimatedImpactAmount?: string | number | null;
  nextBestAction?: string | null;
  recommendedActions?: string[];
  reasoning?: string[];
  evidence?: Record<string, unknown>;
  relatedModule?: "PRICING" | "INVENTORY" | "PURCHASING" | "TRANSFERS" | "CASH" | "CONFIG" | string;
  impactAmount?: string | number | null;
  riskScore?: string | number | null;
  priorityScore?: string | number | null;
  evidenceJson?: unknown;
  sourceJson?: unknown;
  proposedActionJson?: unknown;
  actionResultJson?: unknown;
  proposedActionType?: string | null;
  createdAt: string;
  firstDetectedAt?: string | null;
  lastDetectedAt?: string | null;
  expiresAt?: string | null;
  branch?: { id: string; code: string; name: string } | null;
  product?: { id: string; sku: string; name: string; unit: string } | null;
  targetUser?: { id: string; username: string; fullName?: string | null } | null;
  actionLogs?: BrainDecisionLog[];
  outcomes?: BrainDecisionOutcome[];
};

type DecisionCardProps = {
  decision: BrainDecision;
  busy: boolean;
  onAction: (decisionId: string, action: BrainDecisionAction) => void;
};

const severityStyles: Record<string, { badge: string; rail: string; icon: typeof AlertTriangle; label: string }> = {
  CRITICAL: {
    badge: "border-red-200 bg-red-50 text-red-700",
    rail: "bg-red-500",
    icon: AlertOctagon,
    label: "Critica",
  },
  HIGH: {
    badge: "border-amber-200 bg-amber-50 text-amber-800",
    rail: "bg-amber-500",
    icon: AlertTriangle,
    label: "Alta",
  },
  MEDIUM: {
    badge: "border-orange-200 bg-orange-50 text-orange-700",
    rail: "bg-orange-500",
    icon: Gauge,
    label: "Media",
  },
  LOW: {
    badge: "border-slate-200 bg-slate-50 text-slate-600",
    rail: "bg-slate-400",
    icon: BadgeCheck,
    label: "Baja",
  },
  INFO: {
    badge: "border-blue-200 bg-blue-50 text-blue-700",
    rail: "bg-blue-500",
    icon: FileText,
    label: "Info",
  },
};

const statusLabels: Record<string, string> = {
  OPEN: "Abierta",
  APPROVED: "Aprobada",
  MANUAL_REVIEW: "Revision manual",
  EXECUTING: "Ejecutando",
  EXECUTED: "Ejecutada",
  DISMISSED: "Descartada",
  SNOOZED: "Pospuesta",
  FAILED: "Fallida",
  EXPIRED: "Expirada",
};

function asNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function scorePercent(value: string | number | null | undefined) {
  const number = asNumber(value);
  return Math.round(number <= 1 ? number * 100 : number);
}

function formatDate(value?: string | null) {
  if (!value) return "Sin fecha";
  return new Date(value).toLocaleString("es-NI", { dateStyle: "short", timeStyle: "short" });
}

export function DecisionCard({ decision, busy, onAction }: DecisionCardProps) {
  const [showEvidence, setShowEvidence] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const entity = decision.product?.sku ?? decision.targetUser?.username ?? decision.branch?.code ?? "General";
  const style = severityStyles[decision.severity] ?? severityStyles.INFO;
  const SeverityIcon = style.icon;

  return (
    <article className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:border-blue-200 hover:shadow-xl hover:shadow-blue-500/10">
      <div className={`absolute inset-y-0 left-0 w-1.5 ${style.rail}`} />
      <div className="p-4 pl-5 lg:p-5 lg:pl-6">
        <div className="grid gap-5 xl:grid-cols-[1fr_260px]">
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${style.badge}`}>
                <SeverityIcon className="h-3.5 w-3.5" />
                {style.label}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 uppercase text-slate-600">{decision.category}</span>
              <span className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-indigo-700">{statusLabels[decision.status] ?? decision.status}</span>
              <span className="inline-flex items-center gap-1 text-slate-500">
                <Clock className="h-3.5 w-3.5" />
                {formatDate(decision.lastDetectedAt ?? decision.createdAt)}
              </span>
            </div>

            <button type="button" className="block w-full text-left" onClick={() => setDetailOpen(true)}>
              <div className="flex gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-extrabold leading-snug text-slate-950 transition group-hover:text-blue-700">{decision.title}</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{decision.description}</p>
                </div>
                <ArrowRight className="mt-1 h-5 w-5 flex-shrink-0 text-slate-300 transition group-hover:translate-x-1 group-hover:text-blue-600" />
              </div>
            </button>

            <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm leading-6 text-slate-800">
              <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-blue-700">
                <Zap className="h-3.5 w-3.5" />
                Accion sugerida
              </div>
              {decision.recommendation}
            </div>

            <div className="flex flex-wrap gap-2 text-xs text-slate-600">
              {decision.branch ? <InfoChip label="Sucursal" value={`${decision.branch.code} - ${decision.branch.name}`} /> : null}
              {decision.product ? <InfoChip label="Producto" value={`${decision.product.sku} - ${decision.product.name}`} /> : null}
              {decision.targetUser ? <InfoChip label="Usuario" value={decision.targetUser.fullName ?? decision.targetUser.username} /> : null}
              {decision.proposedActionType ? <InfoChip label="Accion" value={decision.proposedActionType} /> : null}
              <InfoChip label="Entidad" value={entity} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4 xl:grid-cols-1">
            <Metric icon={Target} label="Impacto" value={formatMoney(decision.estimatedImpactAmount ?? decision.impactAmount)} />
            <Metric icon={BadgeCheck} label="Confianza" value={`${scorePercent(decision.confidenceScore)}%`} />
            <Metric icon={Gauge} label="Urgencia" value={Math.round(asNumber(decision.urgencyScore ?? decision.riskScore))} />
            <Metric icon={AlertTriangle} label="Prioridad" value={Math.round(asNumber(decision.priorityScore))} />
          </div>
        </div>

        {(decision.nextBestAction || decision.reasoning?.length) ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
            {decision.nextBestAction ? (
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Siguiente mejor accion: <span className="text-blue-700">{decision.nextBestAction}</span></div>
            ) : null}
            {decision.reasoning?.length ? (
              <ul className="space-y-1 text-xs leading-5 text-slate-600">
                {decision.reasoning.slice(0, 2).map((line) => <li key={line}>{line}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}

        {showEvidence ? (
          <div className="mt-4">
            <DecisionEvidence value={decision.evidenceJson} />
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50" onClick={() => setShowEvidence((value) => !value)}>
            <Eye className="h-4 w-4" />
            {showEvidence ? "Ocultar evidencia" : "Ver evidencia"}
          </button>
          <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50" onClick={() => setDetailOpen(true)}>
            <FileText className="h-4 w-4" />
            Detalle
          </button>
          <DecisionActionButtons status={decision.status} busy={busy} onAction={(action) => onAction(decision.id, action)} />
        </div>
      </div>

      <DecisionDetailDrawer decision={decision} open={detailOpen} busy={busy} onClose={() => setDetailOpen(false)} onAction={(action) => onAction(decision.id, action)} />
    </article>
  );
}

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
      <strong className="text-slate-500">{label}:</strong> {value}
    </span>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Target; label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-3 shadow-sm">
      <div className="flex items-center justify-center gap-1 text-[11px] font-bold uppercase text-slate-500 xl:justify-start">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-base font-extrabold text-slate-950">{value}</div>
    </div>
  );
}
