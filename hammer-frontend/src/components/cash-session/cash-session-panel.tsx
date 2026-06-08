"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/client/api";

type CashBox = {
  id: string;
  code: string;
  description: string | null;
};

type CashSession = {
  id: string;
  status: "OPEN" | "RECONCILING" | "CLOSED" | "AUTO_CLOSED_PENDING_REVIEW";
  openingAmount: string;
  openedAt: string;
  autoClosedAt?: string | null;
  expectedCashAmount?: string | null;
  physicalCashBox?: CashBox;
  openedBy?: { username: string; fullName: string };
};

export type CashSessionState = {
  hasOpenSession: boolean;
  cashSessionId: string | null;
  physicalCashBoxId: string | null;
  status: "OPEN" | "RECONCILING" | "CLOSED" | "AUTO_CLOSED_PENDING_REVIEW" | null;
};

const SESSION_REASON_MESSAGES: Record<string, string> = {
  FORBIDDEN_ROLE: "Tu rol no tiene permiso para abrir caja. Contacta al administrador.",
  FORBIDDEN_BRANCH: "No tienes acceso a esta sucursal.",
  CASH_SESSION_ALREADY_OPEN: "Ya existe una sesión abierta para esta caja.",
  CASH_SESSION_CASH_BOX_INVALID: "La caja física no está activa o no pertenece a la sucursal.",
  CASH_SESSION_NOT_OPEN: "La sesión ya no está abierta.",
  CASH_SESSION_AUTO_CLOSED_PENDING_REVIEW: "La caja fue cerrada automaticamente por horario y requiere revision. Abre una nueva caja para continuar.",
  OPERATIONAL_DAY_NOT_OPEN: "No hay dia operativo abierto para esta sucursal. Un administrador debe abrirlo antes de abrir caja.",
  CASH_SESSION_UNRESOLVED_ORDERS: "No puedes cerrar caja con órdenes pendientes de pago o despacho.",
  CASH_SESSION_NOT_RECONCILING: "La sesión debe estar en conciliación antes de cerrarla.",
  CASH_SESSION_NOT_PENDING_AUTO_REVIEW: "La sesion ya no esta pendiente de revision automatica.",
  APPROVAL_REQUESTED: "Solicitud enviada. Un aprobador debe validar la diferencia antes de cerrar la caja.",
};

function mapSessionMessage(message?: string, reason?: string): string {
  if (reason && SESSION_REASON_MESSAGES[reason]) return SESSION_REASON_MESSAGES[reason];
  if (message && SESSION_REASON_MESSAGES[message]) return SESSION_REASON_MESSAGES[message];
  return message ?? "No se pudo completar la operación de caja.";
}

export function CashSessionPanel({ branchId, onStatusChange }: { branchId: string; onStatusChange?: (state: CashSessionState) => void }) {
  const [cashBoxes, setCashBoxes] = useState<CashBox[]>([]);
  const [selectedCashBoxId, setSelectedCashBoxId] = useState("");
  const [activeSession, setActiveSession] = useState<CashSession | null>(null);
  const [pendingAutoClosedSessions, setPendingAutoClosedSessions] = useState<CashSession[]>([]);
  const [openingAmount, setOpeningAmount] = useState("0");
  const [closingAmount, setClosingAmount] = useState("0");
  const [reviewAmount, setReviewAmount] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [reviewingSessionId, setReviewingSessionId] = useState("");
  const [message, setMessage] = useState("");
  const [reconcilingSessionId, setReconcilingSessionId] = useState("");
  const [busyAction, setBusyAction] = useState<"open" | "requestClose" | "close" | "review" | null>(null);
  const [loadError, setLoadError] = useState(false);
  // CORRECCIÓN 2 (UX): el formulario de revisión de cierre automático se muestra
  // colapsado por defecto para que el botón "Abrir sesión" quede siempre visible.
  const [showReviewForm, setShowReviewForm] = useState(false);
  const isReconciling = Boolean(reconcilingSessionId);

  const canOpen = useMemo(() => !!selectedCashBoxId && !activeSession && !reconcilingSessionId, [selectedCashBoxId, activeSession, reconcilingSessionId]);
  const canRequestClose = useMemo(() => activeSession?.status === "OPEN", [activeSession]);
  const canClose = useMemo(() => isReconciling, [isReconciling]);
  const selectedCashBox = useMemo(() => cashBoxes.find((box) => box.id === selectedCashBoxId) ?? null, [cashBoxes, selectedCashBoxId]);

  const sessionState = useMemo(() => {
    if (activeSession) return { label: "ABIERTA", variant: "success" as const };
    if (isReconciling) return { label: "EN CONCILIACIÓN", variant: "warning" as const };
    if (pendingAutoClosedSessions.length > 0) return { label: "REVISION PENDIENTE", variant: "warning" as const };
    return { label: "CERRADA", variant: "neutral" as const };
  }, [activeSession, isReconciling, pendingAutoClosedSessions.length]);

  const hasSingleBox = cashBoxes.length === 1;

  const publishStatus = useCallback((next: CashSessionState) => {
    onStatusChange?.(next);
  }, [onStatusChange]);

  const loadCashBoxes = useCallback(async () => {
    const query = new URLSearchParams({ branchId });
    const response = await fetch(`/api/cashier/cash-boxes?${query.toString()}`);
    const json = (await response.json()) as { data: CashBox[]; message?: string; reason?: string };

    if (!response.ok) {
      // Don't show confusing FORBIDDEN_ROLE if user simply has no boxes
      if (json.reason === "FORBIDDEN_ROLE") {
        setLoadError(true);
        setMessage("Tu perfil no tiene asignadas cajas físicas. Contacta al administrador.");
      } else {
        setMessage(mapSessionMessage(json.message, json.reason));
      }
      return;
    }

    const boxes = json.data ?? [];
    setCashBoxes(boxes);
    setLoadError(false);

    // Auto-select: if only 1 box, select it automatically
    if (boxes.length === 1) {
      setSelectedCashBoxId(boxes[0].id);
    } else if (!selectedCashBoxId && boxes.length > 0) {
      setSelectedCashBoxId(boxes[0].id);
    }

    if (boxes.length === 0) {
      setMessage("No hay cajas físicas activas en esta sucursal.");
    }
  }, [branchId, selectedCashBoxId]);

  const loadActiveSession = useCallback(async (cashBoxId: string) => {
    if (!cashBoxId) {
      setActiveSession(null);
      publishStatus({
        hasOpenSession: false,
        cashSessionId: null,
        physicalCashBoxId: cashBoxId || null,
        status: null,
      });
      return;
    }

    const query = new URLSearchParams({ branchId, physicalCashBoxId: cashBoxId });
    const response = await fetch(`/api/cashier/cash-sessions/active?${query.toString()}`);
    const json = (await response.json()) as { data: CashSession | null; message?: string; reason?: string };

    if (!response.ok) {
      setMessage(mapSessionMessage(json.message, json.reason));
      return;
    }

    if (json.data?.status === "RECONCILING") {
      setActiveSession(null);
      setReconcilingSessionId(json.data.id);
      publishStatus({
        hasOpenSession: false,
        cashSessionId: json.data.id,
        physicalCashBoxId: cashBoxId,
        status: "RECONCILING",
      });
      return;
    }

    setReconcilingSessionId("");
    setActiveSession(json.data ?? null);
    publishStatus({
      hasOpenSession: Boolean(json.data),
      cashSessionId: json.data?.id ?? null,
      physicalCashBoxId: cashBoxId,
      status: (json.data?.status as CashSessionState["status"]) ?? null,
    });
  }, [branchId, publishStatus]);

  const loadPendingAutoClosed = useCallback(async (cashBoxId: string) => {
    if (!cashBoxId) {
      setPendingAutoClosedSessions([]);
      return;
    }

    const query = new URLSearchParams({ branchId, physicalCashBoxId: cashBoxId });
    const response = await fetch(`/api/branch/cash/sessions/auto-closed-pending?${query.toString()}`);
    const json = (await response.json()) as { data: CashSession[]; message?: string; reason?: string };
    if (!response.ok) return;

    const rows = json.data ?? [];
    setPendingAutoClosedSessions(rows);
    if (rows.length > 0 && !activeSession && !reconcilingSessionId) {
      publishStatus({
        hasOpenSession: false,
        cashSessionId: rows[0].id,
        physicalCashBoxId: cashBoxId,
        status: "AUTO_CLOSED_PENDING_REVIEW",
      });
    }
    if (rows.length > 0 && !reviewingSessionId) {
      setReviewingSessionId(rows[0].id);
      setReviewAmount(rows[0].expectedCashAmount ? Number(rows[0].expectedCashAmount).toFixed(2) : "");
    }
  }, [activeSession, branchId, publishStatus, reconcilingSessionId, reviewingSessionId]);

  useEffect(() => {
    loadCashBoxes().catch(() => setMessage("No se pudo cargar la lista de cajas."));
  }, [loadCashBoxes]);

  useEffect(() => {
    loadActiveSession(selectedCashBoxId).catch(() => setMessage("No se pudo consultar la sesión activa."));
  }, [loadActiveSession, selectedCashBoxId]);

  useEffect(() => {
    loadPendingAutoClosed(selectedCashBoxId).catch(() => undefined);
  }, [loadPendingAutoClosed, selectedCashBoxId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMessage("");
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function openSession() {
    if (!selectedCashBoxId || busyAction) return;
    setBusyAction("open");
    setMessage("Abriendo sesión...");
    try {
      const response = await apiFetch("/api/cashier/cash-sessions/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, physicalCashBoxId: selectedCashBoxId, openingAmount: Number(openingAmount) }),
      });
      const json = (await response.json()) as { message?: string; reason?: string; status?: string };

      if (!response.ok) {
        setMessage(mapSessionMessage(json.message, json.reason));
        return;
      }

      setReconcilingSessionId("");
      setMessage("Sesión abierta correctamente. Ya puedes cobrar. ✓");
      await loadActiveSession(selectedCashBoxId);
    } catch (error) {
      console.error("[CashSession][openSession]", error);
      setMessage(error instanceof TypeError ? "Error de red. Verifica tu conexión." : "No se pudo abrir la sesión.");
    } finally {
      setBusyAction(null);
    }
  }

  async function requestCloseSession() {
    if (!activeSession || busyAction) return;
    setBusyAction("requestClose");
    setMessage("Solicitando cierre para conciliación...");
    try {
      const response = await apiFetch("/api/cashier/cash-sessions/close-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashSessionId: activeSession.id }),
      });
      const json = (await response.json()) as { message?: string; reason?: string; status?: string };

      if (!response.ok) {
        setMessage(mapSessionMessage(json.message, json.reason));
        return;
      }

      setMessage("Sesión en conciliación. Ingresa monto final para cerrar.");
      setReconcilingSessionId(activeSession.id);
      setActiveSession(null);
      publishStatus({
        hasOpenSession: false,
        cashSessionId: activeSession.id,
        physicalCashBoxId: selectedCashBoxId || null,
        status: "RECONCILING",
      });
    } catch (error) {
      console.error("[CashSession][requestCloseSession]", error);
      setMessage(error instanceof TypeError ? "Error de red. Verifica tu conexión." : "No se pudo solicitar el cierre.");
    } finally {
      setBusyAction(null);
    }
  }

  async function closeSession() {
    if (!reconcilingSessionId || busyAction) return;
    setBusyAction("close");
    setMessage("Cerrando sesión...");
    try {
      const response = await apiFetch("/api/cashier/cash-sessions/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashSessionId: reconcilingSessionId, closingAmount: Number(closingAmount) }),
      });
      const json = (await response.json()) as { message?: string; reason?: string; status?: string };

      if (!response.ok) {
        setMessage(mapSessionMessage(json.message, json.reason));
        return;
      }

      if (json.status === "REQUESTED") {
        setMessage(mapSessionMessage(json.message, json.reason ?? "APPROVAL_REQUESTED"));
        return;
      }

      setMessage("Sesión cerrada correctamente. ✓");
      setActiveSession(null);
      setReconcilingSessionId("");
      publishStatus({
        hasOpenSession: false,
        cashSessionId: null,
        physicalCashBoxId: selectedCashBoxId || null,
        status: "CLOSED",
      });
    } catch (error) {
      console.error("[CashSession][closeSession]", error);
      setMessage(error instanceof TypeError ? "Error de red. Verifica tu conexión." : "No se pudo cerrar la sesión.");
    } finally {
      setBusyAction(null);
    }
  }

  async function reviewAutoClosedSession() {
    if (!reviewingSessionId || busyAction) return;
    if (!reviewNote.trim()) {
      setMessage("La nota de revision es obligatoria.");
      return;
    }
    setBusyAction("review");
    setMessage("Registrando revision de cierre automatico...");
    try {
      const response = await apiFetch(`/api/branch/cash/sessions/${reviewingSessionId}/review-auto-close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countedCashAmount: Number(reviewAmount), note: reviewNote.trim() }),
      });
      const json = (await response.json()) as { message?: string; reason?: string; status?: string };

      if (!response.ok) {
        setMessage(mapSessionMessage(json.message, json.reason));
        return;
      }

      setMessage("Revision registrada. La sesion quedo cerrada.");
      setReviewAmount("");
      setReviewNote("");
      setReviewingSessionId("");
      await loadPendingAutoClosed(selectedCashBoxId);
      await loadActiveSession(selectedCashBoxId);
    } catch (error) {
      console.error("[CashSession][reviewAutoClosedSession]", error);
      setMessage(error instanceof TypeError ? "Error de red. Verifica tu conexion." : "No se pudo revisar el cierre automatico.");
    } finally {
      setBusyAction(null);
    }
  }

  const stateColors = {
    success: { bg: "bg-[var(--color-success-50)]", border: "border-[var(--color-success-200)]", text: "text-[var(--color-success-700)]", dot: "bg-[var(--color-success-500)]" },
    warning: { bg: "bg-[var(--color-warning-50)]", border: "border-[var(--color-warning-200)]", text: "text-[var(--color-warning-700)]", dot: "bg-[var(--color-warning-500)]" },
    neutral: { bg: "bg-[var(--color-surface-alt)]", border: "border-[var(--color-border)]", text: "text-[var(--color-text-muted)]", dot: "bg-[var(--color-text-soft)]" },
  };

  const sc = stateColors[sessionState.variant];
  const reviewingSession = pendingAutoClosedSessions.find((session) => session.id === reviewingSessionId) ?? pendingAutoClosedSessions[0] ?? null;
  const expectedForReview = Number(reviewingSession?.expectedCashAmount ?? 0);
  const countedForReview = Number(reviewAmount || 0);
  const reviewDifference = Number.isFinite(countedForReview) ? countedForReview - expectedForReview : 0;

  if (loadError) {
    return (
      <section className="rounded-2xl border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] p-5" data-testid="cash-session-panel">
        <p className="text-sm text-[var(--color-warning-700)]">{message}</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-4 shadow-[var(--shadow-card)]" data-testid="cash-session-panel">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-[var(--color-text)]">Control de sesión de caja</h2>
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[0.6875rem] font-semibold ${sc.bg} ${sc.text} border ${sc.border}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${sc.dot}`} />
          {sessionState.label}
        </span>
      </div>

      {/* Cash box info — auto-selected if single box, otherwise show selector */}
      {hasSingleBox ? (
        <div className={`rounded-xl p-3 text-sm ${sc.bg} border ${sc.border}`}>
          <div className="font-medium text-[var(--color-text)]">
            Caja: <strong>{selectedCashBox?.code ?? "—"}</strong>
            {selectedCashBox?.description ? ` — ${selectedCashBox.description}` : ""}
          </div>
          <div className="text-xs text-[var(--color-text-muted)] mt-0.5">Asignada automáticamente</div>
        </div>
      ) : cashBoxes.length > 1 ? (
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-[var(--color-text-secondary)]">Selecciona caja física</span>
          <select
            className="hm-input rounded-xl"
            value={selectedCashBoxId}
            onChange={(event) => setSelectedCashBoxId(event.target.value)}
            disabled={Boolean(busyAction)}
          >
            {cashBoxes.map((box) => (
              <option key={box.id} value={box.id}>{box.code}{box.description ? ` — ${box.description}` : ""}</option>
            ))}
          </select>
        </label>
      ) : null}

      {/* CORRECCIÓN 2 (UX): Acción principal SIEMPRE visible.
          "Abrir sesión" se muestra arriba en una tarjeta destacada, antes que el
          formulario de revisión de cierre automático (que ahora es colapsable),
          para que el botón nunca quede empujado fuera de la vista. */}
      {!activeSession && !isReconciling && cashBoxes.length > 0 && (
        <div className="rounded-xl border-2 border-[var(--color-success-200)] bg-[var(--color-success-50)] p-4 space-y-3">
          <p className="text-sm font-medium text-[var(--color-success-700)]">
            No hay sesión abierta. Ingresa el monto de apertura y abre una sesión para comenzar a cobrar.
          </p>
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Monto de apertura (C$)</label>
              <input
                className="hm-input rounded-xl"
                type="number"
                min="0"
                step="0.01"
                value={openingAmount}
                onChange={(event) => setOpeningAmount(event.target.value)}
                placeholder="Monto apertura"
                disabled={Boolean(busyAction)}
              />
            </div>
            <div className="flex items-end">
              <button
                className="w-full rounded-xl bg-[var(--color-success-600)] hover:bg-[var(--color-success-700)] px-5 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                onClick={openSession}
                disabled={!canOpen || Boolean(busyAction)}
                data-testid="cash-session-open"
              >
                {busyAction === "open" ? "Abriendo..." : "Abrir sesión"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Session details when open */}
      {activeSession && (
        <div className="rounded-xl border border-[var(--color-success-100)] bg-[var(--color-success-50)] p-4 text-sm space-y-1">
          <div className="text-[var(--color-success-700)]">
            <strong>⏱ Abierta desde:</strong> {new Date(activeSession.openedAt).toLocaleString()}
          </div>
          <div className="text-[var(--color-success-700)]">
            <strong>Monto de apertura:</strong> C$ {Number(activeSession.openingAmount).toFixed(2)}
          </div>
        </div>
      )}

      {/* Request close */}
      {activeSession && (
        <div className="flex justify-end">
          <button
            className="rounded-xl border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] hover:bg-[var(--color-warning-100)] px-5 py-2.5 text-sm font-medium text-[var(--color-warning-700)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={requestCloseSession}
            disabled={!canRequestClose || Boolean(busyAction)}
            data-testid="cash-session-request-close"
          >
            {busyAction === "requestClose" ? "Procesando..." : "Solicitar cierre"}
          </button>
        </div>
      )}

      {/* Reconciling message */}
      {isReconciling && (
        <div className="rounded-xl border border-[var(--color-warning-100)] bg-[var(--color-warning-50)] p-3 text-sm text-[var(--color-warning-700)]">
          Sesión en conciliación. Ingresa el monto de cierre y confirma.
        </div>
      )}

      {/* Close session controls */}
      {isReconciling && (
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Monto de cierre (C$)</label>
            <input
              className="hm-input rounded-xl"
              type="number"
              min="0"
              step="0.01"
              value={closingAmount}
              onChange={(event) => setClosingAmount(event.target.value)}
              placeholder="Monto cierre"
              disabled={Boolean(busyAction)}
            />
          </div>
          <div className="flex items-end">
            <button
              className="rounded-xl bg-[var(--color-text)] hover:bg-[var(--color-text-secondary)] px-5 py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              onClick={closeSession}
              disabled={!canClose || Boolean(busyAction)}
              data-testid="cash-session-close"
            >
              {busyAction === "close" ? "Cerrando..." : "Cerrar sesion"}
            </button>
          </div>
        </div>
      )}

      {/* CORRECCIÓN 2 (UX): Revisión de cierre automático — indicador claro + colapsable.
          Se ubica DESPUÉS de la acción principal y queda colapsado por defecto para
          no desplazar el botón "Abrir sesión". */}
      {pendingAutoClosedSessions.length > 0 && (
        <div className="rounded-xl border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] p-4 text-sm space-y-3" data-testid="cash-session-pending-review">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2">
              <span className="mt-1 inline-flex h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-[var(--color-warning-500)]" />
              <div>
                <p className="font-semibold text-[var(--color-warning-700)]">⚠ Cierre automático pendiente de revisión</p>
                <p className="text-xs text-[var(--color-text-muted)]">Esta caja fue cerrada por horario. No se pueden cobrar pagos sobre esa sesión hasta revisarla.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-[var(--color-warning-200)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--color-warning-700)]">
                {pendingAutoClosedSessions.length} pendiente{pendingAutoClosedSessions.length !== 1 ? "s" : ""}
              </span>
              <button
                type="button"
                className="rounded-xl border border-[var(--color-warning-300)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-warning-700)] transition-colors hover:bg-[var(--color-warning-100)]"
                onClick={() => setShowReviewForm((value) => !value)}
                data-testid="cash-session-toggle-review"
                aria-expanded={showReviewForm}
              >
                {showReviewForm ? "Ocultar revisión" : "Revisar ahora"}
              </button>
            </div>
          </div>

          {showReviewForm && (
            <div className="space-y-3 border-t border-[var(--color-warning-200)] pt-3">
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-[var(--color-text-muted)]">Sesion a revisar</span>
                <select
                  className="hm-input rounded-xl"
                  value={reviewingSessionId}
                  onChange={(event) => {
                    const next = pendingAutoClosedSessions.find((item) => item.id === event.target.value);
                    setReviewingSessionId(event.target.value);
                    setReviewAmount(next?.expectedCashAmount ? Number(next.expectedCashAmount).toFixed(2) : "");
                  }}
                  disabled={Boolean(busyAction)}
                >
                  {pendingAutoClosedSessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.physicalCashBox?.code ?? "Caja"} - {session.autoClosedAt ? new Date(session.autoClosedAt).toLocaleString() : "auto-cierre"}
                    </option>
                  ))}
                </select>
              </label>

              {reviewingSession && (
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-lg border border-[var(--color-warning-100)] bg-[var(--color-surface)] p-3">
                    <p className="text-xs text-[var(--color-text-muted)]">Monto esperado</p>
                    <p className="font-semibold text-[var(--color-text)]">C$ {expectedForReview.toFixed(2)}</p>
                  </div>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-semibold text-[var(--color-text-muted)]">Monto contado real</span>
                    <input
                      className="hm-input rounded-xl"
                      type="number"
                      min="0"
                      step="0.01"
                      value={reviewAmount}
                      onChange={(event) => setReviewAmount(event.target.value)}
                      disabled={Boolean(busyAction)}
                    />
                  </label>
                  <div className={`rounded-lg border p-3 ${Math.abs(reviewDifference) > 5 ? "border-[var(--color-danger-200)] bg-[var(--color-danger-50)]" : "border-[var(--color-border)] bg-[var(--color-surface)]"}`}>
                    <p className="text-xs text-[var(--color-text-muted)]">Diferencia</p>
                    <p className="font-semibold text-[var(--color-text)]">C$ {reviewDifference.toFixed(2)}</p>
                  </div>
                </div>
              )}

              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-[var(--color-text-muted)]">Nota de revision</span>
                <textarea
                  className="hm-input min-h-20 rounded-xl px-3 py-2"
                  value={reviewNote}
                  onChange={(event) => setReviewNote(event.target.value)}
                  placeholder="Describe el conteo fisico y cualquier diferencia."
                  disabled={Boolean(busyAction)}
                />
              </label>

              <div className="flex justify-end">
                <button
                  className="rounded-xl bg-[var(--color-warning-600)] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--color-warning-700)] disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={reviewAutoClosedSession}
                  disabled={!reviewingSessionId || !reviewNote.trim() || Boolean(busyAction)}
                >
                  {busyAction === "review" ? "Revisando..." : "Revisar cierre"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Feedback message */}
      {message && !loadError ? (
        <p className="text-sm text-[var(--color-text-secondary)] bg-[var(--color-surface-alt)] rounded-xl px-3 py-2">
          {message}
        </p>
      ) : null}
    </section>
  );
}
