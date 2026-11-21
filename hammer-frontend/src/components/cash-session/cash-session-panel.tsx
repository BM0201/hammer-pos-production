"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { fmtDateTime, fmtTimeShort, money, usdMoney } from "@/lib/format";
import { useOperationalPolling } from "@/lib/realtime/use-operational-polling";
import { CashMovementsPanel } from "./cash-movements-panel";
import { CashDestinationDeclarationModal } from "./cash-destination-declaration-modal";
import { GastosLocalesPanel } from "./gastos-locales-panel";
import { CashCount, countDifference, type CashCountResult } from "./cash-count";
import { usePosCashContext } from "@/components/pos/hooks/use-pos-cash-context";
import { closeReminderPhase } from "@/components/pos/components/cash-close-reminder";

type CashBox = {
  id: string;
  code: string;
  description: string | null;
};

type ActiveSession = {
  id: string;
  status: "OPEN" | "RECONCILING";
  openingAmount: string;
  openedAt: string;
  openedBy?: { username: string; fullName: string };
  /** Desde 20 min antes del cierre y mientras se cuenta: la API no manda el esperado (conteo a ciegas). */
  blindCount?: boolean;
  /** Tipo de cambio de Tesorería, solo mientras se cuenta: para "US$ X equivale a C$ Y". */
  usdToNioRate?: number | null;
};

type CloseResult = { counted: number; expected: number; difference: number; sales: number; cashFund: number; opening: number | null; usd: number; expectedUsd: number };
type LastCashFund = { amount: number; note: string | null; declaredAt: string; setByMaster?: boolean };
type Declaration = { cashSessionId: string; countedAmount: number; cashFund?: { amount: number; note: string } | null };

type AutoClosedSession = {
  id: string;
  autoClosedAt?: string | null;
  expectedCashAmount?: string | null;
  physicalCashBox?: CashBox;
};

export type CashSessionState = {
  hasOpenSession: boolean;
  cashSessionId: string | null;
  physicalCashBoxId: string | null;
  status: "OPEN" | "RECONCILING" | "CLOSED" | "AUTO_CLOSED_PENDING_REVIEW" | null;
};

const SESSION_REASON_MESSAGES: Record<string, string> = {
  FORBIDDEN: "No tienes permiso para esta operación.",
  FORBIDDEN_ROLE: "Tu rol no tiene permiso para abrir caja. Contacta al administrador.",
  FORBIDDEN_BRANCH: "No tienes acceso a esta sucursal.",
  CASH_SESSION_ALREADY_OPEN: "Ya existe una sesión abierta para esta caja.",
  CASH_SESSION_CASH_BOX_INVALID: "La caja física no existe o no pertenece a la sucursal.",
  CASH_BOX_INACTIVE: "La caja física está inactiva. Un administrador debe activarla antes de abrir sesión.",
  CASH_BOX_BRANCH_MISMATCH: "La caja no pertenece a esta sucursal.",
  CASH_SESSION_NOT_OPEN: "La sesión ya no está abierta.",
  CASH_SESSION_AUTO_CLOSED_PENDING_REVIEW: "La caja fue cerrada automáticamente por horario y requiere revisión. Abre una nueva caja para continuar.",
  STALE_CASH_SESSION_PENDING_REVIEW: "Existe una caja pendiente de revisión de una fecha anterior. Master debe resolverla antes de continuar.",
  STALE_CASH_SESSION_RECONCILING: "Existe una caja en conciliación de una fecha anterior. Master debe resolverla antes de continuar.",
  CASH_SESSION_RECONCILING: "La sesión de caja está en proceso de conciliación. Espera a que se complete antes de abrir una nueva sesión.",
  CASH_SESSION_AFTER_CLOSING_TIME: "La hora de cierre operativo ya pasó. No se puede abrir una nueva sesión de caja hasta mañana.",
  OPERATIONAL_DAY_NOT_OPEN: "No hay día operativo abierto para esta sucursal. Un administrador debe abrirlo antes de abrir caja.",
  OPERATIONAL_DAY_ALREADY_CLOSED: "El día operativo de hoy ya fue cerrado. No se puede abrir caja hasta que un administrador inicie un nuevo día operativo.",
  OPERATIONAL_DAY_STALE: "El día operativo abierto pertenece a una fecha anterior y debe cerrarse antes de continuar. Contacta al administrador.",
  STALE_OPERATIONAL_DAY_OPEN: "Hay un día operativo anterior que sigue abierto. Un administrador Master debe ejecutar limpieza operativa antes de continuar.",
  OPERATIONAL_DAY_REOPEN_REQUIRED: "El día operativo fue cerrado. Un administrador Master debe reabrirlo para continuar operaciones.",
  NO_ACTIVE_CASH_BOX_FOR_BRANCH: "La sucursal no tiene caja física activa configurada. Contacta al administrador.",
  CASH_SESSION_UNRESOLVED_ORDERS: "No puedes cerrar caja con órdenes pendientes de pago o despacho.",
  STALE_PENDING_PAYMENT_ORDERS: "Hay órdenes con pago pendiente de este día que deben resolverse antes de cerrar la caja.",
  CASH_SESSION_NOT_RECONCILING: "La sesión debe estar en conciliación antes de cerrarla.",
  CASH_SESSION_NOT_PENDING_AUTO_REVIEW: "La sesión ya no está pendiente de revisión automática.",
  APPROVAL_REQUESTED: "La sesión fue cerrada con diferencia registrada para revisión en Día Operativo 360.",
};

/**
 * Extracts { message, code } from either the canonical API format
 * { ok: false, error: { code, message } } or a legacy { message, reason } shape.
 */
function extractApiError(json: unknown): { message: string; code: string } {
  if (typeof json === "object" && json !== null) {
    const j = json as Record<string, unknown>;
    if (j.error && typeof j.error === "object") {
      const err = j.error as Record<string, unknown>;
      return { message: String(err.message ?? ""), code: String(err.code ?? "") };
    }
    return { message: String(j.message ?? ""), code: String(j.reason ?? "") };
  }
  return { message: "", code: "" };
}

function mapSessionMessage(message?: string, reason?: string): string {
  if (reason && SESSION_REASON_MESSAGES[reason]) return SESSION_REASON_MESSAGES[reason];
  if (message && SESSION_REASON_MESSAGES[message]) return SESSION_REASON_MESSAGES[message];
  return message || "No se pudo completar la operación de caja.";
}

type Notice = { tone: "info" | "success" | "error"; text: string };

const NOTICE_STYLE: Record<Notice["tone"], string> = {
  info: "border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-secondary)]",
  success: "border-[var(--color-success-200)] bg-[var(--color-success-50)] text-[var(--color-success-700)]",
  error: "border-[var(--color-danger-200)] bg-[var(--color-danger-50)] text-[var(--color-danger-700)]",
};

function NoticeLine({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  const Icon = notice.tone === "success" ? CheckCircle2 : notice.tone === "error" ? AlertTriangle : Info;
  return (
    <p role="status" className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${NOTICE_STYLE[notice.tone]}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{notice.text}</span>
    </p>
  );
}

const STATUS_PILL = {
  OPEN: { label: "Abierta", cls: "bg-[var(--color-success-50)] text-[var(--color-success-700)] border-[var(--color-success-200)]", dot: "bg-[var(--color-success-500)]" },
  RECONCILING: { label: "Contando", cls: "bg-[var(--color-warning-50)] text-[var(--color-warning-700)] border-[var(--color-warning-200)]", dot: "bg-[var(--color-warning-500)]" },
  CLOSED: { label: "Cerrada", cls: "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] border-[var(--color-border)]", dot: "bg-[var(--color-text-soft)]" },
} as const;

/**
 * Pantalla Caja: la hoja de la gaveta del turno. Arriba lo que debe haber
 * (y de dónde sale), la acción del momento (abrir, cerrar turno, contar) y su
 * aviso al lado; abajo las salidas de dinero y los gastos de hoy. Se refresca
 * cada 30 s, así un cobro hecho en otra pantalla se ve sin recargar.
 */
export function CashSessionPanel({ branchId }: { branchId: string }) {
  const [cashBoxes, setCashBoxes] = useState<CashBox[]>([]);
  const [boxesLoaded, setBoxesLoaded] = useState(false);
  const [selectedCashBoxId, setSelectedCashBoxId] = useState("");
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [pendingAutoClosed, setPendingAutoClosed] = useState<AutoClosedSession[]>([]);
  const [openingAmount, setOpeningAmount] = useState("0");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyAction, setBusyAction] = useState<"open" | "requestClose" | "close" | "review" | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Pedir el cierre no tiene marcha atrás: el primer toque solo pregunta.
  const [confirmingClose, setConfirmingClose] = useState(false);
  // Hora del cierre automático de hoy (la trae el contexto de la caja) y la hora del último refresco.
  const posContext = usePosCashContext(branchId).posContext;
  const closeAt = posContext?.cashAutoCloseAt ?? null;
  const countFrom = posContext?.cashCountFrom ?? null;
  const [now, setNow] = useState(() => Date.now());
  // Desde el aviso previo al cierre ("Contar ahora") se llega con ?cerrar=1: abre la confirmación una vez.
  const [wantsClose, setWantsClose] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("cerrar") !== "1") return;
    setWantsClose(true);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  // Se abre justo después de cerrar y no se puede saltar; si se recarga, vuelve (GET after-close).
  const [declaration, setDeclaration] = useState<Declaration | null>(null);
  // Sencillo contado en el último cierre: con eso se abre la caja.
  const [lastCashFund, setLastCashFund] = useState<LastCashFund | null>(null);
  // Tras cerrar: lo contado contra lo que debía haber. Recién aquí se ve la diferencia.
  const [closeResult, setCloseResult] = useState<CloseResult | null>(null);

  const selectedCashBox = cashBoxes.find((box) => box.id === selectedCashBoxId) ?? null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await apiFetch(`/api/cashier/cash-boxes?branchId=${encodeURIComponent(branchId)}`);
      const json = (await response.json()) as unknown;
      if (cancelled) return;
      if (!response.ok) {
        const { message, code } = extractApiError(json);
        setLoadError(code === "FORBIDDEN" || code === "FORBIDDEN_ROLE"
          ? "Tu perfil no tiene asignadas cajas físicas. Contacta al administrador."
          : mapSessionMessage(message, code));
        return;
      }
      const boxes = (unwrapApiData(json) as CashBox[] | null) ?? [];
      setCashBoxes(boxes);
      setLoadError(boxes.length === 0 ? "No hay cajas físicas activas en esta sucursal." : null);
      setSelectedCashBoxId((current) => current || boxes[0]?.id || "");
    })()
      .catch(() => { if (!cancelled) setLoadError("No se pudo cargar la lista de cajas."); })
      .finally(() => { if (!cancelled) setBoxesLoaded(true); });
    return () => { cancelled = true; };
  }, [branchId]);

  const refresh = useCallback(async () => {
    if (!selectedCashBoxId) return;
    const query = new URLSearchParams({ branchId, physicalCashBoxId: selectedCashBoxId });
    const [activeRes, pendingRes] = await Promise.all([
      apiFetch(`/api/cashier/cash-sessions/active?${query}`),
      apiFetch(`/api/branch/cash/sessions/auto-closed-pending?${query}`),
    ]);
    const activeJson = (await activeRes.json()) as unknown;
    if (!activeRes.ok) {
      const { message, code } = extractApiError(activeJson);
      setNotice({ tone: "error", text: mapSessionMessage(message, code) });
    } else {
      const active = (unwrapApiData(activeJson) as ActiveSession | null) ?? null;
      setSession(active);
      setSessionLoaded(true);
      setNow(Date.now());
      // Caja cerrada: destino pendiente de hoy (se recargó a mitad) y el sencillo para abrir.
      if (!active) {
        const res = await apiFetch(`/api/cashier/cash-sessions/after-close?branchId=${branchId}`).catch(() => null);
        const afterClose = res?.ok
          ? (unwrapApiData(await res.json()) as { pendingDeclaration: Declaration | null; lastCashFund: LastCashFund | null } | null)
          : null;
        const pending = afterClose?.pendingDeclaration;
        if (pending) setDeclaration((current) => current ?? pending);
        const fund = afterClose?.lastCashFund ?? null;
        setLastCashFund(fund);
        // Propone abrir con el sencillo de ayer, sin pisar lo que la persona ya escribió.
        if (fund && fund.amount > 0) setOpeningAmount((current) => (current === "0" || current === "" ? fund.amount.toFixed(2) : current));
      }
    }
    if (pendingRes.ok) setPendingAutoClosed((unwrapApiData(await pendingRes.json()) as AutoClosedSession[] | null) ?? []);
  }, [branchId, selectedCashBoxId]);

  useOperationalPolling({
    task: refresh,
    intervalMs: 30_000,
    enabled: Boolean(selectedCashBoxId),
    deps: [refresh],
    onError: () => undefined,
  });

  async function post(url: string, body: unknown): Promise<{ ok: true; json: unknown } | { ok: false; text: string }> {
    try {
      const response = await apiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await response.json()) as unknown;
      if (!response.ok) {
        const { message, code } = extractApiError(json);
        return { ok: false, text: mapSessionMessage(message, code) };
      }
      return { ok: true, json };
    } catch (error) {
      return { ok: false, text: error instanceof TypeError ? "Error de red. Verifica tu conexión." : "No se pudo completar la operación de caja." };
    }
  }

  async function openSession() {
    if (!selectedCashBoxId || busyAction) return;
    setBusyAction("open");
    setNotice(null);
    const result = await post("/api/cashier/cash-sessions/open", { branchId, physicalCashBoxId: selectedCashBoxId, openingAmount: Number(openingAmount) || 0 });
    if (result.ok) {
      setCloseResult(null);
      setNotice({ tone: "success", text: "Caja abierta. Ya puedes cobrar." });
      await refresh().catch(() => undefined);
    } else {
      setNotice({ tone: "error", text: result.text });
    }
    setBusyAction(null);
  }

  async function requestClose() {
    if (session?.status !== "OPEN" || busyAction) return;
    setBusyAction("requestClose");
    setNotice(null);
    const result = await post("/api/cashier/cash-sessions/close-request", { cashSessionId: session.id });
    setConfirmingClose(false);
    if (result.ok) await refresh().catch(() => undefined);
    else setNotice({ tone: "error", text: result.text });
    setBusyAction(null);
  }

  async function closeSession(count: CashCountResult) {
    const counted = count.total;
    if (session?.status !== "RECONCILING" || busyAction) return;
    setBusyAction("close");
    setNotice(null);
    const sessionId = session.id;
    const result = await post("/api/cashier/cash-sessions/close", { cashSessionId: sessionId, closingAmount: counted, countedUsdAmount: count.usd > 0 ? count.usd : null });
    if (!result.ok) {
      setNotice({ tone: "error", text: result.text });
      setBusyAction(null);
      return;
    }
    const data = unwrapApiData(result.json) as { status?: string; expectedCash?: number; expectedUsd?: number; openingAmount?: number | string } | null;
    if (data?.status === "AUTO_CLOSED_PENDING_REVIEW") {
      setNotice({ tone: "info", text: "La caja quedó pendiente de revisión por Master." });
    } else {
      setDeclaration({ cashSessionId: sessionId, countedAmount: counted, cashFund: { amount: count.cashFund, note: count.cashFundNote } });
      const expectedCash = Number(data?.expectedCash ?? counted);
      const opening = data?.openingAmount != null ? Number(data.openingAmount) : null;
      setCloseResult({ counted, expected: expectedCash, difference: countDifference(counted, expectedCash), sales: count.sales, cashFund: count.cashFund, opening, usd: count.usd, expectedUsd: Number(data?.expectedUsd ?? 0) });
      setOpeningAmount(count.cashFund > 0 ? count.cashFund.toFixed(2) : "0");
    }
    await refresh().catch(() => undefined);
    setBusyAction(null);
  }

  async function reviewAutoClosed(sessionId: string, countedCashAmount: number, note: string) {
    if (busyAction) return false;
    setBusyAction("review");
    setNotice(null);
    const result = await post(`/api/branch/cash/sessions/${sessionId}/review-auto-close`, { countedCashAmount, note });
    setNotice(result.ok ? { tone: "success", text: "Revisión registrada. La sesión quedó cerrada." } : { tone: "error", text: result.text });
    if (result.ok) await refresh().catch(() => undefined);
    setBusyAction(null);
    return result.ok;
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] p-5" data-testid="cash-session-panel">
        <p className="text-sm text-[var(--color-warning-700)]">{loadError}</p>
      </div>
    );
  }
  if (!boxesLoaded || (selectedCashBoxId && !sessionLoaded)) {
    return <p className="animate-pulse text-sm text-[var(--color-text-muted)]">Cargando la caja…</p>;
  }

  const status = session?.status ?? "CLOSED";
  const pill = STATUS_PILL[status];
  const closePhase = closeAt && countFrom ? closeReminderPhase(now, Date.parse(countFrom), Date.parse(closeAt)) : "none";
  if (wantsClose && status === "OPEN") {
    setWantsClose(false);
    setConfirmingClose(true);
  }
  const boxName = selectedCashBox ? (selectedCashBox.description || selectedCashBox.code) : "Caja";

  return (
    <div className="space-y-4" data-testid="cash-session-panel">
      {pendingAutoClosed.length > 0 && (
        <AutoCloseReview sessions={pendingAutoClosed} busy={busyAction === "review"} onSubmit={reviewAutoClosed} />
      )}

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {cashBoxes.length > 1 ? (
            <select
              className="hm-input max-w-xs rounded-xl"
              value={selectedCashBoxId}
              onChange={(event) => { setSelectedCashBoxId(event.target.value); setSessionLoaded(false); setNotice(null); setConfirmingClose(false); }}
              disabled={Boolean(busyAction)}
              aria-label="Caja física"
            >
              {cashBoxes.map((box) => (
                <option key={box.id} value={box.id}>{box.description || box.code} · {box.code}</option>
              ))}
            </select>
          ) : (
            <p className="text-sm font-semibold text-[var(--color-text)]">
              {boxName}
              {selectedCashBox?.description ? <span className="ml-1.5 font-normal text-[var(--color-text-muted)]">· {selectedCashBox.code}</span> : null}
            </p>
          )}
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${pill.cls}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} aria-hidden />
            {pill.label}
          </span>
        </div>

        {status === "OPEN" && session ? (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_18rem] md:items-end">
            <div className="min-w-0 space-y-2">
              <p className="text-sm text-[var(--color-text-muted)]">Debe haber en la gaveta</p>
              {/* Conteo a ciegas: la API nunca manda cuánto debe haber; se ve al cerrar el turno. */}
              <p className="text-lg font-semibold text-[var(--color-text)]" data-testid="cash-expected-hidden">
                No disponible hasta el conteo del cierre
              </p>
              <p className="text-sm text-[var(--color-text-secondary)]">
                Abrió con <strong className="tabular-nums">{money(Number(session.openingAmount))}</strong> de sencillo
              </p>
              {closePhase !== "none" && closeAt ? (
                <p className="rounded-xl border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-3 py-2 text-sm font-medium text-[var(--color-warning-700)]" data-testid="cash-close-soon">
                  {closePhase === "soon"
                    ? `Antes de las ${fmtTimeShort(closeAt)}, cuando la caja se cierra sola: cuenta la gaveta billete por billete y luego decide el destino del dinero.`
                    : `Pasó la hora de cierre (${fmtTimeShort(closeAt)}). Cuenta la gaveta y cierra antes de que el sistema la cierre sin destino.`}
                </p>
              ) : null}
              <p className="text-xs text-[var(--color-text-muted)]">
                Abierta {session.openedBy ? `por ${session.openedBy.fullName || session.openedBy.username} ` : ""}desde las {fmtTimeShort(session.openedAt)}
              </p>
            </div>
            {confirmingClose ? (
              <div className="space-y-2.5 rounded-xl border border-[var(--color-warning-300)] bg-[var(--color-warning-50)] p-3">
                <p className="text-sm font-medium text-[var(--color-warning-700)]">
                  Vas a contar la gaveta. Mientras cuentas no se puede cobrar en esta caja, y no se puede volver atrás.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="flex-1 rounded-xl bg-[var(--btn-danger-bg,var(--color-danger-600))] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--btn-danger-hover,var(--color-danger-700))] disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void requestClose()}
                    disabled={Boolean(busyAction)}
                    data-testid="cash-session-request-close-confirm"
                  >
                    {busyAction === "requestClose" ? "Procesando…" : "Sí, a contar"}
                  </button>
                  <button
                    type="button"
                    className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-alt)] disabled:opacity-50"
                    onClick={() => setConfirmingClose(false)}
                    disabled={Boolean(busyAction)}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="w-full rounded-xl border border-[var(--color-warning-300)] bg-[var(--color-warning-50)] px-5 py-3 text-sm font-semibold text-[var(--color-warning-700)] transition-colors hover:bg-[var(--color-warning-100)] disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => { setNotice(null); setConfirmingClose(true); }}
                disabled={Boolean(busyAction)}
                data-testid="cash-session-request-close"
              >
                Cerrar turno y contar
              </button>
            )}
          </div>
        ) : status === "RECONCILING" && session ? (
          <div className="space-y-3">
            <div>
              <p className="text-base font-semibold text-[var(--color-text)]">Cuenta el efectivo de la gaveta</p>
              <p className="text-sm text-[var(--color-text-muted)]">Anota cuántos billetes y monedas hay de cada uno. La caja no cobra hasta que confirmes.</p>
            </div>
            <CashCount key={session.id} busy={busyAction === "close"} usdRate={session.usdToNioRate ?? null} onConfirm={(count) => void closeSession(count)} />
          </div>
        ) : (
          <div className="space-y-4">
          {closeResult ? <CloseResultCard result={closeResult} /> : null}
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="block">
              <span className="mb-1 block text-sm text-[var(--color-text-muted)]">
                {lastCashFund && Number(openingAmount) === lastCashFund.amount
                  ? lastCashFund.setByMaster
                    ? "La caja está cerrada. Abre con el sencillo que fijó Master:"
                    : "La caja está cerrada. Abre con el sencillo que quedó en el último cierre:"
                  : "La caja está cerrada. ¿Con cuánto sencillo empieza la gaveta?"}
              </span>
              <input
                className="hm-input rounded-xl text-lg font-semibold tabular-nums"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={openingAmount}
                onChange={(event) => setOpeningAmount(event.target.value)}
                disabled={Boolean(busyAction) || pendingAutoClosed.length > 0}
                aria-label="Monto de apertura (C$)"
              />
              {lastCashFund?.note && Number(openingAmount) === lastCashFund.amount ? (
                <span className="mt-1 block text-xs text-[var(--color-text-soft)]" data-testid="cash-open-fund-note">
                  {lastCashFund.note.replace(/^Sencillo:\s*/, "")}. Si no coincide al contarlo, anota lo que hay.
                </span>
              ) : null}
            </label>
            <button
              type="button"
              className="w-full rounded-xl bg-[var(--btn-success-bg,var(--color-success-600))] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--btn-success-hover,var(--color-success-700))] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              onClick={() => void openSession()}
              disabled={!selectedCashBoxId || Boolean(busyAction) || pendingAutoClosed.length > 0}
              data-testid="cash-session-open"
            >
              {busyAction === "open" ? "Abriendo…" : "Abrir caja"}
            </button>
          </div>
          </div>
        )}

        <NoticeLine notice={notice} />
      </Card>

      {status === "OPEN" && session ? (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <CashMovementsPanel
            cashSessionId={session.id}
            branchId={branchId}
            onRegistered={() => void refresh().catch(() => undefined)}
          />
          <GastosLocalesPanel branchId={branchId} />
        </div>
      ) : (
        <GastosLocalesPanel branchId={branchId} />
      )}

      {declaration && (
        <CashDestinationDeclarationModal
          cashSessionId={declaration.cashSessionId}
          branchId={branchId}
          countedAmount={declaration.countedAmount}
          cashFund={declaration.cashFund}
          onSaved={() => { setDeclaration(null); void refresh().catch(() => undefined); }}
        />
      )}
    </div>
  );
}

/** Lo contado contra lo que debía haber: se ve recién después de cerrar. */
function CloseResultCard({ result }: { result: CloseResult }) {
  const { counted, expected, difference, sales, cashFund, opening, usd, expectedUsd } = result;
  const usdDifference = countDifference(usd, expectedUsd);
  const tone = difference === 0 ? "text-[var(--color-success-700)]" : "text-[var(--color-danger-700)]";
  return (
    <div className="space-y-2" data-testid="cash-close-result">
      <p className="text-sm font-semibold text-[var(--color-text)]">Caja cerrada</p>
      <dl className="grid grid-cols-3 gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-center">
        <div>
          <dt className="text-xs text-[var(--color-text-muted)]">Contaste</dt>
          <dd className="text-sm font-semibold tabular-nums text-[var(--color-text)]">{money(counted)}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--color-text-muted)]">Debía haber</dt>
          <dd className="text-sm font-semibold tabular-nums text-[var(--color-text)]">{money(expected)}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--color-text-muted)]">Diferencia</dt>
          <dd className={`text-sm font-bold tabular-nums ${tone}`}>
            {difference === 0 ? "Cuadró" : `${difference > 0 ? "Sobran" : "Faltan"} ${money(Math.abs(difference))}`}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-[var(--color-text-muted)]" data-testid="cash-close-split">
        Venta {money(sales)} + sencillo {money(cashFund)}
        {opening !== null ? `. El sencillo abrió con ${money(opening)}${cashFund !== opening ? ` y cierra con ${money(cashFund)} (${cashFund > opening ? "+" : "−"}${money(Math.abs(countDifference(cashFund, opening)))})` : " y cierra igual"}` : ""}.
        {usd > 0 && expectedUsd === 0 ? ` Dólares aparte: ${usdMoney(usd)}.` : ""}
      </p>
      {expectedUsd > 0 ? (
        <p className="text-xs text-[var(--color-text-secondary)]" data-testid="cash-close-usd">
          Dólares: contaste <b className="tabular-nums">{usdMoney(usd)}</b>, debía haber <b className="tabular-nums">{usdMoney(expectedUsd)}</b> ·{" "}
          <b className={usdDifference === 0 ? "text-[var(--color-success-700)]" : "text-[var(--color-danger-700)]"}>
            {usdDifference === 0 ? "Cuadró" : `${usdDifference > 0 ? "Sobran" : "Faltan"} ${usdMoney(Math.abs(usdDifference))}`}
          </b>
        </p>
      ) : null}
      {difference !== 0 || usdDifference !== 0 ? (
        <p className="text-xs text-[var(--color-text-muted)]">La diferencia quedó registrada; Master la revisa en Día Operativo 360.</p>
      ) : null}
    </div>
  );
}

/** Cierre automático por horario: se cuenta lo que quedó y se deja nota. */
function AutoCloseReview({
  sessions,
  busy,
  onSubmit,
}: {
  sessions: AutoClosedSession[];
  busy: boolean;
  onSubmit: (sessionId: string, countedCashAmount: number, note: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState(sessions[0]?.id ?? "");
  const current = sessions.find((s) => s.id === sessionId) ?? sessions[0];
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  return (
    <div className="space-y-3 rounded-xl border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] p-5" data-testid="cash-session-pending-review">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning-700)]" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-[var(--color-warning-700)]">
              {sessions.length === 1 ? "Una caja se cerró sola por horario" : `${sessions.length} cajas se cerraron solas por horario`}
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">Cuenta lo que quedó y deja una nota. Hasta entonces no se puede abrir otra.</p>
          </div>
        </div>
        <button
          type="button"
          className="rounded-xl border border-[var(--color-warning-300)] bg-[var(--color-surface)] px-3 py-2 text-sm font-semibold text-[var(--color-warning-700)] transition-colors hover:bg-[var(--color-warning-100)]"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid="cash-session-toggle-review"
        >
          {open ? "Ocultar" : "Revisar ahora"}
        </button>
      </div>

      {open && current ? (
        <div className="space-y-3 border-t border-[var(--color-warning-200)] pt-3">
          {sessions.length > 1 ? (
            <select
              className="hm-input rounded-xl"
              value={current.id}
              onChange={(event) => {
                setSessionId(event.target.value);
                setAmount("");
              }}
              disabled={busy}
              aria-label="Sesión a revisar"
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.physicalCashBox?.code ?? "Caja"} · {s.autoClosedAt ? fmtDateTime(s.autoClosedAt) : "cierre automático"}
                </option>
              ))}
            </select>
          ) : null}
          <label className="grid max-w-xs gap-1">
            <span className="text-xs font-semibold text-[var(--color-text-muted)]">Contado (lo que hay en la gaveta)</span>
            <input className="hm-input rounded-xl" type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-semibold text-[var(--color-text-muted)]">Nota de revisión</span>
            <textarea
              className="hm-input min-h-20 rounded-xl px-3 py-2"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Cómo se contó y quién estaba."
              disabled={busy}
            />
          </label>
          <div className="flex justify-end">
            <button
              type="button"
              className="rounded-xl bg-[var(--btn-primary-bg,var(--color-info-700))] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--btn-primary-hover,var(--color-info-600))] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={async () => {
                if (await onSubmit(current.id, Number(amount) || 0, note.trim())) setNote("");
              }}
              disabled={!note.trim() || amount.trim() === "" || busy}
            >
              {busy ? "Registrando…" : "Registrar revisión"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
