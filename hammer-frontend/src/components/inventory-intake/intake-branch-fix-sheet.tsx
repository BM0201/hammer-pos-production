"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Check, Loader2, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money, qty } from "@/lib/format";

/**
 * prompt-entrada-reintento-precio.md Commit 2 §3 — "Editar IM-000008 ·
 * RIV": corrige SOLO las líneas pendientes de una sucursal FAILED, sobre la
 * MISMA entrada (no crea una nueva). Las líneas ya aplicadas
 * (index < processedLines) se muestran bloqueadas, nunca editables — ya
 * movieron inventario real, tocar sería crear datos sin movimiento. Es un
 * componente aparte de IntakeSheet (no un modo nuevo de ese archivo):
 * IntakeSheet existe para armar un pedido nuevo con vista previa real
 * producto por producto a través de varias sucursales; acá la sucursal, el
 * tipo y el motivo ya están fijos (vienen de la entrada que falló) y solo
 * hace falta corregir un puñado de líneas — reusar la máquina de vista
 * previa completa hubiera sido mucho más complejo que el problema real.
 */

export type FixSheetLine = { productId: string; quantity: number; unitCost?: number; salePrice?: number; unit?: string };
export type FixSheetAppliedLine = FixSheetLine & { product: { sku: string; name: string } | null };

type ProductSearchResult = { id: string; sku: string; name: string };

type EditableLine = FixSheetLine & { sku: string; name: string };

function toEditable(line: FixSheetLine, product: { sku: string; name: string } | null): EditableLine {
  return { ...line, sku: product?.sku ?? line.productId, name: product?.name ?? "(producto)" };
}

export function IntakeBranchFixSheet({
  intakeId,
  intakeCode,
  branchId,
  branchCode,
  branchName,
  appliedLines,
  pendingLines,
  revision,
  onClose,
  onDone,
}: {
  intakeId: string;
  intakeCode: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  appliedLines: FixSheetAppliedLine[];
  pendingLines: FixSheetAppliedLine[];
  revision: number;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [lines, setLines] = useState<EditableLine[]>(() => pendingLines.map((l) => toEditable(l, l.product)));
  const [currentRevision, setCurrentRevision] = useState(revision);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<ProductSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function runSearch(term: string) {
    setSearch(term);
    if (term.trim().length < 2) { setSearchResults([]); return; }
    setSearchLoading(true);
    try {
      const params = new URLSearchParams({ q: term.trim(), page: "1", limit: "8" });
      const response = await fetch(`/api/master/catalog-inventory?${params}`, { cache: "no-store" });
      const raw = await response.json().catch(() => null);
      if (!response.ok) return;
      const data = unwrapApiData(raw) as { products: ProductSearchResult[] };
      setSearchResults(data.products ?? []);
    } finally {
      setSearchLoading(false);
    }
  }

  function addProduct(product: ProductSearchResult) {
    if (lines.some((l) => l.productId === product.id)) { toast.error("Ese producto ya está en la lista."); return; }
    setLines((prev) => [...prev, { productId: product.id, sku: product.sku, name: product.name, quantity: 1, unitCost: undefined }]);
    setSearch("");
    setSearchResults([]);
    setShowDropdown(false);
  }

  function removeLine(productId: string) {
    setLines((prev) => prev.filter((l) => l.productId !== productId));
  }

  function updateLine(productId: string, patch: Partial<EditableLine>) {
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
  }

  async function submit() {
    if (lines.length === 0) { toast.error("Agregá al menos un producto pendiente."); return; }
    const invalid = lines.find((l) => !(l.quantity >= 0));
    if (invalid) { toast.error(`${invalid.name}: la cantidad no es válida.`); return; }

    setSubmitting(true);
    try {
      const body = {
        lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitCost: l.unitCost, salePrice: l.salePrice, unit: l.unit })),
        expectedRevision: currentRevision,
      };
      const putResponse = await apiFetch(`/api/inventory/multi-branch-intake/${intakeId}/branches/${branchId}/lines`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const putRaw = await putResponse.json().catch(() => null);
      if (!putResponse.ok) throw new Error(putRaw?.error?.message ?? "No se pudo guardar la corrección.");
      const putData = unwrapApiData(putRaw) as { revision: number };
      setCurrentRevision(putData.revision);

      const retryResponse = await apiFetch(`/api/inventory/multi-branch-intake/${intakeId}/retry`, { method: "POST" });
      const retryRaw = await retryResponse.json().catch(() => null);
      if (!retryResponse.ok) throw new Error(retryRaw?.error?.message ?? "Se guardó la corrección, pero no se pudo reintentar.");
      const retryData = unwrapApiData(retryRaw) as { branches: Array<{ branchId: string; status: string }> };
      const thisBranch = retryData.branches.find((b) => b.branchId === branchId);

      if (thisBranch?.status === "DONE") {
        toast.success(`${branchCode} quedó al día.`);
        await onDone();
        onClose();
      } else {
        toast.error(`${branchCode} sigue fallando — revisá el detalle y corregí de nuevo.`);
        await onDone();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo corregir la entrada.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/40 lg:items-center lg:p-4">
      <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--color-surface)] shadow-2xl lg:h-auto lg:max-h-[90vh] lg:max-w-3xl lg:rounded-xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold">Editar {intakeCode} · {branchCode}</h3>
            <p className="text-xs text-[var(--color-text-muted)]">{branchName} — corrige solo lo pendiente de esta entrada; lo ya aplicado no se toca.</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} icon={<X className="h-4 w-4" />}>Cerrar</Button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {appliedLines.length > 0 ? (
            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Ya aplicadas ({appliedLines.length}) — no se pueden editar</h4>
              <div className="space-y-1">
                {appliedLines.map((line) => (
                  <div key={line.productId} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-1.5 text-xs text-[var(--color-text-muted)]">
                    <span>{line.product?.name ?? line.productId} <span className="font-mono text-[10px]">{line.product?.sku}</span></span>
                    <span>{qty(line.quantity)}{line.unit ? ` ${line.unit}` : ""}{line.unitCost !== undefined ? ` · ${money(line.unitCost)}` : ""}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Pendientes ({lines.length}) — corregí lo que haga falta</h4>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <Input
                className="h-10 pl-9"
                value={search}
                onChange={(e) => void runSearch(e.target.value)}
                onFocus={() => setShowDropdown(true)}
                onBlur={() => setTimeout(() => setShowDropdown(false), 160)}
                placeholder="Agregar otro producto (ej. para reemplazar uno descartado)"
              />
              {showDropdown && search.trim().length >= 2 ? (
                <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-60 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
                  {searchLoading ? (
                    <div className="flex items-center gap-2 px-3 py-3 text-xs text-[var(--color-text-muted)]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando…</div>
                  ) : searchResults.length > 0 ? searchResults.map((product) => (
                    <button key={product.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => addProduct(product)} className="flex w-full items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2 text-left text-xs last:border-0 hover:bg-[var(--color-surface-alt)]">
                      <span className="truncate font-medium">{product.name}</span>
                      <span className="font-mono text-[10px] text-[var(--color-text-muted)]">{product.sku}</span>
                    </button>
                  )) : <div className="px-3 py-3 text-xs text-[var(--color-text-muted)]">Sin resultados.</div>}
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              {lines.map((line) => (
                <div key={line.productId} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs">
                  <div className="min-w-[160px] flex-1">
                    <div className="font-medium">{line.name}</div>
                    <div className="font-mono text-[10px] text-[var(--color-text-muted)]">{line.sku}</div>
                  </div>
                  <Input type="number" className="h-9 w-24" value={line.quantity} min={0} onChange={(e) => updateLine(line.productId, { quantity: Number(e.target.value) })} placeholder="Cantidad" />
                  <Input type="number" className="h-9 w-28" value={line.unitCost ?? ""} min={0} onChange={(e) => updateLine(line.productId, { unitCost: e.target.value === "" ? undefined : Number(e.target.value) })} placeholder="Costo" />
                  <button type="button" onClick={() => removeLine(line.productId)} className="hm-icon-btn h-9 w-9 text-[var(--color-danger-600)]" title="Quitar"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              {lines.length === 0 ? (
                <p className="rounded-lg border border-[var(--color-border)] p-4 text-center text-xs text-[var(--color-text-muted)]">Sin productos pendientes — buscá uno arriba para agregarlo.</p>
              ) : null}
            </div>
          </section>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="button" variant="success" loading={submitting} onClick={() => void submit()} icon={<Check className="h-4 w-4" />}>
            Ver vista previa y reintentar {branchCode}
          </Button>
        </div>
      </div>
    </div>
  );
}
