"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { CATEGORY_LABELS } from "@/components/expenses/expense-manager.types";

/**
 * prompt-caja-gastos-pos-cobro.md Commit 2 — "Salida de dinero de la caja"
 * en 3 pasos: ① ¿Qué fue? → ② Detalle y monto → ③ Confirmar. Reemplaza la
 * grilla de 9 botones iguales (ver git history de este archivo) por una
 * lista agrupada con ejemplos, un resumen en vivo de dónde se anota y
 * cuánto queda en caja, y compras/retiros separados de los gastos reales.
 *
 * Nota de alcance (prompt-caja-gastos-pos-cobro.md punto 7, última frase):
 * el doc asume que ya existe un permiso/flujo para "anular un movimiento
 * con motivo" — no existe (no hay CashMovementType de reversión, ni
 * capacidad RBAC para ello). No se construyó acá: es una feature nueva, no
 * algo que ya exista para reutilizar. Reportado en el resumen final.
 */

type ExpenseConceptOption = { id: string; name: string };

type ExpenseItemKey = "UTILITIES" | "TAXES" | "TRANSPORT" | "CASUAL_LABOR" | "FOOD" | "SUPPLIES" | "MAINTENANCE" | "OTHER";

type ExpenseItemDef = { key: ExpenseItemKey; emoji: string; examples: string };

/** "Gastos del local" — la categoría real (ExpenseCategory) sale de `key`; la etiqueta en español sale de CATEGORY_LABELS (fuente única). */
const EXPENSE_ITEMS: ExpenseItemDef[] = [
  { key: "UTILITIES", emoji: "💡", examples: "luz, agua, internet" },
  { key: "TAXES", emoji: "🏛️", examples: "Alcaldía, basura, DGI" },
  { key: "TRANSPORT", emoji: "🚌", examples: "pasajes, combustible, taxi" },
  { key: "CASUAL_LABOR", emoji: "📦", examples: "pago a ayudantes por carga/descarga" },
  { key: "FOOD", emoji: "🍱", examples: "desayuno, almuerzo, cena" },
  { key: "SUPPLIES", emoji: "🧹", examples: "bolsas, papel, limpieza" },
  { key: "MAINTENANCE", emoji: "🔧", examples: "reparaciones del local" },
  { key: "OTHER", emoji: "✏️", examples: "cualquier otro gasto — descríbelo" },
];

/** "No es gasto" — no suma al gasto operativo. */
const PURCHASE_ITEM = { emoji: "🧱", label: "Compra de mercadería o flete", examples: "arena, bloques, cemento, viaje de material" };
const CASH_OUT_ITEM = { emoji: "💵", label: "Retiro o envío de dinero", examples: "dinero que se manda a Master o bóveda, antes del cierre" };

type Selection =
  | { kind: "expense"; item: ExpenseItemDef }
  | { kind: "purchase" }
  | { kind: "cashout" };

/** prompt-gastos-semana-quincena.md Fase 4 — por qué sale este dinero (retiro, no gasto). */
const CASH_OUT_REASONS: Array<{ key: string; label: string; reason: string }> = [
  { key: "owner", label: "Retiro del dueño", reason: "Retiro de efectivo (dueño)" },
  { key: "transfer", label: "Cambio a otra caja", reason: "Retiro de efectivo (cambio a otra caja)" },
  { key: "other", label: "Otro", reason: "Retiro de efectivo (otro)" },
];

type CashMovement = {
  id: string;
  type: string;
  amount: string | number;
  reason: string;
  notes: string | null;
  createdAt: string;
  createdBy: { fullName: string; username: string } | null;
  operatingExpense: { category: string; conceptId: string | null; concept: { name: string } | null; receiptNumber: string | null; receiptPhotoUrl: string | null } | null;
  cashPurchase: { kind: string; supplierName: string | null; receiptPhotoUrl: string | null; linkedIntakeId: string | null } | null;
};

const TYPE_LABELS: Record<string, string> = {
  CASH_IN: "Entrada",
  CASH_OUT: "Retiro",
  EXPENSE_OUT: "Gasto",
  BANK_DEPOSIT_OUT: "Depósito banco",
  CHANGE_IN: "Cambio",
  REFUND_OUT: "Devolución",
  CORRECTION: "Corrección",
  PURCHASE_OUT: "Compra",
};

const TYPE_COLOR: Record<string, string> = {
  CASH_IN: "text-[var(--color-success-700)] bg-[var(--color-success-50)] border-[var(--color-success-200)]",
  CHANGE_IN: "text-[var(--color-success-700)] bg-[var(--color-success-50)] border-[var(--color-success-200)]",
  CASH_OUT: "text-[var(--color-danger-700)] bg-[var(--color-danger-50)] border-[var(--color-danger-200)]",
  EXPENSE_OUT: "text-[var(--color-danger-700)] bg-[var(--color-danger-50)] border-[var(--color-danger-200)]",
  BANK_DEPOSIT_OUT: "text-[var(--color-warning-700)] bg-[var(--color-warning-50)] border-[var(--color-warning-200)]",
  REFUND_OUT: "text-[var(--color-warning-700)] bg-[var(--color-warning-50)] border-[var(--color-warning-200)]",
  CORRECTION: "text-[var(--color-text-muted)] bg-[var(--color-surface-alt)] border-[var(--color-border)]",
  PURCHASE_OUT: "text-[var(--color-info-700)] bg-[var(--color-info-50)] border-[var(--color-info-200)]",
};

/** Evento para que "Gastos del Local" (panel hermano) se refresque al registrar un gasto aquí. */
export const GASTOS_LOCAL_REFRESH_EVENT = "hammer:gastos-local-refresh";

function periodLabel(d = new Date()): string {
  const month = d.toLocaleDateString("es-NI", { month: "long" });
  const weekStart = new Date(d);
  weekStart.setDate(d.getDate() - d.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  return `Semana del ${weekStart.getDate()} al ${weekEnd.getDate()} · ${month}`;
}

type DuplicateInfo = { description: string; amount: number; createdAt: string } | null;

export function CashMovementsPanel({
  cashSessionId,
  branchId,
  physicalCashBoxId,
  cashBoxCode,
}: {
  cashSessionId: string;
  branchId: string;
  physicalCashBoxId?: string | null;
  cashBoxCode?: string | null;
}) {
  const sessionState = useSession();
  const session = sessionState.status === "authenticated" ? sessionState.session : null;
  const canMove = Boolean(session && canInBranch(session, branchId, CAPABILITIES.CASH_MOVEMENT_CREATE));
  const canExpense = Boolean(session && canInBranch(session, branchId, CAPABILITIES.OPERATING_EXPENSE_CREATE));
  const canCreate = canMove || canExpense;

  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"pick" | "detail" | "confirm">("pick");

  const [selection, setSelection] = useState<Selection | null>(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [payee, setPayee] = useState("");
  const [conceptId, setConceptId] = useState("");
  const [concepts, setConcepts] = useState<ExpenseConceptOption[]>([]);
  const [cashOutReasonKey, setCashOutReasonKey] = useState<string | null>(null);
  const [supplierName, setSupplierName] = useState("");
  const [purchaseKind, setPurchaseKind] = useState<"GOODS" | "FREIGHT">("GOODS");
  const [materialArrived, setMaterialArrived] = useState(false);

  const [receiptChoice, setReceiptChoice] = useState<"photo" | "none" | null>(null);
  const [receiptPhotoUrl, setReceiptPhotoUrl] = useState<string | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo>(null);
  const [lastWarning, setLastWarning] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [cashOnHand, setCashOnHand] = useState<number | null>(null);
  const [pickFocusIndex, setPickFocusIndex] = useState(0);

  const amt = parseFloat(amount);
  const isExpense = selection?.kind === "expense";
  const isPurchase = selection?.kind === "purchase";
  const isCashOut = selection?.kind === "cashout";

  const pickList = useMemo(
    () => [
      ...EXPENSE_ITEMS.filter(() => canExpense).map((item) => ({ group: "expense" as const, item })),
      ...(canMove ? [{ group: "purchase" as const }, { group: "cashout" as const }] : []),
    ],
    [canExpense, canMove],
  );

  function resetForm() {
    setSelection(null);
    setAmount("");
    setDescription("");
    setPayee("");
    setConceptId("");
    setCashOutReasonKey(null);
    setSupplierName("");
    setPurchaseKind("GOODS");
    setMaterialArrived(false);
    setReceiptChoice(null);
    setReceiptPhotoUrl(null);
    setFormError("");
    setDuplicateInfo(null);
    setStep("pick");
    setPickFocusIndex(0);
  }

  // Al elegir un gasto, trae los conceptos de esa categoría para los chips.
  useEffect(() => {
    if (!selection || selection.kind !== "expense") { setConcepts([]); return; }
    apiFetch(`/api/branch/expense-concepts?branchId=${branchId}&category=${selection.item.key}`)
      .then((r) => r.json())
      .then((raw) => setConcepts((unwrapApiData(raw) as ExpenseConceptOption[]) ?? []))
      .catch(() => setConcepts([]));
  }, [selection, branchId]);

  const loadMovements = useCallback(async () => {
    const response = await apiFetch(`/api/cashier/v2/cash-movements?cashSessionId=${cashSessionId}`);
    if (!response.ok) return;
    const raw = await response.json();
    setMovements((raw?.data ?? raw) as CashMovement[]);
  }, [cashSessionId]);

  const loadCashOnHand = useCallback(async () => {
    if (!physicalCashBoxId) return;
    try {
      const query = new URLSearchParams({ branchId, physicalCashBoxId });
      const response = await apiFetch(`/api/cashier/cash-sessions/active?${query.toString()}`);
      if (!response.ok) return;
      const raw = await response.json();
      const data = unwrapApiData(raw) as { expectedCashAmount?: string | null } | null;
      setCashOnHand(data?.expectedCashAmount != null ? Number(data.expectedCashAmount) : null);
    } catch {
      setCashOnHand(null);
    }
  }, [branchId, physicalCashBoxId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadMovements(), loadCashOnHand()]).finally(() => setLoading(false));
  }, [loadMovements, loadCashOnHand]);

  async function handlePhotoChosen(file: File) {
    setUploadingReceipt(true);
    setFormError("");
    try {
      const blob = await upload(`receipts/${cashSessionId}-${Date.now()}-${file.name}`, file, {
        access: "public",
        handleUploadUrl: "/api/branch/receipt-upload",
        clientPayload: JSON.stringify({ branchId }),
      });
      setReceiptPhotoUrl(blob.url);
    } catch {
      setFormError("No se pudo subir la foto. Intenta de nuevo.");
      setReceiptChoice(null);
    } finally {
      setUploadingReceipt(false);
    }
  }

  function detailIsValid(): string | null {
    if (!amount || isNaN(amt) || amt <= 0) return "Anota el monto (mayor a 0).";
    if (cashOnHand != null && amt > cashOnHand) return `Supera el efectivo en caja (C$ ${cashOnHand.toFixed(2)}).`;
    if (isExpense && selection!.item.key === "OTHER" && description.trim().length < 10) {
      return "Describe qué fue el gasto (mínimo 10 caracteres) — no encaja en ninguna categoría.";
    }
    if (isExpense && description.trim().length < 2) return "¿Para qué fue? — describe el gasto.";
    if (isCashOut && !cashOutReasonKey) return "Elige por qué sale este dinero.";
    if (isPurchase && description.trim().length < 2) return "¿Para qué fue? — describe la compra.";
    if ((isExpense || isPurchase) && receiptChoice === null) return "¿Hay recibo o factura? — elegí Sí o No.";
    if (receiptChoice === "photo" && !receiptPhotoUrl) return uploadingReceipt ? "Esperá a que termine de subir la foto." : "Tomá la foto del recibo (es obligatoria si elegiste Sí).";
    return null;
  }

  function goToConfirm() {
    const error = detailIsValid();
    if (error) { setFormError(error); return; }
    setFormError("");
    setStep("confirm");
  }

  async function register(confirmedNotDuplicate = false) {
    if (!selection) return;
    const error = detailIsValid();
    if (error) { setFormError(error); setStep("detail"); return; }
    setFormError("");
    setSubmitting(true);
    try {
      let response: Response;
      if (selection.kind === "expense") {
        response = await apiFetch("/api/branch/expenses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            branchId,
            category: selection.item.key,
            description: description.trim(),
            amount: amt,
            conceptId: conceptId || undefined,
            payee: payee.trim() || undefined,
            receiptPhotoUrl: receiptPhotoUrl ?? undefined,
            confirmedNotDuplicate,
          }),
        });
      } else if (selection.kind === "purchase") {
        response = await apiFetch("/api/branch/cash-purchases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            branchId,
            amount: amt,
            description: description.trim(),
            supplierName: supplierName.trim() || undefined,
            kind: purchaseKind,
            receiptPhotoUrl: receiptPhotoUrl ?? undefined,
          }),
        });
      } else {
        const cashOutReason = CASH_OUT_REASONS.find((r) => r.key === cashOutReasonKey);
        const reason = description.trim() ? `${cashOutReason?.reason} — ${description.trim()}` : (cashOutReason?.reason ?? "Retiro de efectivo");
        response = await apiFetch("/api/cashier/v2/cash-movements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cashSessionId, type: "CASH_OUT", amount: amt, reason, notes: null }),
        });
      }

      const raw = await response.json();
      if (!response.ok) {
        if (raw?.error?.code === "POSSIBLE_DUPLICATE") {
          setDuplicateInfo(raw.error.details?.duplicate ?? null);
          return;
        }
        setFormError(raw?.error?.message ?? "No se pudo registrar.");
        return;
      }

      const warning = (raw?.data as { warning?: string | null } | undefined)?.warning;
      setLastWarning(typeof warning === "string" && warning ? warning : "");
      if (selection.kind === "expense" && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(GASTOS_LOCAL_REFRESH_EVENT));
      }
      const anotadoEn = selection.kind === "expense" ? `Gastos › ${CATEGORY_LABELS[selection.item.key] ?? selection.item.key}` : selection.kind === "purchase" ? "Compras pagadas con caja (informativo)" : "Retiro de caja";
      setSuccessMessage(`Anotado en ${anotadoEn}. Caja: C$ ${(cashOnHand != null ? cashOnHand - amt : 0).toFixed(2)}`);
      resetForm();
      setOpen(false);
      await Promise.all([loadMovements(), loadCashOnHand()]);
    } catch {
      setFormError("Error de red. Intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  function selectionTitle(sel: Selection): { emoji: string; label: string } {
    if (sel.kind === "expense") return { emoji: sel.item.emoji, label: CATEGORY_LABELS[sel.item.key] ?? sel.item.key };
    if (sel.kind === "purchase") return { emoji: PURCHASE_ITEM.emoji, label: PURCHASE_ITEM.label };
    return { emoji: CASH_OUT_ITEM.emoji, label: CASH_OUT_ITEM.label };
  }

  const projectedCash = cashOnHand != null && !isNaN(amt) ? cashOnHand - amt : null;

  function handlePickKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setPickFocusIndex((i) => Math.min(i + 1, pickList.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setPickFocusIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); pickAt(pickFocusIndex); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  }

  function pickAt(index: number) {
    const entry = pickList[index];
    if (!entry) return;
    setFormError("");
    if (entry.group === "expense") setSelection({ kind: "expense", item: entry.item });
    else if (entry.group === "purchase") setSelection({ kind: "purchase" });
    else setSelection({ kind: "cashout" });
    setStep("detail");
  }

  function handleDetailKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); setStep("pick"); setSelection(null); }
  }

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">Salida de dinero de la caja</h3>
            <p className="text-xs text-[var(--color-text-muted)]">Elegí qué fue y anotá el monto — vas a ver dónde queda anotado antes de confirmar</p>
          </div>
          {canCreate && (
            <button
              type="button"
              className="hidden sm:block shrink-0 rounded-lg bg-[var(--color-master-600)] hover:bg-[var(--color-master-700)] px-3 py-2 text-xs font-semibold text-white transition-colors"
              onClick={() => { resetForm(); setOpen((v) => !v); }}
            >
              {open ? "Cancelar" : "Registrar salida"}
            </button>
          )}
        </div>
        {canCreate && (
          <button
            type="button"
            className="sm:hidden mt-2.5 w-full rounded-lg bg-[var(--color-master-600)] hover:bg-[var(--color-master-700)] px-4 py-2.5 text-sm font-semibold text-white transition-colors"
            onClick={() => { resetForm(); setOpen((v) => !v); }}
          >
            {open ? "Cancelar" : "+ Registrar salida"}
          </button>
        )}
      </div>

      {successMessage && (
        <div className="flex items-start gap-2 border-b border-[var(--color-success-200)] bg-[var(--color-success-50)] px-4 py-2.5">
          <span aria-hidden="true">✅</span>
          <p className="flex-1 text-xs text-[var(--color-success-700)]">{successMessage}</p>
          <button type="button" className="text-xs font-bold text-[var(--color-success-700)]" onClick={() => setSuccessMessage("")} aria-label="Cerrar aviso">✕</button>
        </div>
      )}
      {lastWarning && (
        <div className="flex items-start gap-2 border-b border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-4 py-2.5">
          <span aria-hidden="true">⚠️</span>
          <p className="flex-1 text-xs text-[var(--color-warning-700)]">{lastWarning}</p>
          <button type="button" className="text-xs font-bold text-[var(--color-warning-700)]" onClick={() => setLastWarning("")} aria-label="Cerrar aviso">✕</button>
        </div>
      )}

      {open && canCreate && (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4 space-y-3">
          {/* Pasos visibles */}
          <div className="flex items-center gap-2 text-[0.7rem] font-semibold">
            {(["pick", "detail", "confirm"] as const).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${step === s ? "border-[var(--color-master-600)] bg-[var(--color-master-600)] text-white" : (["pick", "detail", "confirm"].indexOf(step) > i) ? "border-[var(--color-success-400)] bg-[var(--color-success-100)] text-[var(--color-success-700)]" : "border-[var(--color-border)] text-[var(--color-text-soft)]"}`}>
                  {(["pick", "detail", "confirm"].indexOf(step) > i) ? "✓" : i + 1}
                </span>
                <span className={step === s ? "text-[var(--color-text)]" : "text-[var(--color-text-soft)]"}>
                  {s === "pick" ? "¿Qué fue?" : s === "detail" ? "Detalle y monto" : "Confirmar"}
                </span>
                {i < 2 && <span className="text-[var(--color-border-strong)]">→</span>}
              </div>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* Columna 1 — ¿Qué fue? */}
            <div className={`${step === "pick" ? "block" : "hidden"} md:block space-y-2`} onKeyDown={handlePickKeyDown} tabIndex={0}>
              <p className="text-[0.7rem] font-bold uppercase tracking-wide text-[var(--color-text-soft)]">Gastos del local</p>
              {EXPENSE_ITEMS.filter(() => canExpense).map((item) => {
                const idx = pickList.findIndex((e) => e.group === "expense" && e.item.key === item.key);
                const active = selection?.kind === "expense" && selection.item.key === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => pickAt(idx)}
                    className={`flex w-full items-start gap-2.5 rounded-lg border-[1.5px] px-3 py-2 text-left transition-colors ${active ? "border-[var(--color-master-500)] bg-[var(--color-master-50)]" : pickFocusIndex === idx ? "border-[var(--color-info-400)] bg-[var(--color-surface-alt)]" : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-info-400)]"}`}
                  >
                    <span className="text-lg leading-none" aria-hidden="true">{item.emoji}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-[var(--color-text)]">{CATEGORY_LABELS[item.key] ?? item.key}</span>
                      <span className="block text-[0.7rem] text-[var(--color-text-muted)]">{item.examples}</span>
                    </span>
                  </button>
                );
              })}
              {canMove && (
                <>
                  <p className="pt-2 text-[0.7rem] font-bold uppercase tracking-wide text-[var(--color-text-soft)]">No es gasto (no suma al gasto operativo)</p>
                  {(["purchase", "cashout"] as const).map((g) => {
                    const idx = pickList.findIndex((e) => e.group === g);
                    const def = g === "purchase" ? PURCHASE_ITEM : CASH_OUT_ITEM;
                    const active = selection?.kind === g;
                    return (
                      <button
                        key={g}
                        type="button"
                        onClick={() => pickAt(idx)}
                        className={`flex w-full items-start gap-2.5 rounded-lg border-[1.5px] px-3 py-2 text-left transition-colors ${active ? "border-[var(--color-master-500)] bg-[var(--color-master-50)]" : pickFocusIndex === idx ? "border-[var(--color-info-400)] bg-[var(--color-surface-alt)]" : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-info-400)]"}`}
                      >
                        <span className="text-lg leading-none" aria-hidden="true">{def.emoji}</span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-[var(--color-text)]">{def.label}</span>
                          <span className="block text-[0.7rem] text-[var(--color-text-muted)]">{def.examples}</span>
                        </span>
                      </button>
                    );
                  })}
                </>
              )}
            </div>

            {/* Columna 2 — Detalle y monto */}
            <div className={`${step === "detail" || step === "confirm" ? "block" : "hidden"} md:block space-y-3`} onKeyDown={handleDetailKeyDown}>
              {!selection ? (
                <p className="rounded-lg border border-dashed border-[var(--color-border)] px-3 py-6 text-center text-xs text-[var(--color-text-soft)]">Elegí qué fue para continuar →</p>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (step === "detail") goToConfirm();
                    else void register(false);
                  }}
                  className="space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-semibold text-[var(--color-text)]">
                      {selectionTitle(selection).emoji} {selectionTitle(selection).label}
                    </span>
                    <button type="button" className="text-xs font-semibold text-[var(--color-info-600)] hover:underline" onClick={() => { setSelection(null); setStep("pick"); }}>← Cambiar</button>
                  </div>

                  {isExpense && (
                    <p className="text-xs text-[var(--color-text-muted)]">Se anota en <strong>Gastos operativos › {CATEGORY_LABELS[selection.item.key]}</strong></p>
                  )}

                  {isCashOut && !cashOutReasonKey ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        {CASH_OUT_REASONS.map((r) => (
                          <button key={r.key} type="button" onClick={() => setCashOutReasonKey(r.key)} className="rounded-lg border-[1.5px] border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2.5 text-xs font-semibold text-[var(--color-text)] hover:border-[var(--color-info-400)]">
                            {r.label}
                          </button>
                        ))}
                      </div>
                      {canExpense && (
                        <button type="button" className="text-xs font-semibold text-[var(--color-warning-700)] hover:underline" onClick={() => { setSelection(null); setStep("pick"); }}>
                          Esto es un gasto → registrarlo como gasto
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      <label className="grid gap-1 text-xs">
                        <span className="font-medium text-[var(--color-text-secondary)]">Monto (C$) *</span>
                        <input className="hm-input rounded-lg text-xl font-bold" type="number" min="0.01" step="0.01" placeholder="0.00" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} disabled={submitting} />
                      </label>

                      {isExpense && concepts.length > 0 && (
                        <div className="space-y-1">
                          <span className="text-xs font-medium text-[var(--color-text-secondary)]">Concepto</span>
                          <div className="flex flex-wrap gap-1.5">
                            {concepts.map((c) => (
                              <button key={c.id} type="button" onClick={() => setConceptId(conceptId === c.id ? "" : c.id)} className={`rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold ${conceptId === c.id ? "border-[var(--color-master-500)] bg-[var(--color-master-100)] text-[var(--color-master-700)]" : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)]"}`}>
                                {c.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <label className="grid gap-1 text-xs">
                        <span className="font-medium text-[var(--color-text-secondary)]">¿Para qué fue? {!isCashOut && "*"}</span>
                        <input className="hm-input rounded-lg text-sm" type="text" placeholder={isExpense && selection.item.key === "OTHER" ? "Describí qué fue (mínimo 10 caracteres)" : "Ej: " + (isExpense ? selection.item.examples : isPurchase ? PURCHASE_ITEM.examples : "")} maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} disabled={submitting} />
                      </label>

                      {isExpense && (
                        <label className="grid gap-1 text-xs">
                          <span className="font-medium text-[var(--color-text-secondary)]">¿Quién recibió el dinero? (opcional)</span>
                          <input className="hm-input rounded-lg text-sm" type="text" maxLength={160} value={payee} onChange={(e) => setPayee(e.target.value)} disabled={submitting} />
                        </label>
                      )}

                      {isPurchase && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="grid gap-1 text-xs">
                            <span className="font-medium text-[var(--color-text-secondary)]">Proveedor (opcional)</span>
                            <input className="hm-input rounded-lg text-sm" type="text" maxLength={160} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} disabled={submitting} />
                          </label>
                          <label className="grid gap-1 text-xs">
                            <span className="font-medium text-[var(--color-text-secondary)]">Tipo</span>
                            <select className="hm-input rounded-lg text-sm" value={purchaseKind} onChange={(e) => setPurchaseKind(e.target.value as "GOODS" | "FREIGHT")} disabled={submitting}>
                              <option value="GOODS">Mercadería</option>
                              <option value="FREIGHT">Flete</option>
                            </select>
                          </label>
                          <label className="flex items-center gap-2 text-xs sm:col-span-2">
                            <input type="checkbox" checked={materialArrived} onChange={(e) => setMaterialArrived(e.target.checked)} disabled={submitting} />
                            <span className="font-medium text-[var(--color-text-secondary)]">¿Ya llegó el material?</span>
                          </label>
                          {materialArrived && (
                            <p className="text-[0.7rem] text-[var(--color-info-700)] sm:col-span-2">Después de registrar, hacé la Entrada en Inventario para que el stock quede reflejado — esta pantalla solo anota que el dinero salió.</p>
                          )}
                        </div>
                      )}

                      {(isExpense || isPurchase) && (
                        <div className="space-y-1.5">
                          <span className="text-xs font-medium text-[var(--color-text-secondary)]">¿Hay recibo o factura?</span>
                          <div className="flex gap-2">
                            <button type="button" disabled={submitting || uploadingReceipt} onClick={() => { setReceiptChoice("photo"); fileInputRef.current?.click(); }} className={`flex-1 rounded-lg border-[1.5px] px-3 py-2 text-xs font-semibold ${receiptChoice === "photo" ? "border-[var(--color-master-500)] bg-[var(--color-master-50)]" : "border-[var(--color-border)] bg-[var(--color-surface)]"}`}>
                              📷 Sí, tomar foto
                            </button>
                            <button type="button" disabled={submitting} onClick={() => { setReceiptChoice("none"); setReceiptPhotoUrl(null); }} className={`flex-1 rounded-lg border-[1.5px] px-3 py-2 text-xs font-semibold ${receiptChoice === "none" ? "border-[var(--color-master-500)] bg-[var(--color-master-50)]" : "border-[var(--color-border)] bg-[var(--color-surface)]"}`}>
                              No hay recibo
                            </button>
                          </div>
                          <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void handlePhotoChosen(file); }} />
                          {uploadingReceipt && <p className="text-[0.7rem] text-[var(--color-text-muted)]">Subiendo foto…</p>}
                          {receiptChoice === "photo" && receiptPhotoUrl && (
                            <p className="text-[0.7rem] text-[var(--color-success-700)]">✓ Foto del recibo lista.</p>
                          )}
                        </div>
                      )}

                      {formError && <p className="text-xs text-[var(--color-danger-600)]">{formError}</p>}

                      {duplicateInfo && (
                        <div className="rounded-lg border border-[var(--color-warning-300)] bg-[var(--color-warning-50)] p-3 text-xs text-[var(--color-warning-700)] space-y-2">
                          <p>Parecido a uno de hoy: {duplicateInfo.description} (C$ {duplicateInfo.amount.toFixed(2)}). ¿Es otro distinto?</p>
                          <div className="flex gap-2">
                            <button type="button" className="rounded-lg bg-[var(--color-warning-600)] px-3 py-1.5 font-semibold text-white" onClick={() => { setDuplicateInfo(null); void register(true); }}>Sí, es otro distinto</button>
                            <button type="button" className="rounded-lg border border-[var(--color-warning-300)] px-3 py-1.5 font-semibold" onClick={() => setDuplicateInfo(null)}>Revisar</button>
                          </div>
                        </div>
                      )}

                      {step === "detail" ? (
                        <button type="submit" className="block w-full rounded-lg bg-[var(--color-info-600)] px-4 py-2.5 text-sm font-semibold text-white lg:hidden" disabled={submitting}>
                          Siguiente →
                        </button>
                      ) : (
                        <button type="submit" className="block w-full rounded-lg bg-[var(--color-master-600)] px-4 py-2.5 text-sm font-semibold text-white lg:hidden disabled:opacity-50" disabled={submitting || uploadingReceipt}>
                          {submitting ? "Registrando…" : `Registrar salida de C$ ${isNaN(amt) ? "0.00" : amt.toFixed(2)}`}
                        </button>
                      )}
                    </>
                  )}
                </form>
              )}
            </div>

            {/* Columna 3 — Así queda anotado */}
            <div className={`${step !== "pick" ? "block" : "hidden"} md:block md:col-span-2 lg:col-span-1 space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3`}>
              <p className="text-[0.7rem] font-bold uppercase tracking-wide text-[var(--color-text-soft)]">Así queda anotado</p>
              {!selection ? (
                <p className="text-xs text-[var(--color-text-soft)]">Elegí qué fue para ver el resumen.</p>
              ) : (
                <div className="space-y-1.5 text-xs text-[var(--color-text)]">
                  <p className="text-lg font-bold text-[var(--color-danger-600)]">− C$ {isNaN(amt) ? "0.00" : amt.toFixed(2)}</p>
                  <p className="text-[var(--color-text-muted)]">sale de la caja {cashBoxCode ?? ""}</p>
                  <p><strong>A dónde va:</strong> {isExpense ? `Gastos › ${CATEGORY_LABELS[selection.item.key]}${conceptId ? ` › ${concepts.find((c) => c.id === conceptId)?.name ?? ""}` : ""}` : isPurchase ? "Compra de mercadería/flete (informativo, no gasto)" : "Retiro de caja (no gasto)"}</p>
                  {description && <p><strong>Para qué:</strong> {description}</p>}
                  {payee && <p><strong>Quién recibió:</strong> {payee}</p>}
                  {supplierName && <p><strong>Proveedor:</strong> {supplierName}</p>}
                  {(isExpense || isPurchase) && (
                    <p><strong>Recibo:</strong> {receiptChoice === "photo" ? (receiptPhotoUrl ? "Foto adjunta ✓" : "Subiendo…") : receiptChoice === "none" ? "Sin recibo" : "—"}</p>
                  )}
                  <p className="text-[var(--color-text-soft)]">{periodLabel()}</p>
                  <div className="mt-2 rounded-lg bg-[var(--color-surface-alt)] p-2">
                    <p className="font-semibold">
                      Caja queda en {projectedCash != null ? `C$ ${projectedCash.toFixed(2)}` : "—"}
                    </p>
                    {projectedCash != null && projectedCash < 0 && (
                      <p className="mt-1 text-[var(--color-danger-600)]">⚠ Supera el efectivo disponible — no se puede confirmar.</p>
                    )}
                  </div>

                  {step === "confirm" && (
                    <button
                      type="button"
                      className="mt-2 hidden w-full rounded-lg bg-[var(--color-master-600)] px-4 py-2.5 text-sm font-semibold text-white lg:block disabled:opacity-50"
                      disabled={submitting || uploadingReceipt}
                      onClick={() => void register(false)}
                    >
                      {submitting ? "Registrando…" : `Registrar salida de C$ ${isNaN(amt) ? "0.00" : amt.toFixed(2)}`}
                    </button>
                  )}
                  {step === "detail" && (
                    <button type="button" className="mt-2 hidden w-full rounded-lg bg-[var(--color-info-600)] px-4 py-2.5 text-sm font-semibold text-white lg:block" onClick={goToConfirm} disabled={submitting}>
                      Siguiente →
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Navegación móvil/tablet — ≥lg ya muestra todo junto */}
          {selection && (
            <div className="flex items-center justify-between gap-2 lg:hidden">
              <button
                type="button"
                className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-xs font-semibold"
                onClick={() => { if (step === "confirm") setStep("detail"); else { setSelection(null); setStep("pick"); } }}
              >
                ← Atrás
              </button>
              <span className="text-[0.65rem] text-[var(--color-text-soft)]">Esc también vuelve</span>
            </div>
          )}
        </div>
      )}

      <div className="divide-y divide-[var(--color-border)]">
        {loading ? (
          <p className="px-4 py-3 text-xs text-[var(--color-text-muted)] animate-pulse">Cargando movimientos...</p>
        ) : movements.length === 0 ? (
          <p className="px-4 py-4 text-center text-xs text-[var(--color-text-muted)]">Sin movimientos registrados en esta sesión.</p>
        ) : (
          movements.map((m) => {
            const hasReceipt = Boolean(m.operatingExpense?.receiptNumber || m.operatingExpense?.receiptPhotoUrl || m.cashPurchase?.receiptPhotoUrl);
            const categoryLine = m.operatingExpense
              ? `${CATEGORY_LABELS[m.operatingExpense.category] ?? m.operatingExpense.category}${m.operatingExpense.concept ? ` › ${m.operatingExpense.concept.name}` : ""}`
              : m.cashPurchase
                ? `Compra (${m.cashPurchase.kind === "FREIGHT" ? "Flete" : "Mercadería"})`
                : null;
            return (
              <div key={m.id} className="flex items-start gap-3 px-4 py-3">
                <span className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold ${TYPE_COLOR[m.type] ?? TYPE_COLOR.CORRECTION}`}>
                  {TYPE_LABELS[m.type] ?? m.type}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-[var(--color-text)]" title={m.reason}>{categoryLine ?? m.reason}</span>
                    <span className="shrink-0 text-sm font-bold text-[var(--color-text)]">C$ {Number(m.amount).toFixed(2)}</span>
                  </div>
                  {categoryLine && <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">{m.reason}</p>}
                  {m.notes && <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">{m.notes}</p>}
                  <p className="mt-0.5 text-[0.65rem] text-[var(--color-text-soft)]">
                    {m.createdBy?.fullName ?? m.createdBy?.username ?? "Sistema"} ·{" "}
                    {new Date(m.createdAt).toLocaleString("es-NI", { hour12: true, hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}
                    {(m.operatingExpense || m.cashPurchase) && (hasReceipt ? " · ✓ con recibo" : " · sin recibo")}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
