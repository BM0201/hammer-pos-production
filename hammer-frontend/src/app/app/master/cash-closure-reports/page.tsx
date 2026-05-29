"use client";

import { useState, useEffect, useCallback } from "react";
import { unwrapApiData } from "@/lib/client/api";
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

function formatCurrency(value: string): string {
  return `C$ ${parseFloat(value).toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("es-NI", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "America/Managua",
  });
}

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
    AUTO: "bg-blue-100 text-blue-800",
    MANUAL: "bg-green-100 text-green-800",
    PERMANENT: "bg-red-100 text-red-800",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${colors[type] ?? "bg-gray-100 text-gray-800"}`}>
      {type === "PERMANENT" && <Lock className="h-3 w-3" />}
      {type}
    </span>
  );
}

function ClosureDetail({ closure }: { closure: ClosureReport }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-start">
            <span className="text-sm font-bold text-gray-900">{closure.branchName}</span>
            <span className="text-xs text-gray-500">{closure.branchCode}</span>
          </div>
          <ClosureTypeBadge type={closure.closureType} />
          {closure.legacy && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-700">
              Historico legacy
            </span>
          )}
          {closure.isReopened && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800">
              <AlertTriangle className="h-3 w-3" />
              Reabierta ({closure.reopenCount}x)
            </span>
          )}
          {closure.isPermanentlyClosed && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800">
              <Lock className="h-3 w-3" />
              Cierre Permanente
            </span>
          )}
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-sm font-bold text-gray-900">{formatCurrency(closure.totalSales)}</p>
            <p className="text-xs text-gray-500">{closure.transactionCount} transacciones</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">{formatDate(closure.closureDate)}</p>
            <p className="text-xs text-gray-400">{formatTime(closure.closedAt)}</p>
          </div>
          {expanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </div>
      </button>

      {/* Expanded Detail */}
      {expanded && (
        <div className="border-t border-gray-200 px-4 py-4 space-y-4">
          {/* Payment method breakdown */}
          <div>
            <h5 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Métodos de Pago</h5>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {[
                { label: "Efectivo", value: closure.cashTotal, color: "text-green-700" },
                { label: "Tarjeta", value: closure.cardTotal, color: "text-blue-700" },
                { label: "Transferencia", value: closure.transferTotal, color: "text-purple-700" },
                { label: "Crédito", value: closure.creditTotal, color: "text-orange-700" },
                { label: "Mixto", value: closure.mixedTotal, color: "text-gray-700" },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-gray-50 rounded p-2">
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className={`text-sm font-semibold ${color}`}>{formatCurrency(value)}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="bg-gray-50 rounded p-2">
              <p className="text-xs text-gray-500">Productos vendidos</p>
              <p className="text-sm font-semibold">{closure.productsSold}</p>
            </div>
            {closure.isReopened && (
              <>
                <div className="bg-amber-50 rounded p-2">
                  <p className="text-xs text-amber-600">Ventas de emergencia</p>
                  <p className="text-sm font-semibold text-amber-800">
                    {closure.emergencySalesCount} / {closure.maxEmergencySales}
                  </p>
                </div>
                <div className="bg-amber-50 rounded p-2">
                  <p className="text-xs text-amber-600">Reaperturas</p>
                  <p className="text-sm font-semibold text-amber-800">{closure.reopenCount}</p>
                </div>
              </>
            )}
          </div>

          {/* Logs */}
          {closure.logs.length > 0 && (
            <div>
              <h5 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Historial de Eventos</h5>
              <div className="space-y-1">
                {closure.logs.map((log) => (
                  <div key={log.id} className="flex items-center gap-2 text-xs">
                    <span className="text-gray-400">{formatTime(log.createdAt)}</span>
                    <span className={`font-semibold ${
                      log.action === "AUTO_CLOSE" ? "text-blue-700" :
                      log.action === "REOPEN" ? "text-amber-700" :
                      log.action === "EMERGENCY_SALE" ? "text-orange-700" :
                      log.action === "PERMANENT_CLOSE" ? "text-red-700" :
                      "text-gray-700"
                    }`}>
                      {log.action === "AUTO_CLOSE" && "Cierre Automatico"}
                      {log.action === "REOPEN" && "Reapertura de Emergencia"}
                      {log.action === "EMERGENCY_SALE" && "Venta de Emergencia"}
                      {log.action === "PERMANENT_CLOSE" && "Cierre Permanente"}
                    </span>
                    {log.performedByUserId && (
                      <span className="text-gray-400">por {log.performedByUserId}</span>
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
          <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-indigo-600" />
            Reportes de Cierre de Caja
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            Historico legacy de CashClosure. La operacion diaria actual se controla desde Dia Operativo 360 y sesiones de caja.
          </p>
        </div>
        <button
          onClick={fetchClosures}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Actualizar
        </button>
      </div>

      {/* Alerts */}
      {reopenAlerts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <h4 className="font-semibold text-amber-800">
              Alertas de Reapertura ({reopenAlerts.length})
            </h4>
          </div>
          <div className="space-y-1">
            {reopenAlerts.map((c) => (
              <p key={c.id} className="text-sm text-amber-700">
                <span className="font-semibold">{c.branchName}</span> — {formatDate(c.closureDate)}
                {" "} ({c.emergencySalesCount} ventas de emergencia, {c.reopenCount} reaperturas)
                {c.isPermanentlyClosed && " — Cierre permanente ejecutado"}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-gray-500 mb-1">
            <DollarSign className="h-4 w-4" />
            <span className="text-xs uppercase tracking-wider font-semibold">Ventas Totales</span>
          </div>
          <p className="text-xl font-bold text-gray-900">{formatCurrency(String(totalSalesSum))}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-gray-500 mb-1">
            <ShoppingCart className="h-4 w-4" />
            <span className="text-xs uppercase tracking-wider font-semibold">Transacciones</span>
          </div>
          <p className="text-xl font-bold text-gray-900">{totalTransactions}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-gray-500 mb-1">
            <Clock className="h-4 w-4" />
            <span className="text-xs uppercase tracking-wider font-semibold">Cierres</span>
          </div>
          <p className="text-xl font-bold text-gray-900">{total}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-amber-500 mb-1">
            <Unlock className="h-4 w-4" />
            <span className="text-xs uppercase tracking-wider font-semibold">Reaperturas</span>
          </div>
          <p className="text-xl font-bold text-amber-700">{reopenAlerts.length}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="h-4 w-4 text-gray-500" />
          <h4 className="text-sm font-semibold text-gray-700">Filtros</h4>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Sucursal</label>
            <select
              value={selectedBranch}
              onChange={(e) => { setSelectedBranch(e.target.value); setPage(1); }}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
            >
              <option value="">Todas las sucursales</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Desde</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Hasta</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={() => { setSelectedBranch(""); setStartDate(""); setEndDate(""); setPage(1); }}
              className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
            >
              Limpiar filtros
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <div className="text-center py-8 text-gray-500">
          <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />
          Cargando reportes...
        </div>
      ) : error ? (
        <div className="text-center py-8 text-red-500">
          <AlertTriangle className="h-6 w-6 mx-auto mb-2" />
          {error}
        </div>
      ) : closures.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
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
            className="px-3 py-1.5 text-sm border border-gray-300 rounded disabled:opacity-50"
          >
            Anterior
          </button>
          <span className="text-sm text-gray-500">
            Página {page} de {Math.ceil(total / 20)}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= Math.ceil(total / 20)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded disabled:opacity-50"
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}
