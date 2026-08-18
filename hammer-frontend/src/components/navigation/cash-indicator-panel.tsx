"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Banknote, Send, X } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { useOperationalPolling } from "@/lib/realtime/use-operational-polling";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import toast from "react-hot-toast";

/**
 * Indicador de efectivo en la barra lateral (prompt-indicador-efectivo-
 * inteligente.md) — que desde acá se sepa, sin entrar a ninguna pantalla,
 * cuánto efectivo hay, cuánto viene acumulado, y cuándo toca depositar.
 * CLEAR no se renderiza (§3): un indicador siempre presente deja de serlo.
 */

export type CashIndicatorState = "ACCUMULATING" | "APPROACHING" | "READY" | "OVERDUE" | "CRITICAL" | "IN_TRANSIT_ONLY" | "CLEAR";

export type CashPosition = {
  branchId: string;
  cashInDrawerToday: number;
  accumulatedAmount: number;
  cashFundAmount: number | null;
  pendingDeposit: number;
  pendingDepositNote: string | null;
  inTransitAmount: number;
  state: CashIndicatorState;
  projection: { earliestDate: string | null; likelyDate: string | null; basis: string; confidence: "LOW" | "MEDIUM" | "HIGH" } | null;
  anomaly: { message: string } | null;
  policy: { thresholdAmount: number; maxDaysHolding: number } | null;
};

const STATE_META: Record<Exclude<CashIndicatorState, "CLEAR">, { label: string; tone: "neutral" | "amber" | "critical" }> = {
  ACCUMULATING: { label: "Acumulando", tone: "neutral" },
  APPROACHING: { label: "Cerca del umbral", tone: "neutral" },
  READY: { label: "Listo para depositar", tone: "amber" },
  OVERDUE: { label: "Retenido de más", tone: "amber" },
  CRITICAL: { label: "Crítico", tone: "critical" },
  IN_TRANSIT_ONLY: { label: "En tránsito", tone: "neutral" },
};

const fmt = (v: number) => `C$${v.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("es-NI", { weekday: "long", day: "2-digit", month: "short" });
}

export function CashIndicatorPanel({ branchId, isMaster, canSendDeposit }: { branchId: string | null; isMaster: boolean; canSendDeposit: boolean }) {
  const [position, setPosition] = useState<CashPosition | null>(null);
  const [branchLabel, setBranchLabel] = useState<string | null>(null);
  const [otherBranchesFlagged, setOtherBranchesFlagged] = useState(0);
  const [showSendModal, setShowSendModal] = useState(false);

  const load = useCallback(async () => {
    if (!isMaster && !branchId) return;
    const url = isMaster ? "/api/master/treasury/cash-positions" : `/api/treasury/cash-position?branchId=${branchId}`;
    const res = await apiFetch(url);
    if (!res.ok) return;
    const raw = await res.json();
    if (isMaster) {
      const rows = unwrapApiData(raw) as Array<{ branch: { id: string; name: string }; position: CashPosition }>;
      // Master: prioriza la de peor estado (§6, "las que están en READY u OVERDUE arriba").
      const priority: Record<string, number> = { CRITICAL: 0, OVERDUE: 1, READY: 2, APPROACHING: 3, IN_TRANSIT_ONLY: 4, ACCUMULATING: 5, CLEAR: 6 };
      const sorted = [...rows].sort((a, b) => (priority[a.position.state] ?? 9) - (priority[b.position.state] ?? 9));
      const worst = sorted[0];
      setPosition(worst ? worst.position : null);
      setBranchLabel(worst ? worst.branch.name : null);
      setOtherBranchesFlagged(sorted.slice(1).filter((r) => r.position.state !== "CLEAR").length);
    } else {
      setPosition(unwrapApiData(raw) as CashPosition);
    }
  }, [branchId, isMaster]);

  useOperationalPolling({ enabled: isMaster || Boolean(branchId), intervalMs: 90_000, task: load });

  if ((!isMaster && !branchId) || !position || position.state === "CLEAR") return null;

  const meta = STATE_META[position.state];

  return (
    <div
      className={[
        "mx-3 mb-2 rounded-lg border px-2.5 py-2 text-[0.6875rem]",
        meta.tone === "critical" ? "border-[var(--color-danger-200)] bg-[var(--color-danger-50)]" :
        meta.tone === "amber" ? "border-[var(--color-warning-200)] bg-[var(--color-warning-50)]" :
        "border-[var(--color-border)] bg-[var(--color-surface-alt)]",
      ].join(" ")}
    >
      <div className="mb-1 flex items-center justify-between gap-1.5">
        <span className="flex items-center gap-1 font-semibold text-[var(--color-text)]">
          <Banknote className="h-3 w-3" /> Efectivo{branchLabel ? ` · ${branchLabel}` : ""}
        </span>
        <span
          className={[
            "rounded-full px-1.5 py-0.5 text-[0.5625rem] font-bold uppercase tracking-wide",
            meta.tone === "critical" ? "bg-[var(--color-danger-600)] text-white" :
            meta.tone === "amber" ? "bg-[var(--color-warning-500)] text-white" :
            "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]",
          ].join(" ")}
        >
          {meta.label}
        </span>
      </div>

      <div className="space-y-0.5 text-[var(--color-text-muted)]">
        <div className="flex justify-between"><span>En caja hoy</span><span className="font-mono tabular-nums text-[var(--color-text)]">{fmt(position.cashInDrawerToday)}</span></div>
        <div className="flex justify-between"><span>Acumulado</span><span className="font-mono tabular-nums text-[var(--color-text)]">{fmt(position.accumulatedAmount)}</span></div>
        <div className="flex justify-between">
          <span>Para depositar</span>
          <span className="font-mono tabular-nums text-[var(--color-text)]">{fmt(position.pendingDeposit)}</span>
        </div>
        {position.pendingDepositNote && <p className="text-[0.625rem] italic text-[var(--color-text-soft)]">{position.pendingDepositNote}</p>}
        {position.inTransitAmount > 0.01 && (
          <div className="flex justify-between"><span>En tránsito</span><span className="font-mono tabular-nums text-[var(--color-text)]">{fmt(position.inTransitAmount)}</span></div>
        )}
      </div>

      {position.projection?.likelyDate && (
        <p className="mt-1.5 border-t border-[var(--color-border)] pt-1.5 text-[var(--color-text)]">
          Alcanzás el umbral el {fmtDate(position.projection.likelyDate)}
          <span className="block text-[0.625rem] text-[var(--color-text-soft)]">según {position.projection.basis}</span>
        </p>
      )}
      {!position.projection?.likelyDate && position.state === "APPROACHING" && position.projection && position.policy && (
        <p className="mt-1.5 border-t border-[var(--color-border)] pt-1.5 text-[var(--color-text)]">
          Faltan {fmt(Math.max(0, position.policy.thresholdAmount - position.accumulatedAmount))} para el umbral
        </p>
      )}
      {position.anomaly && (
        <p className="mt-1.5 flex items-start gap-1 text-[0.625rem] text-[var(--color-warning-700)]">
          <AlertTriangle className="mt-0.5 h-2.5 w-2.5 shrink-0" /> {position.anomaly.message}
        </p>
      )}

      {canSendDeposit && !isMaster && (position.state === "READY" || position.state === "OVERDUE" || position.state === "CRITICAL") && (
        <Button variant="secondary" size="sm" className="mt-2 w-full" icon={<Send className="h-3 w-3" />} onClick={() => setShowSendModal(true)}>
          Enviar depósito
        </Button>
      )}

      {isMaster && (
        <Link href="/app/master/treasury" className="mt-2 block text-center text-[0.625rem] font-semibold text-[var(--color-pay)] hover:underline">
          {otherBranchesFlagged > 0 ? `Ver Tesorería (${otherBranchesFlagged} más con algo pendiente)` : "Ver Tesorería"}
        </Link>
      )}

      {showSendModal && branchId && (
        <SendDepositModal branchId={branchId} pendingDeposit={position.pendingDeposit} onClose={() => setShowSendModal(false)} onSent={() => { setShowSendModal(false); void load(); }} />
      )}
    </div>
  );
}

export function SendDepositModal({ branchId, pendingDeposit, onClose, onSent }: { branchId: string; pendingDeposit: number; onClose: () => void; onSent: () => void }) {
  const [people, setPeople] = useState<Array<{ id: string; fullName: string }>>([]);
  const [cashSessionId, setCashSessionId] = useState<string | null>(null);
  const [amount, setAmount] = useState(pendingDeposit > 0 ? pendingDeposit.toFixed(2) : "");
  const [carrierUserId, setCarrierUserId] = useState("");
  const [reason, setReason] = useState<"DEPOSIT_DISPATCH" | "HANDOVER">("DEPOSIT_DISPATCH");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [peopleRes, sessionRes] = await Promise.all([
        apiFetch(`/api/branches/${branchId}/members`),
        apiFetch(`/api/cashier/cash-sessions/active?branchId=${branchId}`),
      ]);
      if (cancelled) return;
      if (peopleRes.ok) setPeople(unwrapApiData(await peopleRes.json()) as Array<{ id: string; fullName: string }>);
      if (sessionRes.ok) {
        const raw = await sessionRes.json();
        const data = unwrapApiData(raw) as { id?: string } | null;
        if (!cancelled) setCashSessionId(data?.id ?? null);
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [branchId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!cashSessionId) {
      toast.error("No hay una sesión de caja abierta en esta sucursal.");
      return;
    }
    if (!carrierUserId) {
      toast.error(reason === "DEPOSIT_DISPATCH" ? "Elegí quién lo lleva." : "Elegí quién lo recibe.");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch(`/api/cashier/cash-sessions/${cashSessionId}/send-deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashSessionId, amount: Number(amount), carrierUserId, reason }),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo registrar el envío.");
      toast.success("Registrado. La sesión sigue abierta — el depósito se confirma después desde Tesorería.");
      onSent();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo registrar el envío.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4" onClick={(e) => e.stopPropagation()}>
      <form onSubmit={submit} className="w-full max-w-sm space-y-3 rounded-xl bg-[var(--color-surface)] p-5 text-sm normal-case shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Enviar efectivo</h3>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} icon={<X className="h-4 w-4" />}>Cerrar</Button>
        </div>

        {!loaded ? (
          <p className="text-xs text-[var(--color-text-muted)]">Cargando…</p>
        ) : !cashSessionId ? (
          <p className="rounded-lg bg-[var(--color-warning-50)] px-3 py-2 text-xs text-[var(--color-warning-700)]">No hay una sesión de caja abierta en esta sucursal — esta acción exige la caja abierta.</p>
        ) : (
          <>
            <div className="inline-flex rounded-lg border border-[var(--color-border)] p-0.5">
              <button type="button" onClick={() => setReason("DEPOSIT_DISPATCH")} className={["rounded-md px-3 py-1.5 text-xs font-medium", reason === "DEPOSIT_DISPATCH" ? "bg-[var(--color-pay)] text-white" : "text-[var(--color-text-secondary)]"].join(" ")}>A depositar</button>
              <button type="button" onClick={() => setReason("HANDOVER")} className={["rounded-md px-3 py-1.5 text-xs font-medium", reason === "HANDOVER" ? "bg-[var(--color-pay)] text-white" : "text-[var(--color-text-secondary)]"].join(" ")}>Entregar en persona</button>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Monto</label>
              <Input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">{reason === "DEPOSIT_DISPATCH" ? "¿Quién lo lleva?" : "¿Quién lo recibe?"}</label>
              <select className="hm-input w-full" value={carrierUserId} onChange={(e) => setCarrierUserId(e.target.value)} required>
                <option value="">Seleccioná…</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
              </select>
            </div>
            <Button type="submit" variant="success" loading={saving} className="w-full">Registrar envío</Button>
          </>
        )}
      </form>
    </div>
  );
}
