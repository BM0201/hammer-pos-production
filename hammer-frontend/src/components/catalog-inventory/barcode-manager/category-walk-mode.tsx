"use client";

import { useState, type KeyboardEvent } from "react";
import toast from "react-hot-toast";
import { ArrowDown, ArrowUp, Camera, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CameraScanner } from "@/components/scanner/camera-scanner";
import { useCameraAvailable } from "@/lib/client/use-camera-available";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { qty } from "@/lib/format";
import {
  initCategoryWalk, currentCategoryWalkProduct, skipCategoryWalk, retreatCategoryWalk,
  assignCategoryWalkCode, categoryWalkProgress, categoryWalkBrandMismatchWarning,
  type CategoryWalkState, type SuggestionLike,
} from "@/lib/barcode-manager-logic";

type Category = { id: string; name: string };
type Branch = { id: string; name: string; code?: string | null };
type CategoryWalkCandidate = { productId: string; name: string; sku: string; stockInBranch: number };

/**
 * prompt-codigos-editar-eliminar.md Fase 3.2 — "Recorrer por categoría":
 * para etiquetar un anaquel entero. Elegís categoría y sucursal, el primero
 * (más stock) queda resaltado, lo escaneás y pasa al siguiente.
 */
export function CategoryWalkMode({ categories, branches }: { categories: Category[]; branches: Branch[] }) {
  const [categoryId, setCategoryId] = useState("");
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<CategoryWalkState | null>(null);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<{ code: string; warning: string } | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const cameraAvailable = useCameraAvailable();

  async function startWalk() {
    if (!categoryId || !branchId) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/catalog/barcodes/category-walk?categoryId=${categoryId}&branchId=${branchId}`);
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo cargar la categoría.");
      const data = unwrapApiData(raw) as CategoryWalkCandidate[];
      setState(initCategoryWalk(data));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cargar la categoría.");
    } finally {
      setLoading(false);
    }
  }

  async function assignCode(rawCode: string, skipMismatchCheck = false) {
    const trimmed = rawCode.trim();
    if (!trimmed || !state || submitting) return;
    const current = currentCategoryWalkProduct(state);
    if (!current) return;

    if (!skipMismatchCheck) {
      try {
        const res = await apiFetch(`/api/catalog/barcodes/suggest?code=${encodeURIComponent(trimmed)}`);
        const raw = await res.json().catch(() => null);
        if (res.ok) {
          const data = unwrapApiData(raw) as { suggestions: SuggestionLike[] };
          const warning = categoryWalkBrandMismatchWarning(current.productId, current.name, data.suggestions);
          if (warning) { setPendingConfirm({ code: trimmed, warning }); return; }
        }
      } catch { /* si la verificación falla, se sigue igual — no bloquea el flujo principal. */ }
    }

    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/catalog/products/${current.productId}/barcodes`, { method: "POST", body: JSON.stringify({ code: trimmed, kind: "FACTORY" }) });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo asignar el código.");
      toast.success(`${current.name} — código asignado.`);
      setState((prev) => (prev ? assignCategoryWalkCode(prev) : prev));
      setCode("");
      setPendingConfirm(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo asignar el código.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleCodeKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") { event.preventDefault(); void assignCode(code); }
  }

  const current = state ? currentCategoryWalkProduct(state) : null;
  const progress = state ? categoryWalkProgress(state) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className="hm-input h-10 w-56" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Elegí una categoría…</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="hm-input h-10 w-44" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.code ?? b.name}</option>)}
        </select>
        <Button size="sm" variant="primary" loading={loading} disabled={!categoryId || !branchId} onClick={() => void startWalk()}>Empezar</Button>
      </div>

      {state ? (
        state.products.length === 0 ? (
          <p className="rounded-lg border border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-text-muted)]">Todos los productos de esta categoría ya tienen código.</p>
        ) : !current ? (
          <p className="rounded-lg border border-[var(--color-success-300)] bg-[var(--color-success-50)] p-6 text-center text-sm font-semibold text-[var(--color-success-700)]">¡Listo! Terminaste esta categoría.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)]">
              <span>Progreso: {progress!.done} / {progress!.total}</span>
              <div className="h-1.5 w-40 overflow-hidden rounded-full bg-[var(--color-surface-alt)]">
                <div className="h-full rounded-full bg-[var(--color-master-600)]" style={{ width: `${(progress!.done / Math.max(1, progress!.total)) * 100}%` }} />
              </div>
            </div>

            <div className="rounded-xl border-2 border-[var(--color-master-400)] bg-[var(--color-master-50)] p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-master-600)]">Resaltado</p>
              <p className="mt-1 text-lg font-semibold text-[var(--color-text)]">{current.name}</p>
              <p className="font-mono text-xs text-[var(--color-text-muted)]">{current.sku} · stock {qty(current.stockInBranch)}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Input className="h-11 flex-1 min-w-[220px] font-mono" placeholder="Escaneá el código para asignarlo" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={handleCodeKeyDown} disabled={submitting} autoFocus />
              {cameraAvailable ? <Button variant={showCamera ? "primary" : "ghost"} className="h-11" icon={<Camera className="h-4 w-4" />} onClick={() => setShowCamera((v) => !v)}>Cámara</Button> : null}
              <Button variant="ghost" className="h-11" icon={<ArrowUp className="h-4 w-4" />} onClick={() => setState((s) => (s ? retreatCategoryWalk(s) : s))} disabled={submitting}>Volver</Button>
              <Button variant="ghost" className="h-11" icon={<ArrowDown className="h-4 w-4" />} onClick={() => setState((s) => (s ? skipCategoryWalk(s) : s))} disabled={submitting}>Saltar</Button>
            </div>
            {cameraAvailable && showCamera ? (
              <div className="max-w-sm"><CameraScanner onClose={() => setShowCamera(false)} onDecode={(raw) => { setCode(raw); void assignCode(raw); }} /></div>
            ) : null}
          </div>
        )
      ) : null}

      {pendingConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl">
            <h3 className="text-sm font-semibold text-[var(--color-warning-700)]">{pendingConfirm.warning}</h3>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPendingConfirm(null)}>Cancelar</Button>
              <Button variant="success" icon={<Check className="h-4 w-4" />} onClick={() => void assignCode(pendingConfirm.code, true)}>Sí, es ese producto</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
