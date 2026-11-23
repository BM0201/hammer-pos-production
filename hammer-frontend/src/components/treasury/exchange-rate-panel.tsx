"use client";

import { useEffect, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import toast from "react-hot-toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type ExchangeRateRow = { id: string; fromCurrency: string; toCurrency: string; rate: string; effectiveAt: string; source: string; createdBy: { fullName: string | null; username: string } | null };

const RATE_SOURCE_LABEL: Record<string, string> = { MANUAL: "Manual", BANK_RECEIPT: "Comprobante bancario" };

function fmtRateDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-NI", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * H-7 (prompt-tesoreria-cerrar-circuito.md) — tasa vigente (con fecha y
 * fuente) + histórico + formulario para registrar una nueva. Nunca convierte
 * ningún saldo: la posición de arriba (PositionTile) ya muestra el USD por
 * separado con la conversión ANOTADA ("≈ ... tasa X"), nunca sumada al NIO
 * sin decirlo — este panel es de dónde sale esa tasa.
 */
export function ExchangeRatePanel({ onSaved }: { onSaved?: () => void }) {
  const [latestExchangeRate, setLatest] = useState<ExchangeRateRow | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<ExchangeRateRow[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [rate, setRate] = useState("");
  const [source, setSource] = useState<"MANUAL" | "BANK_RECEIPT">("MANUAL");
  const [saving, setSaving] = useState(false);

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const res = await apiFetch("/api/master/treasury/exchange-rates?fromCurrency=USD&toCurrency=NIO");
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo cargar el histórico.");
      const rows = unwrapApiData(raw) as ExchangeRateRow[];
      setHistory(rows);
      setLatest(rows[0] ?? null); // la API ordena de la más reciente a la más vieja
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cargar el histórico.");
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => { void loadHistory(); }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const rateNumber = Number(rate);
    if (!(rateNumber > 0)) { toast.error("La tasa debe ser mayor que 0."); return; }
    setSaving(true);
    try {
      const res = await apiFetch("/api/master/treasury/exchange-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromCurrency: "USD", toCurrency: "NIO", rate: rateNumber, source }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo registrar la tasa.");
      toast.success(`Tasa registrada: 1 USD = ${rateNumber} NIO.`);
      setRate("");
      setShowForm(false);
      void loadHistory();
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo registrar la tasa.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            <ArrowLeftRight className="h-3 w-3" /> Tipo de cambio (USD → NIO)
          </div>
          {latestExchangeRate ? (
            <p className="mt-1 text-sm text-[var(--color-text)]">
              <span className="text-lg font-bold tabular-nums">1 USD = {latestExchangeRate.rate} NIO</span>
              <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                vigente desde {fmtRateDate(latestExchangeRate.effectiveAt)} · {RATE_SOURCE_LABEL[latestExchangeRate.source] ?? latestExchangeRate.source}
              </span>
            </p>
          ) : (
            <p className="mt-1 text-sm font-semibold text-[var(--color-warning-700)]">Sin tasa registrada: los dólares contados en caja no entran en la diferencia y el efectivo en USD se muestra sin convertir.</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowHistory((v) => !v)}
          >
            {showHistory ? "Ocultar histórico" : "Ver histórico"}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => setShowForm((v) => !v)}>Registrar tasa</Button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3">
          <label className="text-xs font-semibold text-[var(--color-text-muted)]">
            1 USD =
            <Input type="number" step="0.0001" min="0.0001" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="36.60" className="mt-1 w-28" required />
          </label>
          <label className="text-xs font-semibold text-[var(--color-text-muted)]">
            Fuente
            <select className="hm-input mt-1" value={source} onChange={(e) => setSource(e.target.value as "MANUAL" | "BANK_RECEIPT")}>
              <option value="MANUAL">Manual</option>
              <option value="BANK_RECEIPT">Comprobante bancario</option>
            </select>
          </label>
          <Button type="submit" variant="success" size="sm" loading={saving}>Guardar</Button>
        </form>
      )}

      {showHistory && (
        <div className="mt-3 border-t border-[var(--color-border)] pt-3">
          {loadingHistory ? (
            <p className="text-xs text-[var(--color-text-muted)]">Cargando…</p>
          ) : !history || history.length === 0 ? (
            <p className="text-xs text-[var(--color-text-muted)]">Sin tasas registradas todavía.</p>
          ) : (
            <div className="space-y-1">
              {history.map((r) => (
                <div key={r.id} className="flex items-center justify-between text-xs">
                  <span className="text-[var(--color-text-muted)]">
                    {fmtRateDate(r.effectiveAt)} · {RATE_SOURCE_LABEL[r.source] ?? r.source} · {r.createdBy?.fullName ?? r.createdBy?.username ?? "—"}
                  </span>
                  <span className="font-mono font-semibold tabular-nums text-[var(--color-text)]">{r.rate}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
