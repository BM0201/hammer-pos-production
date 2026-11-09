"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import toast from "react-hot-toast";
import { Copy, AlertTriangle, Check, X, ChevronRight, ChevronLeft, Loader2, RefreshCw, Search, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { qty, fmtDateTimeShort } from "@/lib/format";

/**
 * prompt-codigos-y-duplicados.md Fase 4 — pantalla de posibles duplicados
 * + asistente de unificación (4 pasos: elegir principal, revisar, confirmar,
 * resultado). Las sugerencias NUNCA se auto-aplican — un Master decide acá
 * fusionar (reusa Fase 3, product-merge-service.ts vía sus rutas) o
 * descartar el par ("no son el mismo producto"), y puede deshacer un descarte.
 */

type DuplicateProduct = {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  categoryName?: string;
  unit: string;
  barcode: string | null;
  totalStock: number;
  createdAt: string;
};
type DuplicateConfidence = "HIGH" | "MEDIUM" | "LOW";
type DuplicatePair = {
  productA: DuplicateProduct;
  productB: DuplicateProduct;
  similarity: number;
  confidence: DuplicateConfidence;
  reason: string;
  suggestedPrimaryId: string;
};
type DismissedPair = {
  productAId: string;
  productBId: string;
  productAName: string;
  productASku: string;
  productBName: string;
  productBSku: string;
  dismissedAt: string;
  dismissedByName: string;
  reason: string | null;
};

type MergeBlocker = { code: string; message: string };
type MergeWarning = { code: string; message: string };
type MergePlanLine = { relation: string; label: string; kind: string; count: number; conflictCount?: number };
type MergePreview = {
  survivingProductId: string;
  mergedProductId: string;
  survivingSku: string;
  survivingName: string;
  mergedSku: string;
  mergedName: string;
  blockers: MergeBlocker[];
  warnings: MergeWarning[];
  plan: MergePlanLine[];
  canExecute: boolean;
};

const CONFIDENCE_META: Record<DuplicateConfidence, { label: string; hint: string; badge: "success" | "warning" | "neutral" }> = {
  HIGH: { label: "Casi seguro", hint: "Mismas palabras o solo errores de tipeo", badge: "success" },
  MEDIUM: { label: "Probable", hint: "Uno de los dos dice algo de más", badge: "warning" },
  LOW: { label: "Dudoso", hint: "Parece una marca o variante distinta", badge: "neutral" },
};
type Filter = "ALL" | DuplicateConfidence | "DISMISSED";

type PairIds = { productA: { id: string }; productB: { id: string } };
const samePair = (a: PairIds, b: PairIds) => a.productA.id === b.productA.id && a.productB.id === b.productB.id;

export function DuplicatesPanel({ onMerged }: { onMerged?: () => void }) {
  const [pairs, setPairs] = useState<DuplicatePair[] | null>(null);
  const [dismissed, setDismissed] = useState<DismissedPair[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [wizardPair, setWizardPair] = useState<DuplicatePair | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");

  // fresh: salta la caché de 60 s del GET (después de restaurar o fusionar, o con "Actualizar").
  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const init = fresh ? { cache: "no-store" as const } : {};
      const [pairsRes, dismissedRes] = await Promise.all([
        apiFetch("/api/master/catalog/products/duplicates", init),
        apiFetch("/api/master/catalog/products/duplicates/dismiss", init),
      ]);
      const raw = await pairsRes.json();
      if (!pairsRes.ok) throw new Error(raw?.error?.message ?? "No se pudieron cargar los posibles duplicados.");
      setPairs(unwrapApiData(raw) as DuplicatePair[]);
      const rawDismissed = dismissedRes.ok ? await dismissedRes.json() : null;
      setDismissed(rawDismissed ? (unwrapApiData(rawDismissed) as DismissedPair[]) : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudieron cargar los posibles duplicados.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<DuplicateConfidence, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const p of pairs ?? []) c[p.confidence] += 1;
    return c;
  }, [pairs]);

  const visiblePairs = useMemo(() => {
    const words = query.trim().toUpperCase().split(/\s+/).filter(Boolean);
    return (pairs ?? []).filter((p) => {
      if (filter !== "ALL" && p.confidence !== filter) return false;
      if (words.length === 0) return true;
      const text = `${p.productA.name} ${p.productA.sku} ${p.productB.name} ${p.productB.sku}`.toUpperCase();
      return words.every((w) => text.includes(w));
    });
  }, [pairs, filter, query]);

  async function handleDismiss(pair: DuplicatePair) {
    const key = `${pair.productA.id}:${pair.productB.id}`;
    setBusyKey(key);
    try {
      const res = await apiFetch("/api/master/catalog/products/duplicates/dismiss", {
        method: "POST",
        body: JSON.stringify({ productAId: pair.productA.id, productBId: pair.productB.id }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo descartar el par.");
      toast.success("Descartado — lo podés restaurar en Descartados.");
      setPairs((prev) => prev?.filter((p) => !samePair(p, pair)) ?? null);
      setDismissed((prev) => [{
        productAId: pair.productA.id, productBId: pair.productB.id,
        productAName: pair.productA.name, productASku: pair.productA.sku,
        productBName: pair.productB.name, productBSku: pair.productB.sku,
        dismissedAt: new Date().toISOString(), dismissedByName: "vos", reason: null,
      }, ...(prev ?? [])]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo descartar el par.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRestore(row: DismissedPair) {
    const key = `${row.productAId}:${row.productBId}`;
    setBusyKey(key);
    try {
      const res = await apiFetch("/api/master/catalog/products/duplicates/dismiss", {
        method: "DELETE",
        body: JSON.stringify({ productAId: row.productAId, productBId: row.productBId }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo restaurar el par.");
      toast.success("Restaurado — si todavía se parecen, vuelven a la lista.");
      await load(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo restaurar el par.");
    } finally {
      setBusyKey(null);
    }
  }

  const filterChips: Array<{ key: Filter; label: string; count: number; title?: string }> = [
    { key: "ALL", label: "Todos", count: pairs?.length ?? 0 },
    ...(["HIGH", "MEDIUM", "LOW"] as const).map((k) => ({ key: k, label: CONFIDENCE_META[k].label, count: counts[k], title: CONFIDENCE_META[k].hint })),
    { key: "DISMISSED", label: "Descartados", count: dismissed?.length ?? 0, title: "Pares marcados como \"no son el mismo\"" },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden shadow-sm">
        <div className="hm-card-header-amber px-4 py-3 flex flex-wrap items-center justify-between gap-2 sm:px-5">
          <div className="flex items-center gap-2">
            <Copy className="h-5 w-5" />
            <h2 className="font-semibold">Posibles duplicados</h2>
          </div>
          <Button size="sm" variant="ghost" icon={<RefreshCw className="h-4 w-4" />} loading={loading} onClick={() => void load(true)}>Actualizar</Button>
        </div>

        <div className="space-y-2 border-b border-[var(--color-border)] px-4 py-3 sm:px-5">
          <div className="flex flex-wrap gap-1.5">
            {filterChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                title={chip.title}
                aria-pressed={filter === chip.key}
                onClick={() => setFilter(chip.key)}
                className={`hm-chip min-h-[36px] ${filter === chip.key ? "border-[var(--color-master-600)] bg-[var(--color-master-50)] text-[var(--color-master-700)]" : ""}`}
              >
                {chip.label} <span className="font-mono">{chip.count}</span>
              </button>
            ))}
          </div>
          {filter !== "DISMISSED" ? (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <Input className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtrar por nombre o SKU" aria-label="Filtrar duplicados por nombre o SKU" />
            </div>
          ) : null}
        </div>

        {loading && !pairs ? (
          <p className="p-8 text-center text-sm text-[var(--color-text-muted)] animate-pulse">Buscando posibles duplicados…</p>
        ) : filter === "DISMISSED" ? (
          !dismissed || dismissed.length === 0 ? (
            <p className="p-8 text-center text-sm text-[var(--color-text-muted)]">No hay pares descartados.</p>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {dismissed.map((row) => {
                const key = `${row.productAId}:${row.productBId}`;
                return (
                  <div key={key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-medium text-[var(--color-text)]">{row.productAName} <span className="font-mono text-xs text-[var(--color-text-muted)]">{row.productASku}</span></p>
                      <p className="font-medium text-[var(--color-text)]">{row.productBName} <span className="font-mono text-xs text-[var(--color-text-muted)]">{row.productBSku}</span></p>
                      <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">Descartado por {row.dismissedByName} · {fmtDateTimeShort(row.dismissedAt)}{row.reason ? ` · ${row.reason}` : ""}</p>
                    </div>
                    <Button size="sm" variant="ghost" icon={<Undo2 className="h-4 w-4" />} loading={busyKey === key} disabled={busyKey === key} onClick={() => void handleRestore(row)}>
                      Restaurar
                    </Button>
                  </div>
                );
              })}
            </div>
          )
        ) : visiblePairs.length === 0 ? (
          <div className="p-8 text-center">
            <Copy className="h-10 w-10 mx-auto mb-3 text-[var(--color-text-muted)]" />
            <p className="text-sm font-medium text-[var(--color-text-secondary)]">
              {(pairs?.length ?? 0) === 0 ? "No se encontraron productos que parezcan duplicados" : "Ningún par coincide con el filtro"}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {visiblePairs.map((pair) => {
              const key = `${pair.productA.id}:${pair.productB.id}`;
              const meta = CONFIDENCE_META[pair.confidence];
              return (
                <div key={key} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={meta.badge} title={meta.hint}>{meta.label}</Badge>
                      <span className="text-xs text-[var(--color-text-muted)]">{Math.round(pair.similarity * 100)}% parecido</span>
                    </div>
                    {[pair.productA, pair.productB].map((p) => (
                      <div key={p.id} className="text-sm">
                        <Link href={`/app/master/catalog-inventory/products/${p.id}` as Route} className="font-medium text-[var(--color-text)] hover:underline">{p.name}</Link>
                        {p.id === pair.suggestedPrimaryId ? <span className="ml-1.5 text-[11px] font-semibold text-[var(--color-info-600)]">sugerido para quedar</span> : null}
                        <p className="text-xs text-[var(--color-text-muted)]">
                          <span className="font-mono">{p.sku}</span>{p.categoryName ? ` · ${p.categoryName}` : ""} · {p.unit} · stock {qty(p.totalStock)}{p.barcode ? "" : " · sin código"}
                        </p>
                      </div>
                    ))}
                    <p className="text-xs text-[var(--color-text-secondary)]">{pair.reason}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="primary" onClick={() => setWizardPair(pair)}>Unificar</Button>
                    <Button size="sm" variant="ghost" loading={busyKey === key} disabled={busyKey === key} onClick={() => void handleDismiss(pair)}>
                      No son el mismo
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {wizardPair && (
        <MergeWizard
          pair={wizardPair}
          onClose={() => setWizardPair(null)}
          onDone={() => {
            setWizardPair(null);
            // El fusionado queda inactivo: los otros pares donde aparecía ya no aplican.
            void load(true);
            onMerged?.();
          }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ── Asistente de unificación — 4 pasos ── */
/* ═══════════════════════════════════════════════════════════════════════════ */
type WizardStep = "CHOOSE_PRIMARY" | "REVIEW" | "CONFIRM" | "RESULT";

export function MergeWizard({ pair, onClose, onDone }: { pair: DuplicatePair; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<WizardStep>("CHOOSE_PRIMARY");
  const [survivingId, setSurvivingId] = useState(pair.suggestedPrimaryId);
  const [confirmUnitMismatch, setConfirmUnitMismatch] = useState(false);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [skuConfirmation, setSkuConfirmation] = useState("");
  const [reason, setReason] = useState("");
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<{ ok: true } | { ok: false; message: string } | null>(null);

  const survivor = survivingId === pair.productA.id ? pair.productA : pair.productB;
  const merged = survivingId === pair.productA.id ? pair.productB : pair.productA;

  const loadPreview = useCallback(async (unitMismatchConfirmed: boolean) => {
    setLoadingPreview(true);
    try {
      const res = await apiFetch("/api/master/catalog/products/merge/preview", {
        method: "POST",
        body: JSON.stringify({ survivingProductId: survivor.id, mergedProductId: merged.id, confirmUnitMismatch: unitMismatchConfirmed }),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo calcular la vista previa.");
      setPreview(unwrapApiData(raw) as MergePreview);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo calcular la vista previa.");
    } finally {
      setLoadingPreview(false);
    }
  }, [survivor.id, merged.id]);

  function goToReview() {
    setStep("REVIEW");
    void loadPreview(confirmUnitMismatch);
  }

  async function handleExecute() {
    if (!preview) return;
    setExecuting(true);
    try {
      const res = await apiFetch("/api/master/catalog/products/merge", {
        method: "POST",
        body: JSON.stringify({
          survivingProductId: survivor.id,
          mergedProductId: merged.id,
          confirmedMergedSku: skuConfirmation.trim(),
          confirmUnitMismatch,
          reason: reason.trim() || undefined,
        }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo unificar.");
      setResult({ ok: true });
      setStep("RESULT");
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : "No se pudo unificar." });
      setStep("RESULT");
    } finally {
      setExecuting(false);
    }
  }

  const unitMismatchBlocker = preview?.blockers.find((b) => b.code === "UNIT_MISMATCH");
  const otherBlockers = preview?.blockers.filter((b) => b.code !== "UNIT_MISMATCH") ?? [];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgb(28_25_23/0.45)] p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-[var(--shadow-modal)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Unificar productos duplicados"
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <h2 className="text-base font-bold text-[var(--color-text)]">Unificar productos duplicados</h2>
          <button onClick={onClose} className="hm-icon-btn" aria-label="Cerrar"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* ── Paso 1: elegir principal ── */}
          {step === "CHOOSE_PRIMARY" && (
            <div className="space-y-3">
              <p className="text-sm text-[var(--color-text-secondary)]">¿Cuál de los dos productos se queda? El otro pasa inactivo y redirige acá — su historial no se pierde.</p>
              {[pair.productA, pair.productB].map((p) => (
                <label
                  key={p.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border-2 p-3 ${survivingId === p.id ? "border-[var(--color-master-400)] bg-[var(--color-master-50)]" : "border-[var(--color-border)]"}`}
                >
                  <input type="radio" name="surviving" className="mt-1" checked={survivingId === p.id} onChange={() => setSurvivingId(p.id)} />
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-text)]">
                      {p.name} {p.id === pair.suggestedPrimaryId && <Badge variant="info">Sugerido</Badge>}
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)]">SKU {p.sku} · {p.unit} · stock {qty(p.totalStock)}{p.barcode ? ` · código ${p.barcode}` : " · sin código"}</p>
                  </div>
                </label>
              ))}
            </div>
          )}

          {/* ── Paso 2: revisar ── */}
          {step === "REVIEW" && (
            <div className="space-y-3">
              <p className="text-sm text-[var(--color-text-secondary)]">
                <strong>{survivor.name}</strong> sobrevive · <strong>{merged.name}</strong> queda inactivo y redirigido.
              </p>

              {loadingPreview ? (
                <p className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Calculando vista previa…</p>
              ) : preview ? (
                <>
                  {unitMismatchBlocker && (
                    <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-3">
                      <p className="flex items-start gap-2 text-sm font-semibold text-amber-800"><AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />{unitMismatchBlocker.message}</p>
                      <label className="mt-2 flex items-center gap-2 text-xs text-amber-800">
                        <input type="checkbox" checked={confirmUnitMismatch} onChange={(e) => { setConfirmUnitMismatch(e.target.checked); void loadPreview(e.target.checked); }} />
                        Confirmo que las cantidades son equivalentes
                      </label>
                    </div>
                  )}
                  {otherBlockers.map((b) => (
                    <div key={b.code} className="flex items-start gap-2 rounded-lg border-2 border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-700">
                      <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />{b.message}
                    </div>
                  ))}
                  {preview.warnings.map((w) => (
                    <div key={w.code} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />{w.message}
                    </div>
                  ))}

                  <div className="rounded-lg border border-[var(--color-border)] overflow-hidden">
                    <table className="w-full text-xs">
                      <tbody className="divide-y divide-[var(--color-border)]">
                        {preview.plan.filter((line) => line.count > 0).map((line) => (
                          <tr key={line.relation}>
                            <td className="px-3 py-1.5 text-[var(--color-text-secondary)]">{line.label}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{line.count}</td>
                          </tr>
                        ))}
                        {preview.plan.every((line) => line.count === 0) && (
                          <tr><td className="px-3 py-2 text-center text-[var(--color-text-muted)]">{merged.name} no tiene datos asociados que mover.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </div>
          )}

          {/* ── Paso 3: confirmar ── */}
          {step === "CONFIRM" && (
            <div className="space-y-3">
              <p className="text-sm text-[var(--color-text-secondary)]">
                Para confirmar, escribí el SKU exacto del producto que queda inactivo: <strong className="font-mono">{merged.sku}</strong>
              </p>
              <Input value={skuConfirmation} onChange={(e) => setSkuConfirmation(e.target.value)} placeholder={merged.sku} className="font-mono" />
              <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
                Motivo (opcional)
                <textarea className="hm-input mt-1 w-full" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej: se cargó dos veces por error" />
              </label>
            </div>
          )}

          {/* ── Paso 4: resultado ── */}
          {step === "RESULT" && result && (
            <div className="text-center py-4">
              {result.ok ? (
                <>
                  <Check className="h-10 w-10 mx-auto mb-3 text-[var(--color-success-600)]" />
                  <p className="text-sm font-semibold text-[var(--color-text)]">Unificado correctamente.</p>
                  <Link href={`/app/master/catalog-inventory/products/${survivor.id}` as Route} className="mt-2 inline-block text-sm text-[var(--color-info-600)] hover:underline">
                    Ver {survivor.name}
                  </Link>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-10 w-10 mx-auto mb-3 text-red-500" />
                  <p className="text-sm font-semibold text-red-700">{result.message}</p>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] px-5 py-4">
          {step !== "CHOOSE_PRIMARY" && step !== "RESULT" ? (
            <Button variant="ghost" icon={<ChevronLeft className="h-4 w-4" />} onClick={() => setStep(step === "CONFIRM" ? "REVIEW" : "CHOOSE_PRIMARY")}>
              Atrás
            </Button>
          ) : <span />}

          {step === "CHOOSE_PRIMARY" && (
            <Button variant="primary" icon={<ChevronRight className="h-4 w-4" />} onClick={goToReview}>Siguiente</Button>
          )}
          {step === "REVIEW" && (
            <Button variant="primary" icon={<ChevronRight className="h-4 w-4" />} disabled={!preview?.canExecute || loadingPreview} onClick={() => setStep("CONFIRM")}>
              Siguiente
            </Button>
          )}
          {step === "CONFIRM" && (
            <Button
              variant="danger"
              loading={executing}
              disabled={executing || skuConfirmation.trim().toUpperCase() !== merged.sku.toUpperCase()}
              onClick={() => void handleExecute()}
            >
              Unificar ahora
            </Button>
          )}
          {step === "RESULT" && (
            <Button variant="primary" onClick={result?.ok ? onDone : onClose}>
              {result?.ok ? "Listo" : "Cerrar"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
