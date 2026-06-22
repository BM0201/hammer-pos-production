"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
  FileText,
  Ban,
  X,
  Eye,
  User as UserIcon,
  Package,
  CreditCard,
  Receipt,
  Printer,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { useOperationalPolling } from "@/lib/realtime/use-operational-polling";

const MANAGEMENT_LINKS: { href: string; label: string; description: string; icon: LucideIcon }[] = [
  { href: "/app/master/cash-closure-reports", label: "Cierres de Caja", description: "Revisar y aprobar cierres", icon: Wallet },
  { href: "/app/master/cash-boxes", label: "Cajas Físicas", description: "Administrar cajas por sucursal", icon: Settings },
  { href: "/app/master/settings/operational-automation", label: "Automatización Operativa", description: "Apertura de día, cierre de cajas y cierre operativo", icon: Activity },
  { href: "/app/master/users/activity", label: "Detalle de usuarios", description: "Actividad y sesiones en detalle", icon: Activity },
];

/* ── Types ── */

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
  lastSale: { orderNumber: string; amount: number; paidAt: string; method: string } | null;
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
  cashClosures: { pending: CashClosure[]; completedToday: CashClosure[]; history: CashClosure[] };
};

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
    id: string; code: string; name: string; legalName: string;
    taxId: string | null; phone: string | null; email: string | null; address: string | null;
  } | null;
  totals: { subtotal: number; discountTotal: number; taxTotal: number; transportAmount: number; grandTotal: number };
  documentMode: string;
  requiresManualInvoice: boolean;
  manualInvoice: {
    series: string | null; number: string | null; date: string | null;
    customerName: string | null; customerRuc: string | null; status: string;
    registeredBy: string | null; registeredAt: string | null; notes: string | null;
  } | null;
  lines: {
    id: string; productId: string; productName: string; sku: string | null;
    unit: string | null; quantity: number; unitPrice: number;
    discountAmount: number; lineSubtotal: number;
  }[];
  payments: {
    id: string; method: string; status: string; amount: number; currencyCode: string;
    referenceNumber: string | null; paidAt: string; receivedByName: string | null;
    tenders: {
      id: string; method: string; amount: number; receivedAmount: number | null;
      changeAmount: number | null; referenceNumber: string | null;
    }[];
  }[];
  auditTrail: {
    id: string; occurredAt: string; action: string; module: string;
    actorName: string | null; metadata: unknown;
  }[];
};

/* ── Helpers ── */

const money = (n: number) => `C$${n.toFixed(2)}`;

const ORDER_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Borrador", PENDING_PAYMENT: "Pago pendiente", PAID: "Pagada",
  DISPATCH_PENDING: "Despacho pendiente", DISPATCHED: "Despachada", CANCELLED: "Anulada",
  RETURN_REQUESTED: "Devolución solicitada", RETURN_APPROVED: "Devolución aprobada",
  RETURN_REJECTED: "Devolución rechazada", RETURNED: "Devuelta",
};

function orderStatusBadge(status: string) {
  const label = ORDER_STATUS_LABELS[status] ?? status;
  if (status === "CANCELLED") return <Badge variant="danger">{label}</Badge>;
  if (status === "PAID" || status === "DISPATCHED") return <Badge variant="success">{label}</Badge>;
  if (status === "PENDING_PAYMENT" || status === "DISPATCH_PENDING") return <Badge variant="warning">{label}</Badge>;
  if (status.startsWith("RETURN") || status === "RETURNED") return <Badge variant="info">{label}</Badge>;
  return <Badge variant="neutral">{label}</Badge>;
}

function localDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-NI", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", timeZone: "America/Managua",
  });
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Efectivo", CARD: "Tarjeta", TRANSFER: "Transferencia",
  CREDIT: "Crédito", CHECK: "Cheque", MIXED: "Mixto", OTHER: "Otro",
};
const paymentMethodLabel = (m: string) => PAYMENT_METHOD_LABELS[m] ?? m;

const AUDIT_ACTION_LABELS: Record<string, string> = {
  SALE_ORDER_CANCELLED: "Factura anulada",
  SALE_ORDER_CANCEL_DENIED: "Intento de anulación denegado",
};
const auditActionLabel = (a: string) => AUDIT_ACTION_LABELS[a] ?? a;

function todayManaguaYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Managua", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
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
  OPEN: "Abierta", RECONCILING: "Conciliando",
  AUTO_CLOSED_PENDING_REVIEW: "Pendiente de revisión",
  AUTO_CLOSED: "Cerrada (auto)", CLOSED: "Cerrada", PERMANENTLY_CLOSED: "Cerrada definitiva",
};

const DAY_STATUS_LABELS: Record<string, string> = {
  OPEN: "Abierto", CLOSING: "Cerrando", CLOSED: "Cerrado", CANCELLED: "Cancelado",
};

function statusBadge(status: string) {
  if (status === "OPEN") return <Badge variant="success">{STATUS_LABELS[status]}</Badge>;
  if (status === "RECONCILING") return <Badge variant="warning">{STATUS_LABELS[status]}</Badge>;
  if (status === "AUTO_CLOSED_PENDING_REVIEW") return <Badge variant="danger">{STATUS_LABELS[status]}</Badge>;
  return <Badge variant="neutral">{STATUS_LABELS[status] ?? status}</Badge>;
}

function presenceDot(status: ConnectedUser["status"]) {
  const color =
    status === "ONLINE" ? "var(--color-success-500)" :
    status === "IDLE"   ? "var(--color-warning-500)" :
    "var(--color-text-soft)";
  return <CircleDot className="h-3.5 w-3.5" style={{ color }} />;
}

/* ── v7 primitives ── */

function SectionHeader({
  icon: Icon,
  title,
  aside,
}: {
  icon: LucideIcon;
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="h-4 w-4 text-[var(--color-text-muted)]" />
      <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--color-text)]">
        {title}
      </span>
      <div className="flex-1 h-px bg-[var(--color-border)]" />
      {aside && (
        <span className="font-mono text-[10px] text-[var(--color-text-muted)]">{aside}</span>
      )}
    </div>
  );
}

function KpiV7({
  label,
  value,
  helper,
  tone = "neutral",
  icon: Icon,
}: {
  label: string;
  value: string | number;
  helper?: string;
  tone?: "ok" | "alert" | "neutral";
  icon: LucideIcon;
}) {
  const dotColor = tone === "ok" ? "var(--v7-success)" : tone === "alert" ? "var(--v7-warning)" : "var(--v7-inactive)";
  return (
    <div
      className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-4"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
          {label}
        </span>
        <Icon className="h-4 w-4 text-[var(--color-text-soft)] opacity-70" />
      </div>
      <div className="font-mono text-[26px] font-bold leading-none text-[var(--color-text)] mb-2.5">
        {value}
      </div>
      {helper && (
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ background: dotColor }} />
          <span className="text-[11px] font-medium text-[var(--color-text-muted)]">{helper}</span>
        </div>
      )}
    </div>
  );
}

/* ── Cash closures table ── */

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
      <div className="py-8 text-center font-mono text-xs text-[var(--color-text-muted)]">
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
                <span className="font-medium text-[var(--color-text)]">{r.branchCode} · {r.boxName}</span>
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
                {r.differenceAmount === null ? "—" : (
                  <span className={Math.abs(r.differenceAmount) < 0.01 ? "text-[var(--color-success-600)]" : "text-[var(--color-danger-600)] font-semibold"}>
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
                    <Button size="sm" variant="secondary" loading={reviewingId === r.id} disabled={Boolean(reviewingId)}
                      icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => onConfirmOk?.(r)}>
                      OK
                    </Button>
                    <Button size="sm" variant="secondary" disabled={Boolean(reviewingId)}
                      icon={<Receipt className="h-3.5 w-3.5" />} onClick={() => onRegisterDifference?.(r)}>
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

/* ── Modal helpers ── */

function InfoTile({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[0.625rem] uppercase tracking-wide text-[var(--color-text-muted)]">
        {icon}{label}
      </div>
      <div className="text-sm text-[var(--color-text)] truncate" title={value}>{value}</div>
    </div>
  );
}

function ModalSectionTitle({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] mb-2">
      {icon}{children}
    </h4>
  );
}

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

/* ── Print ── */

function printOrderDetail(d: OrderDetail) {
  const esc = (s: unknown) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
  const rows = d.lines.map((l) =>
    `<tr><td>${esc(l.productName)}</td><td>${esc(l.sku ?? "—")}</td><td style="text-align:right">${esc(l.quantity)} ${esc(l.unit ?? "")}</td><td style="text-align:right">${money(l.unitPrice)}</td><td style="text-align:right">${money(l.lineSubtotal)}</td></tr>`
  ).join("");
  const pays = d.payments.map((p) =>
    `<li>${esc(paymentMethodLabel(p.method))} — ${p.currencyCode === "USD" ? "US$" : "C$"}${p.amount.toFixed(2)}${p.status === "VOIDED" ? " (ANULADO)" : ""}${p.referenceNumber ? ` · Ref. ${esc(p.referenceNumber)}` : ""}</li>`
  ).join("");
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Factura ${esc(d.orderNumber)}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;padding:24px;font-size:13px}h1{font-size:18px;margin:0 0 4px}h2{font-size:13px;margin:18px 0 6px;text-transform:uppercase;color:#555;border-bottom:1px solid #ddd;padding-bottom:3px}table{width:100%;border-collapse:collapse;margin-top:6px}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}th{background:#f3f4f6}.muted{color:#666}.right{text-align:right}.totals{margin-top:8px;float:right;width:260px}.totals div{display:flex;justify-content:space-between;padding:2px 0}.grand{font-weight:bold;border-top:1px solid #333;margin-top:4px;padding-top:4px}ul{margin:4px 0;padding-left:18px}</style></head><body>
  <h1>Factura / Orden ${esc(d.orderNumber)}</h1>
  <div class="muted">Estado: ${esc(d.status)} · ${esc(localDateTime(d.createdAt))} · Sucursal ${esc(d.branch.code)} - ${esc(d.branch.name)}</div>
  <div class="muted">Vendedor: ${esc(d.createdBy?.name ?? "—")}</div>
  <h2>Cliente</h2><div>${esc(d.customer?.name ?? "Consumidor final")}${d.customer?.taxId ? ` · RUC ${esc(d.customer.taxId)}` : ""}${d.customer?.phone ? ` · Tel. ${esc(d.customer.phone)}` : ""}</div>
  <h2>Productos</h2><table><thead><tr><th>Producto</th><th>SKU</th><th class="right">Cant.</th><th class="right">Precio</th><th class="right">Subtotal</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="totals"><div><span>Subtotal</span><span>${money(d.totals.subtotal)}</span></div>${d.totals.discountTotal > 0 ? `<div><span>Descuento</span><span>-${money(d.totals.discountTotal)}</span></div>` : ""}${d.totals.taxTotal > 0 ? `<div><span>Impuestos</span><span>${money(d.totals.taxTotal)}</span></div>` : ""}${d.totals.transportAmount > 0 ? `<div><span>Transporte</span><span>${money(d.totals.transportAmount)}</span></div>` : ""}<div class="grand"><span>Total</span><span>${money(d.totals.grandTotal)}</span></div></div>
  <div style="clear:both"></div><h2>Pagos</h2><ul>${pays || "<li>Sin pagos</li>"}</ul>${d.notes ? `<h2>Notas</h2><pre style="white-space:pre-wrap;font-family:inherit">${esc(d.notes)}</pre>` : ""}
</body></html>`;
  const w = window.open("", "_blank", "width=820,height=900");
  if (!w) { toast.error("No se pudo abrir la ventana de impresión (¿bloqueador de pop-ups?)."); return; }
  w.document.open(); w.document.write(html); w.document.close();
  w.focus(); setTimeout(() => w.print(), 300);
}

/* ── Invoices management ── */

function InvoicesManagementCard({ onChanged, refreshKey }: { onChanged: () => void; refreshKey?: string }) {
  const [orders, setOrders] = useState<ManagedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState<string>(() => todayManaguaYmd());
  const [showCancelled, setShowCancelled] = useState(false);
  const [target, setTarget] = useState<ManagedOrder | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const mounted = useRef(true);
  const requestId = useRef(0);
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
        setOrders(data.orders ?? []); setError(null);
      }
    } catch (e) {
      if (mounted.current && currentRequest === requestId.current)
        setError(e instanceof Error ? e.message : "Error al cargar facturas");
    } finally {
      if (mounted.current && currentRequest === requestId.current) setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    mounted.current = true;
    loadOrders();
    return () => { mounted.current = false; };
  }, [loadOrders, refreshKey]);

  const openCancelModal = (order: ManagedOrder) => { setTarget(order); setReason(""); };
  const closeModal = () => { if (submitting) return; setTarget(null); setReason(""); };

  const confirmCancel = async () => {
    if (!target) return;
    const trimmed = reason.trim();
    if (trimmed.length < 3) { toast.error("Debe indicar un motivo de anulación (mínimo 3 caracteres)."); return; }
    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/master/sales-orders/${target.id}/cancel`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: trimmed }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message ?? json?.message ?? `Error al anular (HTTP ${res.status})`);
      const result = json?.data ?? {};
      toast.success(
        `Factura ${target.orderNumber} anulada.` +
        (result.inventoryReversalsCount ? ` Inventario revertido: ${result.inventoryReversalsCount} producto(s).` : "") +
        (result.voidedPaymentsCount ? ` Pagos anulados: ${result.voidedPaymentsCount}.` : "")
      );
      setTarget(null); setReason(""); await loadOrders(); onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo anular la factura");
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  };

  const openDetail = useCallback(async (orderId: string) => {
    setDetailId(orderId); setDetail(null); setDetailError(null); setDetailLoading(true);
    try {
      const res = await apiFetch(`/api/master/sales-orders/${orderId}`);
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message ?? json?.message ?? `No se pudo cargar el detalle (HTTP ${res.status})`);
      const data = unwrapApiData(json) as { order: OrderDetail };
      if (mounted.current) setDetail(data.order);
    } catch (e) {
      if (mounted.current) setDetailError(e instanceof Error ? e.message : "Error al cargar el detalle");
    } finally {
      if (mounted.current) setDetailLoading(false);
    }
  }, []);

  const closeDetail = () => { setDetailId(null); setDetail(null); setDetailError(null); };

  const cancelFromDetail = () => {
    if (!detail) return;
    const managed: ManagedOrder = {
      id: detail.id, orderNumber: detail.orderNumber, deliveryOrderNumber: null,
      deliveryOrderIssuedAt: null, documentMode: detail.documentMode,
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
      status: detail.status, grandTotal: detail.totals.grandTotal, createdAt: detail.createdAt,
      branch: detail.branch, customerName: detail.customer?.name ?? null,
      createdByName: detail.createdBy?.name ?? null, linesCount: detail.lines.length,
      cancellable: detail.cancellable,
    };
    closeDetail(); setTarget(managed); setReason("");
  };

  const visibleOrders = showCancelled ? orders : orders.filter((o) => o.status !== "CANCELLED");
  const activeOrders = orders.filter((o) => o.status !== "CANCELLED");
  const cancelledCount = orders.length - activeOrders.length;
  const totalActive = activeOrders.reduce((acc, o) => acc + o.grandTotal, 0);

  return (
    <div
      className="rounded-lg border border-[var(--color-border-strong)] overflow-hidden bg-[var(--color-surface)]"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-[var(--color-text-muted)]" />
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--color-text)]">
              Gestión de Facturas
            </span>
            <p className="text-[10px] text-[var(--color-text-muted)]">
              {activeOrders.length} activas · total {money(totalActive)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date" value={date} max={todayManaguaYmd()}
            onChange={(e) => setDate(e.target.value)}
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs text-[var(--color-text)]"
            style={{ borderRadius: 4 }}
          />
          <button
            onClick={() => setShowCancelled((v) => !v)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border transition-colors"
            style={{
              borderRadius: 4,
              borderColor: showCancelled ? "var(--color-border-mid)" : "var(--color-border)",
              background: showCancelled ? "var(--color-surface)" : "transparent",
              color: "var(--color-text-secondary)",
            }}
          >
            {showCancelled ? "Ocultar anuladas" : `Mostrar anuladas (${cancelledCount})`}
          </button>
          <button
            onClick={() => loadOrders()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-[var(--color-border)] hover:bg-[var(--color-surface)] transition-colors text-[var(--color-text-secondary)]"
            style={{ borderRadius: 4 }}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Actualizar
          </button>
        </div>
      </div>

      {error ? (
        <div className="px-5 py-8 text-center text-sm text-[var(--color-danger-600)]">{error}</div>
      ) : loading ? (
        <div className="px-5 py-8 text-center font-mono text-xs text-[var(--color-text-muted)] animate-pulse">Cargando facturas…</div>
      ) : visibleOrders.length === 0 ? (
        <div className="py-8 text-center font-mono text-xs text-[var(--color-text-muted)]">Sin facturas para la fecha seleccionada.</div>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Factura / Orden</TH>
              <TH>Sucursal</TH>
              <TH>Cliente / Vendedor</TH>
              <TH>Estado</TH>
              <TH>Documento</TH>
              <TH>Pago</TH>
              <TH className="text-right">Total</TH>
              <TH className="text-right">Fecha</TH>
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
                <TD className="text-xs font-mono text-[var(--color-text-secondary)]">{o.branch.code}</TD>
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
                    <Button variant="secondary" size="sm" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => openDetail(o.id)}>
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

      {/* Detail modal */}
      {detailId && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-6"
          role="dialog" aria-modal="true" onClick={closeDetail}>
          <div className="my-4 w-full max-w-4xl rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]"
            style={{ boxShadow: "0 4px 24px rgba(46,45,42,0.18)" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--color-border)] sticky top-0 bg-[var(--color-surface)] rounded-t-lg z-10">
              <div className="flex items-center gap-2.5 min-w-0">
                <Receipt className="h-5 w-5 text-[var(--color-text-muted)] flex-shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-[var(--color-text)] truncate">
                      {detail ? detail.orderNumber : "Detalle de factura"}
                    </h3>
                    {detail && orderStatusBadge(detail.status)}
                  </div>
                  {detail && <p className="text-[0.6875rem] text-[var(--color-text-muted)]">{localDateTime(detail.createdAt)}</p>}
                </div>
              </div>
              <button onClick={closeDetail} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] flex-shrink-0" aria-label="Cerrar">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-5 py-4 max-h-[70vh] overflow-y-auto space-y-5">
              {detailLoading ? (
                <div className="py-12 text-center font-mono text-xs text-[var(--color-text-muted)] animate-pulse">Cargando detalle…</div>
              ) : detailError ? (
                <div className="py-12 text-center">
                  <AlertTriangle className="h-6 w-6 text-[var(--color-danger-500)] mx-auto mb-2" />
                  <p className="text-sm text-[var(--color-danger-600)]">{detailError}</p>
                  <Button variant="secondary" size="sm" className="mt-3" onClick={() => openDetail(detailId)}>Reintentar</Button>
                </div>
              ) : detail ? (
                <>
                  <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <InfoTile label="Sucursal" value={`${detail.branch.code} · ${detail.branch.name}`} />
                    <InfoTile label="Vendedor" value={detail.createdBy?.name ?? "—"} icon={<UserIcon className="h-3.5 w-3.5" />} />
                    <InfoTile label="Fecha y hora" value={localDateTime(detail.createdAt)} />
                    <InfoTile label="Líneas" value={`${detail.lines.length} producto(s)`} />
                  </section>
                  <section>
                    <ModalSectionTitle icon={<UserIcon className="h-3.5 w-3.5" />}>Cliente</ModalSectionTitle>
                    {detail.customer ? (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                        <InfoTile label="Nombre" value={detail.customer.name} />
                        <InfoTile label="RUC" value={detail.customer.taxId ?? "—"} />
                        <InfoTile label="Teléfono" value={detail.customer.phone ?? "—"} />
                        <InfoTile label="Correo" value={detail.customer.email ?? "—"} />
                        {detail.customer.address && (
                          <div className="col-span-2 sm:col-span-4"><InfoTile label="Dirección" value={detail.customer.address} /></div>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-[var(--color-text-muted)]">Venta sin cliente asignado (consumidor final).</p>
                    )}
                  </section>
                  <section>
                    <ModalSectionTitle icon={<Package className="h-3.5 w-3.5" />}>Productos</ModalSectionTitle>
                    <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-[var(--color-surface-alt)] text-[var(--color-text-secondary)] text-xs">
                            <th className="text-left font-medium px-3 py-2">Producto</th>
                            <th className="text-left font-medium px-3 py-2">SKU</th>
                            <th className="text-right font-medium px-3 py-2">Cant.</th>
                            <th className="text-right font-medium px-3 py-2">Precio</th>
                            <th className="text-right font-medium px-3 py-2">Desc.</th>
                            <th className="text-right font-medium px-3 py-2">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.lines.map((l) => (
                            <tr key={l.id} className="border-t border-[var(--color-border)]">
                              <td className="px-3 py-2 text-[var(--color-text)]">{l.productName}</td>
                              <td className="px-3 py-2 text-xs text-[var(--color-text-muted)] font-mono">{l.sku ?? "—"}</td>
                              <td className="px-3 py-2 text-right font-mono">{l.quantity}{l.unit ? <span className="text-[var(--color-text-muted)]"> {l.unit}</span> : null}</td>
                              <td className="px-3 py-2 text-right font-mono">{money(l.unitPrice)}</td>
                              <td className="px-3 py-2 text-right font-mono text-[var(--color-text-muted)]">{l.discountAmount > 0 ? `-${money(l.discountAmount)}` : "—"}</td>
                              <td className="px-3 py-2 text-right font-mono font-semibold text-[var(--color-text)]">{money(l.lineSubtotal)}</td>
                            </tr>
                          ))}
                          {detail.lines.length === 0 && (
                            <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-[var(--color-text-muted)]">Sin productos registrados.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-3 flex justify-end">
                      <div className="w-full sm:w-72 space-y-1 text-sm">
                        <TotalRow label="Subtotal" value={detail.totals.subtotal} />
                        {detail.totals.discountTotal > 0 && <TotalRow label="Descuento" value={-detail.totals.discountTotal} />}
                        {detail.totals.taxTotal > 0 && <TotalRow label="Impuestos" value={detail.totals.taxTotal} />}
                        {detail.totals.transportAmount > 0 && <TotalRow label="Transporte" value={detail.totals.transportAmount} />}
                        <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-1.5 mt-1.5">
                          <span className="font-semibold text-[var(--color-text)]">Total</span>
                          <span className="font-mono font-bold text-base text-[var(--color-text)]">{money(detail.totals.grandTotal)}</span>
                        </div>
                      </div>
                    </div>
                  </section>
                  <section>
                    <ModalSectionTitle icon={<CreditCard className="h-3.5 w-3.5" />}>Pagos</ModalSectionTitle>
                    {detail.payments.length === 0 ? (
                      <p className="text-sm text-[var(--color-text-muted)]">Sin pagos registrados.</p>
                    ) : (
                      <div className="space-y-2">
                        {detail.payments.map((p) => (
                          <div key={p.id} className="rounded-lg border border-[var(--color-border)] px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm text-[var(--color-text)]">{paymentMethodLabel(p.method)}</span>
                              {p.status === "VOIDED" ? <Badge variant="danger">Anulado</Badge> : <Badge variant="success">Registrado</Badge>}
                              {p.referenceNumber && <span className="text-xs text-[var(--color-text-muted)]">Ref.: {p.referenceNumber}</span>}
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-[var(--color-text-muted)]">{localDateTime(p.paidAt)}</span>
                              {p.receivedByName && <span className="text-xs text-[var(--color-text-muted)]">por {p.receivedByName}</span>}
                              <span className="font-mono font-semibold text-sm text-[var(--color-text)]">
                                {p.currencyCode === "USD" ? "US$" : "C$"}{p.amount.toFixed(2)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                  {detail.manualInvoice && (
                    <section>
                      <ModalSectionTitle icon={<FileText className="h-3.5 w-3.5" />}>Factura manual</ModalSectionTitle>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                        <InfoTile label="Serie / Número" value={`${detail.manualInvoice.series ?? "—"} ${detail.manualInvoice.number ?? ""}`.trim()} />
                        <InfoTile label="Estado" value={detail.manualInvoice.status} />
                        <InfoTile label="Cliente" value={detail.manualInvoice.customerName ?? "—"} />
                        <InfoTile label="RUC" value={detail.manualInvoice.customerRuc ?? "—"} />
                      </div>
                    </section>
                  )}
                  {detail.notes && (
                    <section>
                      <ModalSectionTitle icon={<FileText className="h-3.5 w-3.5" />}>Notas</ModalSectionTitle>
                      <pre className="whitespace-pre-wrap text-sm text-[var(--color-text-secondary)] bg-[var(--color-surface-alt)] rounded-lg px-3 py-2 border border-[var(--color-border)]">
                        {detail.notes}
                      </pre>
                    </section>
                  )}
                  <section>
                    <ModalSectionTitle icon={<History className="h-3.5 w-3.5" />}>Historial y auditoría</ModalSectionTitle>
                    {detail.auditTrail.length === 0 ? (
                      <p className="text-sm text-[var(--color-text-muted)]">Sin eventos de auditoría registrados.</p>
                    ) : (
                      <ul className="space-y-2">
                        {detail.auditTrail.map((a) => {
                          const meta = (a.metadata ?? {}) as Record<string, unknown>;
                          const reasonTxt = typeof meta.reason === "string" ? meta.reason : null;
                          return (
                            <li key={a.id} className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm flex items-start gap-2">
                              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[var(--color-text-muted)] flex-shrink-0" />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium text-[var(--color-text)]">{auditActionLabel(a.action)}</span>
                                  <span className="text-xs text-[var(--color-text-muted)]">{localDateTime(a.occurredAt)}</span>
                                  {a.actorName && <span className="text-xs text-[var(--color-text-muted)]">· {a.actorName}</span>}
                                </div>
                                {reasonTxt && <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">Motivo: {reasonTxt}</p>}
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
            <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-[var(--color-border)] flex-wrap">
              <div>
                {detail && (
                  <Button variant="ghost" size="sm" icon={<Printer className="h-3.5 w-3.5" />} onClick={() => printOrderDetail(detail)}>
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
                <Button variant="secondary" size="sm" onClick={closeDetail}>Cerrar</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cancel confirm modal */}
      {target && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog" aria-modal="true" onClick={closeModal}>
          <div className="w-full max-w-md rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]"
            style={{ boxShadow: "0 4px 24px rgba(46,45,42,0.18)" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="h-5 w-5 text-[var(--color-danger-500)] flex-shrink-0" />
                <h3 className="text-sm font-semibold text-[var(--color-text)]">Anular factura</h3>
              </div>
              <button onClick={closeModal} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]" aria-label="Cerrar">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-[var(--color-text-secondary)]">
                ¿Está seguro que desea anular la factura{" "}
                <span className="font-semibold text-[var(--color-text)]">{target.orderNumber}</span>{" "}
                por <span className="font-semibold text-[var(--color-text)]">{money(target.grandTotal)}</span>?
              </p>
              <div className="rounded-lg bg-[var(--color-warning-50)] border border-[var(--color-warning-200)] px-3 py-2 text-xs text-[var(--color-warning-700)] flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>Esta acción revertirá el inventario, anulará los pagos y actualizará los totales del día. No se puede deshacer.</span>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                  Motivo de la anulación <span className="text-[var(--color-danger-600)]">*</span>
                </label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder="Ej.: Error en el cobro, devolución del cliente…"
                  autoFocus disabled={submitting} />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--color-border)]">
              <Button variant="secondary" size="sm" onClick={closeModal} disabled={submitting}>Cancelar</Button>
              <Button variant="danger" size="sm" loading={submitting} icon={<Ban className="h-3.5 w-3.5" />} onClick={confirmCancel}>
                Confirmar anulación
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Page ── */

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
      if (mounted.current) { setData(unwrapApiData(json) as CommandCenter); setError(null); }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      if (mounted.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  const pollLoad = useCallback(async () => { await load(true); }, [load]);

  useEffect(() => {
    mounted.current = true;
    void load(false);
    return () => { mounted.current = false; };
  }, [load]);

  useOperationalPolling({ task: pollLoad, intervalMs: 30_000, immediate: false, deps: [pollLoad] });

  const reviewAutoClose = useCallback(async (cashSessionId: string, payload: Record<string, unknown>) => {
    setReviewingId(cashSessionId);
    try {
      const res = await apiFetch(`/api/master/cash-sessions/${cashSessionId}/review-auto-close`, {
        method: "POST", body: JSON.stringify(payload),
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
    if (!Number.isFinite(countedCashAmount) || countedCashAmount < 0) { toast.error("Monto contado invalido"); return; }
    if (differenceNote.trim().length < 5) { toast.error("Agrega una nota para la diferencia"); return; }
    await reviewAutoClose(differenceTarget.id, { countedCashAmount, note: differenceNote.trim() });
    setDifferenceTarget(null); setDifferenceAmount(""); setDifferenceNote("");
  }, [differenceAmount, differenceNote, differenceTarget, reviewAutoClose]);

  if (loading) {
    return <p className="font-mono text-xs text-[var(--color-text-muted)] animate-pulse">Cargando Centro de Comando…</p>;
  }
  if (error && !data) {
    return <p className="text-sm text-[var(--color-danger-600)]">No se pudo cargar el Centro de Comando: {error}</p>;
  }
  if (!data) return null;

  const { totals, users, byBranch, cashClosures } = data;
  const closureRows =
    tab === "pending" ? cashClosures.pending :
    tab === "completedToday" ? cashClosures.completedToday :
    cashClosures.history;
  const maxSales = Math.max(1, ...byBranch.map((b) => b.salesToday));

  const CLOSURE_TABS = [
    { key: "pending" as ClosureTab, label: "Pendientes", icon: ClipboardCheck, count: cashClosures.pending.length },
    { key: "completedToday" as ClosureTab, label: "Hoy", icon: CheckCircle2, count: cashClosures.completedToday.length },
    { key: "history" as ClosureTab, label: "Historial", icon: History, count: cashClosures.history.length },
  ];

  return (
    <section className="space-y-6 animate-fade-in-up">

      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="relative flex h-2 w-2 flex-shrink-0 mt-1">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "var(--v7-success)" }} />
            <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: "var(--v7-success)" }} />
          </span>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text)]">
                Centro de Comando
              </h1>
              <span
                className="text-[9px] font-bold uppercase tracking-[0.1em] px-1.5 py-0.5 border"
                style={{
                  fontFamily: "'DM Mono', monospace",
                  borderRadius: 3,
                  color: "var(--v7-success)",
                  background: "rgba(45,125,70,0.08)",
                  borderColor: "rgba(45,125,70,0.2)",
                }}
              >
                En vivo
              </span>
            </div>
            <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
              Visibilidad global de operaciones, cajas y personal activo
            </p>
            {data.generatedAt && (
              <p className="font-mono text-[10px] text-[var(--color-text-muted)] mt-1">
                Actualizado: {localDateTime(data.generatedAt)}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={() => load(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] transition-colors"
          style={{ borderRadius: 6 }}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Actualizar
        </button>
      </div>

      {/* ── KPI grid ── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiV7
          label="Ventas globales (hoy)"
          value={money(totals.salesToday)}
          helper={`${totals.paidSalesCount} venta(s) cobrada(s)`}
          tone="ok"
          icon={ShoppingCart}
        />
        <KpiV7
          label="Cajas abiertas"
          value={`${totals.openSessions}/${totals.boxesActive}`}
          helper="sesiones abiertas / cajas activas"
          tone={totals.openSessions > 0 ? "neutral" : "ok"}
          icon={Wallet}
        />
        <KpiV7
          label="Cierres por revisar"
          value={totals.pendingReviewSessions}
          helper={totals.pendingReviewSessions > 0 ? "requieren atención" : "sin diferencias"}
          tone={totals.pendingReviewSessions > 0 ? "alert" : "ok"}
          icon={ClipboardCheck}
        />
        <KpiV7
          label="Usuarios en línea"
          value={totals.usersOnline}
          helper={`${totals.usersIdle} inactivos · ${totals.usersOffline} desconectados`}
          tone="neutral"
          icon={Users}
        />
      </div>

      {/* ── Gestión rápida ── */}
      <div>
        <SectionHeader icon={Settings} title="Gestión rápida" aside="acceso directo" />
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {MANAGEMENT_LINKS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href as Route}
                className="group flex flex-col gap-2 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3.5 transition-all hover:bg-[var(--color-surface-alt)] hover:shadow-[var(--shadow-card-hover)]"
              >
                <Icon className="h-[18px] w-[18px] text-[var(--color-text-secondary)]" />
                <div className="text-[13px] font-semibold text-[var(--color-text)]">{item.label}</div>
                <div className="text-[11px] text-[var(--color-text-muted)] leading-snug">{item.description}</div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* ── Branch grid ── */}
      <div>
        <SectionHeader icon={Building2} title="Sucursales" aside={`${byBranch.length} registradas`} />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {byBranch.map((b) => {
            const pct = Math.round((b.salesToday / maxSales) * 100);
            const dayOpen = b.operationalDay?.status === "OPEN";
            return (
              <div
                key={b.branchId}
                className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3.5"
                style={{ boxShadow: "var(--shadow-card)" }}
              >
                {/* Header row */}
                <div className="flex items-center justify-between mb-2.5">
                  <span
                    className="text-[10px] font-bold tracking-[0.12em] px-1.5 py-0.5 border"
                    style={{
                      fontFamily: "'DM Mono', monospace",
                      borderRadius: 3,
                      color: "var(--color-text)",
                      background: "var(--color-surface)",
                      borderColor: "var(--color-border-mid)",
                    }}
                  >
                    {b.branchCode}
                  </span>
                  {b.pendingReviewSessions > 0 ? (
                    <Badge variant="danger">{b.pendingReviewSessions} por revisar</Badge>
                  ) : dayOpen ? (
                    <Badge variant="success">Activa</Badge>
                  ) : (
                    <Badge variant="neutral">Inactiva</Badge>
                  )}
                </div>

                <div className="text-[15px] font-bold text-[var(--color-text)] mb-0.5">{b.branchName}</div>
                <div className="text-[11px] text-[var(--color-text-muted)] mb-3">
                  {b.boxesTotal} {b.boxesTotal === 1 ? "caja" : "cajas"} ·{" "}
                  {b.operationalDay
                    ? `Día ${DAY_STATUS_LABELS[b.operationalDay.status] ?? b.operationalDay.status}`
                    : "Sin día operativo"}
                </div>

                {/* Progress bar */}
                <div className="h-[3px] rounded-sm overflow-hidden mb-3" style={{ background: "var(--color-border)" }}>
                  <div
                    className="h-full transition-all duration-500"
                    style={{
                      width: `${pct}%`,
                      background: b.salesToday > 0 ? "linear-gradient(90deg, color-mix(in srgb, var(--color-master-600) 65%, transparent), var(--color-master-500))" : "transparent",
                      borderRadius: 2,
                    }}
                  />
                </div>

                {/* Key data rows */}
                <div className="space-y-1.5 mb-3">
                  {[
                    ["Ventas hoy", money(b.salesToday)],
                    ["Cajas abiertas", `${b.openSessions} / ${b.boxesTotal}`],
                    ["Efectivo esperado", money(b.expectedCashOnHand)],
                    ["Utilidad est.", b.estimatedGrossProfit === null ? "N/D" : money(b.estimatedGrossProfit)],
                  ].map(([label, value], i) => (
                    <div key={label}>
                      {i === 1 && <div className="h-px mb-1.5" style={{ background: "var(--color-border)" }} />}
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-medium text-[var(--color-text-muted)]">{label}</span>
                        <span
                          className="text-[12px] font-semibold text-[var(--color-text)]"
                          style={{ fontFamily: "'DM Mono', monospace" }}
                        >
                          {value}
                        </span>
                      </div>
                    </div>
                  ))}
                  {b.operationalDay?.cashDifferenceTotal !== null && b.operationalDay?.cashDifferenceTotal !== undefined && (
                    <div className="flex items-center justify-between pt-1.5 border-t border-[var(--color-border)]">
                      <span className="text-[11px] font-medium text-[var(--color-text-muted)]">Diferencia de caja</span>
                      <span
                        className="text-[12px] font-semibold"
                        style={{
                          fontFamily: "'DM Mono', monospace",
                          color: Math.abs(b.operationalDay.cashDifferenceTotal) < 0.01 ? "var(--v7-success)" : "var(--v7-accent)",
                        }}
                      >
                        {money(b.operationalDay.cashDifferenceTotal)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Cash breakdown */}
                <div
                  className="rounded-md border border-[var(--color-border)] p-2.5"
                  style={{ background: "rgba(46,45,42,0.02)" }}
                >
                  <p
                    className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--color-text-muted)] mb-2"
                    style={{ fontFamily: "'DM Mono', monospace" }}
                  >
                    Caja del día · {b.activeCashSessionIds.length} activa(s)
                  </p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                    {([
                      ["Apertura", money(b.openingCashTotal)],
                      ["Efectivo neto", money(b.cashTenderNetTotal)],
                      ["Movimientos", money(b.cashMovementsNet)],
                      ["Egresos", b.cashOutflowsTotal > 0 ? `- ${money(b.cashOutflowsTotal)}` : money(0)],
                      ["Tarjeta", money(b.cardTenderTotal)],
                      ["Transferencia", money(b.transferTenderTotal)],
                    ] as [string, string][]).map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between gap-1">
                        <span className="text-[10px] text-[var(--color-text-muted)] truncate">{label}</span>
                        <span className="text-[10px] text-[var(--color-text-secondary)] flex-shrink-0 font-mono">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Cierres + Usuarios (2-col) ── */}
      <div className="grid gap-3 xl:grid-cols-2">

        {/* Cierres de caja */}
        <div
          className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] overflow-hidden"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-[var(--color-text-muted)]" />
              <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--color-text)]">
                Cierres de Caja
              </span>
            </div>
            <div className="flex border border-[var(--color-border)] overflow-hidden" style={{ borderRadius: 4 }}>
              {CLOSURE_TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className="flex items-center gap-1 px-2.5 py-1 transition-colors"
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    background: tab === t.key ? "var(--color-ink, #2E2D2A)" : "transparent",
                    color: tab === t.key ? "#F5F4F2" : "var(--color-text-muted)",
                    borderRight: "1px solid var(--color-border)",
                  }}
                >
                  {t.label}
                  <span
                    className="ml-1 px-1 rounded-full"
                    style={{
                      fontSize: 9,
                      background: tab === t.key ? "rgba(255,255,255,0.2)" : "var(--color-border)",
                      color: tab === t.key ? "#fff" : "var(--color-text-muted)",
                    }}
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
        </div>

        {/* Usuarios conectados */}
        <div
          className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] overflow-hidden"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-[var(--color-text-muted)]" />
              <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--color-text)]">
                Usuarios conectados
              </span>
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
                <TH>Módulo</TH>
                <TH className="text-center">Cajas</TH>
                <TH className="text-right">Actividad</TH>
              </TR>
            </THead>
            <TBody>
              {[...users.list]
                .sort((a, b) => ({ ONLINE: 0, IDLE: 1, OFFLINE: 2 } as const)[a.status] - ({ ONLINE: 0, IDLE: 1, OFFLINE: 2 } as const)[b.status])
                .map((u) => (
                  <TR key={u.userId}>
                    <TD>
                      <div className="flex items-center gap-2">
                        {presenceDot(u.status)}
                        <span className="font-medium text-[var(--color-text)]">{u.username}</span>
                      </div>
                    </TD>
                    <TD className="text-xs text-[var(--color-text-secondary)]">{u.globalRole}</TD>
                    <TD className="text-xs font-mono text-[var(--color-text-muted)]">{u.branch ? u.branch.code : "—"}</TD>
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
        </div>
      </div>

      {/* ── Gestión de facturas ── */}
      <InvoicesManagementCard onChanged={() => load(true)} refreshKey={data.generatedAt} />

      {/* ── Difference modal ── */}
      {differenceTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
            style={{ boxShadow: "0 4px 24px rgba(46,45,42,0.18)" }}
          >
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
                  className="mt-1" type="number" min="0" step="0.01"
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
      )}
    </section>
  );
}
