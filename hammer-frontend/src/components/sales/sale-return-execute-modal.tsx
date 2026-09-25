"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { X, Check, AlertTriangle } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money } from "@/lib/format";

/**
 * prompt-pendientes-2026-09.md Fase 3 (PENDIENTES #8) — ejecutar una
 * devolución ya APROBADA: mueve inventario (SELLABLE/DAMAGED según la
 * condición ya fijada al solicitar) y postea el reembolso. El backend
 * (POST /api/sales/returns/[id]/execute) ya existía completo; faltaba esta
 * pantalla. Extraído a su propio archivo por el mismo motivo que
 * sale-return-request-sheet.tsx.
 */

type RefundMethod = "CASH" | "CARD" | "TRANSFER" | "CREDIT_NOTE";

const METHOD_LABEL: Record<RefundMethod, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  TRANSFER: "Transferencia",
  CREDIT_NOTE: "Nota de crédito",
};

const DESTINATION_LABEL: Record<string, string> = {
  SELLABLE: "vuelve a inventario vendible",
  DAMAGED: "entra a inventario dañado",
  NONE: "no vuelve a inventario",
};

const ERROR_MESSAGES: Record<string, string> = {
  SALE_RETURN_NOT_APPROVED: "Esta devolución todavía no fue aprobada.",
  SALE_RETURN_ALREADY_EXECUTED: "Esta devolución ya fue ejecutada.",
  CASH_SESSION_REQUIRED_FOR_CASH_REFUND: "Selecciona una sesión de caja para un reembolso en efectivo.",
  CASH_SESSION_NOT_OPEN: "La sesión de caja ya no está abierta.",
  REFUND_EXCEEDS_AMOUNT_PAID: "El monto a reembolsar supera lo efectivamente pagado.",
  REFUND_METHOD_MISMATCH_REQUIRES_MASTER_EXCEPTION: "Cambiar el método de reembolso requiere que la devolución tenga aprobación Master.",
  CUSTOMER_REQUIRED_FOR_CREDIT_NOTE: "Se requiere un cliente para emitir una nota de crédito.",
};

type SaleReturnItem = {
  saleOrderLineId: string;
  productId: string;
  quantity: number;
  condition: "GOOD" | "DAMAGED" | "NOT_RETURNED";
  inventoryDestination: "SELLABLE" | "DAMAGED" | "NONE";
  refundableAmount: number;
};

type SaleReturnFull = {
  id: string;
  approvedByMasterId: string | null;
  items: SaleReturnItem[];
};

// GET /api/sales/returns/[id] devuelve la fila Prisma cruda: quantity y
// refundableAmount son Prisma.Decimal en el schema, y roundDecimalsForResponse
// (decimal-rounding.ts) los redondea pero NO los convierte a number — llegan
// serializados como STRING ("100.00", vía Decimal.toJSON()). Sin normalizar,
// `sum + refundableAmount` en el total concatena en vez de sumar (con 1 ítem
// da bien "por casualidad" porque round2 multiplica por 100 y ahí sí coacciona
// a number; con 2+ ítems da NaN).
type RawSaleReturnItem = Omit<SaleReturnItem, "quantity" | "refundableAmount"> & {
  quantity: number | string;
  refundableAmount: number | string;
};
type RawSaleReturnFull = Omit<SaleReturnFull, "items"> & { items: RawSaleReturnItem[] };

function normalizeSaleReturn(raw: RawSaleReturnFull): SaleReturnFull {
  return {
    ...raw,
    items: raw.items.map((item) => ({
      ...item,
      quantity: Number(item.quantity),
      refundableAmount: Number(item.refundableAmount),
    })),
  };
}

/** Espejo del total que arma executeSaleReturn (sales-returns/service.ts) sobre refundableAmount por ítem — acepta string u number porque la fuente es un Decimal serializado. */
export function totalRefundableFromItems(items: { refundableAmount: number | string }[]): number {
  return round2(items.reduce((sum, i) => sum + Number(i.refundableAmount), 0));
}

type ActiveCashSession = { id: string; status: string; physicalCashBox?: { code?: string } | null } | null;

function isOriginalMethod(m: string | null): m is RefundMethod {
  return m === "CASH" || m === "CARD" || m === "TRANSFER";
}

export function SaleReturnExecuteModal({
  saleReturnId,
  returnNumber,
  branchId,
  orderLines,
  originalPaymentMethod,
  onClose,
  onExecuted,
}: {
  saleReturnId: string;
  returnNumber: string;
  branchId: string;
  orderLines: { id: string; productName: string }[];
  originalPaymentMethod: string | null;
  onClose: () => void;
  onExecuted: () => void;
}) {
  const [saleReturn, setSaleReturn] = useState<SaleReturnFull | null>(null);
  const [activeCashSession, setActiveCashSession] = useState<ActiveCashSession | undefined>(undefined);
  const [refundMethod, setRefundMethod] = useState<RefundMethod>(isOriginalMethod(originalPaymentMethod) ? originalPaymentMethod : "CASH");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch(`/api/sales/returns/${saleReturnId}`)
      .then(async (res) => {
        const raw = await res.json();
        if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo cargar la devolución.");
        setSaleReturn(normalizeSaleReturn(unwrapApiData(raw) as RawSaleReturnFull));
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "No se pudo cargar la devolución."));

    apiFetch(`/api/cashier/cash-sessions/active?branchId=${branchId}`)
      .then(async (res) => {
        const raw = await res.json();
        if (!res.ok) throw new Error();
        setActiveCashSession(unwrapApiData(raw) as ActiveCashSession);
      })
      .catch(() => setActiveCashSession(null));
  }, [saleReturnId, branchId]);

  const nameByLineId = new Map(orderLines.map((l) => [l.id, l.productName]));
  const totalRefundable = saleReturn ? totalRefundableFromItems(saleReturn.items) : 0;
  const hasMasterException = Boolean(saleReturn?.approvedByMasterId);
  const changedMethod = isOriginalMethod(originalPaymentMethod) && originalPaymentMethod !== refundMethod && refundMethod !== "CREDIT_NOTE";
  const blockedByMethodMismatch = changedMethod && !hasMasterException;

  const cashSessionOpen = activeCashSession != null && activeCashSession.status === "OPEN";
  const canConfirm = !saving && saleReturn !== null && !blockedByMethodMismatch && (refundMethod !== "CASH" || cashSessionOpen);

  async function submit() {
    if (!canConfirm) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/sales/returns/${saleReturnId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refundMethod,
          cashSessionId: refundMethod === "CASH" ? activeCashSession?.id ?? null : null,
        }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) {
        const code = raw?.error?.code as string | undefined;
        throw new Error((code && ERROR_MESSAGES[code]) || raw?.error?.message || "No se pudo ejecutar la devolución.");
      }
      toast.success(`Devolución ${returnNumber} ejecutada — reembolso registrado.`);
      onExecuted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo ejecutar la devolución.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto space-y-4 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Ejecutar reembolso — {returnNumber}</h3>
          <button type="button" onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!saleReturn ? (
          <p className="py-6 text-center text-sm text-[var(--color-text-muted)]">Cargando…</p>
        ) : (
          <>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-sm">
              <p className="mb-1.5 font-medium text-[var(--color-text-muted)]">Resumen</p>
              <div className="space-y-1">
                {saleReturn.items.map((item) => (
                  <div key={item.saleOrderLineId} className="flex justify-between text-xs">
                    <span>
                      {nameByLineId.get(item.saleOrderLineId) ?? "(producto)"} × {item.quantity} — {DESTINATION_LABEL[item.inventoryDestination]}
                    </span>
                    <span className="tabular-nums">{money(item.refundableAmount)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between border-t border-[var(--color-border)] pt-2 font-semibold">
                <span>Total a reembolsar</span>
                <span>{money(totalRefundable)}</span>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Método de reembolso</label>
              <select
                className="hm-input w-full"
                value={refundMethod}
                onChange={(e) => setRefundMethod(e.target.value as RefundMethod)}
              >
                {(Object.keys(METHOD_LABEL) as RefundMethod[]).map((m) => (
                  <option key={m} value={m}>
                    {METHOD_LABEL[m]}{isOriginalMethod(originalPaymentMethod) && originalPaymentMethod === m ? " (original)" : ""}
                  </option>
                ))}
              </select>
              {changedMethod && (
                <p className={`mt-1.5 flex items-start gap-1.5 text-xs ${blockedByMethodMismatch ? "text-[var(--color-danger-600)]" : "text-[var(--color-warning-700)]"}`}>
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {blockedByMethodMismatch
                    ? "El backend va a rechazar esto: cambiar el método requiere que la devolución tenga aprobación Master, y esta no la tiene."
                    : "Método distinto al original — permitido porque esta devolución tiene aprobación Master."}
                </p>
              )}
            </div>

            {refundMethod === "CASH" && (
              <div className="rounded-lg border border-[var(--color-border)] p-3 text-sm">
                {activeCashSession === undefined ? (
                  <p className="text-xs text-[var(--color-text-muted)]">Buscando sesión de caja activa…</p>
                ) : cashSessionOpen ? (
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    Se usará la sesión de caja activa de la sucursal{activeCashSession?.physicalCashBox?.code ? ` (${activeCashSession.physicalCashBox.code})` : ""}.
                  </p>
                ) : (
                  <p className="flex items-start gap-1.5 text-xs text-[var(--color-danger-600)]">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    No hay una sesión de caja abierta en esta sucursal — no se puede reembolsar en efectivo hasta que se abra una.
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]">
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canConfirm}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--color-success-600)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-success-700)] disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
                {saving ? "Ejecutando…" : "Ejecutar reembolso"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
