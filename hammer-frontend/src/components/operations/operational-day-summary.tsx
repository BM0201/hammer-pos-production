"use client";

import { Badge } from "@/components/ui/badge";
import { Building2, Calendar, Clock, TrendingUp, Wallet, AlertTriangle, CheckCircle2, XCircle, Activity, Truck, Brain } from "lucide-react";

export type OperationalDay = {
  id: string;
  branchId: string;
  businessDate: string;
  status: "OPEN" | "CLOSING" | "CLOSED" | "CANCELLED";
  openedAt: string;
  closedAt?: string | null;
  approvedAt?: string | null;
  salesTotal: string | number;
  paidOrdersTotal: string | number;
  pendingPaymentTotal: string | number;
  expectedCashTotal?: string | number | null;
  countedCashTotal?: string | number | null;
  cashDifferenceTotal?: string | number | null;
  openCashSessionsCount: number;
  autoClosedPendingReviewCount: number;
  pendingDispatchCount: number;
  criticalBrainDecisionCount: number;
  branch?: { id: string; code: string; name: string };
  openedBy?: { username: string; fullName?: string | null };
  approvedBy?: { username: string; fullName?: string | null };
  cashSessions?: CashSessionRow[];
  summaryJson?: {
    paymentsByMethod?: Array<{ method: string; amount: number; count: number }>;
    cashExpensesTotal?: number | string | null;
    cashOutflowsTotal?: number | string | null;
  } | null;
};

export type CashSessionRow = {
  id: string;
  status: string;
  openingAmount: string | number;
  expectedCashAmount?: string | number | null;
  countedCashAmount?: string | number | null;
  differenceAmount?: string | number | null;
  openedAt: string;
  closedAt?: string | null;
  autoClosedAt?: string | null;
  requiresReview: boolean;
  autoClosedBySystem?: boolean;
  physicalCashBox?: { code: string; description?: string | null };
  openedBy?: { username: string; fullName?: string | null };
  closedBy?: { username: string; fullName?: string | null } | null;
};

function money(value: string | number | null | undefined) {
  return new Intl.NumberFormat("es-NI", { style: "currency", currency: "NIO" }).format(Number(value ?? 0));
}

function businessDateDisplay(iso: string) {
  return new Date(iso).toLocaleDateString("es-NI", { timeZone: "UTC", weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

function timeAgo(iso: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `hace ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  return `hace ${Math.floor(minutes / 60)} h`;
}

const STATUS_CONFIG: Record<string, { label: string; badge: "success" | "warning" | "neutral" | "danger"; barColor: string }> = {
  OPEN:      { label: "Abierto",   badge: "success", barColor: "var(--color-success-500)" },
  CLOSING:   { label: "En cierre", badge: "warning", barColor: "var(--color-warning-500)" },
  CLOSED:    { label: "Cerrado",   badge: "neutral",  barColor: "var(--color-text-soft)" },
  CANCELLED: { label: "Cancelado", badge: "danger",   barColor: "var(--color-danger-500)" },
};

type KpiTileProps = {
  label: string;
  value: string | number;
  icon: React.ElementType;
  tone?: "ok" | "alert" | "warn" | "default";
  subtext?: string;
};

function KpiTile({ label, value, icon: Icon, tone = "default", subtext }: KpiTileProps) {
  const styles = {
    ok:      { tile: "hm-kpi-tile border-[var(--color-success-100)] bg-[color-mix(in_srgb,var(--color-success-50)_25%,white)]", bar: "linear-gradient(90deg,var(--color-success-400),var(--color-success-600))", iconBg: "bg-[var(--color-success-50)] border border-[var(--color-success-100)]", iconColor: "text-[var(--color-success-600)]" },
    alert:   { tile: "hm-kpi-tile border-[var(--color-danger-200)] bg-[color-mix(in_srgb,var(--color-danger-50)_35%,white)]",   bar: "linear-gradient(90deg,var(--color-danger-400),var(--color-danger-600))",  iconBg: "bg-[var(--color-danger-50)] border border-[var(--color-danger-100)]",   iconColor: "text-[var(--color-danger-600)]" },
    warn:    { tile: "hm-kpi-tile border-[var(--color-warning-200)] bg-[color-mix(in_srgb,var(--color-warning-50)_30%,white)]", bar: "linear-gradient(90deg,var(--color-warning-400),var(--color-warning-600))", iconBg: "bg-[var(--color-warning-50)] border border-[var(--color-warning-100)]", iconColor: "text-[var(--color-warning-700)]" },
    default: { tile: "hm-kpi-tile", bar: "linear-gradient(90deg,var(--color-info-400),var(--color-info-600))", iconBg: "bg-[var(--color-surface-alt)] border border-[var(--color-border)]", iconColor: "text-[var(--color-text-muted)]" },
  };
  const s = styles[tone];
  return (
    <div className={`${s.tile} hm-shine group`}>
      <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: s.bar }} />
      <div className="flex items-start justify-between gap-2 mt-0.5">
        <div className="min-w-0 flex-1">
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.1em] text-[var(--color-text-muted)] mb-1.5">{label}</p>
          <p className="hm-num-lg">{value}</p>
          {subtext && <p className="mt-1 text-[0.625rem] text-[var(--color-text-soft)] truncate">{subtext}</p>}
        </div>
        <div className={`hm-icon-wrap hm-icon-wrap-md ${s.iconBg} flex-shrink-0 mt-0.5 transition-transform duration-200 group-hover:scale-105`}>
          <Icon className={`${s.iconColor}`} style={{ width: "1rem", height: "1rem" }} />
        </div>
      </div>
    </div>
  );
}

export function OperationalDaySummary({ day }: { day: OperationalDay }) {
  const statusCfg = STATUS_CONFIG[day.status] ?? STATUS_CONFIG.OPEN;
  const diff = Number(day.cashDifferenceTotal ?? 0);
  const cashDiffTone: KpiTileProps["tone"] = Math.abs(diff) > 100 ? "alert" : diff !== 0 ? "warn" : "ok";

  return (
    <section className="space-y-4">
      {/* ── Header card ── */}
      <div className="hm-module-card overflow-hidden">
        {/* Role accent bar */}
        <div className="h-1" style={{ background: `linear-gradient(90deg, ${statusCfg.barColor}, transparent)` }} />
        <div className="hm-module-card-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="hm-icon-wrap hm-icon-wrap-md bg-[var(--color-info-50)] border border-[var(--color-info-100)] flex-shrink-0">
              <Building2 className="text-[var(--color-info-600)]" style={{ width: "1.125rem", height: "1.125rem" }} />
            </div>
            <div className="min-w-0">
              <p className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-[var(--color-text-muted)]">Día Operativo 360</p>
              <h1 className="text-lg font-extrabold text-[var(--color-text)] leading-tight truncate">
                {day.branch?.code ?? "SUC"} — {day.branch?.name ?? day.branchId}
              </h1>
            </div>
          </div>
          <Badge variant={statusCfg.badge} className="flex-shrink-0">{statusCfg.label}</Badge>
        </div>

        <div className="px-5 py-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[0.75rem] text-[var(--color-text-muted)] border-t border-[var(--color-border)] bg-[var(--color-surface-muted)]">
          <span className="flex items-center gap-1.5">
            <Calendar style={{ width: "0.875rem", height: "0.875rem" }} />
            {businessDateDisplay(day.businessDate)}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock style={{ width: "0.875rem", height: "0.875rem" }} />
            Abierto por <strong className="text-[var(--color-text-secondary)]">{day.openedBy?.fullName ?? day.openedBy?.username ?? "usuario"}</strong> · {timeAgo(day.openedAt)}
          </span>
          {day.approvedBy && (
            <span className="flex items-center gap-1.5 text-[var(--color-success-700)]">
              <CheckCircle2 style={{ width: "0.875rem", height: "0.875rem" }} />
              Aprobado por <strong>{day.approvedBy.fullName ?? day.approvedBy.username}</strong>
            </span>
          )}
        </div>
      </div>

      {/* ── KPI groups ── */}
      {/* Finanzas */}
      <div className="space-y-2">
        <p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-[var(--color-text-muted)] flex items-center gap-1.5">
          <TrendingUp style={{ width: "0.75rem", height: "0.75rem" }} />
          Finanzas
        </p>
        <div className="hm-kpi-grid">
          <KpiTile label="Ventas totales"   value={money(day.salesTotal)}          icon={TrendingUp} tone="default" />
          <KpiTile label="Pagadas"          value={money(day.paidOrdersTotal)}      icon={CheckCircle2} tone="ok" />
          <KpiTile label="Pendiente pago"   value={money(day.pendingPaymentTotal)}  icon={Activity}
            tone={Number(day.pendingPaymentTotal) > 0 ? "warn" : "ok"}
            subtext={Number(day.pendingPaymentTotal) > 0 ? "Resolver antes de cerrar" : undefined}
          />
        </div>
      </div>

      {/* Caja */}
      <div className="space-y-2">
        <p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-[var(--color-text-muted)] flex items-center gap-1.5">
          <Wallet style={{ width: "0.75rem", height: "0.75rem" }} />
          Caja
        </p>
        <div className="hm-kpi-grid">
          <KpiTile label="Cajas abiertas"      value={day.openCashSessionsCount}          icon={Wallet}
            tone={
              day.openCashSessionsCount === 0
                ? "ok"
                : day.status === "CLOSING" || day.status === "CLOSED"
                  ? "alert"
                  : "default"
            }
            subtext={
              day.openCashSessionsCount === 0
                ? "Sin cajas abiertas"
                : day.status === "CLOSING" || day.status === "CLOSED"
                  ? "Bloquea el cierre"
                  : "En uso — operación normal"
            }
          />
          <KpiTile label="Auto-cierre pendiente" value={day.autoClosedPendingReviewCount} icon={AlertTriangle}
            tone={day.autoClosedPendingReviewCount > 0 ? "alert" : "ok"}
            subtext={day.autoClosedPendingReviewCount > 0 ? "Requieren revisión" : undefined}
          />
          <KpiTile label="Diferencia de caja"  value={money(day.cashDifferenceTotal)}     icon={XCircle}
            tone={cashDiffTone}
            subtext={Math.abs(diff) > 100 ? "Diferencia alta — requiere nota" : diff !== 0 ? "Diferencia pequeña" : "Sin diferencia"}
          />
          <KpiTile label="Gastos / egresos de caja" value={money(day.summaryJson?.cashOutflowsTotal)} icon={Wallet}
            tone="default"
            subtext={
              Number(day.summaryJson?.cashExpensesTotal ?? 0) > 0
                ? `Gastos: ${money(day.summaryJson?.cashExpensesTotal)}`
                : "Sin gastos registrados"
            }
          />
        </div>
      </div>

      {/* Operaciones */}
      <div className="space-y-2">
        <p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-[var(--color-text-muted)] flex items-center gap-1.5">
          <Activity style={{ width: "0.75rem", height: "0.75rem" }} />
          Operaciones
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <KpiTile label="Despachos pendientes"  value={day.pendingDispatchCount}       icon={Truck}
            tone={day.pendingDispatchCount > 2 ? "warn" : day.pendingDispatchCount > 0 ? "default" : "ok"}
          />
          <KpiTile label="Brain crítico"         value={day.criticalBrainDecisionCount} icon={Brain}
            tone={day.criticalBrainDecisionCount > 0 ? "warn" : "ok"}
            subtext={day.criticalBrainDecisionCount > 0 ? "Decisiones críticas pendientes" : undefined}
          />
        </div>
      </div>
    </section>
  );
}
