"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useRef, useState } from "react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import {
  Building2,
  Users,
  Wallet,
  CircleDot,
  RefreshCw,
  ClipboardCheck,
  History,
  AlertTriangle,
  CheckCircle2,
  Banknote,
  Settings,
  AlarmClock,
  Activity,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";

/* Quick access to management screens that were removed from the sidebar:
   the Command Center is now the single entry point for cash/box/user control. */
const MANAGEMENT_LINKS: { href: string; label: string; description: string; icon: LucideIcon }[] = [
  { href: "/app/master/cash-closure-reports", label: "Cierres de Caja", description: "Revisar y aprobar cierres", icon: Wallet },
  { href: "/app/master/cash-boxes", label: "Cajas Físicas", description: "Administrar cajas por sucursal", icon: Settings },
  { href: "/app/master/settings/cash-auto-close", label: "Cierre Automático", description: "Configurar horario de cierre", icon: AlarmClock },
  { href: "/app/master/users/activity", label: "Detalle de usuarios", description: "Actividad y sesiones en detalle", icon: Activity },
  { href: "/app/master/sales-management", label: "Gestión de Ventas", description: "Ver, marcar prueba y anular ventas", icon: ClipboardCheck },
];

/* ──────────────────────────────────────────────────────────────────────── */
/* Types (mirror backend command-center snapshot)                            */
/* ──────────────────────────────────────────────────────────────────────── */

type ConnectedUser = {
  userId: string;
  username: string;
  globalRole: string;
  status: "ONLINE" | "IDLE" | "OFFLINE";
  currentModule: string | null;
  branch: { code: string; name: string } | null;
  lastSeenAt: string | null;
  activeCashSessions: { id: string }[];
};

type BranchBlock = {
  branchId: string;
  branchCode: string;
  branchName: string;
  boxesTotal: number;
  boxesActive: number;
  openSessions: number;
  reconcilingSessions: number;
  pendingReviewSessions: number;
  salesToday: number;
  operationalDay: {
    status: string;
    salesTotal: number;
    expectedCashTotal: number | null;
    countedCashTotal: number | null;
    cashDifferenceTotal: number | null;
    openCashSessionsCount: number;
    autoClosedPendingReviewCount: number;
    pendingDispatchCount: number;
  } | null;
};

type CashClosure = {
  id: string;
  status: string;
  branchCode: string;
  branchName: string;
  boxCode: string;
  boxName: string;
  openedBy: string | null;
  closedBy: string | null;
  openedAt: string;
  closedAt: string | null;
  autoClosedBySystem: boolean;
  requiresReview: boolean;
  openingAmount: number;
  expectedCashAmount: number | null;
  countedCashAmount: number | null;
  differenceAmount: number | null;
};

type CommandCenter = {
  generatedAt: string;
  totals: {
    salesToday: number;
    openSessions: number;
    pendingReviewSessions: number;
    reconcilingSessions: number;
    closuresCompletedToday: number;
    boxesActive: number;
    boxesTotal: number;
    usersOnline: number;
    usersIdle: number;
    usersOffline: number;
  };
  users: {
    summary: { online: number; idle: number; offline: number; openCashSessions: number };
    list: ConnectedUser[];
  };
  byBranch: BranchBlock[];
  cashClosures: {
    pending: CashClosure[];
    completedToday: CashClosure[];
    history: CashClosure[];
  };
};

/* ──────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                   */
/* ──────────────────────────────────────────────────────────────────────── */

const money = (n: number) => `C$${n.toFixed(2)}`;

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(iso).toLocaleDateString("es-NI");
}

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Abierta",
  RECONCILING: "Conciliando",
  AUTO_CLOSED_PENDING_REVIEW: "Pendiente de revisión",
  AUTO_CLOSED: "Cerrada (auto)",
  CLOSED: "Cerrada",
  PERMANENTLY_CLOSED: "Cerrada definitiva",
};

const DAY_STATUS_LABELS: Record<string, string> = {
  OPEN: "Abierto",
  CLOSING: "Cerrando",
  CLOSED: "Cerrado",
  CANCELLED: "Cancelado",
};

function statusBadge(status: string) {
  if (status === "OPEN") return <Badge variant="success">{STATUS_LABELS[status]}</Badge>;
  if (status === "RECONCILING") return <Badge variant="warning">{STATUS_LABELS[status]}</Badge>;
  if (status === "AUTO_CLOSED_PENDING_REVIEW") return <Badge variant="danger">{STATUS_LABELS[status]}</Badge>;
  return <Badge variant="neutral">{STATUS_LABELS[status] ?? status}</Badge>;
}

function presenceDot(status: ConnectedUser["status"]) {
  const color =
    status === "ONLINE" ? "var(--color-success-500)" : status === "IDLE" ? "var(--color-warning-500)" : "var(--color-text-soft)";
  return <CircleDot className="h-3.5 w-3.5" style={{ color }} />;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Cash closures table                                                       */
/* ──────────────────────────────────────────────────────────────────────── */

function ClosuresTable({ rows, showDifference }: { rows: CashClosure[]; showDifference: boolean }) {
  if (rows.length === 0) {
    return (
      <div className="flex items-center gap-2 px-5 py-8 text-sm text-[var(--color-text-muted)] justify-center">
        <CheckCircle2 className="h-4 w-4 text-[var(--color-success-500)]" />
        Sin registros.
      </div>
    );
  }
  return (
    <Table>
      <THead>
        <TR>
          <TH>Sucursal / Caja</TH>
          <TH>Estado</TH>
          <TH>Responsable</TH>
          <TH className="text-right">Esperado</TH>
          <TH className="text-right">Contado</TH>
          {showDifference && <TH className="text-right">Diferencia</TH>}
          <TH className="text-right">Hora</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.id}>
            <TD>
              <div className="flex flex-col">
                <span className="font-medium text-[var(--color-text)]">
                  {r.branchCode} · {r.boxName}
                </span>
                <span className="text-xs text-[var(--color-text-muted)]">{r.branchName}</span>
              </div>
            </TD>
            <TD>
              <div className="flex items-center gap-1.5">
                {statusBadge(r.status)}
                {r.autoClosedBySystem && (
                  <span className="text-[0.625rem] text-[var(--color-text-soft)] uppercase tracking-wide">auto</span>
                )}
              </div>
            </TD>
            <TD className="text-sm text-[var(--color-text-secondary)]">{r.closedBy ?? r.openedBy ?? "—"}</TD>
            <TD className="text-right font-mono text-xs">{r.expectedCashAmount === null ? "—" : money(r.expectedCashAmount)}</TD>
            <TD className="text-right font-mono text-xs">{r.countedCashAmount === null ? "—" : money(r.countedCashAmount)}</TD>
            {showDifference && (
              <TD className="text-right font-mono text-xs">
                {r.differenceAmount === null ? (
                  "—"
                ) : (
                  <span
                    className={
                      Math.abs(r.differenceAmount) < 0.01
                        ? "text-[var(--color-success-600)]"
                        : "text-[var(--color-danger-600)] font-semibold"
                    }
                  >
                    {money(r.differenceAmount)}
                  </span>
                )}
              </TD>
            )}
            <TD className="text-right text-xs text-[var(--color-text-muted)]">{timeAgo(r.closedAt ?? r.openedAt)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Page                                                                      */
/* ──────────────────────────────────────────────────────────────────────── */

type ClosureTab = "pending" | "completedToday" | "history";

export default function MasterCommandCenterPage() {
  const [data, setData] = useState<CommandCenter | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ClosureTab>("pending");
  const mounted = useRef(true);

  const load = useCallback(async (isRefresh: boolean) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await apiFetch("/api/master/command-center");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (mounted.current) {
        setData(unwrapApiData(json) as CommandCenter);
        setError(null);
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    load(false);
    const id = setInterval(() => load(true), 20000);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [load]);

  if (loading) {
    return <p className="text-[var(--color-text-muted)] animate-pulse">Cargando Centro de Comando…</p>;
  }
  if (error && !data) {
    return <p className="text-[var(--color-danger-600)]">No se pudo cargar el Centro de Comando: {error}</p>;
  }
  if (!data) return null;

  const { totals, users, byBranch, cashClosures } = data;
  const closureRows =
    tab === "pending" ? cashClosures.pending : tab === "completedToday" ? cashClosures.completedToday : cashClosures.history;

  const maxSales = Math.max(1, ...byBranch.map((b) => b.salesToday));

  return (
    <section className="space-y-8 animate-fade-in-up">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div
            className="h-8 w-1 rounded-full"
            style={{ background: "linear-gradient(to bottom, var(--color-master-400), var(--color-master-600))" }}
          />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Centro de Comando</h1>
            <p className="text-sm text-[var(--color-text-muted)]">
              Monitoreo en vivo de usuarios, cajas y cierres de todas las sucursales.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
          <span className="inline-flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-success-400)] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--color-success-500)]" />
            </span>
            En vivo
          </span>
          <button
            onClick={() => load(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-alt)] transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Actualizar
          </button>
        </div>
      </div>

      {/* ── Executive KPIs ── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 stagger-children">
        <KpiCard label="Ventas globales (hoy)" value={money(totals.salesToday)} tone="ok" roleAccent="MASTER" />
        <KpiCard
          label="Cajas abiertas"
          value={`${totals.openSessions} / ${totals.boxesActive}`}
          helper="sesiones abiertas / cajas activas"
          tone={totals.openSessions > 0 ? "default" : "ok"}
          roleAccent="MASTER"
        />
        <KpiCard
          label="Cierres por revisar"
          value={totals.pendingReviewSessions}
          tone={totals.pendingReviewSessions > 0 ? "alert" : "ok"}
          roleAccent="MASTER"
        />
        <KpiCard
          label="Usuarios en línea"
          value={totals.usersOnline}
          helper={`${totals.usersIdle} inactivos · ${totals.usersOffline} desconectados`}
          tone="default"
          roleAccent="MASTER"
        />
      </div>

      {/* ── Quick access to management screens (centralized here) ── */}
      <div>
        <div className="flex items-center gap-2.5 mb-3">
          <div className="hm-section-icon hm-section-icon-master">
            <Settings className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Gestión</h2>
            <p className="text-[0.6875rem] text-[var(--color-text-muted)]">
              Acceso directo a cierres, cajas, cierre automático y detalle de usuarios
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {MANAGEMENT_LINKS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href as Route}
                className="group flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 transition-colors hover:border-[var(--color-master-400)] hover:bg-[var(--color-surface-alt)]"
              >
                <div className="hm-section-icon hm-section-icon-master shrink-0">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[var(--color-text)]">{item.label}</p>
                  <p className="truncate text-[0.6875rem] text-[var(--color-text-muted)]">{item.description}</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-text-muted)] transition-transform group-hover:translate-x-0.5" />
              </Link>
            );
          })}
        </div>
      </div>

      {/* ── Branch operational status grid ── */}
      <div>
        <div className="flex items-center gap-2.5 mb-3">
          <div className="hm-section-icon hm-section-icon-master">
            <Building2 className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Estado operativo por sucursal</h2>
            <p className="text-[0.6875rem] text-[var(--color-text-muted)]">Cajas físicas, sesiones y día operativo</p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {byBranch.map((b) => {
            const pct = Math.round((b.salesToday / maxSales) * 100);
            return (
              <Card key={b.branchId}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--color-master-50)] text-[var(--color-master-700)] text-xs font-bold">
                      {b.branchCode}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[var(--color-text)]">{b.branchName}</p>
                      <p className="text-[0.6875rem] text-[var(--color-text-muted)]">
                        {b.operationalDay
                          ? `Día ${DAY_STATUS_LABELS[b.operationalDay.status] ?? b.operationalDay.status}`
                          : "Sin día operativo abierto"}
                      </p>
                    </div>
                  </div>
                  {b.pendingReviewSessions > 0 ? (
                    <Badge variant="danger">
                      <AlertTriangle className="h-3 w-3 mr-1 inline" />
                      {b.pendingReviewSessions} por revisar
                    </Badge>
                  ) : b.openSessions > 0 ? (
                    <Badge variant="success">{b.openSessions} abiertas</Badge>
                  ) : (
                    <Badge variant="neutral">sin actividad</Badge>
                  )}
                </div>

                {/* Sales bar */}
                <div className="mb-3">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-[var(--color-text-muted)]">Ventas hoy</span>
                    <span className="font-mono font-semibold text-[var(--color-text)]">{money(b.salesToday)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--color-surface-alt)] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${pct}%`,
                        background: "linear-gradient(90deg, var(--color-master-400), var(--color-master-600))",
                      }}
                    />
                  </div>
                </div>

                {/* Mini stats */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-[var(--color-surface-alt)] py-2">
                    <p className="text-base font-bold text-[var(--color-text)]">
                      {b.boxesActive}
                      <span className="text-xs font-normal text-[var(--color-text-soft)]">/{b.boxesTotal}</span>
                    </p>
                    <p className="text-[0.625rem] text-[var(--color-text-muted)] uppercase tracking-wide">Cajas</p>
                  </div>
                  <div className="rounded-lg bg-[var(--color-surface-alt)] py-2">
                    <p className="text-base font-bold text-[var(--color-text)]">{b.openSessions}</p>
                    <p className="text-[0.625rem] text-[var(--color-text-muted)] uppercase tracking-wide">Abiertas</p>
                  </div>
                  <div className="rounded-lg bg-[var(--color-surface-alt)] py-2">
                    <p
                      className={`text-base font-bold ${b.reconcilingSessions > 0 ? "text-[var(--color-warning-600)]" : "text-[var(--color-text)]"}`}
                    >
                      {b.reconcilingSessions}
                    </p>
                    <p className="text-[0.625rem] text-[var(--color-text-muted)] uppercase tracking-wide">Conciliando</p>
                  </div>
                </div>

                {b.operationalDay && b.operationalDay.cashDifferenceTotal !== null && (
                  <div className="mt-3 flex items-center justify-between text-xs border-t border-[var(--color-border)] pt-2">
                    <span className="text-[var(--color-text-muted)] inline-flex items-center gap-1">
                      <Banknote className="h-3.5 w-3.5" />
                      Diferencia de caja
                    </span>
                    <span
                      className={`font-mono font-semibold ${
                        Math.abs(b.operationalDay.cashDifferenceTotal) < 0.01
                          ? "text-[var(--color-success-600)]"
                          : "text-[var(--color-danger-600)]"
                      }`}
                    >
                      {money(b.operationalDay.cashDifferenceTotal)}
                    </span>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      {/* ── Cash closures ── */}
      <Card noPadding>
        <div className="flex items-center justify-between px-5 py-3.5 border-b-2 border-[var(--color-border-strong)] flex-wrap gap-3">
          <div className="flex items-center gap-2.5">
            <div className="hm-section-icon hm-section-icon-master">
              <Wallet className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Cierres de Caja</h2>
              <p className="text-[0.6875rem] text-[var(--color-text-muted)]">Pendientes, completados hoy e historial</p>
            </div>
          </div>
          <div className="inline-flex rounded-lg border border-[var(--color-border)] overflow-hidden text-xs font-medium">
            {([
              { key: "pending", label: "Pendientes", icon: ClipboardCheck, count: cashClosures.pending.length },
              { key: "completedToday", label: "Hoy", icon: CheckCircle2, count: cashClosures.completedToday.length },
              { key: "history", label: "Historial", icon: History, count: cashClosures.history.length },
            ] as const).map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 transition-colors ${
                  tab === t.key
                    ? "bg-[var(--color-master-600)] text-white"
                    : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]"
                }`}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
                <span
                  className={`ml-0.5 rounded-full px-1.5 text-[0.625rem] ${
                    tab === t.key ? "bg-white/20" : "bg-[var(--color-surface-alt)]"
                  }`}
                >
                  {t.count}
                </span>
              </button>
            ))}
          </div>
        </div>
        <ClosuresTable rows={closureRows} showDifference={tab !== "pending"} />
      </Card>

      {/* ── Connected users ── */}
      <Card noPadding>
        <div className="flex items-center justify-between px-5 py-3.5 border-b-2 border-[var(--color-border-strong)]">
          <div className="flex items-center gap-2.5">
            <div className="hm-section-icon hm-section-icon-master">
              <Users className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Usuarios conectados</h2>
              <p className="text-[0.6875rem] text-[var(--color-text-muted)]">Presencia y actividad en tiempo real</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="success">{users.summary.online} en línea</Badge>
            <Badge variant="warning">{users.summary.idle} inactivos</Badge>
            <Badge variant="neutral">{users.summary.offline} desconectados</Badge>
          </div>
        </div>
        <Table>
          <THead>
            <TR>
              <TH>Usuario</TH>
              <TH>Rol</TH>
              <TH>Sucursal</TH>
              <TH>Módulo actual</TH>
              <TH className="text-center">Cajas</TH>
              <TH className="text-right">Última actividad</TH>
            </TR>
          </THead>
          <TBody>
            {[...users.list]
              .sort((a, b) => {
                const order = { ONLINE: 0, IDLE: 1, OFFLINE: 2 } as const;
                return order[a.status] - order[b.status];
              })
              .map((u) => (
                <TR key={u.userId}>
                  <TD>
                    <div className="flex items-center gap-2">
                      {presenceDot(u.status)}
                      <span className="font-medium text-[var(--color-text)]">{u.username}</span>
                    </div>
                  </TD>
                  <TD className="text-xs text-[var(--color-text-secondary)]">{u.globalRole}</TD>
                  <TD className="text-xs text-[var(--color-text-secondary)]">{u.branch ? u.branch.code : "—"}</TD>
                  <TD className="text-xs text-[var(--color-text-muted)]">{u.currentModule ?? "—"}</TD>
                  <TD className="text-center">
                    {u.activeCashSessions.length > 0 ? (
                      <Badge variant="info">{u.activeCashSessions.length}</Badge>
                    ) : (
                      <span className="text-[var(--color-text-soft)]">—</span>
                    )}
                  </TD>
                  <TD className="text-right text-xs text-[var(--color-text-muted)]">{timeAgo(u.lastSeenAt)}</TD>
                </TR>
              ))}
          </TBody>
        </Table>
      </Card>
    </section>
  );
}
