"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  CreditCard,
  PackageX,
  Receipt,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Wallet,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { apiFetch, unwrapApiData, type ApiResponse } from "@/lib/client/api";
import { money, fmtTimeShort, qty2 } from "@/lib/format";
import { getActiveBranchId } from "@/lib/client/active-branch";
import { useSession } from "@/lib/client/session";
import { useOperationalPolling } from "@/lib/realtime/use-operational-polling";
import { components } from "@/styles/design-system";

/* "Mi día" de la caja — GET /api/branch/dashboard (getBranchDayView). Cada
 * sección llega solo si el usuario tiene permiso para lo que muestra. */

type PendingKey = "payments" | "myDrafts" | "dispatches" | "transports" | "approvals";

type StockLevel = "out" | "short" | "watch" | "ok";

type DayView = {
  branchName: string;
  businessDate: string;
  cashSessions: Array<{
    id: string;
    status: "OPEN" | "RECONCILING" | "AUTO_CLOSED_PENDING_REVIEW";
    openedAt: string;
    boxCode: string;
    boxName: string | null;
    openedByName: string;
    expectedCash: number | null;
  }> | null;
  sales: {
    paidTotal: number;
    paidCount: number;
    averageTicket: number;
    byMethod: Array<{ method: string; amount: number; count: number }>;
    cancelledCount: number;
    cancelledTotal: number;
  };
  pending: Array<{ key: PendingKey; count: number }>;
  recentSales: Array<{ paymentId: string; orderNumber: string; amount: number; method: string; paidAt: string }>;
  lowStock: Array<{ productId: string; name: string; unit: string; onHand: number; soldToday: number; daysOfCover: number | null; level: StockLevel }>;
};

const PENDING: Record<PendingKey, { label: (n: number) => string; href: string; icon: ReactNode }> = {
  payments: { label: (n) => (n === 1 ? "Orden por cobrar" : "Órdenes por cobrar"), href: "/app/branch/cashier/payments", icon: <CreditCard className="h-5 w-5" /> },
  myDrafts: { label: (n) => (n === 1 ? "Venta tuya sin terminar" : "Ventas tuyas sin terminar"), href: "/app/branch/sales/orders", icon: <ShoppingCart className="h-5 w-5" /> },
  dispatches: { label: (n) => (n === 1 ? "Despacho pendiente" : "Despachos pendientes"), href: "/app/branch/warehouse/dispatch", icon: <Truck className="h-5 w-5" /> },
  transports: { label: (n) => (n === 1 ? "Transporte por entregar" : "Transportes por entregar"), href: "/app/branch/warehouse/dispatch", icon: <Truck className="h-5 w-5" /> },
  approvals: { label: (n) => (n === 1 ? "Aprobación por revisar" : "Aprobaciones por revisar"), href: "/app/branch/approvals", icon: <ShieldCheck className="h-5 w-5" /> },
};

const METHOD_LABEL: Record<string, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  TRANSFER: "Transferencia",
  CREDIT: "Crédito",
  MIXED: "Mixto",
};

const linkButton = `${components.button.base} ${components.button.secondary} ${components.button.sizes.sm}`;

function Section({ title, icon, action, children, className = "" }: { title: string; icon: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={`flex flex-col gap-3 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
          <span className="text-[var(--color-text-muted)]" aria-hidden>{icon}</span>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

function CashSection({ sessions }: { sessions: NonNullable<DayView["cashSessions"]> }) {
  if (sessions.length === 0) {
    return (
      <Section title="Caja" icon={<Wallet className="h-4 w-4" />}>
        <p className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-text-soft)]" aria-hidden />
          No hay caja abierta.
        </p>
        <Link href="/app/branch/cash" className={`${components.button.base} ${components.button.primary} ${components.button.sizes.md} w-full`}>
          Abrir caja
        </Link>
      </Section>
    );
  }
  return (
    <Section title="Caja" icon={<Wallet className="h-4 w-4" />}>
      <ul className="flex flex-col gap-3">
        {sessions.map((s) => {
          const open = s.status === "OPEN";
          return (
            <li key={s.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                <span className={`h-2.5 w-2.5 rounded-full ${open ? "bg-[var(--color-pay)]" : "bg-[var(--color-warning-500)]"}`} aria-hidden />
                {open ? "Abierta" : s.status === "RECONCILING" ? "En conciliación" : "Cierre automático por revisar"}
                <span className="font-normal text-[var(--color-text-muted)]">· {s.boxName || s.boxCode}</span>
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Desde las {fmtTimeShort(s.openedAt)} · {s.openedByName}
              </p>
              {s.expectedCash !== null ? (
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <span className="text-xs text-[var(--color-text-secondary)]">Efectivo que debe haber en gaveta</span>
                  <span className="text-lg font-bold tabular-nums text-[var(--color-text)]">{money(s.expectedCash)}</span>
                </div>
              ) : open ? (
                // La API lo esconde desde 20 min antes del cierre: conteo a ciegas.
                <p className="mt-2 text-sm font-medium text-[var(--color-warning-700)]">Hora del conteo de cierre: cuenta la gaveta.</p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {sessions.some((s) => s.status === "OPEN" && s.expectedCash === null) ? (
        <Link href={"/app/branch/cash?cerrar=1" as Route} className={`${linkButton} w-full`}>Contar la gaveta</Link>
      ) : (
        <Link href="/app/branch/cash" className={`${linkButton} w-full`}>
          {sessions.every((s) => s.status === "OPEN") ? "Ir a Caja" : "Revisar en Caja"}
        </Link>
      )}
    </Section>
  );
}

function PendingSection({ pending }: { pending: DayView["pending"] }) {
  return (
    <Section title="Lo que falta" icon={<ClipboardCheck className="h-4 w-4" />}>
      {pending.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl bg-[var(--color-success-50)] px-3 py-3 text-sm font-medium text-[var(--color-success-700)]">
          <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
          Todo al día. No hay nada pendiente.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pending.map((p) => {
            const cfg = PENDING[p.key];
            return (
              <li key={p.key}>
                <Link
                  href={cfg.href as Route}
                  className="flex min-h-[52px] items-center gap-3 rounded-xl border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-3 py-2 text-[var(--color-warning-700)] transition-colors hover:border-[var(--color-warning-500)] active:scale-[0.99]"
                >
                  <span aria-hidden>{cfg.icon}</span>
                  <span className="text-xl font-bold tabular-nums">{p.count}</span>
                  <span className="flex-1 text-sm font-medium">{cfg.label(p.count)}</span>
                  <ChevronRight className="h-5 w-5 shrink-0" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function SalesSection({ sales }: { sales: DayView["sales"] }) {
  const max = Math.max(1, ...sales.byMethod.map((m) => m.amount));
  return (
    <Section title="Ventas de hoy" icon={<Receipt className="h-4 w-4" />}>
      <div>
        <p className="text-3xl font-bold tabular-nums text-[var(--color-text)]">{money(sales.paidTotal)}</p>
        <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
          {sales.paidCount === 1 ? "1 venta cobrada" : `${sales.paidCount} ventas cobradas`}
          {sales.paidCount > 0 ? ` · promedio ${money(sales.averageTicket)}` : ""}
        </p>
      </div>
      {sales.byMethod.length > 0 ? (
        <ul className="flex flex-col gap-2.5">
          {sales.byMethod.map((m) => (
            <li key={m.method}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-[var(--color-text-secondary)]">
                  {METHOD_LABEL[m.method] ?? m.method}
                  <span className="ml-1.5 text-xs text-[var(--color-text-muted)]">({m.count})</span>
                </span>
                <span className="font-semibold tabular-nums text-[var(--color-text)]">{money(m.amount)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-alt)]" aria-hidden>
                <div className="h-full rounded-full bg-[var(--color-pay)]" style={{ width: `${(m.amount / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {sales.cancelledCount > 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-[var(--color-danger-600)]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {sales.cancelledCount === 1 ? "1 venta anulada" : `${sales.cancelledCount} ventas anuladas`} ({money(sales.cancelledTotal)})
        </p>
      ) : null}
    </Section>
  );
}

function RecentSalesSection({ recent }: { recent: DayView["recentSales"] }) {
  return (
    <Section title="Últimos cobros" icon={<Receipt className="h-4 w-4" />}>
      {recent.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">Todavía no hay cobros hoy.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {recent.map((s) => (
            <li key={s.paymentId} className="flex items-center gap-3 py-2.5">
              <span className="w-[4.75rem] shrink-0 text-xs tabular-nums text-[var(--color-text-muted)]">{fmtTimeShort(s.paidAt)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[var(--color-text)]">{s.orderNumber}</span>
                <span className="text-xs text-[var(--color-text-muted)]">{METHOD_LABEL[s.method] ?? s.method}</span>
              </span>
              <span className="text-sm font-semibold tabular-nums text-[var(--color-text)]">{money(s.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

const LEVEL_BADGE: Record<StockLevel, string> = {
  out: "bg-[var(--color-danger-50)] text-[var(--color-danger-700)]",
  short: "bg-[var(--color-danger-50)] text-[var(--color-danger-700)]",
  watch: "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
  ok: "bg-[var(--color-success-50)] text-[var(--color-success-700)]",
};

function coverLabel(p: DayView["lowStock"][number]): string {
  if (p.level === "out") return "Agotado";
  if (p.daysOfCover === null) return "Sin ritmo aún";
  if (p.daysOfCover < 1) return "Menos de 1 día";
  if (p.daysOfCover > 60) return "Más de 2 meses";
  const days = Math.floor(p.daysOfCover);
  return `${days} ${days === 1 ? "día" : "días"}`;
}

function StockSection({ items, className }: { items: DayView["lowStock"]; className?: string }) {
  const toOrder = items.filter((p) => p.level === "out" || p.level === "short").length;
  return (
    <Section
      title="Cuánto alcanza"
      icon={<PackageX className="h-4 w-4" />}
      className={className}
      action={toOrder > 0 ? (
        <span className="rounded-full bg-[var(--color-danger-50)] px-2.5 py-1 text-xs font-semibold text-[var(--color-danger-700)]">
          {toOrder} por pedir
        </span>
      ) : null}
    >
      <p className="-mt-1 text-xs text-[var(--color-text-muted)]">Lo vendido hoy y para cuántos días queda, al ritmo de las últimas 2 semanas.</p>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">Todavía no se vende nada hoy.</p>
      ) : (
        <ul className="grid gap-x-6 sm:grid-cols-2">
          {items.map((p) => (
            <li key={p.productId} className="flex items-center gap-3 border-b border-[var(--color-border)] py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[var(--color-text)]" title={p.name}>{p.name}</span>
                <span className="text-xs text-[var(--color-text-muted)]">
                  Hoy {qty2(p.soldToday)} · quedan {qty2(p.onHand)} {p.unit}
                </span>
              </span>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${LEVEL_BADGE[p.level]}`}>
                {coverLabel(p)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export default function BranchDayPage() {
  const sessionState = useSession();
  const [data, setData] = useState<DayView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const branchId = sessionState.status === "authenticated"
    ? getActiveBranchId(sessionState.session.branchIds, sessionState.session.primaryBranchId)
    : "";

  const load = useCallback(async () => {
    if (!branchId) return;
    const requestId = ++requestIdRef.current;
    try {
      const response = await apiFetch(`/api/branch/dashboard?branchId=${encodeURIComponent(branchId)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as ApiResponse<DayView> | DayView;
      if (requestId !== requestIdRef.current) return;
      setData(unwrapApiData<DayView>(payload));
      setUpdatedAt(new Date().toISOString());
      setError(null);
    } catch (e) {
      if (requestId === requestIdRef.current) setError(e instanceof Error ? e.message : "Error");
    }
  }, [branchId]);

  useOperationalPolling({
    task: load,
    intervalMs: 30_000,
    enabled: Boolean(branchId),
    deps: [load],
    onError: () => undefined,
  });

  if (sessionState.status === "loading" || (!data && !error && branchId)) {
    return <p className="animate-pulse text-[var(--color-text-muted)]">Cargando tu día…</p>;
  }
  if (sessionState.status !== "authenticated") {
    return <p className="text-[var(--color-danger-600)]">Sesión no válida.</p>;
  }
  if (!branchId) {
    return <p className="text-[var(--color-danger-600)]">No tienes una sucursal asignada.</p>;
  }
  if (!data) {
    return (
      <Card className="text-center">
        <p className="text-sm text-[var(--color-danger-600)]">No se pudo cargar tu día ({error}).</p>
        <button type="button" onClick={() => void load()} className={`${linkButton} mt-3`}>
          Reintentar
        </button>
      </Card>
    );
  }

  return (
    <section className="flex flex-col gap-4 overflow-y-auto pb-4" data-testid="branch-my-day">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Mi día</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            {data.branchName} · {new Date(`${data.businessDate}T12:00:00`).toLocaleDateString("es-NI", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        {updatedAt ? (
          <p className="text-xs text-[var(--color-text-muted)]" aria-live="polite">
            {error ? "Sin conexión · " : ""}Actualizado {fmtTimeShort(updatedAt)}
          </p>
        ) : null}
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.cashSessions ? <CashSection sessions={data.cashSessions} /> : null}
        <PendingSection pending={data.pending} />
        <SalesSection sales={data.sales} />
        <RecentSalesSection recent={data.recentSales} />
        <StockSection items={data.lowStock} className="md:col-span-2" />
      </div>
    </section>
  );
}
