"use client";

import { Download, FileText, AlertTriangle, ArrowUp, ArrowDown, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState, useMemo } from "react";

export type ColumnDef = {
  key: string;
  label: string;
  type: "text" | "currency" | "date" | "datetime" | "status" | "number" | "percent";
  align?: "left" | "right" | "center";
};

const NIO = new Intl.NumberFormat("es-NI", { style: "currency", currency: "NIO" });
const NUM = new Intl.NumberFormat("es-NI");

function fmtDate(value: unknown): string {
  if (!value) return "";
  const d = new Date(String(value));
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("es-NI", { timeZone: "UTC" });
}

function fmtDatetime(value: unknown): string {
  if (!value) return "";
  const d = new Date(String(value));
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleString("es-NI", { timeZone: "America/Managua" });
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  PAID: "success", POSTED: "success", APPROVED: "success", DISPATCHED: "success",
  RECEIVED: "success", COMPLETED: "success", ACTIVE: "success", RECONCILED: "success",
  RETURN_APPROVED: "success",
  PENDING: "warning", REQUESTED: "warning", IN_TRANSIT: "warning",
  PARTIALLY_RECEIVED: "warning", DRAFT: "warning", RECONCILING: "warning",
  PENDING_PAYMENT: "warning", RETURN_REQUESTED: "warning", DISPATCH_PENDING: "info",
  OPEN: "info", CLOSING: "info",
  CANCELLED: "danger", VOIDED: "danger", REJECTED: "danger", RETURNED: "danger",
  RETURN_REJECTED: "danger",
};

const STATUS_LABEL: Record<string, string> = {
  PAID: "Pagado", POSTED: "Cobrado", APPROVED: "Aprobado", DISPATCHED: "Despachado",
  RECEIVED: "Recibido", COMPLETED: "Completado", ACTIVE: "Activo", RECONCILED: "Reconciliado",
  PENDING: "Pendiente", REQUESTED: "Solicitado", IN_TRANSIT: "En tránsito",
  PARTIALLY_RECEIVED: "Parc. recibido", DRAFT: "Borrador", RECONCILING: "Reconciliando",
  PENDING_PAYMENT: "Pend. pago", RETURN_REQUESTED: "Dev. solicitada",
  DISPATCH_PENDING: "Pend. despacho", OPEN: "Abierto", CLOSING: "Cerrando",
  CANCELLED: "Cancelado", VOIDED: "Anulado", REJECTED: "Rechazado",
  RETURNED: "Devuelto", RETURN_REJECTED: "Dev. rechazada",
};

function Cell({ value, type }: { value: unknown; type: ColumnDef["type"] }) {
  if (value == null || value === "") {
    return <span className="text-[var(--color-text-muted)] select-none">—</span>;
  }
  switch (type) {
    case "currency":
      return <span className="font-semibold tabular-nums">{NIO.format(Number(value))}</span>;
    case "number":
      return <span className="tabular-nums">{NUM.format(Number(value))}</span>;
    case "percent":
      return <span className="tabular-nums">{Number(value).toFixed(1)}%</span>;
    case "date":
      return <span className="text-xs tabular-nums">{fmtDate(value)}</span>;
    case "datetime":
      return <span className="text-xs tabular-nums">{fmtDatetime(value)}</span>;
    case "status": {
      const key = String(value);
      return (
        <Badge variant={STATUS_VARIANT[key] ?? "neutral"} className="text-xs">
          {STATUS_LABEL[key] ?? key}
        </Badge>
      );
    }
    default:
      return <span className="text-xs">{String(value)}</span>;
  }
}

const PAGE_SIZE = 50;

type SortState = { key: string; dir: "asc" | "desc" } | null;

type Props = {
  rows: Record<string, unknown>[];
  count: number;
  maxRows: number;
  columns: ColumnDef[];
  generatedAt: string;
  exportCsvUrl: string;
  exportPdfUrl: string;
  reportLabel: string;
};

export function ReportPreviewTable({ rows, count, maxRows, columns, generatedAt, exportCsvUrl, exportPdfUrl, reportLabel }: Props) {
  const [page, setPage]     = useState(0);
  const [sort, setSort]     = useState<SortState>(null);
  const truncated = count >= maxRows;

  const sorted = useMemo(() => {
    if (!sort) return rows;
    return [...rows].sort((a, b) => {
      const av = a[sort.key] ?? "";
      const bv = b[sort.key] ?? "";
      const cmp = String(av).localeCompare(String(bv), "es", { numeric: true });
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [rows, sort]);

  const page_rows  = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));

  function toggleSort(key: string) {
    setSort((s) => {
      if (s?.key === key) return s.dir === "asc" ? { key, dir: "desc" } : null;
      return { key, dir: "asc" };
    });
  }

  function SortIcon({ col }: { col: string }) {
    if (sort?.key !== col) return <Minus className="opacity-25" style={{ width: "0.75rem", height: "0.75rem" }} />;
    return sort.dir === "asc"
      ? <ArrowUp className="text-[var(--color-info-600)]" style={{ width: "0.75rem", height: "0.75rem" }} />
      : <ArrowDown className="text-[var(--color-info-600)]" style={{ width: "0.75rem", height: "0.75rem" }} />;
  }

  return (
    <div className="hm-module-card overflow-hidden">
      {/* Export bar */}
      <div className="hm-module-card-header flex-wrap gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-[var(--color-text)]">Vista previa — {reportLabel}</span>
          <span className="hm-chip hm-chip-info text-xs">{count.toLocaleString("es-NI")} filas</span>
          {truncated && (
            <span className="flex items-center gap-1 text-xs font-semibold text-[var(--color-warning-700)]">
              <AlertTriangle style={{ width: "0.75rem", height: "0.75rem" }} />
              Limitado a {maxRows.toLocaleString("es-NI")} filas — use filtros para acotar
            </span>
          )}
          <span className="hidden text-[0.625rem] text-[var(--color-text-muted)] xl:inline">
            Generado {new Date(generatedAt).toLocaleString("es-NI", { timeZone: "America/Managua" })}
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<Download className="h-3.5 w-3.5" />}
            onClick={() => { window.location.href = exportCsvUrl; }}
          >
            CSV
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={<FileText className="h-3.5 w-3.5" />}
            onClick={() => { window.location.href = exportPdfUrl; }}
          >
            PDF
          </Button>
        </div>
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <p className="text-sm font-semibold text-[var(--color-text-secondary)]">Sin datos para los filtros seleccionados.</p>
          <p className="text-xs text-[var(--color-text-muted)]">Ajusta el rango de fechas o los filtros e intenta de nuevo.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="hm-table w-full text-left text-xs">
              <thead>
                <tr>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={`cursor-pointer select-none ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""}`}
                      onClick={() => toggleSort(col.key)}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        <SortIcon col={col.key} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page_rows.map((row, i) => (
                  <tr key={i}>
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""}
                      >
                        <Cell value={row[col.key]} type={col.type} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-4 border-t border-[var(--color-border)] px-4 py-2.5">
              <span className="text-xs text-[var(--color-text-muted)]">
                Pág. {page + 1} / {totalPages} — mostrando {page_rows.length} de {sorted.length} filas
              </span>
              <div className="flex gap-1">
                <button
                  className="hm-icon-btn"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >‹</button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const target = Math.min(Math.max(page - 2, 0) + i, totalPages - 1);
                  return (
                    <button
                      key={target}
                      className={`hm-icon-btn ${target === page ? "bg-[var(--color-info-50)] text-[var(--color-info-700)] font-bold border-[var(--color-info-200)]" : ""}`}
                      onClick={() => setPage(target)}
                    >{target + 1}</button>
                  );
                })}
                <button
                  className="hm-icon-btn"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                >›</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
