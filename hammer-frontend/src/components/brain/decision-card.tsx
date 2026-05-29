"use client";

import { useState } from "react";
import { DecisionActionButtons, type BrainDecisionAction } from "@/components/brain/decision-action-buttons";
import { DecisionDetailDrawer } from "@/components/brain/decision-detail-drawer";
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

const severityClasses: Record<string, string> = {
  CRITICAL: "bg-[var(--color-danger-50)] text-[var(--color-danger-700)] border-[var(--color-danger-200)]",
  HIGH: "bg-[var(--color-warning-50)] text-[var(--color-warning-800)] border-[var(--color-warning-200)]",
  MEDIUM: "bg-[var(--color-warning-50)] text-[var(--color-warning-700)] border-[var(--color-warning-200)]",
  LOW: "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] border-[var(--color-border)]",
  INFO: "bg-[var(--color-info-50)] text-[var(--color-info-700)] border-[var(--color-info-200)]",
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

function formatMoney(value: string | number | null | undefined) {
  return new Intl.NumberFormat("es-NI", { style: "currency", currency: "NIO" }).format(asNumber(value));
}

export function DecisionCard({ decision, busy, onAction }: DecisionCardProps) {
  const [showEvidence, setShowEvidence] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const entity = decision.product?.sku ?? decision.targetUser?.username ?? decision.branch?.code ?? "General";

  return (
    <article className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
      <div className="grid gap-4 xl:grid-cols-[1fr_220px]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span className={`rounded-full border px-2 py-1 ${severityClasses[decision.severity] ?? "border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]"}`}>{decision.severity}</span>
            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-2 py-1 text-[var(--color-text-muted)]">{decision.category}</span>
            <span className="rounded-full border border-[var(--color-border)] px-2 py-1 text-[var(--color-text-muted)]">{statusLabels[decision.status] ?? decision.status}</span>
            <span className="text-[var(--color-text-muted)]">{entity}</span>
          </div>

          <div>
            <h2 className="text-base font-semibold text-[var(--color-text)]">{decision.title}</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">{decision.description}</p>
          </div>

          <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm leading-6 text-[var(--color-text)]">{decision.recommendation}</p>

          <div className="flex flex-wrap gap-2 text-xs text-[var(--color-text-muted)]">
            {decision.branch ? <span>Sucursal: {decision.branch.code} - {decision.branch.name}</span> : null}
            {decision.product ? <span>Producto: {decision.product.sku} - {decision.product.name}</span> : null}
            {decision.targetUser ? <span>Usuario: {decision.targetUser.fullName ?? decision.targetUser.username}</span> : null}
            {decision.proposedActionType ? <span>Accion: {decision.proposedActionType}</span> : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4 xl:grid-cols-1">
          <Metric label="Impacto" value={formatMoney(decision.impactAmount)} />
          <Metric label="Confianza" value={`${scorePercent(decision.confidenceScore)}%`} />
          <Metric label="Riesgo" value={Math.round(asNumber(decision.riskScore))} />
          <Metric label="Prioridad" value={Math.round(asNumber(decision.priorityScore))} />
        </div>
      </div>

      {showEvidence ? (
        <div className="mt-4">
          <DecisionEvidence value={decision.evidenceJson} />
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-muted)]" onClick={() => setShowEvidence((value) => !value)}>
          {showEvidence ? "Ocultar evidencia" : "Ver evidencia"}
        </button>
        <button type="button" className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-muted)]" onClick={() => setDetailOpen(true)}>
          Detalle
        </button>
        <DecisionActionButtons status={decision.status} busy={busy} onAction={(action) => onAction(decision.id, action)} />
      </div>

      <DecisionDetailDrawer decision={decision} open={detailOpen} onClose={() => setDetailOpen(false)} />
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-2">
      <div className="text-[11px] font-semibold uppercase text-[var(--color-text-muted)]">{label}</div>
      <div className="mt-1 text-sm font-semibold text-[var(--color-text)]">{value}</div>
    </div>
  );
}
