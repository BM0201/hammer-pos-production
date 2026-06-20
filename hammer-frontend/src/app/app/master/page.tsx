"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import toast from "react-hot-toast";
import {
  Building2,
  Users,
  Wallet,
  CircleDot,
  RefreshCw,
  ClipboardCheck,
  History,
  AlertTriangle,
  CheckCircle2,
  Banknote,
  Settings,
  Activity,
  ChevronRight,
  FileText,
  Ban,
  X,
  Eye,
  User as UserIcon,
  Package,
  CreditCard,
  Receipt,
  Printer,
  type LucideIcon,
} from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { useOperationalPolling } from "@/lib/realtime/use-operational-polling";

/* Quick access to management screens that were removed from the sidebar:
   the Command Center is now the single entry point for cash/box/user control. */
const MANAGEMENT_LINKS: { href: string; label: string; description: string; icon: LucideIcon }[] = [
  { href: "/app/master/cash-closure-reports", label: "Cierres de Caja", description: "Revisar y aprobar cierres", icon: Wallet },
  { href: "/app/master/cash-boxes", label: "Cajas Físicas", description: "Administrar cajas por sucursal", icon: Settings },
  { href: "/app/master/settings/operational-automation", label: "Automatización Operativa", description: "Apertura de día, cierre de cajas y cierre operativo", icon: Activity },
  { href: "/app/master/users/activity", label: "Detalle de usuarios", description: "Actividad y sesiones en detalle", icon: Activity },
];

/* ──────────────────────────────────────────────────────────────────────── */
/* Types (mirror backend command-center snapshot)                            */
/* ──────────────────────────────────────────────────────────────────────── */

type ConnectedUser = {
  userId: string;
  username: string;
  globalRole: string;
  status: "ONLINE" | "IDLE" | "OFFLINE";
  currentModule: string | null;
  branch: { code: string; name: string } | null;
  lastSeenAt: string | null;
  activeCashSessions: { id: string }[];
};

type BranchBlock = {
  branchId: string;
  branchCode: string;
  branchName: string;
  boxesTotal: number;
  boxesActive: number;
  openSessions: number;
  reconcilingSessions: number;
  pendingReviewSessions: number;
  salesToday: number;
  paidSalesCount: number;
  pendingPaymentTotal: number;
  pendingPaymentCount: number;
  openingCashTotal: number;
  cashTenderNetTotal: number;
  cashMovementsNet: number;
  cashExpensesTotal: number;
  cashOutflowsTotal: number;
  expectedCashOnHand: number;
  cashNetWithoutOpening: number;
  cardTenderTotal: number;
  transferTenderTotal: number;
  otherTenderTotal: number;
  estimatedCostOfGoodsSold: number | null;
  estimatedGrossProfit: number | null;
  activeCashSessionIds: string[];
  lastSale: {
    orderNumber: string;
    amount: number;
    paidAt: string;
    method: string;
  } | null;
  operationalDay: {
    status: string;
    salesTotal: number;
    expectedCashTotal: number | null;
    countedCashTotal: number | null;
    cashDifferenceTotal: number | null;
    openCashSessionsCount: number;
    autoClosedPendingReviewCount: number;
    pendingDispatchCount: number;
  } | null;
};

type CashClosure = {
  id: string;
  status: string;
  branchCode: string;
  branchName: string;
  boxCode: string;
  boxName: string;
  openedBy: string | null;
  closedBy: string | null;
  openedAt: string;
  closedAt: string | null;
  autoClosedBySystem: boolean;
  requiresReview: boolean;
  openingAmount: number;
  expectedCashAmount: number | null;
  countedCashAmount: number | null;
  differenceAmount: number | null;
};

type CommandCenter = {
  generatedAt: string;
  totals: {
    salesToday: number;
    openSessions: number;
    pendingReviewSessions: number;
    reconcilingSessions: number;
    closuresCompletedToday: number;
    boxesActive: number;
    boxesTotal: number;
    usersOnline: number;
    usersIdle: number;
    usersOffline: number;
    paidSalesCount: number;
    pendingPaymentTotal: number;
    pendingPaymentCount: number;
    openingCashTotal: number;
    cashTenderNetTotal: number;
    cashMovementsNet: number;
    cashExpensesTotal: number;
    cashOutflowsTotal: number;
    expectedCashOnHand: number;
    cashNetWithoutOpening: number;
    cardTenderTotal: number;
    transferTenderTotal: number;
    otherTenderTotal: number;
  };
  users: {
    summary: { online: number; idle: number; offline: number; openCashSessions: number };
    list: ConnectedUser[];
  };
  byBranch: BranchBlock[];
  cashClosures: {
    pending: CashClosure[];
    completedToday: CashClosure[];
    history: CashClosure[];
  };
};

/** Factura/orden para la gestión de anulaciones (mirror backend). */
type ManagedOrder = {
  id: string;
  orderNumber: string;
  deliveryOrderNumber: string | null;
  deliveryOrderIssuedAt: string | null;
  documentMode: string;
  requiresManualInvoice: boolean;
  manualInvoiceSeries: string | null;
  manualInvoiceNumber: string | null;
  manualInvoiceStatus: string | null;
  manualInvoiceRegisteredAt: string | null;
  manualInvoiceCustomerName: string | null;
  manualInvoiceCustomerRuc: string | null;
  latestPaymentAt: string | null;
  paymentStatus: string | null;
  paymentMethod: string | null;
  commercialDate: string;
  status: string;
  grandTotal: number;
  createdAt: string;
  branch: { id: string; code: string; name: string };
  customerName: string | null;
  createdByName: string | null;
  linesCount: number;
  cancellable: boolean;
};

/** Detalle completo de una factura (vista de auditoría). */
type OrderDetail = {
  id: string;
  orderNumber: string;
  status: string;
  cancellable: boolean;
  createdAt: string;
  updatedAt: string;
  notes: string | null;
  branch: { id: string; code: string; name: string };
  createdBy: { id: string; name: string; username: string } | null;
  customer: {
    id: string;
    code: string;
    name: string;
    legalName: string;
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
  documentMode: string;
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

/* ──────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                   */
/* ──────────────────────────────────────────────────────────────────────── */

const money = (n: number) => `C$${n.toFixed(2)}`;

/** Etiquetas en español para los estados de las órdenes de venta. */
const ORDER_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Borrador",
  PENDING_PAYMENT: "Pago pendiente",
  PAID: "Pagada",
  DISPATCH_PENDING: "Despacho pendiente",
  DISPATCHED: "Despachada",
  CANCELLED: "Anulada",
  RETURN_REQUESTED: "Devolución solicitada",
  RETURN_APPROVED: "Devolución aprobada",
  RETURN_REJECTED: "Devolución rechazada",
  RETURNED: "Devuelta",
};

/** Badge de color según el estado de la orden. */
function orderStatusBadge(status: string) {
  const label = ORDER_STATUS_LABELS[status] ?? status;
  if (status === "CANCELLED") return <Badge variant="danger">{label}</Badge>;
  if (status === "PAID" || status === "DISPATCHED") return <Badge variant="success">{label}</Badge>;
  if (status === "PENDING_PAYMENT" || status === "DISPATCH_PENDING") return <Badge variant="warning">{label}</Badge>;
  if (status.startsWith("RETURN") || status === "RETURNED") return <Badge variant="info">{label}</Badge>;
  return <Badge variant="neutral">{label}</Badge>;
}

/** Fecha y hora completa (Managua) de un ISO timestamp. */
function localDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-NI", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Managua",
  });
}

/** Etiquetas en español para los métodos de pago. */
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  TRANSFER: "Transferencia",
  CREDIT: "Crédito",
  CHECK: "Cheque",
  MIXED: "Mixto",
  OTHER: "Otro",
};
const paymentMethodLabel = (m: string) => PAYMENT_METHOD_LABELS[m] ?? m;

/** Etiquetas legibles para las acciones del historial de auditoría. */
const AUDIT_ACTION_LABELS: Record<string, string> = {
  SALE_ORDER_CANCELLED: "Factura anulada",
  SALE_ORDER_CANCEL_DENIED: "Intento de anulación denegado",
};
const auditActionLabel = (a: string) => AUDIT_ACTION_LABELS[a] ?? a;

/** Fecha de hoy en formato YYYY-MM-DD en la zona horaria de Managua. */
function todayManaguaYmd(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Managua",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts; // en-CA produce YYYY-MM-DD
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(iso).toLocaleDateString("es-NI");
}

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Abierta",
  RECONCILING: "Conciliando",
  AUTO_CLOSED_PENDING_REVIEW: "Pendiente de revisión",
  AUTO_CLOSED: "Cerrada (auto)",
  CLOSED: "Cerrada",
  PERMANENTLY_CLOSED: "Cerrada definitiva",
};

const DAY_STATUS_LABELS: Record<string, string> = {
  OPEN: "Abierto",
  CLOSING: "Cerrando",
  CLOSED: "Cerrado",
  CANCELLED: "Cancelado",
};

function statusBadge(status: string) {
  if (status === "OPEN") return <Badge variant="success">{STATUS_LABELS[status]}</Badge>;
  if (status === "RECONCILING") return <Badge variant="warning">{STATUS_LABELS[status]}</Badge>;
  if (status === "AUTO_CLOSED_PENDING_REVIEW") return <Badge variant="danger">{STATUS_LABELS[status]}</Badge>;
  return <Badge variant="neutral">{STATUS_LABELS[status] ?? status}</Badge>;
}

function presenceDot(status: ConnectedUser["status"]) {
  const color =
    status === "ONLINE" ? "var(--color-success-500)" : status === "IDLE" ? "var(--color-warning-500)" : "var(--color-text-soft)";
  return <CircleDot className="h-3.5 w-3.5" style={{ color }} />;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Cash closures table                                                       */
/* ──────────────────────────────────────────────────────────────────────── */

function ClosuresTable({
  rows,
  showDifference,
  onConfirmOk,
  onRegisterDifference,
  reviewingId,
}: {
  rows: CashClosure[];
  showDifference: boolean;
  onConfirmOk?: (row: CashClosure) => void;
  onRegisterDifference?: (row: CashClosure) => void;
  reviewingId?: string | null;
}) {
  if (rows.length === 0) {
    return (
      <div className="flex items-center gap-2 px-5 py-8 text-sm text-[var(--color-text-muted)] justify-center">
        <CheckCircle2 className="h-4 w-4 text-[var(--color-success-500)]" />
        Sin registros.
      </div>
    );
  }
  return (
    <Table>
      <THead>
        <TR>
          <TH>Sucursal / Caja</TH>
          <TH>Estado</TH>
          <TH>Responsable</TH>
          <TH className="text-right">Esperado</TH>
          <TH className="text-right">Contado</TH>
          {showDifference && <TH className="text-right">Diferencia</TH>}
          <TH className="text-right">Hora</TH>
          {(onConfirmOk || onRegisterDifference) && <TH className="text-right">Acciones</TH>}
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.id}>
            <TD>
              <div className="flex flex-col">
                <span className="font-medium text-[var(--color-text)]">
                  {r.branchCode} · {r.boxName}
                </span>
                <span className="text-xs text-[var(--color-text-muted)]">{r.branchName}</span>
              </div>
            </TD>
            <TD>
              <div className="flex items-center gap-1.5">
                {statusBadge(r.status)}
                {r.autoClosedBySystem && (
                  <span className="text-[0.625rem] text-[var(--color-text-soft)] uppercase tracking-wide">auto</span>
                )}
              </div>
            </TD>
            <TD className="text-sm text-[var(--color-text-secondary)]">{r.closedBy ?? r.openedBy ?? "—"}</TD>
            <TD className="text-right font-mono text-xs">{r.expectedCashAmount === null ? "—" : money(r.expectedCashAmount)}</TD>
            <TD className="text-right font-mono text-xs">{r.countedCashAmount === null ? "—" : money(r.countedCashAmount)}</TD>
            {showDifference && (
              <TD className="text-right font-mono text-xs">
                {r.differenceAmount === null ? (
                  "—"
                ) : (
                  <span
                    className={
                      Math.abs(r.differenceAmount) < 0.01
                        ? "text-[var(--color-success-600)]"
                        : "text-[var(--color-danger-600)] font-semibold"
                    }
                  >
                    {money(r.differenceAmount)}
                  </span>
                )}
              </TD>
            )}
            <TD className="text-right text-xs text-[var(--color-text-muted)]">{timeAgo(r.closedAt ?? r.openedAt)}</TD>
            {(onConfirmOk || onRegisterDifference) && (
              <TD className="text-right">
                {r.status === "AUTO_CLOSED_PENDING_REVIEW" ? (
                  <div className="flex justify-end gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={reviewingId === r.id}
                      disabled={Boolean(reviewingId)}
                      icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                      onClick={() => onConfirmOk?.(r)}
                    >
                      OK
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={Boolean(reviewingId)}
                      icon={<Receipt className="h-3.5 w-3.5" />}
                      onClick={() => onRegisterDifference?.(r)}
                    >
                      Diferencia
                    </Button>
                  </div>
                ) : (
                  <span className="text-[var(--color-text-soft)]">-</span>
                )}
              </TD>
            )}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Gestión de Facturas (anulación) — solo rol master                         */
/* ──────────────────────────────────────────────────────────────────────── */

/** Celda de información etiqueta/valor para el modal de detalle. */
function InfoTile({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[0.625rem] uppercase tracking-wide text-[var(--color-text-muted)]">
        {icon}
        {label}
      </div>
      <div className="text-sm text-[var(--color-text)] truncate" title={value}>
        {value}
      </div>
    </div>
  );
}

/** Título de sección dentro del modal de detalle. */
function SectionTitle({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] mb-2">
      {icon}
      {children}
    </h4>
  );
}

/** Fila de total (etiqueta + monto) para el resumen del modal. */
function TotalRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-[var(--color-text-secondary)]">
      <span>{label}</span>
      <span className="font-mono">{money(value)}</span>
    </div>
  );
}

function CashMiniRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <span className="truncate text-[var(--color-text-muted)]">{label}</span>
      <span className={`shrink-0 font-mono ${strong ? "font-semibold text-[var(--color-text)]" : "text-[var(--color-text-secondary)]"}`}>
        {value}
      </span>
    </div>
  );
}

/**
 * Genera una vista imprimible (y exportable a PDF vía "Guardar como PDF") del
 * detalle de la factura en una ventana nueva.
 */
function printOrderDetail(d: OrderDetail) {
  const esc = (s: unknown) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
  const rows = d.lines
    .map(
      (l) =>
        `<tr><td>${esc(l.productName)}</td><td>${esc(l.sku ?? "—")}</td><td style="text-align:right">${esc(l.quantity)} ${esc(l.unit ?? "")}</td><td style="text-align:right">${money(l.unitPrice)}</td><td style="text-align:right">${money(l.lineSubtotal)}</td></tr>`,
    )
    .join("");
  const pays = d.payments
    .map(
      (p) =>
        `<li>${esc(paymentMethodLabel(p.method))} — ${p.currencyCode === "USD" ? "US$" : "C$"}${p.amount.toFixed(2)}${
          p.status === "VOIDED" ? " (ANULADO)" : ""
        }${p.referenceNumber ? ` · Ref. ${esc(p.referenceNumber)}` : ""}</li>`,
    )
    .join("");
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Factura ${esc(d.orderNumber)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;padding:24px;font-size:13px}
  h1{font-size:18px;margin:0 0 4px} h2{font-size:13px;margin:18px 0 6px;text-transform:uppercase;color:#555;border-bottom:1px solid #ddd;padding-bottom:3px}
  table{width:100%;border-collapse:collapse;margin-top:6px} th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}
  th{background:#f3f4f6} .muted{color:#666} .right{text-align:right} .totals{margin-top:8px;float:right;width:260px}
  .totals div{display:flex;justify-content:space-between;padding:2px 0} .grand{font-weight:bold;border-top:1px solid #333;margin-top:4px;padding-top:4px}
  ul{margin:4px 0;padding-left:18px}
</style></head><body>
  <h1>Factura / Orden ${esc(d.orderNumber)}</h1>
  <div class="muted">Estado: ${esc(d.status)} · ${esc(localDateTime(d.createdAt))} · Sucursal ${esc(d.branch.code)} - ${esc(d.branch.name)}</div>
  <div class="muted">Vendedor: ${esc(d.createdBy?.name ?? "—")}</div>
  <h2>Cliente</h2>
  <div>${esc(d.customer?.name ?? "Consumidor final")}${d.customer?.taxId ? ` · RUC ${esc(d.customer.taxId)}` : ""}${
    d.customer?.phone ? ` · Tel. ${esc(d.customer.phone)}` : ""
  }</div>
  <h2>Productos</h2>
  <table><thead><tr><th>Producto</th><th>SKU</th><th class="right">Cant.</th><th class="right">Precio</th><th class="right">Subtotal</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="totals">
    <div><span>Subtotal</span><span>${money(d.totals.subtotal)}</span></div>
    ${d.totals.discountTotal > 0 ? `<div><span>Descuento</span><span>-${money(d.totals.discountTotal)}</span></div>` : ""}
    ${d.totals.taxTotal > 0 ? `<div><span>Impuestos</span><span>${money(d.totals.taxTotal)}</span></div>` : ""}
    ${d.totals.transportAmount > 0 ? `<div><span>Transporte</span><span>${money(d.totals.transportAmount)}</span></div>` : ""}
    <div class="grand"><span>Total</span><span>${money(d.totals.grandTotal)}</span></div>
  </div>
  <div style="clear:both"></div>
  <h2>Pagos</h2><ul>${pays || "<li>Sin pagos</li>"}</ul>
  ${d.notes ? `<h2>Notas</h2><pre style="white-space:pre-wrap;font-family:inherit">${esc(d.notes)}</pre>` : ""}
</body></html>`;
  const w = window.open("", "_blank", "width=820,height=900");
  if (!w) {
    toast.error("No se pudo abrir la ventana de impresión (¿bloqueador de pop-ups?).");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

function InvoicesManagementCard({ onChanged, refreshKey }: { onChanged: () => void; refreshKey?: string }) {
  const [orders, setOrders] = useState<ManagedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState<string>(() => todayManaguaYmd());
  const [showCancelled, setShowCancelled] = useState(false);

  // Estado del modal de confirmación de anulación.
  const [target, setTarget] = useState<ManagedOrder | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const mounted = useRef(true);
  const requestId = useRef(0);

  // Estado del modal de detalles/auditoría.
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/master/sales-orders?date=${encodeURIComponent(date)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const data = unwrapApiData(json) as { orders: ManagedOrder[] };
      if (mounted.current && currentRequest === requestId.current) {
        setOrders(data.orders ?? []);
        setError(null);
      }
    } catch (e) {
      if (mounted.current && currentRequest === requestId.current) setError(e instanceof Error ? e.message : "Error al cargar facturas");
    } finally {
      if (mounted.current && currentRequest === requestId.current) setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    mounted.current = true;
    loadOrders();
    return () => {
      mounted.current = false;
    };
  }, [loadOrders, refreshKey]);

  const openCancelModal = (order: ManagedOrder) => {
    setTarget(order);
    setReason("");
  };
  const closeModal = () => {
    if (submitting) return;
    setTarget(null);
    setReason("");
  };

  const confirmCancel = async () => {
    if (!target) return;
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      toast.error("Debe indicar un motivo de anulación (mínimo 3 caracteres).");
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/master/sales-orders/${target.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: trimmed }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = json?.error?.message ?? json?.message ?? `Error al anular (HTTP ${res.status})`;
        throw new Error(msg);
      }
      const result = json?.data ?? {};
      toast.success(
        `Factura ${target.orderNumber} anulada.` +
          (result.inventoryReversalsCount ? ` Inventario revertido: ${result.inventoryReversalsCount} producto(s).` : "") +
          (result.voidedPaymentsCount ? ` Pagos anulados: ${result.voidedPaymentsCount}.` : ""),
      );
      setTarget(null);
      setReason("");
      await loadOrders();
      onChanged(); // refresca los KPIs/totales del Centro de Comando.
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo anular la factura");
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  };

  // ── Detalles / auditoría ──
  const openDetail = useCallback(async (orderId: string) => {
    setDetailId(orderId);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const res = await apiFetch(`/api/master/sales-orders/${orderId}`);
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = json?.error?.message ?? json?.message ?? `No se pudo cargar el detalle (HTTP ${res.status})`;
        throw new Error(msg);
      }
      const data = unwrapApiData(json) as { order: OrderDetail };
      if (mounted.current) setDetail(data.order);
    } catch (e) {
      if (mounted.current) setDetailError(e instanceof Error ? e.message : "Error al cargar el detalle");
    } finally {
      if (mounted.current) setDetailLoading(false);
    }
  }, []);

  const closeDetail = () => {
    setDetailId(null);
    setDetail(null);
    setDetailError(null);
  };

  // Anular desde el modal de detalle: cierra detalle y abre confirmación.
  const cancelFromDetail = () => {
    if (!detail) return;
    const managed: ManagedOrder = {
      id: detail.id,
      orderNumber: detail.orderNumber,
      deliveryOrderNumber: null,
      deliveryOrderIssuedAt: null,
      documentMode: detail.documentMode,
      requiresManualInvoice: detail.requiresManualInvoice,
      manualInvoiceSeries: detail.manualInvoice?.series ?? null,
      manualInvoiceNumber: detail.manualInvoice?.number ?? null,
      manualInvoiceStatus: detail.manualInvoice?.status ?? null,
      manualInvoiceRegisteredAt: detail.manualInvoice?.registeredAt ?? null,
      manualInvoiceCustomerName: detail.manualInvoice?.customerName ?? null,
      manualInvoiceCustomerRuc: detail.manualInvoice?.customerRuc ?? null,
      latestPaymentAt: detail.payments[0]?.paidAt ?? null,
      paymentStatus: detail.payments[0]?.status ?? null,
      paymentMethod: detail.payments[0]?.method ?? null,
      commercialDate: detail.payments[0]?.paidAt ?? detail.manualInvoice?.registeredAt ?? detail.updatedAt ?? detail.createdAt,
      status: detail.status,
      grandTotal: detail.totals.grandTotal,
      createdAt: detail.createdAt,
      branch: detail.branch,
      customerName: detail.customer?.name ?? null,
      createdByName: detail.createdBy?.name ?? null,
      linesCount: detail.lines.length,
      cancellable: detail.cancellable,
    };
    closeDetail();
    setTarget(managed);
    setReason("");
  };

  const visibleOrders = showCancelled ? orders : orders.filter((o) => o.status !== "CANCELLED");
  const activeOrders = orders.filter((o) => o.status !== "CANCELLED");
  const cancelledCount = orders.length - activeOrders.length;
  const totalActive = activeOrders.reduce((acc, o) => acc + o.grandTotal, 0);

  return (
    <Card noPadding>
      <div className="flex items-center justify-between px-5 py-3.5 border-b-2 border-[var(--color-border-strong)] flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <div className="hm-section-icon hm-section-icon-master">
            <FileText className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Gestión de Facturas</h2>
            <p className="text-[0.6875rem] text-[var(--color-text-muted)]">
              Anular facturas/órdenes del día · {activeOrders.length} activas · total {money(totalActive)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            value={date}
            max={todayManaguaYmd()}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs text-[var(--color-text)]"
          />
          <button
            onClick={() => setShowCancelled((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs transition-colors ${
              showCancelled
                ? "border-[var(--color-master-400)] bg-[var(--color-surface-alt)] text-[var(--color-text)]"
                : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]"
            }`}
          >
            {showCancelled ? "Ocultar anuladas" : `Mostrar anuladas (${cancelledCount})`}
          </button>
          <button
            onClick={() => loadOrders()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-alt)] text-xs text-[var(--color-text-secondary)] transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Actualizar
          </button>
        </div>
      </div>

      {error ? (
        <div className="px-5 py-8 text-center text-sm text-[var(--color-danger-600)]">{error}</div>
      ) : loading ? (
        <div className="px-5 py-8 text-center text-sm text-[var(--color-text-muted)] animate-pulse">Cargando facturas…</div>
      ) : visibleOrders.length === 0 ? (
        <div className="flex items-center gap-2 px-5 py-8 text-sm text-[var(--color-text-muted)] justify-center">
          <CheckCircle2 className="h-4 w-4 text-[var(--color-success-500)]" />
          Sin facturas para la fecha seleccionada.
        </div>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Factura / Orden</TH>
              <TH>Sucursal</TH>
              <TH>Cliente / Vendedor</TH>
              <TH>Estado venta</TH>
              <TH>Documento</TH>
              <TH>Pago</TH>
              <TH className="text-right">Total</TH>
              <TH className="text-right">Fecha comercial</TH>
              <TH className="text-right">Acciones</TH>
            </TR>
          </THead>
          <TBody>
            {visibleOrders.map((o) => (
              <TR key={o.id}>
                <TD>
                  <div className="flex flex-col">
                    <span className="font-medium text-[var(--color-text)]">{o.orderNumber}</span>
                    <span className="text-xs text-[var(--color-text-muted)]">{o.linesCount} línea(s)</span>
                  </div>
                </TD>
                <TD className="text-xs text-[var(--color-text-secondary)]">{o.branch.code}</TD>
                <TD>
                  <div className="flex flex-col">
                    <span className="text-sm text-[var(--color-text-secondary)]">{o.customerName ?? "—"}</span>
                    <span className="text-xs text-[var(--color-text-muted)]">{o.createdByName ?? "—"}</span>
                  </div>
                </TD>
                <TD>{orderStatusBadge(o.status)}</TD>
                <TD className="text-xs text-[var(--color-text-secondary)]">{o.manualInvoiceStatus ?? o.documentMode}</TD>
                <TD className="text-xs text-[var(--color-text-secondary)]">{o.paymentMethod ?? o.paymentStatus ?? "—"}</TD>
                <TD className="text-right font-mono text-xs font-semibold text-[var(--color-text)]">{money(o.grandTotal)}</TD>
                <TD className="text-right text-xs text-[var(--color-text-muted)]">{localDateTime(o.commercialDate)}</TD>
                <TD className="text-right">
                  <div className="inline-flex items-center justify-end gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Eye className="h-3.5 w-3.5" />}
                      onClick={() => openDetail(o.id)}
                      title="Ver detalles y auditoría de la factura"
                    >
                      Ver
                    </Button>
                    {o.cancellable && (
                      <Button variant="danger" size="sm" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => openCancelModal(o)}>
                        Anular
                      </Button>
                    )}
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {/* ── Modal de detalles / auditoría ── */}
      {detailId && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-6"
          role="dialog"
          aria-modal="true"
          onClick={closeDetail}
        >
          <div
            className="my-4 w-full max-w-4xl rounded-xl bg-[var(--color-surface)] shadow-xl border border-[var(--color-border)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Encabezado */}
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--color-border)] sticky top-0 bg-[var(--color-surface)] rounded-t-xl z-10">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-master-50)] text-[var(--color-master-600)]">
                  <Receipt className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-[var(--color-text)] truncate">
                      {detail ? detail.orderNumber : "Detalle de factura"}
                    </h3>
                    {detail && orderStatusBadge(detail.status)}
                  </div>
                  {detail && (
                    <p className="text-[0.6875rem] text-[var(--color-text-muted)]">{localDateTime(detail.createdAt)}</p>
                  )}
                </div>
              </div>
              <button
                onClick={closeDetail}
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] shrink-0"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Cuerpo */}
            <div className="px-5 py-4 max-h-[70vh] overflow-y-auto space-y-5">
              {detailLoading ? (
                <div className="py-12 text-center text-sm text-[var(--color-text-muted)] animate-pulse">Cargando detalle…</div>
              ) : detailError ? (
                <div className="py-12 text-center">
                  <AlertTriangle className="h-6 w-6 text-[var(--color-danger-500)] mx-auto mb-2" />
                  <p className="text-sm text-[var(--color-danger-600)]">{detailError}</p>
                  <Button variant="secondary" size="sm" className="mt-3" onClick={() => openDetail(detailId)}>
                    Reintentar
                  </Button>
                </div>
              ) : detail ? (
                <>
                  {/* Información operativa */}
                  <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <InfoTile label="Sucursal" value={`${detail.branch.code} · ${detail.branch.name}`} />
                    <InfoTile label="Vendedor" value={detail.createdBy?.name ?? "—"} icon={<UserIcon className="h-3.5 w-3.5" />} />
                    <InfoTile label="Fecha y hora" value={localDateTime(detail.createdAt)} />
                    <InfoTile label="Líneas" value={`${detail.lines.length} producto(s)`} />
                  </section>

                  {/* Cliente */}
                  <section>
                    <SectionTitle icon={<UserIcon className="h-3.5 w-3.5" />}>Cliente</SectionTitle>
                    {detail.customer ? (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                        <InfoTile label="Nombre" value={detail.customer.name} />
                        <InfoTile label="Identificación / RUC" value={detail.customer.taxId ?? "—"} />
                        <InfoTile label="Teléfono" value={detail.customer.phone ?? "—"} />
                        <InfoTile label="Correo" value={detail.customer.email ?? "—"} />
                        {detail.customer.address && (
                          <div className="col-span-2 sm:col-span-4">
                            <InfoTile label="Dirección" value={detail.customer.address} />
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-[var(--color-text-muted)]">Venta sin cliente asignado (consumidor final).</p>
                    )}
                  </section>

                  {/* Productos */}
                  <section>
                    <SectionTitle icon={<Package className="h-3.5 w-3.5" />}>Productos</SectionTitle>
                    <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-[var(--color-surface-alt)] text-[var(--color-text-secondary)] text-xs">
                            <th className="text-left font-medium px-3 py-2">Producto</th>
                            <th className="text-left font-medium px-3 py-2">SKU</th>
                            <th className="text-right font-medium px-3 py-2">Cant.</th>
                            <th className="text-right font-medium px-3 py-2">Precio Unit.</th>
                            <th className="text-right font-medium px-3 py-2">Desc.</th>
                            <th className="text-right font-medium px-3 py-2">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.lines.map((l) => (
                            <tr key={l.id} className="border-t border-[var(--color-border)]">
                              <td className="px-3 py-2 text-[var(--color-text)]">{l.productName}</td>
                              <td className="px-3 py-2 text-xs text-[var(--color-text-muted)] font-mono">{l.sku ?? "—"}</td>
                              <td className="px-3 py-2 text-right font-mono">
                                {l.quantity}
                                {l.unit ? <span className="text-[var(--color-text-muted)]"> {l.unit}</span> : null}
                              </td>
                              <td className="px-3 py-2 text-right font-mono">{money(l.unitPrice)}</td>
                              <td className="px-3 py-2 text-right font-mono text-[var(--color-text-muted)]">
                                {l.discountAmount > 0 ? `-${money(l.discountAmount)}` : "—"}
                              </td>
                              <td className="px-3 py-2 text-right font-mono font-semibold text-[var(--color-text)]">
                                {money(l.lineSubtotal)}
                              </td>
                            </tr>
                          ))}
                          {detail.lines.length === 0 && (
                            <tr>
                              <td colSpan={6} className="px-3 py-6 text-center text-sm text-[var(--color-text-muted)]">
                                Sin productos registrados.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Totales */}
                    <div className="mt-3 flex justify-end">
                      <div className="w-full sm:w-72 space-y-1 text-sm">
                        <TotalRow label="Subtotal" value={detail.totals.subtotal} />
                        {detail.totals.discountTotal > 0 && (
                          <TotalRow label="Descuento" value={-detail.totals.discountTotal} />
                        )}
                        {detail.totals.taxTotal > 0 && <TotalRow label="Impuestos" value={detail.totals.taxTotal} />}
                        {detail.totals.transportAmount > 0 && (
                          <TotalRow label="Transporte" value={detail.totals.transportAmount} />
                        )}
                        <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-1.5 mt-1.5">
                          <span className="font-semibold text-[var(--color-text)]">Total</span>
                          <span className="font-mono font-bold text-base text-[var(--color-text)]">
                            {money(detail.totals.grandTotal)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Pagos */}
                  <section>
                    <SectionTitle icon={<CreditCard className="h-3.5 w-3.5" />}>Pagos</SectionTitle>
                    {detail.payments.length === 0 ? (
                      <p className="text-sm text-[var(--color-text-muted)]">Sin pagos registrados.</p>
                    ) : (
                      <div className="space-y-2">
                        {detail.payments.map((p) => (
                          <div
                            key={p.id}
                            className="rounded-lg border border-[var(--color-border)] px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap"
                          >
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm text-[var(--color-text)]">{paymentMethodLabel(p.method)}</span>
                              {p.status === "VOIDED" ? (
                                <Badge variant="danger">Anulado</Badge>
                              ) : (
                                <Badge variant="success">Registrado</Badge>
                              )}
                              {p.referenceNumber && (
                                <span className="text-xs text-[var(--color-text-muted)]">Ref.: {p.referenceNumber}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-[var(--color-text-muted)]">{localDateTime(p.paidAt)}</span>
                              {p.receivedByName && (
                                <span className="text-xs text-[var(--color-text-muted)]">por {p.receivedByName}</span>
                              )}
                              <span className="font-mono font-semibold text-sm text-[var(--color-text)]">
                                {p.currencyCode === "USD" ? "US$" : "C$"}
                                {p.amount.toFixed(2)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Factura manual (si aplica) */}
                  {detail.manualInvoice && (
                    <section>
                      <SectionTitle icon={<FileText className="h-3.5 w-3.5" />}>Factura manual</SectionTitle>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                        <InfoTile
                          label="Serie / Número"
                          value={`${detail.manualInvoice.series ?? "—"} ${detail.manualInvoice.number ?? ""}`.trim()}
                        />
                        <InfoTile label="Estado" value={detail.manualInvoice.status} />
                        <InfoTile label="Cliente" value={detail.manualInvoice.customerName ?? "—"} />
                        <InfoTile label="RUC" value={detail.manualInvoice.customerRuc ?? "—"} />
                      </div>
                    </section>
                  )}

                  {/* Notas */}
                  {detail.notes && (
                    <section>
                      <SectionTitle icon={<FileText className="h-3.5 w-3.5" />}>Notas</SectionTitle>
                      <pre className="whitespace-pre-wrap text-sm text-[var(--color-text-secondary)] bg-[var(--color-surface-alt)] rounded-lg px-3 py-2 border border-[var(--color-border)]">
                        {detail.notes}
                      </pre>
                    </section>
                  )}

                  {/* Historial / auditoría */}
                  <section>
                    <SectionTitle icon={<History className="h-3.5 w-3.5" />}>Historial y auditoría</SectionTitle>
                    {detail.auditTrail.length === 0 ? (
                      <p className="text-sm text-[var(--color-text-muted)]">Sin eventos de auditoría registrados.</p>
                    ) : (
                      <ul className="space-y-2">
                        {detail.auditTrail.map((a) => {
                          const meta = (a.metadata ?? {}) as Record<string, unknown>;
                          const reasonTxt = typeof meta.reason === "string" ? meta.reason : null;
                          return (
                            <li
                              key={a.id}
                              className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm flex items-start gap-2"
                            >
                              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[var(--color-master-500)] shrink-0" />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium text-[var(--color-text)]">{auditActionLabel(a.action)}</span>
                                  <span className="text-xs text-[var(--color-text-muted)]">{localDateTime(a.occurredAt)}</span>
                                  {a.actorName && (
                                    <span className="text-xs text-[var(--color-text-muted)]">· {a.actorName}</span>
                                  )}
                                </div>
                                {reasonTxt && (
                                  <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">Motivo: {reasonTxt}</p>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                </>
              ) : null}
            </div>

            {/* Acciones */}
            <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-[var(--color-border)] flex-wrap">
              <div>
                {detail && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Printer className="h-3.5 w-3.5" />}
                    onClick={() => printOrderDetail(detail)}
                  >
                    Imprimir
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {detail?.cancellable && (
                  <Button variant="danger" size="sm" icon={<Ban className="h-3.5 w-3.5" />} onClick={cancelFromDetail}>
                    Anular factura
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={closeDetail}>
                  Cerrar
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de confirmación de anulación ── */}
      {target && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={closeModal}
        >
          <div
            className="w-full max-w-md rounded-xl bg-[var(--color-surface)] shadow-xl border border-[var(--color-border)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-danger-50)] text-[var(--color-danger-600)]">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-semibold text-[var(--color-text)]">Anular factura</h3>
              </div>
              <button onClick={closeModal} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]" aria-label="Cerrar">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-[var(--color-text-secondary)]">
                ¿Está seguro que desea anular la factura <span className="font-semibold text-[var(--color-text)]">{target.orderNumber}</span>{" "}
                por <span className="font-semibold text-[var(--color-text)]">{money(target.grandTotal)}</span>?
              </p>
              <div className="rounded-lg bg-[var(--color-warning-50)] border border-[var(--color-warning-200)] px-3 py-2 text-xs text-[var(--color-warning-700)] flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Esta acción revertirá el inventario consumido, anulará los pagos asociados y actualizará los totales del día. No se
                  puede deshacer.
                </span>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                  Motivo de la anulación <span className="text-[var(--color-danger-600)]">*</span>
                </label>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ej.: Error en el cobro, devolución del cliente…"
                  autoFocus
                  disabled={submitting}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--color-border)]">
              <Button variant="secondary" size="sm" onClick={closeModal} disabled={submitting}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                size="sm"
                loading={submitting}
                icon={<Ban className="h-3.5 w-3.5" />}
                onClick={confirmCancel}
              >
                Confirmar anulación
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Page                                                                      */
/* ──────────────────────────────────────────────────────────────────────── */

type ClosureTab = "pending" | "completedToday" | "history";

export default function MasterCommandCenterPage() {
  const [data, setData] = useState<CommandCenter | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ClosureTab>("pending");
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [differenceTarget, setDifferenceTarget] = useState<CashClosure | null>(null);
  const [differenceAmount, setDifferenceAmount] = useState("");
  const [differenceNote, setDifferenceNote] = useState("");
  const mounted = useRef(true);

  const load = useCallback(async (isRefresh: boolean) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await apiFetch("/api/master/command-center");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (mounted.current) {
        setData(unwrapApiData(json) as CommandCenter);
        setError(null);
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  const pollLoad = useCallback(async () => { await load(true); }, [load]);

  useEffect(() => {
    mounted.current = true;
    void load(false);
    return () => { mounted.current = false; };
  }, [load]);

  useOperationalPolling({
    task: pollLoad,
    intervalMs: 30_000,
    immediate: false,
    deps: [pollLoad],
  });

  const reviewAutoClose = useCallback(async (cashSessionId: string, payload: Record<string, unknown>) => {
    setReviewingId(cashSessionId);
    try {
      const res = await apiFetch(`/api/master/cash-sessions/${cashSessionId}/review-auto-close`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load(true);
      toast.success("Cierre automatico revisado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo revisar el cierre");
    } finally {
      setReviewingId(null);
    }
  }, [load]);

  const confirmOk = useCallback((row: CashClosure) => {
    void reviewAutoClose(row.id, { confirmOk: true });
  }, [reviewAutoClose]);

  const openDifferenceModal = useCallback((row: CashClosure) => {
    setDifferenceTarget(row);
    setDifferenceAmount(row.expectedCashAmount == null ? "" : String(row.expectedCashAmount));
    setDifferenceNote("");
  }, []);

  const submitDifference = useCallback(async () => {
    if (!differenceTarget) return;
    const countedCashAmount = Number(differenceAmount);
    if (!Number.isFinite(countedCashAmount) || countedCashAmount < 0) {
      toast.error("Monto contado invalido");
      return;
    }
    if (differenceNote.trim().length < 5) {
      toast.error("Agrega una nota para la diferencia");
      return;
    }
    await reviewAutoClose(differenceTarget.id, {
      countedCashAmount,
      note: differenceNote.trim(),
    });
    setDifferenceTarget(null);
    setDifferenceAmount("");
    setDifferenceNote("");
  }, [differenceAmount, differenceNote, differenceTarget, reviewAutoClose]);

  if (loading) {
    return <p className="text-[var(--color-text-muted)] animate-pulse">Cargando Centro de Comando…</p>;
  }
  if (error && !data) {
    return <p className="text-[var(--color-danger-600)]">No se pudo cargar el Centro de Comando: {error}</p>;
  }
  if (!data) return null;

  const { totals, users, byBranch, cashClosures } = data;
  const closureRows =
    tab === "pending" ? cashClosures.pending : tab === "completedToday" ? cashClosures.completedToday : cashClosures.history;

  const maxSales = Math.max(1, ...byBranch.map((b) => b.salesToday));

  return (
    <section className="space-y-8 animate-fade-in-up">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: "#D4380D" }} />
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Centro Master</h1>
            <span
              className="text-[0.625rem] font-semibold uppercase tracking-widest px-2 py-0.5 rounded"
              style={{ background: "#D4380D", color: "#fff", fontFamily: "'DM Mono', monospace" }}
            >
              Master
            </span>
          </div>
          <p className="text-sm text-[var(--color-text-muted)] ml-5">
            Control global de sucursales, usuarios, inventario y decisiones.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
          <span className="inline-flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-success-400)] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--color-success-500)]" />
            </span>
            En vivo
          </span>
          <button
            onClick={() => load(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-alt)] transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Actualizar
          </button>
        </div>
      </div>

      {/* ── Executive KPIs ── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 stagger-children">
        <KpiCard label="Ventas globales (hoy)" value={money(totals.salesToday)} tone="ok" roleAccent="MASTER" />
        <KpiCard
          label="Cajas abiertas"
          value={`${totals.openSessions} / ${totals.boxesActive}`}
          helper="sesiones abiertas / cajas activas"
          tone={totals.openSessions > 0 ? "default" : "ok"}
          roleAccent="MASTER"
        />
        <KpiCard
          label="Cierres por revisar"
          value={totals.pendingReviewSessions}
          tone={totals.pendingReviewSessions > 0 ? "alert" : "ok"}
          roleAccent="MASTER"
        />
        <KpiCard
          label="Usuarios en línea"
          value={totals.usersOnline}
          helper={`${totals.usersIdle} inactivos · ${totals.usersOffline} desconectados`}
          tone="default"
          roleAccent="MASTER"
        />
      </div>

      {/* ── Quick access to management screens (centralized here) ── */}
      <div>
        <div className="flex items-center gap-2.5 mb-3">
          <div className="hm-section-icon hm-section-icon-master">
            <Settings className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Gestión</h2>
            <p className="text-[0.6875rem] text-[var(--color-text-muted)]">
              Acceso directo a cierres, cajas, cierre automático y detalle de usuarios
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {MANAGEMENT_LINKS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href as Route}
                className="group flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 transition-colors hover:border-[var(--color-border-mid)] hover:bg-[var(--color-surface-alt)]"
              >
                <div className="hm-section-icon hm-section-icon-master shrink-0">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[var(--color-text)]">{item.label}</p>
                  <p className="truncate text-[0.6875rem] text-[var(--color-text-muted)]">{item.description}</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-text-muted)] transition-transform group-hover:translate-x-0.5" />
              </Link>
            );
          })}
        </div>
      </div>

      {/* ── Branch operational status grid ── */}
      <div>
        <div className="flex items-center gap-2.5 mb-3">
          <div className="hm-section-icon hm-section-icon-master">
            <Building2 className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Estado operativo por sucursal</h2>
            <p className="text-[0.6875rem] text-[var(--color-text-muted)]">Cajas físicas, sesiones y día operativo</p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {byBranch.map((b) => {
            const pct = Math.round((b.salesToday / maxSales) * 100);
            return (
              <Card key={b.branchId}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="flex items-center justify-center rounded px-1.5 py-0.5 border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]"
                      style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.03em" }}
                    >
                      {b.branchCode}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[var(--color-text)]">{b.branchName}</p>
                      <p className="text-[0.6875rem] text-[var(--color-text-muted)]">
                        {b.operationalDay
                          ? `Día ${DAY_STATUS_LABELS[b.operationalDay.status] ?? b.operationalDay.status}`
                          : "Sin día operativo abierto"}
                      </p>
                    </div>
                  </div>
                  {b.pendingReviewSessions > 0 ? (
                    <Badge variant="danger">
                      <AlertTriangle className="h-3 w-3 mr-1 inline" />
                      {b.pendingReviewSessions} por revisar
                    </Badge>
                  ) : b.openSessions > 0 ? (
                    <Badge variant="success">{b.openSessions} abiertas</Badge>
                  ) : (
                    <Badge variant="neutral">sin actividad</Badge>
                  )}
                </div>

                {/* Sales bar */}
                <div className="mb-3">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-[var(--color-text-muted)]">Ventas hoy</span>
                    <span className="font-mono font-semibold text-[var(--color-text)]">{money(b.salesToday)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--color-surface-alt)] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${pct}%`,
                        background: b.salesToday > 0 ? "#D4380D" : "var(--color-border)",
                      }}
                    />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[0.68rem] text-[var(--color-text-muted)]">
                    <span>{b.paidSalesCount} cobrada(s)</span>
                    <span>{b.pendingPaymentCount} pendiente(s) · {money(b.pendingPaymentTotal)}</span>
                  </div>
                </div>

                <div className="mb-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-[0.72rem]">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-text)]">
                      <Banknote className="h-3.5 w-3.5" />
                      Caja del día
                    </span>
                    <span className="font-mono text-[0.68rem] text-[var(--color-text-muted)]">
                      {b.activeCashSessionIds.length} activa(s)
                    </span>
                  </div>
                  <div className="grid gap-x-3 gap-y-1.5 sm:grid-cols-2">
                    <CashMiniRow label="Apertura" value={money(b.openingCashTotal)} />
                    <CashMiniRow label="Efectivo neto" value={money(b.cashTenderNetTotal)} />
                    <CashMiniRow label="Movimientos" value={money(b.cashMovementsNet)} />
                    <CashMiniRow label="Gastos / egresos" value={b.cashOutflowsTotal > 0 ? `- ${money(b.cashOutflowsTotal)}` : money(0)} />
                    <CashMiniRow label="Sin apertura" value={money(b.cashNetWithoutOpening)} />
                    <CashMiniRow label="Tarjeta" value={money(b.cardTenderTotal)} />
                    <CashMiniRow label="Transferencia" value={money(b.transferTenderTotal)} />
                    <CashMiniRow label="Otros" value={money(b.otherTenderTotal)} />
                    <CashMiniRow label="Utilidad est." value={b.estimatedGrossProfit === null ? "N/D" : money(b.estimatedGrossProfit)} />
                  </div>
                  <div className="mt-2 border-t border-[var(--color-border)] pt-2">
                    <CashMiniRow label="Efectivo esperado" value={money(b.expectedCashOnHand)} strong />
                  </div>
                </div>

                {/* Mini stats */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-[var(--color-surface-alt)] py-2">
                    <p className="text-base font-bold text-[var(--color-text)]">
                      {b.boxesActive}
                      <span className="text-xs font-normal text-[var(--color-text-soft)]">/{b.boxesTotal}</span>
                    </p>
                    <p className="text-[0.625rem] text-[var(--color-text-muted)] uppercase tracking-wide">Cajas</p>
                  </div>
                  <div className="rounded-lg bg-[var(--color-surface-alt)] py-2">
                    <p className="text-base font-bold text-[var(--color-text)]">{b.openSessions}</p>
                    <p className="text-[0.625rem] text-[var(--color-text-muted)] uppercase tracking-wide">Abiertas</p>
                  </div>
                  <div className="rounded-lg bg-[var(--color-surface-alt)] py-2">
                    <p
                      className={`text-base font-bold ${b.reconcilingSessions > 0 ? "text-[var(--color-warning-600)]" : "text-[var(--color-text)]"}`}
                    >
                      {b.reconcilingSessions}
                    </p>
                    <p className="text-[0.625rem] text-[var(--color-text-muted)] uppercase tracking-wide">Conciliando</p>
                  </div>
                </div>

                {b.operationalDay && b.operationalDay.cashDifferenceTotal !== null && (
                  <div className="mt-3 flex items-center justify-between text-xs border-t border-[var(--color-border)] pt-2">
                    <span className="text-[var(--color-text-muted)] inline-flex items-center gap-1">
                      <Banknote className="h-3.5 w-3.5" />
                      Diferencia de caja
                    </span>
                    <span
                      className={`font-mono font-semibold ${
                        Math.abs(b.operationalDay.cashDifferenceTotal) < 0.01
                          ? "text-[var(--color-success-600)]"
                          : "text-[var(--color-danger-600)]"
                      }`}
                    >
                      {money(b.operationalDay.cashDifferenceTotal)}
                    </span>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      {/* ── Cash closures ── */}
      <Card noPadding>
        <div className="flex items-center justify-between px-5 py-3.5 border-b-2 border-[var(--color-border-strong)] flex-wrap gap-3">
          <div className="flex items-center gap-2.5">
            <div className="hm-section-icon hm-section-icon-master">
              <Wallet className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Cierres de Caja</h2>
              <p className="text-[0.6875rem] text-[var(--color-text-muted)]">Pendientes, completados hoy e historial</p>
            </div>
          </div>
          <div className="inline-flex rounded-lg border border-[var(--color-border)] overflow-hidden text-xs font-medium">
            {([
              { key: "pending", label: "Pendientes", icon: ClipboardCheck, count: cashClosures.pending.length },
              { key: "completedToday", label: "Hoy", icon: CheckCircle2, count: cashClosures.completedToday.length },
              { key: "history", label: "Historial", icon: History, count: cashClosures.history.length },
            ] as const).map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 transition-colors ${
                  tab === t.key
                    ? "bg-[var(--color-master-600)] text-white"
                    : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]"
                }`}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
                <span
                  className={`ml-0.5 rounded-full px-1.5 text-[0.625rem] ${
                    tab === t.key ? "bg-white/20" : "bg-[var(--color-surface-alt)]"
                  }`}
                >
                  {t.count}
                </span>
              </button>
            ))}
          </div>
        </div>
        <ClosuresTable
          rows={closureRows}
          showDifference={tab !== "pending"}
          onConfirmOk={tab === "pending" ? confirmOk : undefined}
          onRegisterDifference={tab === "pending" ? openDifferenceModal : undefined}
          reviewingId={reviewingId}
        />
      </Card>

      {/* ── Gestión de facturas (anulación) ── */}
      {differenceTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text)]">Registrar diferencia</h3>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {differenceTarget.branchCode} · {differenceTarget.boxName}
                </p>
              </div>
              <button
                onClick={() => setDifferenceTarget(null)}
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                aria-label="Cerrar"
                disabled={reviewingId === differenceTarget.id}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div className="grid grid-cols-2 gap-3 rounded-lg bg-[var(--color-surface-alt)] p-3 text-xs">
                <div>
                  <p className="text-[var(--color-text-muted)]">Esperado</p>
                  <p className="font-mono font-semibold text-[var(--color-text)]">
                    {differenceTarget.expectedCashAmount == null ? "-" : money(differenceTarget.expectedCashAmount)}
                  </p>
                </div>
                <div>
                  <p className="text-[var(--color-text-muted)]">Diferencia</p>
                  <p className="font-mono font-semibold text-[var(--color-text)]">
                    {Number.isFinite(Number(differenceAmount)) && differenceTarget.expectedCashAmount != null
                      ? money(Number(differenceAmount) - differenceTarget.expectedCashAmount)
                      : "-"}
                  </p>
                </div>
              </div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
                Monto contado
                <Input
                  className="mt-1"
                  type="number"
                  min="0"
                  step="0.01"
                  value={differenceAmount}
                  onChange={(event) => setDifferenceAmount(event.target.value)}
                  disabled={reviewingId === differenceTarget.id}
                />
              </label>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
                Nota
                <textarea
                  className="hm-input mt-1 min-h-20 w-full rounded-lg px-3 py-2"
                  value={differenceNote}
                  onChange={(event) => setDifferenceNote(event.target.value)}
                  placeholder="Justificacion o detalle del conteo"
                  disabled={reviewingId === differenceTarget.id}
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-5 py-4">
              <Button variant="secondary" size="sm" onClick={() => setDifferenceTarget(null)} disabled={reviewingId === differenceTarget.id}>
                Cancelar
              </Button>
              <Button size="sm" loading={reviewingId === differenceTarget.id} onClick={submitDifference}>
                Guardar revision
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <InvoicesManagementCard onChanged={() => load(true)} refreshKey={data.generatedAt} />

      {/* ── Connected users ── */}
      <Card noPadding>
        <div className="flex items-center justify-between px-5 py-3.5 border-b-2 border-[var(--color-border-strong)]">
          <div className="flex items-center gap-2.5">
            <div className="hm-section-icon hm-section-icon-master">
              <Users className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Usuarios conectados</h2>
              <p className="text-[0.6875rem] text-[var(--color-text-muted)]">Presencia y actividad en tiempo real</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="success">{users.summary.online} en línea</Badge>
            <Badge variant="warning">{users.summary.idle} inactivos</Badge>
            <Badge variant="neutral">{users.summary.offline} desconectados</Badge>
          </div>
        </div>
        <Table>
          <THead>
            <TR>
              <TH>Usuario</TH>
              <TH>Rol</TH>
              <TH>Sucursal</TH>
              <TH>Módulo actual</TH>
              <TH className="text-center">Cajas</TH>
              <TH className="text-right">Última actividad</TH>
            </TR>
          </THead>
          <TBody>
            {[...users.list]
              .sort((a, b) => {
                const order = { ONLINE: 0, IDLE: 1, OFFLINE: 2 } as const;
                return order[a.status] - order[b.status];
              })
              .map((u) => (
                <TR key={u.userId}>
                  <TD>
                    <div className="flex items-center gap-2">
                      {presenceDot(u.status)}
                      <span className="font-medium text-[var(--color-text)]">{u.username}</span>
                    </div>
                  </TD>
                  <TD className="text-xs text-[var(--color-text-secondary)]">{u.globalRole}</TD>
                  <TD className="text-xs text-[var(--color-text-secondary)]">{u.branch ? u.branch.code : "—"}</TD>
                  <TD className="text-xs text-[var(--color-text-muted)]">{u.currentModule ?? "—"}</TD>
                  <TD className="text-center">
                    {u.activeCashSessions.length > 0 ? (
                      <Badge variant="info">{u.activeCashSessions.length}</Badge>
                    ) : (
                      <span className="text-[var(--color-text-soft)]">—</span>
                    )}
                  </TD>
                  <TD className="text-right text-xs text-[var(--color-text-muted)]">{timeAgo(u.lastSeenAt)}</TD>
                </TR>
              ))}
          </TBody>
        </Table>
      </Card>
    </section>
  );
}
