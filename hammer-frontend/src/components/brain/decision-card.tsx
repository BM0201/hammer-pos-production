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
  actionMode?: "AUTO_EXECUTABLE" | "MANUAL_REVIEW" | null;
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
    badge: "border-[var(--color-danger-200)] bg-[var(--color-danger-50)] text-[var(--color-danger-700)]",
    rail: "bg-[var(--color-danger-600)]",
    icon: AlertOctagon,
    label: "Critica",
  },
  HIGH: {
    badge: "border-[var(--color-warning-200)] bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
    rail: "bg-[var(--color-warning-600)]",
    icon: AlertTriangle,
    label: "Alta",
  },
  MEDIUM: {
    badge: "border-[var(--color-warning-200)] bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
    rail: "bg-[var(--color-warning-400)]",
    icon: Gauge,
    label: "Media",
  },
  LOW: {
    badge: "border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]",
    rail: "bg-[var(--color-border-strong)]",
    icon: BadgeCheck,
    label: "Baja",
  },
  INFO: {
    badge: "border-[var(--color-info-200)] bg-[var(--color-info-50)] text-[var(--color-info-700)]",
    rail: "bg-[var(--color-info-600)]",
    icon: FileText,
    label: "Info",
  },
};

const statusChip: Record<string, string> = {
  OPEN:          "border-[var(--color-master-200)] bg-[var(--color-master-50)] text-[var(--color-master-700)]",
  APPROVED:      "border-[var(--color-success-200)] bg-[var(--color-success-50)] text-[var(--color-success-700)]",
  MANUAL_REVIEW: "border-[var(--color-warning-200)] bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
  EXECUTING:     "border-[var(--color-info-200)] bg-[var(--color-info-50)] text-[var(--color-info-700)]",
  EXECUTED:      "border-[var(--color-success-200)] bg-[var(--color-success-50)] text-[var(--color-success-700)]",
  DISMISSED:     "border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-soft)]",
  SNOOZED:       "border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]",
  FAILED:        "border-[var(--color-danger-200)] bg-[var(--color-danger-50)] text-[var(--color-danger-700)]",
  EXPIRED:       "border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-soft)]",
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
  const chipClass = statusChip[decision.status] ?? "border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]";

  return (
    <article className="group relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] transition hover:border-[var(--color-master-200)] hover:shadow-[var(--shadow-card-hover)]">
      <div className={`absolute inset-y-0 left-0 w-1.5 ${style.rail}`} />
      <div className="p-4 pl-5 lg:p-5 lg:pl-6">
        <div className="grid gap-5 xl:grid-cols-[1fr_260px]">
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${style.badge}`}>
                <SeverityIcon className="h-3.5 w-3.5" />
                {style.label}
              </span>
              <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-2.5 py-1 uppercase text-[var(--color-text-muted)]">
                {decision.category}
              </span>
              <span className={`rounded-full border px-2.5 py-1 ${chipClass}`}>
                {statusLabels[decision.status] ?? decision.status}
              </span>
              <span className="inline-flex items-center gap-1 text-[var(--color-text-soft)]">
                <Clock className="h-3.5 w-3.5" />
                {formatDate(decision.lastDetectedAt ?? decision.createdAt)}
              </span>
            </div>

            <button type="button" className="block w-full text-left" onClick={() => setDetailOpen(true)}>
              <div className="flex gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-extrabold leading-snug text-[var(--color-text)] transition group-hover:text-[var(--color-master-700)]">
                    {decision.title}
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">{decision.description}</p>
                </div>
                <ArrowRight className="mt-1 h-5 w-5 flex-shrink-0 text-[var(--color-border-strong)] transition group-hover:translate-x-1 group-hover:text-[var(--color-master-600)]" />
              </div>
            </button>

            <div className="rounded-xl border border-[var(--color-master-100)] bg-[var(--color-master-50)] px-4 py-3 text-sm leading-6 text-[var(--color-text)]">
              <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[var(--color-master-700)]">
                <Zap className="h-3.5 w-3.5" />
                Accion sugerida
              </div>
              {decision.recommendation}
            </div>

            <div className="flex flex-wrap gap-2 text-xs text-[var(--color-text-secondary)]">
              {decision.branch ? <InfoChip label="Sucursal" value={`${decision.branch.code} - ${decision.branch.name}`} /> : null}
              {decision.product ? <InfoChip label="Producto" value={`${decision.product.sku} - ${decision.product.name}`} /> : null}
              {decision.targetUser ? <InfoChip label="Usuario" value={decision.targetUser.fullName ?? decision.targetUser.username} /> : null}
              {decision.proposedActionType ? <InfoChip label="Accion" value={decision.proposedActionType} /> : null}
              <InfoChip label="Entidad" value={entity} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4 xl:grid-cols-1">
            <Metric icon={Target}        label="Impacto"   value={formatMoney(decision.estimatedImpactAmount ?? decision.impactAmount)} />
            <Metric icon={BadgeCheck}    label="Confianza" value={`${scorePercent(decision.confidenceScore)}%`} />
            <Metric icon={Gauge}         label="Urgencia"  value={Math.round(asNumber(decision.urgencyScore ?? decision.riskScore))} />
            <Metric icon={AlertTriangle} label="Prioridad" value={Math.round(asNumber(decision.priorityScore))} />
          </div>
        </div>

        {(decision.nextBestAction || decision.reasoning?.length) ? (
          <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3">
            {decision.nextBestAction ? (
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                Siguiente mejor accion:{" "}
                <span className="text-[var(--color-master-700)]">{decision.nextBestAction}</span>
              </div>
            ) : null}
            {decision.reasoning?.length ? (
              <ul className="space-y-1 text-xs leading-5 text-[var(--color-text-secondary)]">
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

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-4">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-bold text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-alt)]"
            onClick={() => setShowEvidence((value) => !value)}
          >
            <Eye className="h-4 w-4" />
            {showEvidence ? "Ocultar evidencia" : "Ver evidencia"}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-bold text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-alt)]"
            onClick={() => setDetailOpen(true)}
          >
            <FileText className="h-4 w-4" />
            Detalle
          </button>
          <DecisionActionButtons
            status={decision.status}
            proposedActionType={decision.proposedActionType}
            actionMode={decision.actionMode}
            busy={busy}
            onAction={(action) => onAction(decision.id, action)}
          />
        </div>
      </div>

      <DecisionDetailDrawer
        decision={decision}
        open={detailOpen}
        busy={busy}
        onClose={() => setDetailOpen(false)}
        onAction={(action) => onAction(decision.id, action)}
      />
    </article>
  );
}

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-1">
      <strong className="text-[var(--color-text-muted)]">{label}:</strong> {value}
    </span>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Target; label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3">
      <div className="flex items-center justify-center gap-1 text-[11px] font-bold uppercase text-[var(--color-text-muted)] xl:justify-start">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-base font-extrabold text-[var(--color-text)]">{value}</div>
    </div>
  );
}
