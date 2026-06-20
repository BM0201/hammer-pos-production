"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type OrderSummary = {
  id: string;
  orderNumber: string;
  status: string;
  grandTotal: number;
  commercialDate: string;
  createdAt: string;
  branch: { id: string; code: string; name: string };
  customerName: string | null;
  createdByName: string | null;
  linesCount: number;
  cancellable: boolean;
  paymentStatus: string | null;
  paymentMethod: string | null;
  latestPaymentAt: string | null;
  requiresTransport: boolean;
  transportAmount: number;
  requiresManualInvoice: boolean;
  manualInvoiceStatus: string;
  manualInvoiceNumber: string | null;
  deliveryOrderNumber: string | null;
};

type OrderDetail = {
  id: string;
  orderNumber: string;
  status: string;
  cancellable: boolean;
  requiresTransport: boolean;
  transportAmount: number;
  createdAt: string;
  updatedAt: string;
  notes: string | null;
  branch: { id: string; code: string; name: string };
  createdBy: { id: string; name: string; username: string } | null;
  customer: {
    id: string;
    code: string;
    name: string | null;
    legalName: string | null;
    taxId: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
  } | null;
  totals: {
    subtotal: number;
    discountTotal: number;
    taxTotal: number;
    transportAmount: number;
    grandTotal: number;
  };
  documentMode: string | null;
  requiresManualInvoice: boolean;
  manualInvoice: {
    series: string | null;
    number: string | null;
    date: string | null;
    customerName: string | null;
    customerRuc: string | null;
    status: string;
    registeredBy: string | null;
    registeredAt: string | null;
    notes: string | null;
  } | null;
  lines: {
    id: string;
    productId: string;
    productName: string;
    sku: string | null;
    unit: string | null;
    quantity: number;
    unitPrice: number;
    discountAmount: number;
    lineSubtotal: number;
  }[];
  payments: {
    id: string;
    method: string;
    status: string;
    amount: number;
    currencyCode: string;
    referenceNumber: string | null;
    paidAt: string;
    receivedByName: string | null;
    tenders: {
      id: string;
      method: string;
      amount: number;
      receivedAmount: number | null;
      changeAmount: number | null;
      referenceNumber: string | null;
    }[];
  }[];
  auditTrail: {
    id: string;
    occurredAt: string;
    action: string;
    module: string;
    actorName: string | null;
    metadata: unknown;
  }[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCurrency(val: number) {
  return `C$ ${val.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("es-NI", { dateStyle: "short", timeStyle: "short" });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-NI", { dateStyle: "short" });
}

function todayNi(): string {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Managua" }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function yesterdayNi(): string {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Managua" }));
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    DRAFT: "Borrador",
    PENDING_PAYMENT: "Pend. pago",
    PAID: "Pagada",
    DISPATCH_PENDING: "Por despachar",
    DISPATCHED: "Despachada",
    CANCELLED: "Anulada",
    RETURN_REQUESTED: "Dev. solicitada",
    RETURN_APPROVED: "Dev. aprobada",
    RETURN_REJECTED: "Dev. rechazada",
    RETURNED: "Devuelta",
  };
  return map[s] ?? s;
}

type BadgeColor = "green" | "yellow" | "red" | "gray" | "blue" | "purple";

function statusColor(s: string): BadgeColor {
  if (s === "CANCELLED" || s === "RETURN_REJECTED") return "red";
  if (s === "PAID" || s === "DISPATCHED" || s === "RETURNED") return "green";
  if (s === "PENDING_PAYMENT" || s === "DISPATCH_PENDING") return "yellow";
  if (s === "DRAFT") return "gray";
  return "blue";
}

function paymentLabel(o: OrderSummary): string {
  if (o.paymentStatus === "POSTED") return "Cobrado";
  if (o.status === "PENDING_PAYMENT") return "Pendiente";
  if (["PAID", "DISPATCHED", "RETURNED"].includes(o.status)) return "Cobrado";
  if (o.status === "CANCELLED") return "Anulado";
  return "Sin cobrar";
}

function paymentColor(o: OrderSummary): BadgeColor {
  const label = paymentLabel(o);
  if (label === "Cobrado") return "green";
  if (label === "Pendiente") return "yellow";
  if (label === "Anulado") return "red";
  return "gray";
}

function invoiceLabel(status: string, requires: boolean): string {
  if (!requires) return "No requiere";
  const map: Record<string, string> = {
    NOT_REQUIRED: "No requiere",
    PENDING: "Pendiente",
    REGISTERED: "Registrada",
    CANCELLED: "Anulada",
  };
  return map[status] ?? status;
}

function invoiceColor(status: string, requires: boolean): BadgeColor {
  if (!requires) return "gray";
  if (status === "REGISTERED") return "green";
  if (status === "PENDING") return "yellow";
  if (status === "CANCELLED") return "red";
  return "gray";
}

function detectProblems(o: OrderSummary): string[] {
  const problems: string[] = [];
  const ageH = (Date.now() - new Date(o.createdAt).getTime()) / 3_600_000;
  if (o.status === "PENDING_PAYMENT" && ageH > 3)
    problems.push(`Pendiente de cobro hace ${Math.round(ageH)}h.`);
  if (o.status === "DISPATCH_PENDING" && ageH > 4)
    problems.push(`Pendiente de despacho hace ${Math.round(ageH)}h.`);
  if (o.requiresManualInvoice && o.manualInvoiceStatus === "PENDING")
    problems.push("Factura manual pendiente de registrar.");
  if (o.requiresTransport && o.transportAmount === 0 && o.status !== "CANCELLED")
    problems.push("Requiere transporte pero monto es C$ 0.00.");
  return problems;
}

// ─── Badge ────────────────────────────────────────────────────────────────────

const badgeStyles: Record<BadgeColor, string> = {
  green: "bg-[var(--color-success-100)] text-[var(--color-success-800)] border-[var(--color-success-300)]",
  yellow: "bg-[var(--color-warning-100)] text-[var(--color-warning-800)] border-[var(--color-warning-300)]",
  red: "bg-[var(--color-danger-100)] text-[var(--color-danger-800)] border-[var(--color-danger-300)]",
  gray: "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] border-[var(--color-border)]",
  blue: "bg-[var(--color-info-100)] text-[var(--color-info-800)] border-[var(--color-info-300)]",
  purple: "bg-[var(--color-master-100)] text-[var(--color-master-800)] border-[var(--color-master-300)]",
};

function Badge({ color, children }: { color: BadgeColor; children: React.ReactNode }) {
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-xs font-medium ${badgeStyles[color]}`}>
      {children}
    </span>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, color }: { label: string; value: string | number; color?: BadgeColor }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
      <p
        className={`mt-1 text-xl font-bold ${
          color === "red"
            ? "text-[var(--color-danger-700)]"
            : color === "yellow"
              ? "text-[var(--color-warning-700)]"
              : color === "green"
                ? "text-[var(--color-success-700)]"
                : "text-[var(--color-text)]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

// ─── Cancel Modal ─────────────────────────────────────────────────────────────

function CancelModal({
  orderNumber,
  onConfirm,
  onClose,
  loading,
}: {
  orderNumber: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
  loading: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl">
        <h3 className="mb-1 font-semibold text-[var(--color-danger-700)]">Anular orden {orderNumber}</h3>
        <p className="mb-4 text-sm text-[var(--color-text-muted)]">
          Esta acción revertirá el inventario y anulará los pagos. No se puede deshacer.
        </p>
        <label className="mb-1 block text-sm font-medium text-[var(--color-text)]">
          Motivo de anulación <span className="text-[var(--color-danger-600)]">*</span>
        </label>
        <textarea
          className="mb-4 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-danger-500)]"
          rows={3}
          placeholder="Describa el motivo (mín. 10 caracteres)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
        />
        <div className="flex gap-2 justify-end">
          <button
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm disabled:opacity-60"
            onClick={onClose}
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            className="rounded-lg bg-[var(--color-danger-700)] px-4 py-2 text-sm text-white hover:bg-[var(--color-danger-800)] disabled:opacity-60"
            onClick={() => onConfirm(reason)}
            disabled={loading || reason.trim().length < 10}
          >
            {loading ? "Anulando…" : "Confirmar anulación"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

type DetailTab = "resumen" | "productos" | "pago" | "factura" | "auditoria";

function DetailPanel({
  detail,
  loading,
  onClose,
  onCancel,
}: {
  detail: OrderDetail | null;
  loading: boolean;
  onClose: () => void;
  onCancel: (id: string) => void;
}) {
  const [tab, setTab] = useState<DetailTab>("resumen");

  useEffect(() => {
    setTab("resumen");
  }, [detail?.id]);

  const tabs: { id: DetailTab; label: string }[] = [
    { id: "resumen", label: "Resumen" },
    { id: "productos", label: "Productos" },
    { id: "pago", label: "Pago" },
    ...(detail?.requiresManualInvoice ? [{ id: "factura" as DetailTab, label: "Factura" }] : []),
    { id: "auditoria", label: "Auditoría" },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <div>
          {detail ? (
            <>
              <span className="font-semibold text-[var(--color-text)]">{detail.orderNumber}</span>
              <span className="ml-2">
                <Badge color={statusColor(detail.status)}>{statusLabel(detail.status)}</Badge>
              </span>
              <p className="text-xs text-[var(--color-text-muted)]">{detail.branch.name}</p>
            </>
          ) : (
            <span className="text-sm text-[var(--color-text-muted)]">Seleccione una orden</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {detail?.cancellable && (
            <button
              className="rounded border border-[var(--color-danger-400)] px-2 py-1 text-xs text-[var(--color-danger-700)] hover:bg-[var(--color-danger-100)]"
              onClick={() => onCancel(detail.id)}
            >
              Anular
            </button>
          )}
          <button
            className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Tabs */}
      {detail && (
        <div className="flex gap-1 border-b border-[var(--color-border)] px-3 pt-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`rounded-t px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t.id
                  ? "border-b-2 border-[var(--color-master-600)] text-[var(--color-master-700)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              }`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && (
          <p className="text-sm text-[var(--color-text-muted)] animate-pulse">Cargando detalle…</p>
        )}
        {!loading && !detail && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-[var(--color-text-muted)]">
              Haga clic en una orden para ver el detalle.
            </p>
          </div>
        )}
        {!loading && detail && (
          <>
            {tab === "resumen" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-[var(--color-text-muted)]">Sucursal</p>
                    <p className="font-medium">{detail.branch.name}</p>
                  </div>
                  <div>
                    <p className="text-[var(--color-text-muted)]">Vendedor</p>
                    <p className="font-medium">{detail.createdBy?.name ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-[var(--color-text-muted)]">Cliente</p>
                    <p className="font-medium">{detail.customer?.name ?? "—"}</p>
                    {detail.customer?.taxId && (
                      <p className="text-xs text-[var(--color-text-muted)]">RUC: {detail.customer.taxId}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[var(--color-text-muted)]">Creada</p>
                    <p className="font-medium">{fmtDateTime(detail.createdAt)}</p>
                  </div>
                  <div>
                    <p className="text-[var(--color-text-muted)]">Última actualización</p>
                    <p className="font-medium">{fmtDateTime(detail.updatedAt)}</p>
                  </div>
                  <div>
                    <p className="text-[var(--color-text-muted)]">Documento</p>
                    <p className="font-medium">{detail.documentMode ?? "—"}</p>
                  </div>
                </div>

                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-sm">
                  <p className="mb-1 font-medium text-[var(--color-text-muted)]">Totales</p>
                  <div className="space-y-0.5">
                    <div className="flex justify-between">
                      <span>Subtotal</span>
                      <span>{fmtCurrency(detail.totals.subtotal)}</span>
                    </div>
                    {detail.totals.discountTotal > 0 && (
                      <div className="flex justify-between text-[var(--color-danger-700)]">
                        <span>Descuento</span>
                        <span>−{fmtCurrency(detail.totals.discountTotal)}</span>
                      </div>
                    )}
                    {detail.totals.taxTotal > 0 && (
                      <div className="flex justify-between">
                        <span>Impuesto</span>
                        <span>{fmtCurrency(detail.totals.taxTotal)}</span>
                      </div>
                    )}
                    {detail.requiresTransport && (
                      <div className="flex justify-between">
                        <span>Transporte</span>
                        <span>{fmtCurrency(detail.totals.transportAmount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-[var(--color-border)] pt-1 font-semibold">
                      <span>Total</span>
                      <span>{fmtCurrency(detail.totals.grandTotal)}</span>
                    </div>
                  </div>
                </div>

                {detail.notes && (
                  <div className="rounded-lg border border-[var(--color-warning-300)] bg-[var(--color-warning-50)] p-3 text-sm">
                    <p className="mb-1 font-medium text-[var(--color-warning-700)]">Notas</p>
                    <p className="whitespace-pre-wrap text-[var(--color-text)]">{detail.notes}</p>
                  </div>
                )}
              </div>
            )}

            {tab === "productos" && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">
                      <th className="py-2 pr-3">Producto</th>
                      <th className="py-2 pr-3 text-right">Cant.</th>
                      <th className="py-2 pr-3 text-right">P. Unit.</th>
                      <th className="py-2 pr-3 text-right">Desc.</th>
                      <th className="py-2 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((l) => (
                      <tr key={l.id} className="border-b border-[var(--color-border)]">
                        <td className="py-2 pr-3">
                          <p className="font-medium">{l.productName}</p>
                          {l.sku && <p className="text-xs text-[var(--color-text-muted)]">{l.sku}</p>}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          {l.quantity} {l.unit ?? ""}
                        </td>
                        <td className="py-2 pr-3 text-right">{fmtCurrency(l.unitPrice)}</td>
                        <td className="py-2 pr-3 text-right">
                          {l.discountAmount > 0 ? fmtCurrency(l.discountAmount) : "—"}
                        </td>
                        <td className="py-2 text-right font-medium">{fmtCurrency(l.lineSubtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {detail.lines.length === 0 && (
                  <p className="py-4 text-center text-sm text-[var(--color-text-muted)]">Sin líneas.</p>
                )}
              </div>
            )}

            {tab === "pago" && (
              <div className="space-y-3">
                {detail.payments.length === 0 && (
                  <p className="text-sm text-[var(--color-text-muted)]">Sin pagos registrados.</p>
                )}
                {detail.payments.map((p) => (
                  <div
                    key={p.id}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-sm"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-medium">
                        {p.method} · {fmtCurrency(p.amount)} {p.currencyCode}
                      </span>
                      <Badge color={p.status === "POSTED" ? "green" : p.status === "VOIDED" ? "red" : "yellow"}>
                        {p.status === "POSTED" ? "Cobrado" : p.status === "VOIDED" ? "Anulado" : p.status}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-xs text-[var(--color-text-muted)]">
                      <span>Cajero: {p.receivedByName ?? "—"}</span>
                      <span>Fecha: {fmtDateTime(p.paidAt)}</span>
                      {p.referenceNumber && <span className="col-span-2">Ref: {p.referenceNumber}</span>}
                    </div>
                    {p.tenders.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {p.tenders.map((t) => (
                          <div key={t.id} className="flex justify-between text-xs">
                            <span>{t.method}</span>
                            <span>
                              {fmtCurrency(t.amount)}
                              {t.receivedAmount != null && t.receivedAmount !== t.amount
                                ? ` (recibido ${fmtCurrency(t.receivedAmount)}, cambio ${fmtCurrency(t.changeAmount ?? 0)})`
                                : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {tab === "factura" && detail.manualInvoice && (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[var(--color-text-muted)]">Estado factura</p>
                    <Badge color={invoiceColor(detail.manualInvoice.status, true)}>
                      {invoiceLabel(detail.manualInvoice.status, true)}
                    </Badge>
                  </div>
                  {detail.manualInvoice.series && (
                    <div>
                      <p className="text-[var(--color-text-muted)]">Serie / Número</p>
                      <p className="font-medium">
                        {detail.manualInvoice.series}-{detail.manualInvoice.number}
                      </p>
                    </div>
                  )}
                  {detail.manualInvoice.date && (
                    <div>
                      <p className="text-[var(--color-text-muted)]">Fecha factura</p>
                      <p className="font-medium">{fmtDate(detail.manualInvoice.date)}</p>
                    </div>
                  )}
                  {detail.manualInvoice.customerName && (
                    <div>
                      <p className="text-[var(--color-text-muted)]">Cliente (factura)</p>
                      <p className="font-medium">{detail.manualInvoice.customerName}</p>
                      {detail.manualInvoice.customerRuc && (
                        <p className="text-xs text-[var(--color-text-muted)]">
                          RUC: {detail.manualInvoice.customerRuc}
                        </p>
                      )}
                    </div>
                  )}
                  {detail.manualInvoice.registeredBy && (
                    <div>
                      <p className="text-[var(--color-text-muted)]">Registrada por</p>
                      <p className="font-medium">{detail.manualInvoice.registeredBy}</p>
                      {detail.manualInvoice.registeredAt && (
                        <p className="text-xs text-[var(--color-text-muted)]">
                          {fmtDateTime(detail.manualInvoice.registeredAt)}
                        </p>
                      )}
                    </div>
                  )}
                </div>
                {detail.manualInvoice.notes && (
                  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-xs">
                    {detail.manualInvoice.notes}
                  </div>
                )}
              </div>
            )}

            {tab === "auditoria" && (
              <div className="space-y-2">
                {detail.auditTrail.length === 0 && (
                  <p className="text-sm text-[var(--color-text-muted)]">Sin registros de auditoría.</p>
                )}
                {detail.auditTrail.map((a) => (
                  <div
                    key={a.id}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-xs"
                  >
                    <div className="mb-0.5 flex items-center justify-between">
                      <span className="font-medium text-[var(--color-text)]">{a.action}</span>
                      <span className="text-[var(--color-text-muted)]">{fmtDateTime(a.occurredAt)}</span>
                    </div>
                    <p className="text-[var(--color-text-muted)]">{a.actorName ?? "Sistema"}</p>
                    {a.metadata != null &&
                      typeof a.metadata === "object" &&
                      "reason" in (a.metadata as Record<string, unknown>) && (
                        <p className="mt-1 italic text-[var(--color-text-secondary)]">
                          {String((a.metadata as Record<string, unknown>).reason)}
                        </p>
                      )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "", label: "Todos los estados" },
  { value: "PENDING_PAYMENT", label: "Pend. pago" },
  { value: "PAID", label: "Pagadas" },
  { value: "DISPATCH_PENDING", label: "Por despachar" },
  { value: "DISPATCHED", label: "Despachadas" },
  { value: "CANCELLED", label: "Anuladas" },
  { value: "RETURN_REQUESTED", label: "Dev. solicitadas" },
];

export function OrdersAdmin({ branchId }: { branchId?: string; isMaster?: boolean }) {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [dateMode, setDateMode] = useState<"today" | "yesterday" | "custom">("today");
  const [customDate, setCustomDate] = useState(todayNi());
  const [statusFilter, setStatusFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [problemsOnly, setProblemsOnly] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detail
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Cancel
  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const activeDate = dateMode === "custom" ? customDate : dateMode === "yesterday" ? yesterdayNi() : todayNi();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (branchId) params.set("branchId", branchId);
      if (activeDate) params.set("date", activeDate);
      if (statusFilter) params.set("status", statusFilter);
      if (search.trim()) params.set("search", search.trim());
      const res = await apiFetch(`/api/master/sales-orders?${params.toString()}`);
      const json = (await res.json()) as { data?: { orders?: OrderSummary[] } };
      setOrders(json.data?.orders ?? []);
    } catch {
      setError("Error al cargar órdenes. Verifique su conexión.");
    } finally {
      setLoading(false);
    }
  }, [branchId, activeDate, statusFilter, search]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(searchInput), 350);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchInput]);

  const loadDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await apiFetch(`/api/master/sales-orders/${id}`);
      const json = (await res.json()) as { data?: OrderDetail };
      setDetail(json.data ?? null);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleCancel = useCallback(
    async (orderId: string, reason: string) => {
      setCancelling(true);
      try {
        const res = await apiFetch(`/api/master/sales-orders/${orderId}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        });
        if (!res.ok) {
          const json = (await res.json()) as { error?: string };
          alert(json.error ?? "Error al anular la orden.");
          return;
        }
        setCancelTargetId(null);
        await load();
        if (selectedId === orderId) {
          await loadDetail(orderId);
        }
      } catch {
        alert("Error de red al anular la orden.");
      } finally {
        setCancelling(false);
      }
    },
    [load, loadDetail, selectedId],
  );

  // Derived KPIs
  const visible = problemsOnly ? orders.filter((o) => detectProblems(o).length > 0) : orders;
  const totalAmount = orders.reduce((s, o) => s + (o.status !== "CANCELLED" ? o.grandTotal : 0), 0);
  const pendingPayment = orders.filter((o) => o.status === "PENDING_PAYMENT").length;
  const pendingInvoice = orders.filter(
    (o) => o.requiresManualInvoice && o.manualInvoiceStatus === "PENDING",
  ).length;
  const cancelled = orders.filter((o) => o.status === "CANCELLED").length;
  const withProblems = orders.filter((o) => detectProblems(o).length > 0).length;

  const cancelTarget = cancelTargetId ? orders.find((o) => o.id === cancelTargetId) ?? detail : null;

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <KpiCard label="Total del día" value={fmtCurrency(totalAmount)} />
        <KpiCard label="Órdenes" value={orders.length} />
        <KpiCard label="Pend. cobro" value={pendingPayment} color={pendingPayment > 0 ? "yellow" : undefined} />
        <KpiCard label="Pend. factura" value={pendingInvoice} color={pendingInvoice > 0 ? "yellow" : undefined} />
        <KpiCard label="Con problemas" value={withProblems} color={withProblems > 0 ? "red" : undefined} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3">
        {/* Date quick-select */}
        <div className="flex gap-1">
          {(["today", "yesterday", "custom"] as const).map((m) => (
            <button
              key={m}
              className={`rounded border px-2 py-1 text-xs font-medium transition-colors ${
                dateMode === m
                  ? "border-[var(--color-master-600)] bg-[var(--color-master-600)] text-white"
                  : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]"
              }`}
              onClick={() => setDateMode(m)}
            >
              {m === "today" ? "Hoy" : m === "yesterday" ? "Ayer" : "Fecha"}
            </button>
          ))}
        </div>
        {dateMode === "custom" && (
          <input
            type="date"
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs"
            value={customDate}
            onChange={(e) => setCustomDate(e.target.value)}
          />
        )}

        {/* Status filter */}
        <select
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {/* Search */}
        <input
          type="text"
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs placeholder:text-[var(--color-text-muted)]"
          placeholder="Buscar por orden, cliente…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />

        {/* Problems filter */}
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
          <input
            type="checkbox"
            className="h-3.5 w-3.5"
            checked={problemsOnly}
            onChange={(e) => setProblemsOnly(e.target.checked)}
          />
          Solo con problemas
          {withProblems > 0 && (
            <span className="rounded-full bg-[var(--color-danger-600)] px-1.5 py-0.5 text-[10px] font-bold text-white">
              {withProblems}
            </span>
          )}
        </label>

        <button
          className="ml-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-xs hover:bg-[var(--color-surface-alt)]"
          onClick={() => load()}
          disabled={loading}
        >
          {loading ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-[var(--color-danger-300)] bg-[var(--color-danger-50)] p-3 text-sm text-[var(--color-danger-700)]">
          {error}
        </div>
      )}

      {/* Two-column layout */}
      <div className={`grid gap-4 ${selectedId ? "lg:grid-cols-[1fr_400px]" : ""}`}>
        {/* Orders list */}
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
          {loading && orders.length === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--color-text-muted)] animate-pulse">
              Cargando órdenes…
            </div>
          ) : visible.length === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">
              {orders.length === 0
                ? "No hay órdenes para este período."
                : "Ninguna orden coincide con los filtros activos."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-alt)] text-left text-xs text-[var(--color-text-muted)]">
                    <th className="px-3 py-2">Orden</th>
                    <th className="px-3 py-2">Hora</th>
                    {!branchId && <th className="px-3 py-2">Sucursal</th>}
                    <th className="px-3 py-2">Cliente</th>
                    <th className="px-3 py-2">Estado</th>
                    <th className="px-3 py-2">Cobro</th>
                    <th className="px-3 py-2">Factura</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((o) => {
                    const problems = detectProblems(o);
                    const isSelected = selectedId === o.id;
                    return (
                      <tr
                        key={o.id}
                        className={`cursor-pointer border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-surface-alt)] ${
                          isSelected ? "bg-[var(--color-master-50)]" : ""
                        }`}
                        onClick={() => loadDetail(o.id)}
                      >
                        <td className="px-3 py-2">
                          <p className="font-medium text-[var(--color-text)]">{o.orderNumber}</p>
                          {problems.length > 0 && (
                            <p className="text-[10px] text-[var(--color-danger-600)]">
                              ⚠ {problems[0]}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
                          {fmtDateTime(o.commercialDate).split(",")[1]?.trim() ?? "—"}
                        </td>
                        {!branchId && (
                          <td className="px-3 py-2 text-xs">
                            <span className="rounded bg-[var(--color-surface-alt)] px-1.5 py-0.5 font-medium">
                              {o.branch.code}
                            </span>
                          </td>
                        )}
                        <td className="px-3 py-2 text-xs text-[var(--color-text-secondary)]">
                          {o.customerName ?? <span className="text-[var(--color-text-muted)]">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          <Badge color={statusColor(o.status)}>{statusLabel(o.status)}</Badge>
                        </td>
                        <td className="px-3 py-2">
                          <Badge color={paymentColor(o)}>{paymentLabel(o)}</Badge>
                        </td>
                        <td className="px-3 py-2">
                          <Badge color={invoiceColor(o.manualInvoiceStatus, o.requiresManualInvoice)}>
                            {invoiceLabel(o.manualInvoiceStatus, o.requiresManualInvoice)}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right font-medium">{fmtCurrency(o.grandTotal)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Day summary */}
          {visible.length > 0 && (
            <div className="flex items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
              <span>
                {visible.length} orden{visible.length !== 1 ? "es" : ""}
                {cancelled > 0 ? ` · ${cancelled} anulada${cancelled !== 1 ? "s" : ""}` : ""}
              </span>
              <span className="font-medium">
                Total facturado (no anulado):{" "}
                <span className="text-[var(--color-text)]">{fmtCurrency(totalAmount)}</span>
              </span>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedId && (
          <div className="h-[600px]">
            <DetailPanel
              detail={detail}
              loading={detailLoading}
              onClose={() => {
                setSelectedId(null);
                setDetail(null);
              }}
              onCancel={(id) => setCancelTargetId(id)}
            />
          </div>
        )}
      </div>

      {/* Cancel modal */}
      {cancelTargetId && (cancelTarget !== null || true) && (
        <CancelModal
          orderNumber={
            (cancelTarget as OrderSummary | OrderDetail | null)?.orderNumber ?? "?"
          }
          loading={cancelling}
          onClose={() => setCancelTargetId(null)}
          onConfirm={(reason) => handleCancel(cancelTargetId, reason)}
        />
      )}
    </div>
  );
}
