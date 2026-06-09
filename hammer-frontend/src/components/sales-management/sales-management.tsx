"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { showToast } from "@/components/ui/toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { RefreshCw, FlaskConical, Ban, RotateCcw, Receipt } from "lucide-react";

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

function formatMoney(value: number) {
  return `C$ ${Number(value ?? 0).toFixed(2)}`;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-NI", { timeZone: "America/Managua", dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function SalesManagement() {
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
      showToast("success", kind === "void" ? "Venta anulada y excluida de métricas." : "Venta marcada como prueba.");
      setActionRow(null);
      setReason("");
      void load();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "No se pudo completar la operación.");
    } finally {
      setSubmitting(false);
    }
  }, [actionRow, reason, load]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5">
        <Receipt className="h-6 w-6 text-[var(--color-info-600)]" />
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-text)]">Gestión de Ventas</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Revisa todas las ventas, marca pruebas y anula con justificación. Las pruebas y anuladas se excluyen de reportes y métricas.
          </p>
        </div>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3"><p className="text-xs text-[var(--color-text-muted)]">Ventas listadas</p><p className="text-lg font-semibold">{metrics.total}</p></Card>
        <Card className="p-3"><p className="text-xs text-[var(--color-text-muted)]">De prueba</p><p className="text-lg font-semibold text-[var(--color-warning-600)]">{metrics.test}</p></Card>
        <Card className="p-3"><p className="text-xs text-[var(--color-text-muted)]">Anuladas</p><p className="text-lg font-semibold text-[var(--color-danger-600)]">{metrics.voided}</p></Card>
        <Card className="p-3"><p className="text-xs text-[var(--color-text-muted)]">Total válido</p><p className="text-lg font-semibold text-[var(--color-success-700)]">{formatMoney(metrics.validTotal)}</p></Card>
      </div>

      {/* Filtros */}
      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="space-y-1 text-xs">
            <span className="font-medium text-[var(--color-text-muted)]">Desde</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-[var(--color-text-muted)]">Hasta</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-[var(--color-text-muted)]">Sucursal</span>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
              <option value="">Todas</option>
              {branchOptions.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-[var(--color-text-muted)]">Estado</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
              <option value="">Todos</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-[var(--color-text-muted)]">Pruebas</span>
            <select value={test} onChange={(e) => setTest(e.target.value as typeof test)} className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
              <option value="all">Incluir</option>
              <option value="only">Solo pruebas</option>
              <option value="exclude">Excluir pruebas</option>
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-[var(--color-text-muted)]">Anuladas</span>
            <select value={voided} onChange={(e) => setVoided(e.target.value as typeof voided)} className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
              <option value="all">Incluir</option>
              <option value="only">Solo anuladas</option>
              <option value="exclude">Excluir anuladas</option>
            </select>
          </label>
          <label className="space-y-1 text-xs lg:col-span-2">
            <span className="font-medium text-[var(--color-text-muted)]">Buscar (orden o cliente)</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ej: SO-MGA-..." className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
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
          <div className="p-6 text-center text-sm text-[var(--color-text-muted)]">Cargando ventas…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-[var(--color-text-muted)]">No hay ventas para los filtros seleccionados.</div>
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
                  <TH>Total</TH>
                  <TH>Marca</TH>
                  <TH>Acciones</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id} className={row.voidedAt ? "opacity-60" : ""}>
                    <TD className="font-medium">{row.orderNumber}</TD>
                    <TD className="whitespace-nowrap text-xs">{formatDate(row.createdAt)}</TD>
                    <TD className="text-xs">{row.branchCode}</TD>
                    <TD className="text-xs">{row.seller}</TD>
                    <TD><Badge variant="neutral">{STATUS_LABELS[row.status] ?? row.status}</Badge></TD>
                    <TD className="whitespace-nowrap font-semibold">{formatMoney(row.grandTotal)}</TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {row.isTest ? <Badge variant="warning">Prueba</Badge> : null}
                        {row.voidedAt ? <span title={row.voidReason ?? undefined}><Badge variant="danger">Anulada</Badge></span> : null}
                        {!row.isTest && !row.voidedAt ? <Badge variant="success">Válida</Badge> : null}
                      </div>
                    </TD>
                    <TD>
                      <div className="flex flex-wrap gap-1.5">
                        <Button
                          size="sm"
                          variant={row.isTest ? "secondary" : "ghost"}
                          onClick={() => void toggleTest(row)}
                          icon={<FlaskConical className="h-3.5 w-3.5" />}
                          className="rounded-md text-xs"
                        >
                          {row.isTest ? "Quitar prueba" : "Prueba"}
                        </Button>
                        <Button
                          size="sm"
                          variant={row.voidedAt ? "secondary" : "danger"}
                          onClick={() => void toggleVoid(row)}
                          icon={row.voidedAt ? <RotateCcw className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                          className="rounded-md text-xs"
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
          <div className="w-full max-w-md rounded-xl bg-[var(--color-surface)] shadow-xl">
            <div className={`flex items-center gap-2.5 rounded-t-xl px-5 py-3 text-white ${actionRow.kind === "void" ? "bg-[var(--color-danger-600)]" : "bg-[var(--color-warning-600)]"}`}>
              {actionRow.kind === "void" ? <Ban className="h-5 w-5" /> : <FlaskConical className="h-5 w-5" />}
              <h2 className="text-base font-semibold">
                {actionRow.kind === "void" ? "Anular venta" : "Marcar como prueba"}
              </h2>
            </div>
            <div className="space-y-3 px-5 py-4">
              <p className="text-sm text-[var(--color-text-secondary)]">
                Orden <strong>{actionRow.row.orderNumber}</strong> · {formatMoney(actionRow.row.grandTotal)}.
                {actionRow.kind === "void"
                  ? " La venta no se borra; quedará registrada como anulada y se excluirá de reportes y métricas."
                  : " Se excluirá de reportes y métricas. Puedes revertirlo en cualquier momento."}
              </p>
              <label className="block space-y-1 text-xs">
                <span className="font-medium text-[var(--color-text-muted)]">
                  Motivo {actionRow.kind === "void" ? "(obligatorio)" : "(opcional)"}
                </span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
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
