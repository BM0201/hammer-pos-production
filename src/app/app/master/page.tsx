import { requireMaster } from "@/modules/auth/guards";
import { getMasterDashboardSummary } from "@/modules/dashboard/service";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import {
  AlertTriangle,
  CheckCircle2,
  Building2,
  Globe,
  PackageSearch,
} from "lucide-react";

/* ── Horizontal bar item for branch sales chart ── */
function BarItem({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-24 truncate text-[var(--color-text-secondary)] font-medium text-xs">{label}</span>
      <div className="flex-1 h-5 rounded-md bg-[var(--color-surface-alt)] overflow-hidden">
        <div
          className="h-full rounded-md transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, var(--color-master-400), var(--color-master-600))",
          }}
        />
      </div>
      <span className="w-24 text-right font-mono text-xs font-semibold text-[var(--color-text)]">
        C${value.toFixed(2)}
      </span>
    </div>
  );
}

/* ── Store Pill Filter (client interactive — rendered inline for SSR page) ── */
function StorePillFilter({ branches }: { branches: { branchCode: string; branchName: string }[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-text-muted)] px-2 py-1 rounded-full bg-[var(--color-master-50)] border border-[var(--color-master-200)] text-[var(--color-master-700)]">
        Todas las sucursales
      </span>
      {branches.map((b) => (
        <span
          key={b.branchCode}
          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-text-secondary)] px-2 py-1 rounded-full bg-[var(--color-surface-alt)] border border-[var(--color-border)] hover:bg-[var(--color-master-50)] hover:border-[var(--color-master-200)] transition-colors cursor-pointer"
        >
          {b.branchCode} — {b.branchName}
        </span>
      ))}
    </div>
  );
}

export default async function MasterPage() {
  const session = await requireMaster();
  const summary = await getMasterDashboardSummary();
  const totalSalesToday = summary.byBranch.reduce((acc, item) => acc + item.salesToday, 0);
  const totalPendingOrders = summary.byBranch.reduce((acc, item) => acc + item.pendingOrders, 0);
  const totalPendingApprovals = summary.byBranch.reduce((acc, item) => acc + item.pendingApprovals, 0);
  const totalPendingDispatch = summary.byBranch.reduce((acc, item) => acc + item.pendingDispatch, 0);

  /* Sort branches by sales descending for bar chart */
  const branchSalesSorted = [...summary.byBranch].sort((a, b) => b.salesToday - a.salesToday);
  const maxSales = branchSalesSorted.length > 0 ? branchSalesSorted[0].salesToday : 0;

  return (
    <section className="space-y-8 animate-fade-in-up">
      {/* ── Page Header ── */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div
            className="h-8 w-1 rounded-full"
            style={{
              background: "linear-gradient(to bottom, var(--color-master-400), var(--color-master-600))",
            }}
          />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Centro de Comando</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Visión consolidada de todas las sucursales y métricas estratégicas.</p>
          </div>
        </div>
      </div>

      {/* ── Executive KPIs ── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5 stagger-children">
        <KpiCard label="Ventas globales (hoy)" value={`C$${totalSalesToday.toFixed(2)}`} tone="ok" roleAccent="MASTER" />
        <KpiCard label="Órdenes pendientes" value={totalPendingOrders} tone={totalPendingOrders > 0 ? "alert" : "ok"} roleAccent="MASTER" />
        <KpiCard label="Aprobaciones pendientes" value={totalPendingApprovals} tone={totalPendingApprovals > 0 ? "alert" : "ok"} roleAccent="MASTER" />
        <KpiCard label="Despachos pendientes" value={totalPendingDispatch} tone={totalPendingDispatch > 0 ? "alert" : "ok"} roleAccent="MASTER" />
        <KpiCard
          label="Alertas reposición"
          value={summary.totalReorderAlerts}
          tone={summary.totalReorderAlerts > 0 ? "alert" : "ok"}
          roleAccent="MASTER"
        />
      </div>

      {/* ── Store Pill Filter ── */}
      <div>
        <h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Filtrar sucursales</h3>
        <StorePillFilter branches={summary.byBranch.map((b) => ({ branchCode: b.branchCode, branchName: b.branchName }))} />
      </div>

      {/* ── Sales Bar Chart by Branch ── */}
      {branchSalesSorted.length > 0 && (
        <Card>
          <div className="flex items-center gap-2.5 mb-4">
            <div className="hm-section-icon hm-section-icon-master">
              <Building2 className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Ventas por Sucursal (hoy)</h2>
              <p className="text-[0.6875rem] text-[var(--color-text-muted)]">Comparativa horizontal ordenada por volumen</p>
            </div>
          </div>
          <div className="space-y-2">
            {branchSalesSorted.map((b) => (
              <BarItem key={b.branchId} label={b.branchCode} value={b.salesToday} max={maxSales} />
            ))}
          </div>
        </Card>
      )}

      {/* ── Alerts ── */}
      {summary.alerts && summary.alerts.length > 0 ? (
        <div className="flex items-start gap-3 p-4 rounded-lg border-l-4 border-[var(--color-warning-500)] bg-[var(--color-warning-50)] text-[var(--color-warning-700)]">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold mb-1">Alertas operativas</p>
            <ul className="space-y-0.5 list-disc pl-4 text-sm">
              {summary.alerts.map((alert: string) => (
                <li key={alert}>{alert}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 p-4 rounded-lg border-l-4 border-[var(--color-success-500)] bg-[var(--color-success-50)] text-[var(--color-success-700)]">
          <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <p className="text-sm font-medium">Sin alertas operativas críticas.</p>
        </div>
      )}

      {/* ── Branch Performance Table ── */}
      <Card noPadding>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2.5">
            <div className="hm-section-icon hm-section-icon-master">
              <Building2 className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Rendimiento por Sucursal</h2>
              <p className="text-[0.6875rem] text-[var(--color-text-muted)]">Comparativa en tiempo real</p>
            </div>
          </div>
          <Badge variant="info">
            <Globe className="h-3 w-3 mr-1 inline" />
            {summary.byBranch.length} sucursales
          </Badge>
        </div>

        <Table>
          <THead>
            <TR>
              <TH>Sucursal</TH>
              <TH className="text-right">Ventas hoy</TH>
              <TH className="text-right">Pendientes</TH>
              <TH className="text-right">Aprobaciones</TH>
              <TH className="text-right">Despachos</TH>
              <TH className="text-right">Reposición</TH>
            </TR>
          </THead>
          <TBody>
            {summary.byBranch.map((row) => (
              <TR key={row.branchId}>
                <TD>
                  <div className="flex items-center gap-2.5">
                    <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--color-master-50)] text-[var(--color-master-700)] text-xs font-bold">
                      {row.branchCode}
                    </span>
                    <span className="font-medium text-[var(--color-text)]">{row.branchName}</span>
                  </div>
                </TD>
                <TD className="text-right">
                  <span className="font-mono font-semibold text-[var(--color-text)]">
                    C${row.salesToday.toFixed(2)}
                  </span>
                </TD>
                <TD className="text-right">
                  {row.pendingOrders > 0
                    ? <Badge variant="warning">{row.pendingOrders}</Badge>
                    : <span className="text-[var(--color-text-soft)]">0</span>
                  }
                </TD>
                <TD className="text-right">
                  {row.pendingApprovals > 0
                    ? <Badge variant="danger">{row.pendingApprovals}</Badge>
                    : <span className="text-[var(--color-text-soft)]">0</span>
                  }
                </TD>
                <TD className="text-right">
                  {row.pendingDispatch > 0
                    ? <Badge variant="warning">{row.pendingDispatch}</Badge>
                    : <span className="text-[var(--color-text-soft)]">0</span>
                  }
                </TD>
                <TD className="text-right">
                  {row.reorderAlerts > 0
                    ? (
                      <Badge variant="danger">
                        <PackageSearch className="h-3 w-3 mr-1 inline" />
                        {row.reorderAlerts}
                      </Badge>
                    )
                    : <span className="text-[var(--color-text-soft)]">0</span>
                  }
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </section>
  );
}
