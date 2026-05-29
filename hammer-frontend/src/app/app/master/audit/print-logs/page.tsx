"use client";

/**
 * Página de auditoría de impresión de documentos.
 * FASE 3 — H.A.M.M.E.R. POS/ERP
 *
 * Muestra historial de impresiones con filtros por sucursal, tipo y fechas.
 * Permite reimpresión con motivo.
 */

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { showToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/client/api";

type PrintLog = {
  id: string;
  documentType: string;
  printedAt: string;
  isReprint: boolean;
  reprintReason: string | null;
  printedBy: { id: string; fullName: string; username: string };
  saleOrder: {
    id: string;
    orderNumber: string;
    deliveryOrderNumber: string | null;
    branchId: string;
    branch: { name: string; code: string };
    grandTotal: string;
  };
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

const DOC_TYPE_LABELS: Record<string, string> = {
  DELIVERY_ORDER: "Orden de Entrega",
  PURCHASE_TICKET: "Ticket de Compra",
  PAYMENT_RECEIPT: "Comprobante de Pago",
  PRODUCTION_ORDER: "Orden de Producción",
};

export default function PrintLogsAuditPage() {
  const [logs, setLogs] = useState<PrintLog[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");

  // ── Reprint modal state ──
  const [reprintOrderId, setReprintOrderId] = useState<string | null>(null);
  const [reprintDocType, setReprintDocType] = useState<string>("");
  const [reprintReason, setReprintReason] = useState("");
  const [isReprinting, setIsReprinting] = useState(false);

  const fetchLogs = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (filterType) params.set("documentType", filterType);
      if (filterStartDate) params.set("startDate", filterStartDate);
      if (filterEndDate) params.set("endDate", filterEndDate);

      const res = await apiFetch(`/api/master/print-logs?${params.toString()}`);
      if (res.ok) {
        const json = (await res.json()) as { ok: boolean; data: { logs: PrintLog[]; pagination: Pagination } };
        setLogs(json.data.logs);
        setPagination(json.data.pagination);
      }
    } catch {
      showToast("error", "Error al cargar logs de impresión");
    } finally {
      setLoading(false);
    }
  }, [filterType, filterStartDate, filterEndDate]);

  useEffect(() => {
    fetchLogs(1);
  }, [fetchLogs]);

  const handleReprint = useCallback(async () => {
    if (!reprintOrderId || !reprintReason.trim()) {
      showToast("warning", "Debe indicar el motivo de la reimpresión.");
      return;
    }

    setIsReprinting(true);
    try {
      // 1) Obtener HTML del documento
      const docRes = await apiFetch(`/api/sales/orders/${reprintOrderId}/document?type=${reprintDocType}`);
      if (!docRes.ok) {
        showToast("error", "No se pudo generar el documento para reimpresión.");
        return;
      }

      const docJson = (await docRes.json()) as { ok: boolean; data: { html: string } };

      // 2) Registrar log de reimpresión
      await apiFetch(`/api/sales/orders/${reprintOrderId}/print`, {
        method: "POST",
        body: JSON.stringify({
          documentType: reprintDocType,
          isReprint: true,
          reprintReason: reprintReason.trim(),
        }),
      });

      // 3) Imprimir
      const win = window.open("", "_blank", "width=400,height=600");
      if (win) {
        win.document.write(docJson.data.html);
        win.document.close();
        win.focus();
        win.print();
      }

      showToast("success", "Documento reimpreso exitosamente.");
      setReprintOrderId(null);
      setReprintReason("");
      fetchLogs(pagination.page);
    } catch {
      showToast("error", "Error al reimprimir documento.");
    } finally {
      setIsReprinting(false);
    }
  }, [reprintOrderId, reprintDocType, reprintReason, fetchLogs, pagination.page]);

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
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">Historial de Impresión</h3>
          <p className="text-sm text-[var(--color-text-muted)]">Auditoría de documentos impresos y reimpresiones.</p>
        </div>
        <Badge variant="neutral">{pagination.total} registros</Badge>
      </div>

      {/* Filtros */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-[var(--color-text-muted)]">Tipo de Documento</label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-[var(--color-surface)]"
            >
              <option value="">Todos</option>
              <option value="DELIVERY_ORDER">Orden de Entrega</option>
              <option value="PURCHASE_TICKET">Ticket de Compra</option>
              <option value="PAYMENT_RECEIPT">Comprobante de Pago</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-[var(--color-text-muted)]">Fecha Desde</label>
            <Input
              type="date"
              value={filterStartDate}
              onChange={(e) => setFilterStartDate(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--color-text-muted)]">Fecha Hasta</label>
            <Input
              type="date"
              value={filterEndDate}
              onChange={(e) => setFilterEndDate(e.target.value)}
              className="mt-1"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={() => fetchLogs(1)} className="w-full">
              Buscar
            </Button>
          </div>
        </div>
      </Card>

      {/* Tabla de logs */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">Cargando...</div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">No se encontraron registros de impresión.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-surface-alt)]">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Fecha</th>
                  <th className="px-4 py-3 text-left font-medium">Documento</th>
                  <th className="px-4 py-3 text-left font-medium">Orden</th>
                  <th className="px-4 py-3 text-left font-medium">Sucursal</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 text-left font-medium">Impreso por</th>
                  <th className="px-4 py-3 text-center font-medium">Reimpresión</th>
                  <th className="px-4 py-3 text-center font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-[var(--color-surface-alt)]/50">
                    <td className="px-4 py-3 whitespace-nowrap">{formatDate(log.printedAt)}</td>
                    <td className="px-4 py-3">
                      <Badge variant={log.isReprint ? "warning" : "neutral"}>
                        {DOC_TYPE_LABELS[log.documentType] ?? log.documentType}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {log.saleOrder.deliveryOrderNumber ?? log.saleOrder.orderNumber}
                    </td>
                    <td className="px-4 py-3">{log.saleOrder.branch.name}</td>
                    <td className="px-4 py-3 text-right font-mono">C$ {Number(log.saleOrder.grandTotal).toFixed(2)}</td>
                    <td className="px-4 py-3">
                      {log.printedBy.fullName ? `${log.printedBy.fullName} (usuario: ${log.printedBy.username})` : log.printedBy.username}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {log.isReprint ? (
                        <span className="text-xs text-[var(--color-warning-600)]" title={log.reprintReason ?? ""}>
                          Sí {log.reprintReason ? `(${log.reprintReason.substring(0, 30)})` : ""}
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--color-text-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Button
                        onClick={() => {
                          setReprintOrderId(log.saleOrder.id);
                          setReprintDocType(log.documentType);
                        }}
                        className="text-xs px-2 py-1"
                      >
                        🖨️ Reimprimir
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Paginación */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--color-border)]">
            <p className="text-xs text-[var(--color-text-muted)]">
              Página {pagination.page} de {pagination.totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                onClick={() => fetchLogs(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="text-xs px-3 py-1"
              >
                ← Anterior
              </Button>
              <Button
                onClick={() => fetchLogs(pagination.page + 1)}
                disabled={pagination.page >= pagination.totalPages}
                className="text-xs px-3 py-1"
              >
                Siguiente →
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Modal de Reimpresión */}
      {reprintOrderId && (
        <div className="fixed inset-0 z-[9990] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <Card className="w-full max-w-sm mx-4 p-6">
            <h4 className="text-base font-bold mb-3">Reimprimir Documento</h4>
            <p className="text-sm text-[var(--color-text-muted)] mb-4">
              Indique el motivo de la reimpresión para el registro de auditoría.
            </p>
            <Input
              value={reprintReason}
              onChange={(e) => setReprintReason(e.target.value)}
              placeholder="Motivo de reimpresión..."
              className="mb-4"
            />
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setReprintOrderId(null);
                  setReprintReason("");
                }}
                className="flex-1 bg-[var(--color-surface-alt)] text-[var(--color-text)]"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleReprint}
                disabled={isReprinting || !reprintReason.trim()}
                className="flex-1"
              >
                {isReprinting ? "Imprimiendo..." : "Reimprimir"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
