"use client";

import { useState, useEffect, useCallback } from "react";
import { unwrapApiData } from "@/lib/client/api";
import { money, fmtDate } from "@/lib/format";
import {
  BarChart3,
  AlertTriangle,
  Clock,
  DollarSign,
  ShoppingCart,
  RefreshCw,
  Filter,
  ChevronDown,
  ChevronUp,
  Lock,
  Unlock,
} from "lucide-react";

type ClosureLog = {
  id: string;
  action: string;
  performedByUserId: string | null;
  metadataJson: Record<string, unknown> | null;
  createdAt: string;
};

type ClosureReport = {
  id: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  closureDate: string;
  closedAt: string;
  closureType: string;
  totalSales: string;
  transactionCount: number;
  cashTotal: string;
  cardTotal: string;
  transferTotal: string;
  creditTotal: string;
  mixedTotal: string;
  productsSold: number;
  isReopened: boolean;
  reopenedAt: string | null;
  reopenCount: number;
  emergencySalesCount: number;
  maxEmergencySales: number;
  isPermanentlyClosed: boolean;
  legacy?: boolean;
  source?: string;
  logs: ClosureLog[];
};

type Branch = {
  id: string;
  code: string;
  name: string;
};



function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("es-NI", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Managua",
  });
}

function ClosureTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    AUTO: "bg-[var(--color-info-50)] text-[var(--color-info-700)]",
    MANUAL: "bg-[var(--color-success-50)] text-[var(--color-success-700)]",
    PERMANENT: "bg-[var(--color-danger-50)] text-[var(--color-danger-700)]",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${colors[type] ?? "bg-[var(--color-surface-alt)] text-[var(--color-text)]"}`}>
      {type === "PERMANENT" && <Lock className="h-3 w-3" />}
      {type}
    </span>
  );
}

function ClosureDetail({ closure }: { closure: ClosureReport }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-sm overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--color-surface-alt)] transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-start">
            <span className="text-sm font-bold text-[var(--color-text)]">{closure.branchName}</span>
            <span className="text-xs text-[var(--color-text-muted)]">{closure.branchCode}</span>
          </div>
          <ClosureTypeBadge type={closure.closureType} />
          {closure.legacy && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-700">
              Historico legacy
            </span>
          )}
          {closure.isReopened && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-[var(--color-warning-100)] text-[var(--color-warning-700)]">
              <AlertTriangle className="h-3 w-3" />
              Reabierta ({closure.reopenCount}x)
            </span>
          )}
          {closure.isPermanentlyClosed && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-[var(--color-danger-50)] text-[var(--color-danger-700)]">
              <Lock className="h-3 w-3" />
              Cierre Permanente
            </span>
          )}
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-sm font-bold text-[var(--color-text)]">{money(closure.totalSales)}</p>
            <p className="text-xs text-[var(--color-text-muted)]">{closure.transactionCount} transacciones</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-[var(--color-text-muted)]">{fmtDate(closure.closureDate)}</p>
            <p className="text-xs text-[var(--color-text-soft)]">{formatTime(closure.closedAt)}</p>
          </div>
          {expanded ? <ChevronUp className="h-4 w-4 text-[var(--color-text-soft)]" /> : <ChevronDown className="h-4 w-4 text-[var(--color-text-soft)]" />}
        </div>
      </button>

      {/* Expanded Detail */}
      {expanded && (
        <div className="border-t border-[var(--color-border)] px-4 py-4 space-y-4">
          {/* Payment method breakdown */}
          <div>
            <h5 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Métodos de Pago</h5>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {[
                { label: "Efectivo", value: closure.cashTotal, color: "text-[var(--color-success-700)]" },
                { label: "Tarjeta", value: closure.cardTotal, color: "text-[var(--color-info-700)]" },
                { label: "Transferencia", value: closure.transferTotal, color: "text-[var(--color-master-700)]" },
                { label: "Crédito", value: closure.creditTotal, color: "text-orange-700" },
                { label: "Mixto", value: closure.mixedTotal, color: "text-[var(--color-text)]" },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-[var(--color-surface-alt)] rounded p-2">
                  <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
                  <p className={`text-sm font-semibold ${color}`}>{money(value)}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="bg-[var(--color-surface-alt)] rounded p-2">
              <p className="text-xs text-[var(--color-text-muted)]">Productos vendidos</p>
              <p className="text-sm font-semibold">{closure.productsSold}</p>
            </div>
            {closure.isReopened && (
              <>
                <div className="bg-[var(--color-warning-50)] rounded p-2">
                  <p className="text-xs text-[var(--color-warning-700)]">Ventas de emergencia</p>
                  <p className="text-sm font-semibold text-[var(--color-warning-700)]">
                    {closure.emergencySalesCount} / {closure.maxEmergencySales}
                  </p>
                </div>
                <div className="bg-[var(--color-warning-50)] rounded p-2">
                  <p className="text-xs text-[var(--color-warning-700)]">Reaperturas</p>
                  <p className="text-sm font-semibold text-[var(--color-warning-700)]">{closure.reopenCount}</p>
                </div>
              </>
            )}
          </div>

          {/* Logs */}
          {closure.logs.length > 0 && (
            <div>
              <h5 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Historial de Eventos</h5>
              <div className="space-y-1">
                {closure.logs.map((log) => (
                  <div key={log.id} className="flex items-center gap-2 text-xs">
                    <span className="text-[var(--color-text-soft)]">{formatTime(log.createdAt)}</span>
                    <span className={`font-semibold ${
                      log.action === "AUTO_CLOSE" ? "text-[var(--color-info-700)]" :
                      log.action === "REOPEN" ? "text-[var(--color-warning-700)]" :
                      log.action === "EMERGENCY_SALE" ? "text-orange-700" :
                      log.action === "PERMANENT_CLOSE" ? "text-[var(--color-danger-700)]" :
                      "text-[var(--color-text)]"
                    }`}>
                      {log.action === "AUTO_CLOSE" && "Cierre Automatico"}
                      {log.action === "REOPEN" && "Reapertura de Emergencia"}
                      {log.action === "EMERGENCY_SALE" && "Venta de Emergencia"}
                      {log.action === "PERMANENT_CLOSE" && "Cierre Permanente"}
                    </span>
                    {log.performedByUserId && (
                      <span className="text-[var(--color-text-soft)]">por {log.performedByUserId}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CashClosureReportsPage() {
  const [closures, setClosures] = useState<ClosureReport[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedBranch, setSelectedBranch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const fetchBranches = useCallback(async () => {
    try {
      const res = await fetch("/api/branches");
      if (res.ok) {
        const data = unwrapApiData(await res.json());
        setBranches(Array.isArray(data) ? data : data?.branches ?? []);
      }
    } catch {
      // Branches fetch is non-critical
    }
  }, []);

  const fetchClosures = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (selectedBranch) params.set("branchId", selectedBranch);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      params.set("page", String(page));
      params.set("limit", "20");

      const res = await fetch(`/api/cash-closure/reports?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch reports");
      const data = unwrapApiData(await res.json());
      setClosures(data.closures ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, [selectedBranch, startDate, endDate, page]);

  useEffect(() => {
    fetchBranches();
  }, [fetchBranches]);

  useEffect(() => {
    fetchClosures();
  }, [fetchClosures]);

  const reopenAlerts = closures.filter((c) => c.isReopened);
  const totalSalesSum = closures.reduce((acc, c) => acc + parseFloat(c.totalSales), 0);
  const totalTransactions = closures.reduce((acc, c) => acc + c.transactionCount, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-[var(--color-text)] flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-[var(--color-master-600)]" />
            Reportes de Cierre de Caja
          </h3>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Historico legacy de CashClosure. La operacion diaria actual se controla desde Dia Operativo 360 y sesiones de caja.
          </p>
        </div>
        <button
          onClick={fetchClosures}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-[var(--color-master-600)] text-white rounded-lg hover:bg-[var(--color-master-700)] transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Actualizar
        </button>
      </div>

      {/* Alerts */}
      {reopenAlerts.length > 0 && (
        <div className="bg-[var(--color-warning-50)] border border-[var(--color-warning-200)] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-5 w-5 text-[var(--color-warning-700)]" />
            <h4 className="font-semibold text-[var(--color-warning-700)]">
              Alertas de Reapertura ({reopenAlerts.length})
            </h4>
          </div>
          <div className="space-y-1">
            {reopenAlerts.map((c) => (
              <p key={c.id} className="text-sm text-[var(--color-warning-700)]">
                <span className="font-semibold">{c.branchName}</span> — {fmtDate(c.closureDate)}
                {" "} ({c.emergencySalesCount} ventas de emergencia, {c.reopenCount} reaperturas)
                {c.isPermanentlyClosed && " — Cierre permanente ejecutado"}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4">
          <div className="flex items-center gap-2 text-[var(--color-text-muted)] mb-1">
            <DollarSign className="h-4 w-4" />
            <span className="text-xs uppercase tracking-wider font-semibold">Ventas Totales</span>
          </div>
          <p className="text-xl font-bold text-[var(--color-text)]">{money(String(totalSalesSum))}</p>
        </div>
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4">
          <div className="flex items-center gap-2 text-[var(--color-text-muted)] mb-1">
            <ShoppingCart className="h-4 w-4" />
            <span className="text-xs uppercase tracking-wider font-semibold">Transacciones</span>
          </div>
          <p className="text-xl font-bold text-[var(--color-text)]">{totalTransactions}</p>
        </div>
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4">
          <div className="flex items-center gap-2 text-[var(--color-text-muted)] mb-1">
            <Clock className="h-4 w-4" />
            <span className="text-xs uppercase tracking-wider font-semibold">Cierres</span>
          </div>
          <p className="text-xl font-bold text-[var(--color-text)]">{total}</p>
        </div>
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4">
          <div className="flex items-center gap-2 text-amber-500 mb-1">
            <Unlock className="h-4 w-4" />
            <span className="text-xs uppercase tracking-wider font-semibold">Reaperturas</span>
          </div>
          <p className="text-xl font-bold text-[var(--color-warning-700)]">{reopenAlerts.length}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="h-4 w-4 text-[var(--color-text-muted)]" />
          <h4 className="text-sm font-semibold text-[var(--color-text)]">Filtros</h4>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Sucursal</label>
            <select
              value={selectedBranch}
              onChange={(e) => { setSelectedBranch(e.target.value); setPage(1); }}
              className="w-full border border-[var(--color-border)] rounded px-3 py-1.5 text-sm"
            >
              <option value="">Todas las sucursales</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Desde</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
              className="w-full border border-[var(--color-border)] rounded px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Hasta</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
              className="w-full border border-[var(--color-border)] rounded px-3 py-1.5 text-sm"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={() => { setSelectedBranch(""); setStartDate(""); setEndDate(""); setPage(1); }}
              className="px-3 py-1.5 text-sm text-[var(--color-text-muted)] border border-[var(--color-border)] rounded hover:bg-[var(--color-surface-alt)]"
            >
              Limpiar filtros
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <div className="text-center py-8 text-[var(--color-text-muted)]">
          <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />
          Cargando reportes...
        </div>
      ) : error ? (
        <div className="text-center py-8 text-[var(--color-danger-600)]">
          <AlertTriangle className="h-6 w-6 mx-auto mb-2" />
          {error}
        </div>
      ) : closures.length === 0 ? (
        <div className="text-center py-8 text-[var(--color-text-soft)]">
          No se encontraron cierres de caja con los filtros seleccionados
        </div>
      ) : (
        <div className="space-y-2">
          {closures.map((closure) => (
            <ClosureDetail key={closure.id} closure={closure} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > 20 && (
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 text-sm border border-[var(--color-border)] rounded disabled:opacity-50"
          >
            Anterior
          </button>
          <span className="text-sm text-[var(--color-text-muted)]">
            Página {page} de {Math.ceil(total / 20)}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= Math.ceil(total / 20)}
            className="px-3 py-1.5 text-sm border border-[var(--color-border)] rounded disabled:opacity-50"
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}
