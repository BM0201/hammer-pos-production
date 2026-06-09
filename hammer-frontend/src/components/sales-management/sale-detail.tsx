"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import {
  ArrowLeft,
  Receipt,
  User,
  Building2,
  Calendar,
  UserCircle,
  CreditCard,
  Printer,
  FlaskConical,
  Ban,
} from "lucide-react";

type SaleLine = {
  id: string;
  productId: string;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  lineSubtotal: number;
};

type SalePayment = {
  id: string;
  method: string;
  status: string;
  amount: number;
  referenceNumber: string | null;
  paidAt: string;
};

type SaleDetail = {
  id: string;
  orderNumber: string;
  status: string;
  createdAt: string;
  isTest: boolean;
  voidedAt: string | null;
  voidReason: string | null;
  voidedBy: string | null;
  notes: string | null;
  branch: { id: string; code: string; name: string };
  customer: {
    id: string;
    code: string;
    name: string;
    taxId: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
  } | null;
  seller: string;
  lines: SaleLine[];
  payments: SalePayment[];
  totals: {
    subtotal: number;
    discountTotal: number;
    manualDiscountAmount: number;
    taxTotal: number;
    transportAmount: number;
    grandTotal: number;
  };
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

const PAYMENT_LABELS: Record<string, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  TRANSFER: "Transferencia",
  CREDIT: "Crédito",
  MIXED: "Mixto",
};

function formatMoney(value: number) {
  return `C$ ${Number(value ?? 0).toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatNumber(value: number) {
  return Number(value ?? 0).toLocaleString("es-NI", { maximumFractionDigits: 4 });
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-NI", { timeZone: "America/Managua", dateStyle: "long", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-soft)]">{label}</p>
        <p className="truncate text-sm font-medium text-[var(--color-text)]">{value}</p>
      </div>
    </div>
  );
}

/**
 * Detalle de venta reutilizable. Por defecto consulta el endpoint de gestión de
 * Master (`/api/master/sales-management`), pero acepta una ruta base alterna vía
 * `endpoint` para reutilizarlo en la bitácora de ventas de sucursal
 * (`/api/branch/sales-log`). El detalle se carga como `${endpoint}/${saleId}`.
 */
export function SaleDetail({
  saleId,
  endpoint = "/api/master/sales-management",
}: {
  saleId: string;
  endpoint?: string;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`${endpoint}/${saleId}`);
      const json = await response.json();
      if (!response.ok) throw new Error("No se pudo cargar el detalle de la venta.");
      setDetail(unwrapApiData<SaleDetail>(json));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el detalle de la venta.");
    } finally {
      setLoading(false);
    }
  }, [saleId, endpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <div className="p-10 text-center text-sm text-[var(--color-text-muted)]">Cargando detalle…</div>;
  }

  if (error || !detail) {
    return (
      <div className="space-y-4">
        <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => router.back()} className="rounded-lg">
          Volver
        </Button>
        <Card className="p-6 text-center text-sm text-[var(--color-danger-600)]">
          {error ?? "No se encontró la venta."}
        </Card>
      </div>
    );
  }

  const totalItems = detail.lines.reduce((acc, l) => acc + l.quantity, 0);

  return (
    <div className="space-y-5">
      {/* Barra superior */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => router.back()} className="rounded-lg">
          Volver a ventas
        </Button>
        <Button variant="ghost" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()} className="rounded-lg">
          Imprimir
        </Button>
      </div>

      {/* Encabezado de la factura */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--color-info-600)]/10 text-[var(--color-info-700)]">
              <Receipt className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-[var(--color-text)]">{detail.orderNumber}</h1>
              <p className="text-sm text-[var(--color-text-muted)]">Detalle de la venta</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_VARIANT[detail.status] ?? "neutral"}>{STATUS_LABELS[detail.status] ?? detail.status}</Badge>
            {detail.isTest ? <Badge variant="warning">Prueba</Badge> : null}
            {detail.voidedAt ? <Badge variant="danger">Anulada</Badge> : null}
            {!detail.isTest && !detail.voidedAt ? <Badge variant="success">Válida</Badge> : null}
          </div>
        </div>

        {/* Avisos de estado especial */}
        {detail.isTest ? (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--color-warning-500)]/40 bg-[var(--color-warning-500)]/10 px-3 py-2 text-sm text-[var(--color-warning-600)]">
            <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Esta venta está marcada como <strong>prueba</strong> y se excluye de reportes y métricas.</span>
          </div>
        ) : null}
        {detail.voidedAt ? (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--color-danger-500)]/40 bg-[var(--color-danger-500)]/10 px-3 py-2 text-sm text-[var(--color-danger-600)]">
            <Ban className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Venta <strong>anulada</strong> el {formatDate(detail.voidedAt)}{detail.voidedBy ? ` por ${detail.voidedBy}` : ""}.
              {detail.voidReason ? <> Motivo: <em>{detail.voidReason}</em></> : null}
            </span>
          </div>
        ) : null}
      </Card>

      {/* Información general */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="space-y-3.5 p-5">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Cliente</h2>
          {detail.customer ? (
            <div className="space-y-3">
              <InfoRow icon={<User className="h-4 w-4" />} label="Nombre" value={detail.customer.name} />
              <InfoRow icon={<UserCircle className="h-4 w-4" />} label="Código" value={detail.customer.code} />
              {detail.customer.taxId ? <InfoRow icon={<Receipt className="h-4 w-4" />} label="RUC / Cédula" value={detail.customer.taxId} /> : null}
              {detail.customer.phone ? <InfoRow icon={<User className="h-4 w-4" />} label="Teléfono" value={detail.customer.phone} /> : null}
              {detail.customer.email ? <InfoRow icon={<User className="h-4 w-4" />} label="Correo" value={detail.customer.email} /> : null}
              {detail.customer.address ? <InfoRow icon={<Building2 className="h-4 w-4" />} label="Dirección" value={detail.customer.address} /> : null}
            </div>
          ) : (
            <p className="text-sm text-[var(--color-text-muted)]">Venta sin cliente asociado (consumidor final).</p>
          )}
        </Card>

        <Card className="space-y-3.5 p-5">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Información de la venta</h2>
          <div className="space-y-3">
            <InfoRow icon={<Calendar className="h-4 w-4" />} label="Fecha" value={formatDate(detail.createdAt)} />
            <InfoRow icon={<Building2 className="h-4 w-4" />} label="Sucursal" value={`${detail.branch.code} · ${detail.branch.name}`} />
            <InfoRow icon={<UserCircle className="h-4 w-4" />} label="Vendedor" value={detail.seller} />
            <InfoRow icon={<Receipt className="h-4 w-4" />} label="Ítems" value={`${detail.lines.length} productos · ${formatNumber(totalItems)} unidades`} />
            {detail.notes ? <InfoRow icon={<Receipt className="h-4 w-4" />} label="Notas" value={detail.notes} /> : null}
          </div>
        </Card>
      </div>

      {/* Productos / servicios */}
      <Card noPadding className="overflow-hidden">
        <div className="border-b border-[var(--color-border)] px-5 py-3.5">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Productos y servicios</h2>
        </div>
        {detail.lines.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">Esta venta no tiene líneas registradas.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>#</TH>
                  <TH>Producto / Servicio</TH>
                  <TH>SKU</TH>
                  <TH className="text-right">Cantidad</TH>
                  <TH className="text-right">Precio unit.</TH>
                  <TH className="text-right">Descuento</TH>
                  <TH className="text-right">Subtotal</TH>
                </TR>
              </THead>
              <TBody>
                {detail.lines.map((line, idx) => (
                  <TR key={line.id}>
                    <TD className="text-xs text-[var(--color-text-soft)]">{idx + 1}</TD>
                    <TD className="font-medium text-[var(--color-text)]">{line.name}</TD>
                    <TD className="text-xs text-[var(--color-text-muted)]">{line.sku}</TD>
                    <TD className="whitespace-nowrap text-right tabular-nums">{formatNumber(line.quantity)} <span className="text-xs text-[var(--color-text-soft)]">{line.unit}</span></TD>
                    <TD className="whitespace-nowrap text-right tabular-nums">{formatMoney(line.unitPrice)}</TD>
                    <TD className="whitespace-nowrap text-right tabular-nums text-[var(--color-text-muted)]">{line.discountAmount > 0 ? `- ${formatMoney(line.discountAmount)}` : "—"}</TD>
                    <TD className="whitespace-nowrap text-right font-semibold tabular-nums text-[var(--color-text)]">{formatMoney(line.lineSubtotal)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Pagos + Totales */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="space-y-3 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
            <CreditCard className="h-4 w-4 text-[var(--color-text-muted)]" /> Pagos
          </h2>
          {detail.payments.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">No hay pagos registrados para esta venta.</p>
          ) : (
            <div className="space-y-2">
              {detail.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text)]">{PAYMENT_LABELS[p.method] ?? p.method}</p>
                    <p className="text-[11px] text-[var(--color-text-soft)]">{formatDate(p.paidAt)}{p.referenceNumber ? ` · Ref: ${p.referenceNumber}` : ""}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums text-[var(--color-text)]">{formatMoney(p.amount)}</p>
                    {p.status !== "POSTED" ? <Badge variant="danger" className="mt-0.5">Anulado</Badge> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Resumen</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-[var(--color-text-muted)]">Subtotal</dt>
              <dd className="tabular-nums font-medium text-[var(--color-text)]">{formatMoney(detail.totals.subtotal)}</dd>
            </div>
            {detail.totals.discountTotal > 0 ? (
              <div className="flex items-center justify-between">
                <dt className="text-[var(--color-text-muted)]">Descuento líneas</dt>
                <dd className="tabular-nums font-medium text-[var(--color-danger-600)]">- {formatMoney(detail.totals.discountTotal)}</dd>
              </div>
            ) : null}
            {detail.totals.manualDiscountAmount > 0 ? (
              <div className="flex items-center justify-between">
                <dt className="text-[var(--color-text-muted)]">Descuento manual</dt>
                <dd className="tabular-nums font-medium text-[var(--color-danger-600)]">- {formatMoney(detail.totals.manualDiscountAmount)}</dd>
              </div>
            ) : null}
            {detail.totals.transportAmount > 0 ? (
              <div className="flex items-center justify-between">
                <dt className="text-[var(--color-text-muted)]">Transporte</dt>
                <dd className="tabular-nums font-medium text-[var(--color-text)]">{formatMoney(detail.totals.transportAmount)}</dd>
              </div>
            ) : null}
            <div className="flex items-center justify-between">
              <dt className="text-[var(--color-text-muted)]">Impuestos</dt>
              <dd className="tabular-nums font-medium text-[var(--color-text)]">{formatMoney(detail.totals.taxTotal)}</dd>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-[var(--color-border)] pt-3">
              <dt className="text-base font-semibold text-[var(--color-text)]">Total</dt>
              <dd className="text-xl font-bold tabular-nums text-[var(--color-success-700)]">{formatMoney(detail.totals.grandTotal)}</dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  );
}
