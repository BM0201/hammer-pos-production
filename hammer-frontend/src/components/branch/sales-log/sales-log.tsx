"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import {
  RefreshCw,
  Receipt,
  Eye,
  Filter,
  Search,
  ChevronLeft,
  ChevronRight,
  ListChecks,
  Wallet,
} from "lucide-react";

type SalesLogRow = {
  id: string;
  orderNumber: string;
  status: string;
  createdAt: string;
  customerName: string;
  sellerId: string;
  seller: string;
  linesCount: number;
  grandTotal: number;
};

type SalesLogSeller = { id: string; name: string };

type SalesLogResponse = {
  branchId: string;
  rows: SalesLogRow[];
  sellers: SalesLogSeller[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Borrador",
  PENDING_PAYMENT: "Pendiente de pago",
  PAID: "Pagado",
  DISPATCH_PENDING: "Pendiente de despacho",
  DISPATCHED: "Despachado",
  CANCELLED: "Cancelado",
  RETURN_REQUESTED: "Devolución solicitada",
  RETURN_APPROVED: "Devolución aprobada",
  RETURN_REJECTED: "Devolución rechazada",
  RETURNED: "Devuelto",
};

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  DRAFT: "neutral",
  PENDING_PAYMENT: "warning",
  PAID: "success",
  DISPATCH_PENDING: "info",
  DISPATCHED: "success",
  CANCELLED: "danger",
  RETURN_REQUESTED: "warning",
  RETURN_APPROVED: "info",
  RETURN_REJECTED: "danger",
  RETURNED: "neutral",
};

// Solo se muestran estados de ventas válidas en la bitácora (no anuladas/prueba).
const FILTERABLE_STATUSES = ["PENDING_PAYMENT", "PAID", "DISPATCH_PENDING", "DISPATCHED"] as const;

function formatMoney(value: number) {
  return `C$ ${Number(value ?? 0).toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-NI", { timeZone: "America/Managua", dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

const PAGE_SIZE = 25;

/**
 * Bitácora de ventas de sucursal: historial de SOLO ventas válidas de la
 * sucursal del usuario, con filtros por fecha, estado y vendedor y paginación.
 * Es de SOLO LECTURA — para auditar/anular ventas existe el panel de Master.
 */
export function SalesLog({ branchId }: { branchId?: string }) {
  const router = useRouter();
  const [data, setData] = useState<SalesLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros (se aplican con el botón / cambio de página).
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [status, setStatus] = useState("");
  const [sellerId, setSellerId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(
    async (targetPage: number) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (branchId) params.set("branchId", branchId);
        if (dateFrom) params.set("dateFrom", new Date(`${dateFrom}T00:00:00`).toISOString());
        if (dateTo) params.set("dateTo", new Date(`${dateTo}T23:59:59`).toISOString());
        if (status) params.set("status", status);
        if (sellerId) params.set("sellerId", sellerId);
        if (search.trim()) params.set("search", search.trim());
        params.set("page", String(targetPage));
        params.set("pageSize", String(PAGE_SIZE));

        const response = await apiFetch(`/api/branch/sales-log?${params.toString()}`);
        const json = await response.json();
        if (!response.ok) throw new Error("No se pudo cargar la bitácora de ventas.");
        setData(unwrapApiData<SalesLogResponse>(json));
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo cargar la bitácora de ventas.");
      } finally {
        setLoading(false);
      }
    },
    [branchId, dateFrom, dateTo, status, sellerId, search],
  );

  // Carga inicial y cuando cambia la sucursal activa.
  useEffect(() => {
    setPage(1);
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  const applyFilters = useCallback(() => {
    setPage(1);
    void load(1);
  }, [load]);

  const goToPage = useCallback(
    (next: number) => {
      setPage(next);
      void load(next);
    },
    [load],
  );

  const openDetail = useCallback(
    (row: SalesLogRow) => {
      router.push(`/app/branch/sales-log/${row.id}` as Route);
    },
    [router],
  );

  const sellers = data?.sellers ?? [];
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const pageTotal = useMemo(
    () => (data?.rows ?? []).reduce((acc, r) => acc + r.grandTotal, 0),
    [data],
  );

  const hasActiveFilters = Boolean(dateFrom || dateTo || status || sellerId || search.trim());

  const inputClass =
    "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm transition-colors focus:border-[var(--color-info-500)] focus:outline-none focus:ring-2 focus:ring-[var(--color-info-500)]/30";

  return (
    <div className="space-y-5">
      {/* Encabezado */}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-info-600)]/10 text-[var(--color-info-700)]">
          <Receipt className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--color-text)]">Bitácora de Ventas</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Historial de ventas válidas de tu sucursal. Consulta el detalle de cada venta y filtra por fecha, estado o vendedor.
          </p>
        </div>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="flex items-center gap-3 p-3.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-info-600)]/10 text-[var(--color-info-700)]"><ListChecks className="h-5 w-5" /></div>
          <div><p className="text-xs text-[var(--color-text-muted)]">Ventas (filtro)</p><p className="text-lg font-semibold text-[var(--color-text)]">{total}</p></div>
        </Card>
        <Card className="flex items-center gap-3 p-3.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-success-600)]/12 text-[var(--color-success-700)]"><Wallet className="h-5 w-5" /></div>
          <div className="min-w-0"><p className="text-xs text-[var(--color-text-muted)]">Total en esta página</p><p className="truncate text-lg font-semibold text-[var(--color-success-700)]">{formatMoney(pageTotal)}</p></div>
        </Card>
        <Card className="col-span-2 flex items-center gap-3 p-3.5 lg:col-span-1">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-info-600)]/10 text-[var(--color-info-700)]"><Receipt className="h-5 w-5" /></div>
          <div><p className="text-xs text-[var(--color-text-muted)]">Página</p><p className="text-lg font-semibold text-[var(--color-text)]">{page} / {totalPages}</p></div>
        </Card>
      </div>

      {/* Filtros compactos */}
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)]">
          <Filter className="h-4 w-4 text-[var(--color-text-muted)]" />
          Filtros
          {hasActiveFilters ? <Badge variant="info" className="ml-1">Activos</Badge> : null}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1">
            <span className="text-xs font-medium text-[var(--color-text-muted)]">Desde</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputClass} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[var(--color-text-muted)]">Hasta</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputClass} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[var(--color-text-muted)]">Estado</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
              <option value="">Todos</option>
              {FILTERABLE_STATUSES.map((k) => <option key={k} value={k}>{STATUS_LABELS[k]}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[var(--color-text-muted)]">Vendedor</span>
            <select value={sellerId} onChange={(e) => setSellerId(e.target.value)} className={inputClass}>
              <option value="">Todos</option>
              {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="space-y-1 sm:col-span-2 lg:col-span-3">
            <span className="text-xs font-medium text-[var(--color-text-muted)]">Buscar (orden o cliente)</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-soft)]" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") applyFilters(); }} placeholder="Ej: SO-MGA-..." className={`${inputClass} pl-9`} />
            </div>
          </label>
          <div className="flex items-end">
            <Button onClick={applyFilters} icon={<RefreshCw className="h-4 w-4" />} className="w-full rounded-lg" loading={loading}>
              Aplicar filtros
            </Button>
          </div>
        </div>
      </Card>

      {/* Tabla */}
      <Card noPadding className="overflow-hidden">
        {error ? (
          <div className="p-4 text-sm text-[var(--color-danger-600)]">{error}</div>
        ) : loading ? (
          <div className="p-10 text-center text-sm text-[var(--color-text-muted)]">Cargando ventas…</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-[var(--color-text-muted)]">No hay ventas para los filtros seleccionados.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Orden</TH>
                  <TH>Fecha</TH>
                  <TH>Cliente</TH>
                  <TH>Vendedor</TH>
                  <TH>Estado</TH>
                  <TH className="text-right">Total</TH>
                  <TH className="text-right">Acción</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id}>
                    <TD>
                      <button
                        type="button"
                        onClick={() => openDetail(row)}
                        className="font-semibold text-[var(--color-info-700)] underline-offset-2 transition-colors hover:text-[var(--color-info-600)] hover:underline"
                        title="Ver detalle de la venta"
                      >
                        {row.orderNumber}
                      </button>
                      <p className="text-[11px] text-[var(--color-text-soft)]">{row.linesCount} {row.linesCount === 1 ? "ítem" : "ítems"}</p>
                    </TD>
                    <TD className="whitespace-nowrap text-xs text-[var(--color-text-muted)]">{formatDate(row.createdAt)}</TD>
                    <TD className="text-sm text-[var(--color-text)]">{row.customerName}</TD>
                    <TD className="text-xs">{row.seller}</TD>
                    <TD><Badge variant={STATUS_VARIANT[row.status] ?? "neutral"}>{STATUS_LABELS[row.status] ?? row.status}</Badge></TD>
                    <TD className="whitespace-nowrap text-right font-semibold tabular-nums text-[var(--color-text)]">{formatMoney(row.grandTotal)}</TD>
                    <TD>
                      <div className="flex items-center justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openDetail(row)}
                          icon={<Eye className="h-3.5 w-3.5" />}
                          className="rounded-md text-xs"
                          title="Ver detalle de la venta"
                        >
                          Ver detalle
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}

        {/* Paginación */}
        {!loading && !error && rows.length > 0 ? (
          <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] px-4 py-3">
            <p className="text-xs text-[var(--color-text-muted)]">
              Mostrando página {page} de {totalPages} · {total} {total === 1 ? "venta" : "ventas"}
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1 || loading}
                icon={<ChevronLeft className="h-4 w-4" />}
                className="rounded-md"
              >
                Anterior
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages || loading}
                className="rounded-md"
              >
                Siguiente
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
