"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { canInAnyAssignedBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { RoleSummary } from "@/components/dashboard/role-summary";
import {
  Store,
  ArrowRight,
  ShoppingCart,
  CreditCard,
  Truck,
  ShieldCheck,
  ClipboardList,
  BarChart3,
  PackageCheck,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiFetch, unwrapApiData, type ApiResponse } from "@/lib/client/api";
import { money } from "@/lib/format";
import { getActiveBranchId } from "@/lib/client/active-branch";
import { useSession } from "@/lib/client/session";
import type { SessionPayload } from "@/types/auth";

type QuickLink = { href: string; label: string; icon: ReactNode };

type BranchSession = Pick<
  SessionPayload,
  "roleCode" | "globalRoles" | "branchMemberships"
>;

type SalesSummary = {
  draftsOpen: number;
  sentToPayment: number;
  salesToday: number;
};

type CashierSummary = {
  activeSessionCount: number;
  pendingPayments: number;
  lastPayment: { amount: number; paidAt: string; orderNumber: string } | null;
  discrepancyApprovals: number;
};

type WarehouseSummary = {
  pendingDispatches: number;
  recentDispatches: number;
  overrideRequests: number;
};

type BranchAdminSummary = {
  salesToday: number;
  pendingPayments: number;
  pendingDispatches: number;
  pendingApprovals: number;
  criticalInventory: number;
  pendingTransports: number;
  alerts: string[];
};

type PendingTransport = {
  id: string;
  customerName: string;
  status: string;
  saleOrderNumber: string;
  price: number;
  reference: string | null;
  scheduledPaymentTime: string | null;
};

type BranchDashboardResponse =
  | { kind: "SALES"; summary: SalesSummary }
  | { kind: "CASHIER"; summary: CashierSummary }
  | { kind: "WAREHOUSE"; summary: WarehouseSummary }
  | { kind: "BRANCH_ADMIN"; summary: BranchAdminSummary; pendingTransports: PendingTransport[] };

function buildBranchAdminQuickLinks(session: BranchSession): QuickLink[] {
  const links: QuickLink[] = [];

  if (canInAnyAssignedBranch(session, CAPABILITIES.SALES_VIEW)) {
    links.push({
      href: "/app/branch/sales/orders",
      label: "Punto de venta",
      icon: <ShoppingCart className="h-5 w-5" />,
    });
  }
  if (canInAnyAssignedBranch(session, CAPABILITIES.CASH_PAYMENTS_VIEW)) {
    links.push({
      href: "/app/branch/cashier/payments",
      label: "Caja y cobros",
      icon: <CreditCard className="h-5 w-5" />,
    });
  }
  if (canInAnyAssignedBranch(session, CAPABILITIES.DISPATCH_VIEW)) {
    links.push({
      href: "/app/branch/warehouse/dispatch",
      label: "Despacho",
      icon: <Truck className="h-5 w-5" />,
    });
  }
  if (canInAnyAssignedBranch(session, CAPABILITIES.APPROVAL_REQUEST_REVIEW)) {
    links.push({
      href: "/app/branch/approvals",
      label: "Aprobaciones",
      icon: <ShieldCheck className="h-5 w-5" />,
    });
  }
  if (canInAnyAssignedBranch(session, CAPABILITIES.AUDIT_VIEW)) {
    links.push({
      href: "/app/branch/audit",
      label: "Supervisión y bitácora",
      icon: <ClipboardList className="h-5 w-5" />,
    });
  }
  if (canInAnyAssignedBranch(session, CAPABILITIES.REPORTS_EXPORT)) {
    links.push({
      href: "/app/branch/reports",
      label: "Reportes",
      icon: <BarChart3 className="h-5 w-5" />,
    });
  }

  return links;
}

function resolveRoleVariant(session: BranchSession): "SALES" | "CASHIER" | "WAREHOUSE" | "BRANCH_ADMIN" | "MASTER" {
  if (session.roleCode === "MASTER" || session.globalRoles.includes("MASTER")) return "MASTER";

  const hasSales = canInAnyAssignedBranch(session, CAPABILITIES.SALES_VIEW);
  const hasCash = canInAnyAssignedBranch(session, CAPABILITIES.CASH_PAYMENTS_VIEW);
  const hasDispatch = canInAnyAssignedBranch(session, CAPABILITIES.DISPATCH_VIEW);

  if (hasSales && !hasCash && !hasDispatch) return "SALES";
  if (hasCash && !hasSales && !hasDispatch) return "CASHIER";
  if (hasDispatch && !hasSales && !hasCash) return "WAREHOUSE";

  return "BRANCH_ADMIN";
}

export default function BranchPage() {
  const sessionState = useSession();
  const [data, setData] = useState<BranchDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const variant = useMemo(() => {
    if (sessionState.status !== "authenticated") return null;
    return resolveRoleVariant(sessionState.session);
  }, [sessionState]);

  useEffect(() => {
    if (sessionState.status !== "authenticated" || !variant || variant === "MASTER") {
      if (variant === "MASTER") setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    apiFetch("/api/branch/dashboard")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ApiResponse<BranchDashboardResponse> | BranchDashboardResponse>;
      })
      .then((payload) => {
        if (!cancelled) setData(unwrapApiData<BranchDashboardResponse>(payload));
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? "Failed to load dashboard");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionState, variant]);

  if (sessionState.status === "loading") {
    return <p className="text-[var(--color-text-muted)] animate-pulse">Cargando…</p>;
  }
  if (sessionState.status !== "authenticated") {
    return <p className="text-[var(--color-danger-600)]">Sesión no válida.</p>;
  }

  const session = sessionState.session;
  const primaryBranchId = getActiveBranchId(session.branchIds, session.primaryBranchId);

  /* ── MASTER users get redirected ── */
  if (variant === "MASTER") {
    return (
      <section className="min-h-[50vh] flex items-center justify-center">
        <Card className="p-8 text-center max-w-md animate-scale-in">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-[var(--color-master-50)] flex items-center justify-center mb-4">
            <Store className="h-7 w-7 text-[var(--color-master-600)]" />
          </div>
          <h1 className="text-lg font-bold text-[var(--color-text)]">Panel de Sucursal</h1>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Los usuarios MASTER operan desde el Centro de Comando.
          </p>
          <Link href="/app/master" className="mt-5 inline-flex">
            <Button variant="primary" icon={<ArrowRight className="h-4 w-4" />}>
              Ir al Centro de Comando
            </Button>
          </Link>
        </Card>
      </section>
    );
  }

  if (loading) {
    return <p className="text-[var(--color-text-muted)] animate-pulse">Cargando dashboard…</p>;
  }
  if (error || !data) {
    return <p className="text-[var(--color-danger-600)]">No se pudo cargar el dashboard: {error}</p>;
  }

  /* ── SALES-only ── */
  if (data.kind === "SALES") {
    if (!primaryBranchId) {
      return <p className="text-[var(--color-danger-600)]">No tienes una sucursal asignada.</p>;
    }
    const summary = data.summary;
    return (
      <RoleSummary
        title="Punto de Venta"
        subtitle="Tu actividad comercial del día."
        roleAccent="SALES"
        kpis={(
          <>
            <KpiCard label="Borradores abiertos" value={summary.draftsOpen} tone={summary.draftsOpen > 0 ? "alert" : "ok"} roleAccent="SALES" />
            <KpiCard label="Enviadas a cobro" value={summary.sentToPayment} tone={summary.sentToPayment > 0 ? "alert" : "default"} roleAccent="SALES" />
            <KpiCard label="Ventas del día" value={money(summary.salesToday)} tone="ok" roleAccent="SALES" />
          </>
        )}
        quickLinks={[
          {
            href: "/app/branch/sales/orders",
            label: "Abrir punto de venta",
            icon: <ShoppingCart className="h-5 w-5" />,
          },
        ]}
      />
    );
  }

  /* ── CASHIER-only ── */
  if (data.kind === "CASHIER") {
    if (!primaryBranchId) {
      return <p className="text-[var(--color-danger-600)]">No tienes una sucursal asignada.</p>;
    }
    const summary = data.summary;
    const alerts = summary.discrepancyApprovals > 0
      ? [`Hay ${summary.discrepancyApprovals} cierres con discrepancia pendientes de revisión.`]
      : [];
    return (
      <RoleSummary
        title="Caja & Cobros"
        subtitle="Operación de cobro y estado de sesión de caja."
        roleAccent="CASHIER"
        alerts={alerts}
        kpis={(
          <>
            <KpiCard label="Sesiones activas" value={summary.activeSessionCount} tone={summary.activeSessionCount > 0 ? "ok" : "alert"} roleAccent="CASHIER" />
            <KpiCard label="Órdenes por cobrar" value={summary.pendingPayments} tone={summary.pendingPayments > 0 ? "alert" : "ok"} roleAccent="CASHIER" />
            <KpiCard
              label="Último cobro"
              value={summary.lastPayment ? money(summary.lastPayment.amount) : "—"}
              helper={summary.lastPayment ? `${summary.lastPayment.orderNumber}` : "Sin cobros recientes"}
              roleAccent="CASHIER"
            />
            <KpiCard label="Discrepancias pendientes" value={summary.discrepancyApprovals} tone={summary.discrepancyApprovals > 0 ? "alert" : "ok"} roleAccent="CASHIER" />
          </>
        )}
        quickLinks={[
          {
            href: "/app/branch/cashier/payments",
            label: "Abrir caja y cobros",
            icon: <CreditCard className="h-5 w-5" />,
          },
        ]}
      />
    );
  }

  /* ── WAREHOUSE-only ── */
  if (data.kind === "WAREHOUSE") {
    if (!primaryBranchId) {
      return <p className="text-[var(--color-danger-600)]">No tienes una sucursal asignada.</p>;
    }
    const summary = data.summary;
    const alerts = summary.overrideRequests > 0
      ? [`Hay ${summary.overrideRequests} excepciones de despacho pendientes.`]
      : [];

    const warehouseQuickLinks: QuickLink[] = [
      {
        href: "/app/branch/warehouse/dispatch",
        label: "Despacho y entregas",
        icon: <Truck className="h-5 w-5" />,
      },
    ];

    if (canInAnyAssignedBranch(session, CAPABILITIES.APPROVAL_REQUEST_CREATE)) {
      warehouseQuickLinks.push({
        href: "/app/branch/approvals",
        label: "Excepciones y solicitudes",
        icon: <ShieldCheck className="h-5 w-5" />,
      });
    }

    return (
      <RoleSummary
        title="Bodega & Despacho"
        subtitle="Estado operativo de entregas y excepciones."
        roleAccent="WAREHOUSE"
        alerts={alerts}
        kpis={(
          <>
            <KpiCard label="Pendientes de despacho" value={summary.pendingDispatches} tone={summary.pendingDispatches > 0 ? "alert" : "ok"} roleAccent="WAREHOUSE" />
            <KpiCard label="Despachos hoy" value={summary.recentDispatches} tone="ok" roleAccent="WAREHOUSE" />
            <KpiCard label="Excepciones pendientes" value={summary.overrideRequests} tone={summary.overrideRequests > 0 ? "alert" : "ok"} roleAccent="WAREHOUSE" />
          </>
        )}
        quickLinks={warehouseQuickLinks}
      />
    );
  }

  /* ── BRANCH_ADMIN ── */
  const summary = data.summary;
  const pendingTransports = data.pendingTransports;

  return (
    <>
      <RoleSummary
        title="Supervisión de Sucursal"
        subtitle="Resumen operativo para administración local."
        roleAccent="BRANCH_ADMIN"
        showHeaderAccent={false}
        alerts={summary.alerts}
        kpis={(
          <>
            <KpiCard label="Ventas del día" value={money(summary.salesToday)} tone="ok" roleAccent="BRANCH_ADMIN" />
            <KpiCard label="Cobros pendientes" value={summary.pendingPayments} tone={summary.pendingPayments > 0 ? "alert" : "ok"} roleAccent="BRANCH_ADMIN" />
            <KpiCard label="Despachos pendientes" value={summary.pendingDispatches} tone={summary.pendingDispatches > 0 ? "alert" : "ok"} roleAccent="BRANCH_ADMIN" />
            <KpiCard label="Aprobaciones pendientes" value={summary.pendingApprovals} tone={summary.pendingApprovals > 0 ? "alert" : "ok"} roleAccent="BRANCH_ADMIN" />
            <KpiCard label="Inventario crítico" value={summary.criticalInventory} tone={summary.criticalInventory > 0 ? "alert" : "ok"} roleAccent="BRANCH_ADMIN" />
            <KpiCard label="Transportes en tránsito" value={summary.pendingTransports} tone={summary.pendingTransports > 0 ? "alert" : "ok"} roleAccent="BRANCH_ADMIN" />
          </>
        )}
        quickLinks={buildBranchAdminQuickLinks(session)}
      />

      {/* ── Servicios en Tránsito ── */}
      {pendingTransports.length > 0 && (
        <section className="mt-6 animate-fade-in-up">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-[var(--color-branch_admin-50,var(--color-surface-alt))]">
              <PackageCheck className="h-4 w-4 text-[var(--color-branch_admin-600,var(--color-text-muted))]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Servicios en tránsito</h2>
              <p className="text-xs text-[var(--color-text-muted)]">{pendingTransports.length} transporte(s) pendiente(s) de entrega</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pendingTransports.map((t) => (
              <Card key={t.id} className="p-4 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-[var(--color-text)]">{t.customerName}</span>
                  <span className={`text-[0.65rem] font-semibold uppercase px-2 py-0.5 rounded-full ${
                    t.status === "IN_TRANSIT"
                      ? "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]"
                      : "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]"
                  }`}>
                    {t.status === "IN_TRANSIT" ? "En tránsito" : "Pendiente"}
                  </span>
                </div>
                <p className="text-xs text-[var(--color-text-muted)]">Orden: {t.saleOrderNumber}</p>
                <p className="text-xs text-[var(--color-text-muted)]">Precio transporte: <strong>C${Number(t.price).toFixed(2)}</strong></p>
                {t.reference && <p className="text-xs text-[var(--color-text-muted)]">Ref: {t.reference}</p>}
                {t.scheduledPaymentTime && (
                  <p className="text-xs text-[var(--color-text-muted)]">Pago prog.: {new Date(t.scheduledPaymentTime).toLocaleString("es-NI", { dateStyle: "short", timeStyle: "short" })}</p>
                )}
              </Card>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
