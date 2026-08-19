"use client";

/**
 * Historial Completo — Página master de historial unificado.
 * FASE 3 — H.A.M.M.E.R. POS/ERP
 *
 * Vista consolidada de ventas, pagos y producción con filtros y búsqueda.
 */

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { showToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/client/api";
import { SalesCard } from "@/components/sales/sales-card";
import "@/styles/responsive.css";

type HistoryEntry = {
  id: string;
  type: "sale" | "payment" | "production" | "operational_day";
  date: string;
  reference: string;
  branchName: string;
  branchCode: string;
  description: string;
  amount: number;
  status: string;
  user: string;
};

const TYPE_LABELS: Record<string, string> = {
  sale: "Venta",
  payment: "Pago",
  production: "Producción",
  operational_day: "Día Operativo",
};

const TYPE_COLORS: Record<string, string> = {
  sale: "success",
  payment: "info",
  production: "warning",
  operational_day: "neutral",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Borrador",
  PENDING_PAYMENT: "Pendiente de Pago",
  PAID: "Pagada",
  DISPATCH_PENDING: "Pendiente Despacho",
  DISPATCHED: "Despachada",
  CANCELLED: "Cancelada",
  POSTED: "Aplicado",
  VOIDED: "Anulado",
  IN_PROGRESS: "En Proceso",
  COMPLETED: "Completado",
  PENDING: "Pendiente",
  OPEN: "Abierto",
  CLOSING: "En cierre",
  CLOSED: "Cerrado",
  APPROVED: "Aprobado",
};

export default function MasterHistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");

  const fetchHistory = useCallback(async (pageNum = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(pageNum), limit: "30" });
      if (search) params.set("search", search);
      if (filterType) params.set("type", filterType);
      if (filterStartDate) params.set("startDate", filterStartDate);
      if (filterEndDate) params.set("endDate", filterEndDate);

      const res = await apiFetch(`/api/master/history?${params.toString()}`);
      if (res.ok) {
        const json = (await res.json()) as { ok: boolean; data: { entries: HistoryEntry[]; page: number } };
        setEntries(json.data.entries);
        setPage(json.data.page);
      }
    } catch {
      showToast("error", "Error al cargar historial");
    } finally {
      setLoading(false);
    }
  }, [search, filterType, filterStartDate, filterEndDate]);

  useEffect(() => {
    fetchHistory(1);
  }, [fetchHistory]);

  function handleSearch() {
    setSearch(searchInput);
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleString("es-NI", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-bold">Historial Completo</h3>
        <p className="text-sm text-[var(--color-text-muted)]">
          Vista unificada de todas las operaciones: ventas, pagos y producción.
        </p>
      </div>

      {/* Barra de búsqueda y filtros */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          <div className="sm:col-span-2">
            <label className="text-xs text-[var(--color-text-muted)]">Buscar</label>
            <div className="flex gap-2 mt-1">
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Orden, cliente, lote..."
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
              <Button onClick={handleSearch} className="shrink-0">Buscar</Button>
            </div>
          </div>
          <div>
            <label className="text-xs text-[var(--color-text-muted)]">Tipo</label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-[var(--color-surface)]"
            >
              <option value="">Todos</option>
              <option value="sale">Ventas</option>
              <option value="payment">Pagos</option>
              <option value="production">Producción</option>
              <option value="operational_day">Días Operativos</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-[var(--color-text-muted)]">Desde</label>
            <Input
              type="date"
              value={filterStartDate}
              onChange={(e) => setFilterStartDate(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--color-text-muted)]">Hasta</label>
            <Input
              type="date"
              value={filterEndDate}
              onChange={(e) => setFilterEndDate(e.target.value)}
              className="mt-1"
            />
          </div>
        </div>
      </Card>

      {/* Tabla de historial / Cards mobile */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">Cargando historial...</div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">No se encontraron registros.</div>
        ) : (
          <>
            {/* Cards para mobile */}
            <div className="md:hidden p-4 space-y-3">
              {entries.map((entry) => (
                <SalesCard key={`${entry.type}-${entry.id}`} entry={entry} />
              ))}
            </div>

            {/* Tabla para desktop */}
            <div className="hidden md:block">
          <div className="overflow-x-auto">
            <table className="hm-table w-full text-sm">
              <thead className="bg-[var(--color-surface-alt)]">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Fecha</th>
                  <th className="px-4 py-3 text-left font-medium">Tipo</th>
                  <th className="px-4 py-3 text-left font-medium">Referencia</th>
                  <th className="px-4 py-3 text-left font-medium">Descripción</th>
                  <th className="px-4 py-3 text-left font-medium">Sucursal</th>
                  <th className="px-4 py-3 text-right font-medium">Monto</th>
                  <th className="px-4 py-3 text-center font-medium">Estado</th>
                  <th className="px-4 py-3 text-left font-medium">Usuario</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {entries.map((entry) => (
                  <tr key={`${entry.type}-${entry.id}`} className="hover:bg-[var(--color-surface-alt)]/50">
                    <td className="px-4 py-3 whitespace-nowrap text-xs">{formatDate(entry.date)}</td>
                    <td className="px-4 py-3">
                      <Badge variant={TYPE_COLORS[entry.type] as "success" | "info" | "warning" | "neutral"}>
                        {TYPE_LABELS[entry.type] ?? entry.type}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{entry.reference}</td>
                    <td className="px-4 py-3 max-w-[200px] truncate">{entry.description}</td>
                    <td className="px-4 py-3">{entry.branchName}</td>
                    <td className="px-4 py-3 text-right font-mono">C$ {entry.amount.toFixed(2)}</td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant="neutral" className="text-[0.6rem]">
                        {STATUS_LABELS[entry.status] ?? entry.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs">{entry.user}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            </div>
          </>
        )}

        {/* Paginación */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--color-border)]">
          <p className="text-xs text-[var(--color-text-muted)]">
            Página {page} — {entries.length} registros mostrados
          </p>
          <div className="flex gap-2">
            <Button
              onClick={() => fetchHistory(page - 1)}
              disabled={page <= 1 || loading}
              className="text-xs px-3 py-1"
            >
              ← Anterior
            </Button>
            <Button
              onClick={() => fetchHistory(page + 1)}
              disabled={entries.length < 30 || loading}
              className="text-xs px-3 py-1"
            >
              Siguiente →
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
