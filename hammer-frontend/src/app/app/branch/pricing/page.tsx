"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Search, Send, X } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { getActiveBranchId } from "@/lib/client/active-branch";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import toast from "react-hot-toast";

/**
 * Fase 4 (prompt-motor-precios-lote-herencia-gobierno.md) — la sucursal
 * ajusta libre DENTRO de la banda de su categoría; lo que se pasa sale a
 * aprobación. El margen se muestra EN VIVO mientras se escribe, con el
 * mínimo marcado, y el botón cambia de "Guardar precio" a "Pedir
 * aprobación" ANTES de tocarlo — un rechazo después de enviar se siente
 * arbitrario, un botón que cambia solo enseña dónde está la banda.
 */

type ProductOption = { id: string; sku: string; name: string };
type PricingContext = {
  productId: string;
  productSku: string;
  productName: string;
  branchId: string;
  currentPrice: number | null;
  effectiveCost: number | null;
  minMarginPercent: number;
  targetMarginPercent: number;
};
type SetPriceResult =
  | { path: "IN_BAND"; applied: true; marginPercent: number; minMarginPercent: number; previousPrice: number | null; newPrice: number }
  | { path: "APPROVAL_REQUESTED"; applied: false; marginPercent: number; minMarginPercent: number; requestId: string; requestCreated: boolean };

const fmt = (v: number | null) => (v === null ? "—" : `C$${v.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export default function BranchPricingPage() {
  const sessionState = useSession();
  const branchId = sessionState.status === "authenticated"
    ? getActiveBranchId(sessionState.session.branchIds, sessionState.session.primaryBranchId)
    : null;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ProductOption | null>(null);
  const [context, setContext] = useState<PricingContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [priceInput, setPriceInput] = useState("");
  const [reasonInput, setReasonInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<SetPriceResult | null>(null);

  const search = useCallback(async () => {
    if (!query.trim() || !branchId) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await apiFetch(`/api/catalog/products?q=${encodeURIComponent(query.trim())}&branchId=${branchId}`);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo buscar productos.");
      const data = unwrapApiData(raw);
      setResults(Array.isArray(data) ? (data as ProductOption[]).slice(0, 15) : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo buscar productos.");
    } finally {
      setSearching(false);
    }
  }, [query, branchId]);

  useEffect(() => {
    const t = setTimeout(() => { void search(); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadContext = useCallback(async (productId: string) => {
    if (!branchId) return;
    setLoadingContext(true);
    setLastResult(null);
    try {
      const res = await apiFetch(`/api/branch/pricing/product-context?branchId=${branchId}&productId=${productId}`);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo cargar el precio.");
      const data = unwrapApiData(raw) as PricingContext;
      setContext(data);
      setPriceInput(data.currentPrice !== null ? data.currentPrice.toFixed(2) : "");
      setReasonInput("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cargar el precio.");
    } finally {
      setLoadingContext(false);
    }
  }, [branchId]);

  function selectProduct(p: ProductOption) {
    setSelected(p);
    setResults([]);
    setQuery(`${p.sku} — ${p.name}`);
    void loadContext(p.id);
  }

  const priceNumber = Number(priceInput) || 0;
  const cost = context?.effectiveCost ?? null;
  const liveMarginPercent = cost !== null && cost > 0 && priceNumber > 0 ? ((priceNumber - cost) / priceNumber) * 100 : null;
  const minMargin = context?.minMarginPercent ?? null;
  const belowBand = liveMarginPercent !== null && minMargin !== null && liveMarginPercent < minMargin;

  async function submit() {
    if (!context || !branchId || priceNumber <= 0) return;
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/branch/pricing/set-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: context.productId, branchId, price: priceNumber, reason: reasonInput.trim() || undefined }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo guardar el precio.");
      const result = unwrapApiData(raw) as SetPriceResult;
      setLastResult(result);
      if (result.path === "IN_BAND") {
        toast.success(`Precio guardado: ${fmt(result.newPrice)}.`);
        void loadContext(context.productId);
      } else {
        toast.success(result.requestCreated ? "Solicitud de aprobación enviada a Master." : "Ya había una solicitud pendiente para este producto.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar el precio.");
    } finally {
      setSubmitting(false);
    }
  }

  if (sessionState.status === "loading" || (!branchId && sessionState.status === "authenticated")) {
    return <p className="text-[var(--color-text-muted)] animate-pulse">Cargando…</p>;
  }
  if (sessionState.status !== "authenticated" || !branchId) {
    return <p className="text-[var(--color-danger-600)]">No tienes una sucursal asignada.</p>;
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-8 w-1 rounded-full" style={{ background: "var(--color-pay)" }} />
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-text)]">Precios</h1>
          <p className="text-sm text-[var(--color-text-muted)]">Ajustá dentro de la banda de tu categoría — lo que se pasa va a aprobación de Master.</p>
        </div>
      </div>

      <Card className="p-4">
        <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
          Buscar producto
          <div className="relative mt-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-soft)]" aria-hidden="true" />
            <Input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelected(null); setContext(null); }}
              placeholder="SKU o nombre del producto…"
              className="pl-9"
            />
          </div>
        </label>
        {results.length > 0 && !selected && (
          <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-[var(--color-border)]">
            {results.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => selectProduct(p)}
                className="block w-full border-b border-[var(--color-border)] px-3 py-2 text-left last:border-0 hover:bg-[var(--color-surface-alt)]"
              >
                <span className="block text-sm font-medium text-[var(--color-text)]">{p.name}</span>
                <span className="block text-xs text-[var(--color-text-soft)]">{p.sku}</span>
              </button>
            ))}
          </div>
        )}
        {searching && <p className="mt-2 text-xs text-[var(--color-text-muted)] animate-pulse">Buscando…</p>}
      </Card>

      {loadingContext && <p className="py-6 text-center text-sm text-[var(--color-text-muted)] animate-pulse">Cargando precio…</p>}

      {context && !loadingContext && (
        <Card className="space-y-4 p-4">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text)]">{context.productName}</p>
            <p className="text-xs text-[var(--color-text-soft)]">{context.productSku}</p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">Precio actual</p>
              <p className="font-mono font-semibold text-[var(--color-text)]">{fmt(context.currentPrice)}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">Costo efectivo</p>
              <p className="font-mono font-semibold text-[var(--color-text)]">{fmt(context.effectiveCost)}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">Margen mínimo de categoría</p>
              <p className="font-mono font-semibold text-[var(--color-text)]">{context.minMarginPercent.toFixed(1)}%</p>
            </div>
          </div>

          <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
            Precio nuevo
            <Input type="number" step="0.01" min="0.01" value={priceInput} onChange={(e) => setPriceInput(e.target.value)} className="mt-1" />
          </label>

          {/* §4.3 — margen EN VIVO, mientras se escribe */}
          {liveMarginPercent !== null && minMargin !== null && (
            <div>
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--color-surface-alt)]">
                <div
                  className={`h-full ${belowBand ? "bg-[var(--color-warning-500)]" : "bg-[var(--color-success-500)]"}`}
                  style={{ width: `${Math.max(0, Math.min(100, liveMarginPercent))}%` }}
                />
              </div>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className={belowBand ? "font-semibold text-[var(--color-warning-700)]" : "font-semibold text-[var(--color-success-700)]"}>
                  Margen: {liveMarginPercent.toFixed(1)}%
                </span>
                <span className="text-[var(--color-text-muted)]">Mínimo: {minMargin.toFixed(1)}%</span>
              </div>
            </div>
          )}

          {belowBand && (
            <p className="flex items-start gap-1.5 rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-3 py-2 text-xs text-[var(--color-warning-700)]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Este precio queda bajo el margen mínimo de tu categoría. Se envía como solicitud de aprobación a Master en vez de aplicarse directo.</span>
            </p>
          )}

          <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
            Motivo (opcional{belowBand ? " — ayuda a Master a decidir" : ""})
            <Input value={reasonInput} onChange={(e) => setReasonInput(e.target.value)} placeholder="Competencia local, cliente mayorista…" className="mt-1" />
          </label>

          <Button
            type="button"
            variant={belowBand ? "secondary" : "success"}
            className="w-full"
            disabled={priceNumber <= 0}
            loading={submitting}
            icon={belowBand ? <Send className="h-4 w-4" /> : <Check className="h-4 w-4" />}
            onClick={() => void submit()}
          >
            {belowBand ? "Pedir aprobación" : "Guardar precio"}
          </Button>

          {lastResult && (
            <p className={["flex items-center gap-1.5 text-xs", lastResult.path === "IN_BAND" ? "text-[var(--color-success-700)]" : "text-[var(--color-warning-700)]"].join(" ")}>
              {lastResult.path === "IN_BAND" ? <Check className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
              {lastResult.path === "IN_BAND"
                ? `Aplicado — margen ${lastResult.marginPercent.toFixed(1)}%.`
                : `Solicitud enviada — margen pedido ${lastResult.marginPercent.toFixed(1)}%, mínimo ${lastResult.minMarginPercent.toFixed(1)}%.`}
            </p>
          )}
        </Card>
      )}

      {selected && !context && !loadingContext && (
        <Button type="button" variant="ghost" size="sm" onClick={() => { setSelected(null); setQuery(""); }} icon={<X className="h-4 w-4" />}>
          Limpiar selección
        </Button>
      )}
    </section>
  );
}
