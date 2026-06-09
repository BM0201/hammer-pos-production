"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { showToast } from "@/components/ui/toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import {
  RefreshCw,
  FlaskConical,
  Ban,
  RotateCcw,
  Receipt,
  Eye,
  Filter,
  Search,
  ListChecks,
  ShieldAlert,
  Wallet,
} from "lucide-react";

type SaleRow = {
  id: string;
  orderNumber: string;
  status: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  createdAt: string;
  seller: string;
  linesCount: number;
  subtotal: number;
  discountTotal: number;
  grandTotal: number;
  isTest: boolean;
  voidedAt: string | null;
  voidReason: string | null;
  voidedBy: string | null;
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

// Mapea cada estado a una variante de color de badge para mejor legibilidad.
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

export function SalesManagement() {
  const router = useRouter();
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [branchId, setBranchId] = useState("");
  const [status, setStatus] = useState("");
  const [test, setTest] = useState<"all" | "only" | "exclude">("all");
  const [voided, setVoided] = useState<"all" | "only" | "exclude">("all");
  const [search, setSearch] = useState("");

  // Acción en curso (modal de motivo)
  const [actionRow, setActionRow] = useState<{ row: SaleRow; kind: "void" | "test" } | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("dateFrom", new Date(`${dateFrom}T00:00:00`).toISOString());
      if (dateTo) params.set("dateTo", new Date(`${dateTo}T23:59:59`).toISOString());
      if (branchId) params.set("branchId", branchId);
      if (status) params.set("status", status);
      if (test !== "all") params.set("test", test);
      if (voided !== "all") params.set("voided", voided);
      if (search.trim()) params.set("search", search.trim());

      const response = await apiFetch(`/api/master/sales-management?${params.toString()}`);
      const data = unwrapApiData<SaleRow[]>(await response.json());
      if (!response.ok) throw new Error("No se pudo cargar las ventas.");
      setRows(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar las ventas.");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, branchId, status, test, voided, search]);

  useEffect(() => {
    void load();
    // Carga inicial únicamente; los filtros se aplican con el botón.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opciones de sucursal derivadas de los datos cargados.
  const branchOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) map.set(r.branchId, `${r.branchCode} · ${r.branchName}`);
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [rows]);

  const metrics = useMemo(() => {
    const valid = rows.filter((r) => !r.isTest && !r.voidedAt);
    return {
      total: rows.length,
      test: rows.filter((r) => r.isTest).length,
      voided: rows.filter((r) => r.voidedAt).length,
      validTotal: valid.reduce((acc, r) => acc + r.grandTotal, 0),
    };
  }, [rows]);

  const openDetail = useCallback(
    (row: SaleRow) => {
      router.push(`/app/master/sales-management/${row.id}` as Route);
    },
    [router],
  );

  const toggleTest = useCallback(async (row: SaleRow) => {
    // Marcar como prueba pide confirmación con motivo; desmarcar es directo.
    if (!row.isTest) {
      setActionRow({ row, kind: "test" });
      setReason("");
      return;
    }
    try {
      const response = await apiFetch(`/api/master/sales-management/${row.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isTest: false }),
      });
      if (!response.ok) throw new Error("No se pudo actualizar.");
      showToast("success", "Venta desmarcada como prueba.");
      void load();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "No se pudo actualizar.");
    }
  }, [load]);

  const toggleVoid = useCallback(async (row: SaleRow) => {
    if (!row.voidedAt) {
      setActionRow({ row, kind: "void" });
      setReason("");
      return;
    }
    try {
      const response = await apiFetch(`/api/master/sales-management/${row.id}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voided: false }),
      });
      if (!response.ok) throw new Error("No se pudo restaurar.");
      showToast("success", "Venta restaurada (anulación revertida).");
      void load();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "No se pudo restaurar.");
    }
  }, [load]);

  const confirmAction = useCallback(async () => {
    if (!actionRow) return;
    if (actionRow.kind === "void" && !reason.trim()) {
      showToast("warning", "Debe indicar un motivo para anular la venta.");
      return;
    }
    setSubmitting(true);
    try {
      const { row, kind } = actionRow;
      const url = kind === "void"
        ? `/api/master/sales-management/${row.id}/void`
        : `/api/master/sales-management/${row.id}/test`;
      const body = kind === "void"
        ? { voided: true, reason: reason.trim() }
        : { isTest: true, reason: reason.trim() || null };
      const response = await apiFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("No se pudo completar la operación.");
      showToast(
        "success",
        kind === "void"
          ? "Venta anulada. Historial guardado e inventario revertido."
          : "Venta marcada como prueba. Historial guardado e inventario revertido.",
      );
      setActionRow(null);
      setReason("");
      void load();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "No se pudo completar la operación.");
    } finally {
      setSubmitting(false);
    }
  }, [actionRow, reason, load]);

  const hasActiveFilters = Boolean(dateFrom || dateTo || branchId || status || test !== "all" || voided !== "all" || search.trim());

  return (
    <div className="space-y-5">
      {/* Encabezado */}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-info-600)]/10 text-[var(--color-info-700)]">
          <Receipt className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--color-text)]">Gestión de Ventas</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Revisa, audita y controla todas las ventas. Las pruebas y anuladas se excluyen de reportes y métricas.
          </p>
        </div>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="flex items-center gap-3 p-3.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-info-600)]/10 text-[var(--color-info-700)]"><ListChecks className="h-5 w-5" /></div>
          <div><p className="text-xs text-[var(--color-text-muted)]">Ventas listadas</p><p className="text-lg font-semibold text-[var(--color-text)]">{metrics.total}</p></div>
        </Card>
        <Card className="flex items-center gap-3 p-3.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-warning-500)]/15 text-[var(--color-warning-600)]"><FlaskConical className="h-5 w-5" /></div>
          <div><p className="text-xs text-[var(--color-text-muted)]">De prueba</p><p className="text-lg font-semibold text-[var(--color-warning-600)]">{metrics.test}</p></div>
        </Card>
        <Card className="flex items-center gap-3 p-3.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-danger-500)]/15 text-[var(--color-danger-600)]"><ShieldAlert className="h-5 w-5" /></div>
          <div><p className="text-xs text-[var(--color-text-muted)]">Anuladas</p><p className="text-lg font-semibold text-[var(--color-danger-600)]">{metrics.voided}</p></div>
        </Card>
        <Card className="flex items-center gap-3 p-3.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-success-600)]/12 text-[var(--color-success-700)]"><Wallet className="h-5 w-5" /></div>
          <div className="min-w-0"><p className="text-xs text-[var(--color-text-muted)]">Total válido</p><p className="truncate text-lg font-semibold text-[var(--color-success-700)]">{formatMoney(metrics.validTotal)}</p></div>
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
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm transition-colors focus:border-[var(--color-info-500)] focus:outline-none focus:ring-2 focus:ring-[var(--color-info-500)]/30" />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[var(--color-text-muted)]">Hasta</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm transition-colors focus:border-[var(--color-info-500)] focus:outline-none focus:ring-2 focus:ring-[var(--color-info-500)]/30" />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[var(--color-text-muted)]">Sucursal</span>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm transition-colors focus:border-[var(--color-info-500)] focus:outline-none focus:ring-2 focus:ring-[var(--color-info-500)]/30">
              <option value="">Todas</option>
              {branchOptions.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[var(--color-text-muted)]">Estado</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm transition-colors focus:border-[var(--color-info-500)] focus:outline-none focus:ring-2 focus:ring-[var(--color-info-500)]/30">
              <option value="">Todos</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[var(--color-text-muted)]">Pruebas</span>
            <select value={test} onChange={(e) => setTest(e.target.value as typeof test)} className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm transition-colors focus:border-[var(--color-info-500)] focus:outline-none focus:ring-2 focus:ring-[var(--color-info-500)]/30">
              <option value="all">Incluir pruebas</option>
              <option value="only">Solo pruebas</option>
              <option value="exclude">Excluir pruebas</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[var(--color-text-muted)]">Anuladas</span>
            <select value={voided} onChange={(e) => setVoided(e.target.value as typeof voided)} className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm transition-colors focus:border-[var(--color-info-500)] focus:outline-none focus:ring-2 focus:ring-[var(--color-info-500)]/30">
              <option value="all">Incluir anuladas</option>
              <option value="only">Solo anuladas</option>
              <option value="exclude">Excluir anuladas</option>
            </select>
          </label>
          <label className="space-y-1 sm:col-span-2 lg:col-span-1">
            <span className="text-xs font-medium text-[var(--color-text-muted)]">Buscar (orden o cliente)</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-soft)]" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void load(); }} placeholder="Ej: SO-MGA-..." className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-9 pr-3 text-sm transition-colors focus:border-[var(--color-info-500)] focus:outline-none focus:ring-2 focus:ring-[var(--color-info-500)]/30" />
            </div>
          </label>
          <div className="flex items-end">
            <Button onClick={() => void load()} icon={<RefreshCw className="h-4 w-4" />} className="w-full rounded-lg" loading={loading}>
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
                  <TH>Sucursal</TH>
                  <TH>Vendedor</TH>
                  <TH>Estado</TH>
                  <TH className="text-right">Total</TH>
                  <TH>Marca</TH>
                  <TH className="text-right">Acciones</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id} className={row.voidedAt ? "opacity-60" : ""}>
                    <TD>
                      <button
                        type="button"
                        onClick={() => openDetail(row)}
                        className="font-semibold text-[var(--color-info-700)] underline-offset-2 transition-colors hover:text-[var(--color-info-600)] hover:underline"
                        title="Ver detalle de la factura"
                      >
                        {row.orderNumber}
                      </button>
                      <p className="text-[11px] text-[var(--color-text-soft)]">{row.linesCount} {row.linesCount === 1 ? "ítem" : "ítems"}</p>
                    </TD>
                    <TD className="whitespace-nowrap text-xs text-[var(--color-text-muted)]">{formatDate(row.createdAt)}</TD>
                    <TD className="text-xs font-medium">{row.branchCode}</TD>
                    <TD className="text-xs">{row.seller}</TD>
                    <TD><Badge variant={STATUS_VARIANT[row.status] ?? "neutral"}>{STATUS_LABELS[row.status] ?? row.status}</Badge></TD>
                    <TD className="whitespace-nowrap text-right font-semibold tabular-nums text-[var(--color-text)]">{formatMoney(row.grandTotal)}</TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {row.isTest ? <Badge variant="warning">Prueba</Badge> : null}
                        {row.voidedAt ? <span title={row.voidReason ?? undefined}><Badge variant="danger">Anulada</Badge></span> : null}
                        {!row.isTest && !row.voidedAt ? <Badge variant="success">Válida</Badge> : null}
                      </div>
                    </TD>
                    <TD>
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openDetail(row)}
                          icon={<Eye className="h-3.5 w-3.5" />}
                          className="rounded-md text-xs"
                          title="Ver detalle de la factura"
                        >
                          Detalle
                        </Button>
                        <Button
                          size="sm"
                          variant={row.isTest ? "secondary" : "ghost"}
                          onClick={() => void toggleTest(row)}
                          icon={<FlaskConical className="h-3.5 w-3.5" />}
                          className="rounded-md text-xs"
                          title={row.isTest ? "Quitar la marca de prueba" : "Marcar como venta de prueba (guarda historial y revierte inventario)"}
                        >
                          {row.isTest ? "Quitar prueba" : "Prueba"}
                        </Button>
                        <Button
                          size="sm"
                          variant={row.voidedAt ? "secondary" : "danger"}
                          onClick={() => void toggleVoid(row)}
                          icon={row.voidedAt ? <RotateCcw className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                          className="rounded-md text-xs"
                          title={row.voidedAt ? "Restaurar la venta (revertir anulación)" : "Anular la venta (guarda historial y revierte inventario)"}
                        >
                          {row.voidedAt ? "Restaurar" : "Anular"}
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Modal de motivo (anular / marcar prueba) */}
      {actionRow ? (
        <div className="fixed inset-0 z-[9985] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-[var(--color-surface)] shadow-2xl">
            <div className={`flex items-center gap-2.5 px-5 py-3.5 text-white ${actionRow.kind === "void" ? "bg-[var(--color-danger-600)]" : "bg-[var(--color-warning-600)]"}`}>
              {actionRow.kind === "void" ? <Ban className="h-5 w-5" /> : <FlaskConical className="h-5 w-5" />}
              <h2 className="text-base font-semibold">
                {actionRow.kind === "void" ? "Anular venta" : "Marcar como prueba"}
              </h2>
            </div>
            <div className="space-y-3 px-5 py-4">
              <p className="text-sm text-[var(--color-text-secondary)]">
                Orden <strong>{actionRow.row.orderNumber}</strong> · {formatMoney(actionRow.row.grandTotal)}.
                {actionRow.kind === "void"
                  ? " La venta no se borra: se guarda un historial completo (productos, cantidades, cliente, total), se revierte el inventario y se excluye de reportes y métricas."
                  : " Se guarda un historial completo de lo vendido, se revierte el inventario y se excluye de reportes y métricas. Puedes revertirlo en cualquier momento."}
              </p>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-[var(--color-text-muted)]">
                  Motivo {actionRow.kind === "void" ? "(obligatorio)" : "(opcional)"}
                </span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm transition-colors focus:border-[var(--color-info-500)] focus:outline-none focus:ring-2 focus:ring-[var(--color-info-500)]/30"
                  placeholder="Ej: Venta de prueba durante capacitación."
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2 border-t border-[var(--color-border)] px-5 py-3">
              <Button variant="secondary" className="w-full rounded-lg" onClick={() => setActionRow(null)} disabled={submitting}>
                Cancelar
              </Button>
              <Button
                variant={actionRow.kind === "void" ? "danger" : "primary"}
                className="w-full rounded-lg"
                onClick={() => void confirmAction()}
                loading={submitting}
                disabled={submitting}
              >
                {actionRow.kind === "void" ? "Anular venta" : "Marcar prueba"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
