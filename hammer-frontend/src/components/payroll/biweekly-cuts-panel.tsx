"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Loader2,
  RefreshCw,
  Wallet,
  Building2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import toast from "react-hot-toast";

/**
 * Cortes por quincena — vista consolidada de TODAS las quincenas pendientes de
 * pago del negocio (todas las sucursales y corridas POSTED), con capacidad de
 * procesamiento masivo.
 *
 * Consume la capacidad de backend `listPendingDisbursements`
 * (GET /api/payroll/disbursements sin payrollRunId) que antes no tenía ningún
 * consumidor en el frontend, y paga en bloque vía
 * POST /api/payroll/disbursements/pay-pending.
 */

type Period = "FIRST_HALF" | "SECOND_HALF";

type PendingDisbursement = {
  id: string;
  branchId: string;
  period: Period;
  amount: string;
  status: "PENDING" | "PAID";
  scheduledDate: string;
  employee: { id: string; fullName: string; position: string };
  payrollRun: { id: string; year: number; month: number; status: string };
};

type Branch = { id: string; code: string; name: string };

const PERIOD_LABEL: Record<Period, string> = {
  FIRST_HALF: "1ra quincena (día 15)",
  SECOND_HALF: "2da quincena (fin de mes)",
};

const MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function fmtMoney(v: string | number | null | undefined) {
  return `C$${Number(v ?? 0).toLocaleString("es-NI", { minimumFractionDigits: 2 })}`;
}

/** Fecha real programada (respeta el último día real del mes, no un fijo "día 30"). */
function fmtScheduled(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("es-NI", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function BiweeklyCutsPanel() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [items, setItems] = useState<PendingDisbursement[]>([]);
  const [loading, setLoading] = useState(false);
  const [payingPeriod, setPayingPeriod] = useState<Period | null>(null);

  useEffect(() => {
    fetch("/api/branches")
      .then((r) => r.json())
      .then((j) => {
        const data = unwrapApiData(j);
        setBranches(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedBranch) params.set("branchId", selectedBranch);
      const q = params.toString();
      const r = await apiFetch(`/api/payroll/disbursements${q ? `?${q}` : ""}`);
      const data = unwrapApiData(await r.json());
      setItems(Array.isArray(data) ? (data as PendingDisbursement[]) : []);
    } catch {
      toast.error("Error al cargar las quincenas pendientes");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [selectedBranch]);

  useEffect(() => { load(); }, [load]);

  const branchLabel = useCallback(
    (id: string) => branches.find((b) => b.id === id)?.code ?? id,
    [branches],
  );

  /** Agrupa por período → totales y desglose por sucursal. */
  const grouped = useMemo(() => {
    const byPeriod: Record<Period, { total: number; count: number; byBranch: Map<string, { total: number; count: number }> }> = {
      FIRST_HALF: { total: 0, count: 0, byBranch: new Map() },
      SECOND_HALF: { total: 0, count: 0, byBranch: new Map() },
    };
    for (const d of items) {
      const g = byPeriod[d.period];
      const amt = Number(d.amount);
      g.total += amt;
      g.count += 1;
      const b = g.byBranch.get(d.branchId) ?? { total: 0, count: 0 };
      b.total += amt;
      b.count += 1;
      g.byBranch.set(d.branchId, b);
    }
    return byPeriod;
  }, [items]);

  const grandTotal = useMemo(() => items.reduce((s, d) => s + Number(d.amount), 0), [items]);

  const handlePayPeriod = async (period: Period) => {
    setPayingPeriod(period);
    try {
      const r = await apiFetch("/api/payroll/disbursements/pay-pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, branchId: selectedBranch || undefined }),
      });
      const raw = await r.json();
      if (!r.ok) {
        toast.error((raw?.error?.message ?? raw?.error ?? "Error al procesar el corte") as string);
        return;
      }
      const data = unwrapApiData(raw) as {
        paid: number;
        runsProcessed: number;
        cashSync: Array<{ branchId: string; applied: boolean; reason?: string }>;
      };
      if (data.paid === 0) {
        toast("No había quincenas pendientes para procesar.", { icon: "ℹ️" });
      } else {
        const applied = (data.cashSync ?? []).filter((c) => c.applied).map((c) => branchLabel(c.branchId));
        const pending = (data.cashSync ?? []).filter((c) => !c.applied).map((c) => branchLabel(c.branchId));
        let detail = "";
        if (applied.length) detail += ` Descontado de caja en: ${applied.join(", ")}.`;
        if (pending.length) detail += ` Pendiente de aplicar al abrir caja en: ${pending.join(", ")}.`;
        toast.success(`${PERIOD_LABEL[period]}: ${data.paid} desembolso(s) en ${data.runsProcessed} corrida(s).${detail}`);
      }
      await load();
    } catch {
      toast.error("Error de conexión al procesar el corte");
    } finally {
      setPayingPeriod(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Encabezado + filtro */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold" style={{ color: "var(--color-text)" }}>
            <CalendarClock className="h-5 w-5" /> Cortes quincenales
          </h3>
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            Todas las quincenas pendientes de pago, consolidadas de todas las sucursales. Procesa un corte completo con un solo clic.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
            Sucursal
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="rounded-md px-3 py-2 text-sm"
              style={{ background: "var(--color-surface)", border: "0.5px solid var(--color-border)", color: "var(--color-text)" }}
            >
              <option value="">Todas</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.code} — {b.name}</option>
              ))}
            </select>
          </label>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium"
            style={{ background: "var(--color-surface-alt)", border: "0.5px solid var(--color-border)", color: "var(--color-text)" }}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Actualizar
          </button>
        </div>
      </div>

      {/* Total global */}
      <div className="rounded-xl p-4" style={{ background: "var(--color-surface-raised)", border: "0.5px solid var(--color-border)" }}>
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>
          <Wallet className="h-4 w-4" /> Total pendiente de desembolsar
        </div>
        <div className="mt-1 text-2xl font-bold" style={{ color: grandTotal > 0 ? "var(--color-warning-600, #d97706)" : "var(--color-text)" }}>
          {fmtMoney(grandTotal)}
        </div>
        <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>{items.length} desembolso(s) pendiente(s)</div>
      </div>

      {/* Tarjetas por período */}
      <div className="grid gap-4 lg:grid-cols-2">
        {(["FIRST_HALF", "SECOND_HALF"] as Period[]).map((period) => {
          const g = grouped[period];
          const hasPending = g.count > 0;
          const isPaying = payingPeriod === period;
          return (
            <div key={period} className="rounded-xl p-4 space-y-3" style={{ background: "var(--color-surface)", border: "0.5px solid var(--color-border)" }}>
              <div className="flex items-center justify-between">
                <div className="font-semibold" style={{ color: "var(--color-text)" }}>{PERIOD_LABEL[period]}</div>
                <div className="text-lg font-bold" style={{ color: "var(--color-text)" }}>{fmtMoney(g.total)}</div>
              </div>

              {hasPending ? (
                <div className="space-y-1.5">
                  {[...g.byBranch.entries()].map(([bId, v]) => (
                    <div key={bId} className="flex items-center justify-between rounded-md px-2.5 py-1.5 text-sm"
                      style={{ background: "var(--color-surface-alt)" }}>
                      <span className="flex items-center gap-1.5" style={{ color: "var(--color-text-secondary)" }}>
                        <Building2 className="h-3.5 w-3.5" /> {branchLabel(bId)}
                        <span style={{ color: "var(--color-text-muted)" }}>· {v.count} empleado(s)</span>
                      </span>
                      <span className="tabular-nums" style={{ color: "var(--color-text)" }}>{fmtMoney(v.total)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  <CheckCircle2 className="h-4 w-4" /> Sin quincenas pendientes en este período.
                </div>
              )}

              <button
                onClick={() => handlePayPeriod(period)}
                disabled={!hasPending || isPaying || loading}
                className="w-full inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: hasPending ? "var(--color-master-600, #2563eb)" : "var(--color-surface-alt)", color: hasPending ? "#fff" : "var(--color-text-muted)" }}
              >
                {isPaying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
                {isPaying ? "Procesando…" : `Procesar corte${hasPending ? ` · ${fmtMoney(g.total)}` : ""}`}
              </button>
            </div>
          );
        })}
      </div>

      {/* Detalle */}
      {items.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ border: "0.5px solid var(--color-border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--color-surface-raised)", color: "var(--color-text-muted)" }}>
                <th className="text-left px-3 py-2 font-medium">Empleado</th>
                <th className="text-left px-3 py-2 font-medium">Sucursal</th>
                <th className="text-left px-3 py-2 font-medium">Período</th>
                <th className="text-left px-3 py-2 font-medium">Corrida</th>
                <th className="text-left px-3 py-2 font-medium">Programado</th>
                <th className="text-right px-3 py-2 font-medium">Monto</th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id} style={{ borderTop: "0.5px solid var(--color-border)", color: "var(--color-text-secondary)" }}>
                  <td className="px-3 py-2" style={{ color: "var(--color-text)" }}>{d.employee.fullName}</td>
                  <td className="px-3 py-2">{branchLabel(d.branchId)}</td>
                  <td className="px-3 py-2">{d.period === "FIRST_HALF" ? "1ra" : "2da"}</td>
                  <td className="px-3 py-2">{MONTHS_ES[(d.payrollRun.month - 1) % 12]} {d.payrollRun.year}</td>
                  <td className="px-3 py-2">{fmtScheduled(d.scheduledDate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--color-text)" }}>{fmtMoney(d.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg px-4 py-3 text-sm"
          style={{ background: "var(--color-surface-alt)", color: "var(--color-text-muted)" }}>
          <AlertTriangle className="h-4 w-4" /> No hay quincenas pendientes de pago
          {selectedBranch ? " para la sucursal seleccionada" : " en el negocio"}.
        </div>
      )}
    </div>
  );
}
