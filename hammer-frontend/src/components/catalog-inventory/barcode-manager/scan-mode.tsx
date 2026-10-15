"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import type { Route } from "next";
import toast from "react-hot-toast";
import { AlertTriangle, Camera, Check, Pencil, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CameraScanner } from "@/components/scanner/camera-scanner";
import { useCameraAvailable } from "@/lib/client/use-camera-available";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money, qty } from "@/lib/format";
import {
  classifyKeystrokeBurst,
  SHORTCUT_CONFIRM_DELAY_MS,
  type BarcodeKind,
} from "@/lib/barcode-manager-logic";

/**
 * prompt-codigos-editar-eliminar.md Fase 3.2 — "Escanear" (modo principal
 * de la pantalla nueva). Código registrado → tarjeta con acciones; código
 * no registrado → sugerencias "¿podría ser este producto?" (Fase 2) con
 * atajos de teclado y "Es nuevo" (navega al alta rápida con el código ya
 * puesto — más simple que un panel embebido, con el mismo resultado).
 */

type ProductByCodeResult = { id: string; name: string; sku: string; barcode: string | null; unit: string; standardSalePrice: string | number; isActive: boolean; category: { id: string; code: string; name: string } };
type BarcodeRow = { id: string; code: string; kind: BarcodeKind; isPrimary: boolean };
type SuggestionReason = { code: string; text: string };
type SuggestionCard = { productId: string; name: string; sku: string; unit: string; categoryName: string; stockInBranch: number; hasBarcode: boolean; score: number; reasons: SuggestionReason[] };
type PossibleDuplicate = { id: string; name: string; sku: string };
type RecentLink = { productId: string; name: string; sku: string; barcodeId: string; code: string };

export function ScanMode({ branchId }: { branchId: string }) {
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [foundProduct, setFoundProduct] = useState<ProductByCodeResult | null>(null);
  const [foundBarcodes, setFoundBarcodes] = useState<BarcodeRow[]>([]);
  const [notFoundCode, setNotFoundCode] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionCard[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [recentLinked, setRecentLinked] = useState<RecentLink[]>([]);
  const [possibleDuplicates, setPossibleDuplicates] = useState<PossibleDuplicate[]>([]);
  const [showCamera, setShowCamera] = useState(false);
  const cameraAvailable = useCameraAvailable();
  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const keyBuffer = useRef<{ keys: Array<{ key: string; timestampMs: number }>; fieldWasEmptyAtStart: boolean; timer: number | null }>({ keys: [], fieldWasEmptyAtStart: false, timer: null });

  function resetResult() {
    setFoundProduct(null);
    setFoundBarcodes([]);
    setNotFoundCode(null);
    setSuggestions([]);
    setQuery("");
    setPossibleDuplicates([]);
  }

  async function lookupCode(rawCode: string) {
    const trimmed = rawCode.trim();
    if (!trimmed || checking) return;
    setChecking(true);
    resetResult();
    try {
      const res = await apiFetch(`/api/catalog/products/by-code?code=${encodeURIComponent(trimmed)}`);
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "Error al buscar el código.");
      const data = unwrapApiData(raw) as { product: ProductByCodeResult | null };
      if (data.product) {
        setFoundProduct(data.product);
        const bRes = await apiFetch(`/api/catalog/products/${data.product.id}/barcodes`);
        const bRaw = await bRes.json().catch(() => null);
        if (bRes.ok) setFoundBarcodes(unwrapApiData(bRaw) as BarcodeRow[]);
      } else {
        setNotFoundCode(trimmed);
        await loadSuggestions(trimmed, "");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al buscar el código.");
    } finally {
      setChecking(false);
    }
  }

  async function loadSuggestions(forCode: string, q: string) {
    setSuggestLoading(true);
    try {
      const params = new URLSearchParams({ code: forCode, branchId });
      if (q.trim()) params.set("q", q.trim());
      const recentIds = recentLinked.map((r) => r.productId).slice(0, 3);
      if (recentIds.length > 0) params.set("recent", recentIds.join(","));
      const res = await apiFetch(`/api/catalog/barcodes/suggest?${params}`);
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudieron cargar las sugerencias.");
      setSuggestions((unwrapApiData(raw) as { suggestions: SuggestionCard[] }).suggestions);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudieron cargar las sugerencias.");
    } finally {
      setSuggestLoading(false);
    }
  }

  useEffect(() => {
    if (!notFoundCode) return;
    const timer = window.setTimeout(() => { void loadSuggestions(notFoundCode, query); }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function linkSuggestion(s: SuggestionCard, rank: number) {
    if (!notFoundCode) return;
    try {
      const res = await apiFetch(`/api/catalog/products/${s.productId}/barcodes`, {
        method: "POST",
        body: JSON.stringify({ code: notFoundCode, kind: "FACTORY", suggestion: { rank, reasons: s.reasons } }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo vincular.");
      const data = unwrapApiData(raw) as { id: string; code: string; possibleDuplicates: PossibleDuplicate[] };
      toast.success(`Vinculado a ${s.name}.`);
      setRecentLinked((prev) => [{ productId: s.productId, name: s.name, sku: s.sku, barcodeId: data.id, code: data.code }, ...prev].slice(0, 20));
      setPossibleDuplicates(data.possibleDuplicates);
      setCode("");
      setNotFoundCode(null);
      setSuggestions([]);
      setQuery("");
      requestAnimationFrame(() => codeInputRef.current?.focus());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo vincular.");
    }
  }

  async function undoLastLink() {
    const last = recentLinked[0];
    if (!last) return;
    try {
      const res = await apiFetch(`/api/catalog/products/${last.productId}/barcodes/${last.barcodeId}`, { method: "DELETE" });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo deshacer.");
      toast.success("Deshecho.");
      setRecentLinked((prev) => prev.slice(1));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo deshacer.");
    }
  }

  function handleCodeKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") { event.preventDefault(); void lookupCode(code); return; }

    if (event.key === "Escape" && notFoundCode) { event.preventDefault(); resetResult(); setCode(""); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); void undoLastLink(); return; }

    if (!notFoundCode || !/^[1-5n]$/i.test(event.key)) return;
    // "Cuidado con el lector USB" — ver classifyKeystrokeBurst (lib/barcode-manager-logic.ts).
    const buffer = keyBuffer.current;
    const fieldEmptyNow = code.length === 0;
    if (buffer.keys.length === 0) buffer.fieldWasEmptyAtStart = fieldEmptyNow;
    if (buffer.fieldWasEmptyAtStart) event.preventDefault(); // captura especulativa — se restaura abajo si resulta ser un escaneo.
    buffer.keys.push({ key: event.key, timestampMs: performance.now() });
    if (buffer.timer) window.clearTimeout(buffer.timer);
    buffer.timer = window.setTimeout(() => {
      const classification = classifyKeystrokeBurst({ keystrokes: buffer.keys, fieldWasEmptyAtStart: buffer.fieldWasEmptyAtStart });
      if (classification === "SHORTCUT") {
        runShortcut(buffer.keys[0].key);
      } else if (buffer.fieldWasEmptyAtStart) {
        // Era un código escaneado, no un atajo — se habían interceptado estas teclas: se restauran.
        setCode((prev) => prev + buffer.keys.map((k) => k.key).join(""));
      }
      buffer.keys = [];
    }, SHORTCUT_CONFIRM_DELAY_MS);
  }

  function runShortcut(key: string) {
    if (key.toLowerCase() === "n") { /* "Es nuevo" — el Link ya está en pantalla, este atajo solo podría enfocarlo; sin acción directa necesaria. */ return; }
    const index = Number(key) - 1;
    const suggestion = suggestions[index];
    if (suggestion) void linkSuggestion(suggestion, index + 1);
  }

  const bestReasonBadgeVariant = (i: number) => (i === 0 ? "success" : "neutral") as "success" | "neutral";

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          ref={codeInputRef}
          className="h-14 flex-1 font-mono text-lg"
          placeholder="Escaneá o tecleá el código…"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={handleCodeKeyDown}
          autoFocus
        />
        {cameraAvailable ? (
          <Button variant={showCamera ? "primary" : "ghost"} className="h-14 w-14" onClick={() => setShowCamera((v) => !v)}><Camera className="h-5 w-5" /></Button>
        ) : null}
      </div>
      {cameraAvailable && showCamera ? (
        <div className="max-w-sm"><CameraScanner onClose={() => setShowCamera(false)} onDecode={(raw) => { setCode(raw); void lookupCode(raw); }} /></div>
      ) : null}

      {checking ? <p className="text-sm text-[var(--color-text-muted)]">Buscando…</p> : null}

      {foundProduct ? (
        <div className="rounded-xl border-2 border-[var(--color-success-300)] bg-[var(--color-success-50)] p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-[var(--color-text)]">{foundProduct.name}</p>
              <p className="font-mono text-xs text-[var(--color-text-muted)]">{foundProduct.sku} · {foundProduct.category.name} · {money(Number(foundProduct.standardSalePrice))}</p>
            </div>
            <Link href={`/app/master/catalog-inventory/products/${foundProduct.id}` as Route} className="text-xs font-semibold text-[var(--color-master-700)] hover:underline">Ver producto →</Link>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {foundBarcodes.map((b) => (
              <Badge key={b.id} variant={b.isPrimary ? "success" : "neutral"}>{b.code}{b.isPrimary ? " · Ppal." : ""}</Badge>
            ))}
          </div>
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">Para editar, quitar, mover o imprimir sus códigos, abrí la ficha del producto → pestaña Códigos.</p>
        </div>
      ) : null}

      {notFoundCode ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
            <p className="text-sm font-semibold text-amber-800">Código {notFoundCode} no está registrado. ¿Es alguno de estos productos?</p>
          </div>

          {suggestLoading ? <p className="text-sm text-[var(--color-text-muted)]">Buscando sugerencias…</p> : null}

          <div className="space-y-2">
            {suggestions.map((s, i) => (
              <div key={s.productId} className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${i === 0 ? "border-[var(--color-success-400)] bg-[var(--color-success-50)]" : "border-[var(--color-border)]"}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[var(--color-text)]">{i + 1}. {s.name}</p>
                  <p className="font-mono text-xs text-[var(--color-text-muted)]">{s.sku} · {s.unit} · stock {qty(s.stockInBranch)}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {s.reasons.map((r, ri) => <Badge key={ri} variant={bestReasonBadgeVariant(i)}>{r.text}</Badge>)}
                  </div>
                </div>
                <Button size="sm" variant={i === 0 ? "success" : "secondary"} icon={<Check className="h-3.5 w-3.5" />} onClick={() => void linkSuggestion(s, i + 1)}>Vincular</Button>
              </div>
            ))}
            {!suggestLoading && suggestions.length === 0 ? <p className="text-sm text-[var(--color-text-muted)]">Sin sugerencias para este código.</p> : null}
          </div>

          <Input className="h-11" placeholder="Otro producto: escribí parte del nombre…" value={query} onChange={(e) => setQuery(e.target.value)} />

          <div className="flex flex-wrap gap-2">
            <Link
              href={`/app/master/catalog/products/quick-add?mode=REGISTER&code=${encodeURIComponent(notFoundCode)}` as Route}
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-[var(--color-master-300)] bg-[var(--color-master-50)] px-4 text-sm font-semibold text-[var(--color-master-700)] hover:bg-[var(--color-master-100)]"
            >
              <Plus className="h-4 w-4" /> Es nuevo → crearlo
            </Link>
            <Button variant="ghost" icon={<X className="h-4 w-4" />} onClick={() => { resetResult(); setCode(""); }}>Ignorar</Button>
          </div>
        </div>
      ) : null}

      {possibleDuplicates.length > 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="font-semibold">Posible duplicado: este producto se parece a {possibleDuplicates.map((d) => d.name).join(", ")}.</p>
          <Link href="/app/master/catalog-inventory?tab=duplicates" className="font-semibold underline">Revisar duplicado →</Link>
        </div>
      ) : null}

      {recentLinked.length > 0 ? (
        <div className="rounded-lg border border-[var(--color-border)] p-3">
          <p className="mb-2 text-xs font-semibold text-[var(--color-text-muted)]">Vinculados en esta sesión</p>
          <div className="space-y-1">
            {recentLinked.map((r) => (
              <div key={r.barcodeId} className="flex items-center justify-between gap-2 text-sm">
                <span><span className="font-mono text-xs">{r.code}</span> → {r.name}</span>
                <Link href={`/app/master/catalog-inventory/products/${r.productId}` as Route} className="hm-icon-btn h-7 w-7" title="Editar"><Pencil className="h-3.5 w-3.5" /></Link>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
