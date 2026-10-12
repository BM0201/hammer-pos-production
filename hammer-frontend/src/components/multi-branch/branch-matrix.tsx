"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Plus, RotateCcw, Search, Upload, X } from "lucide-react";
import toast from "react-hot-toast";
import { apiFetch, unwrapApiData, type ApiResponse } from "@/lib/client/api";
import { money, qty } from "@/lib/format";
import { CameraScanner } from "@/components/scanner/camera-scanner";
import { useCameraAvailable } from "@/lib/client/use-camera-available";
import { findExactProductMatch, looksLikeScannedCode } from "@/lib/pos-enter-resolution";
import {
  type MatrixLine,
  quantityForBranch,
  isOverridden,
  setForAll,
  setOverride,
  resetOverride,
  setCost,
  parseQuantityInput,
  addOrIncrementProduct,
  computeMatrixTotals,
  computeOriginShortfalls,
  parseMatrixTsvPaste,
  readRememberedBranchIds,
  writeRememberedBranchIds,
  type TsvPasteProduct,
} from "@/lib/multi-branch-matrix";

/**
 * Parte B.3 (prompt-completo-pendientes-2026-10.md) — un solo componente
 * para compras, ingresos y traslados. La pantalla que lo usa es dueña del
 * submit/preview/clientRequestId (cada una tiene su propio endpoint y
 * campos extra); este componente solo edita la matriz.
 */
export type BranchMatrixKind = "PURCHASE" | "INTAKE" | "TRANSFER";
export type BranchMatrixBranch = { id: string; code: string; name: string };
type SearchProduct = { id: string; sku: string; name: string; barcode?: string | null; barcodes?: string[]; cost?: number | null };

export type BranchMatrixProps = {
  kind: BranchMatrixKind;
  branches: BranchMatrixBranch[];
  selectedBranchIds: string[];
  onSelectedBranchIdsChange: (ids: string[]) => void;
  storageKey: string;
  lines: MatrixLine[];
  onLinesChange: (lines: MatrixLine[]) => void;
  /** default: true salvo TRANSFER (ahí el costo no aplica, se muestra stock del origen). */
  showCost?: boolean;
  /** TRANSFER: stock real del origen por producto, para avisar faltantes ANTES de enviar. */
  originStockByProductId?: Record<string, number>;
};

function getErr(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function BranchMatrix({
  kind,
  branches,
  selectedBranchIds,
  onSelectedBranchIdsChange,
  storageKey,
  lines,
  onLinesChange,
  showCost = kind !== "TRANSFER",
  originStockByProductId,
}: BranchMatrixProps) {
  const cameraAvailable = useCameraAvailable();
  const [showCamera, setShowCamera] = useState(false);
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<SearchProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasting, setPasting] = useState(false);
  const rememberedOnMount = useRef(false);

  const cellRefs = useRef<Record<string, Record<string, HTMLInputElement | null>>>({});

  // Recordar la selección de sucursales por tipo de documento (solo al montar, sin pisar lo que ya trae el padre).
  useEffect(() => {
    if (rememberedOnMount.current) return;
    rememberedOnMount.current = true;
    if (selectedBranchIds.length > 0) return;
    const remembered = readRememberedBranchIds(storageKey);
    if (remembered && remembered.length > 0) {
      const valid = remembered.filter((id) => branches.some((b) => b.id === id));
      if (valid.length > 0) onSelectedBranchIdsChange(valid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branches.length]);

  function selectBranches(ids: string[]) {
    onSelectedBranchIdsChange(ids);
    writeRememberedBranchIds(storageKey, ids);
  }

  function toggleBranch(id: string) {
    selectBranches(selectedBranchIds.includes(id) ? selectedBranchIds.filter((b) => b !== id) : [...selectedBranchIds, id]);
  }

  // Búsqueda con debounce — mismo endpoint que usa el resto del catálogo.
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setCandidates([]); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiFetch(`/api/catalog/products?q=${encodeURIComponent(q)}&isActive=true&limit=8`);
        const json = (await res.json()) as ApiResponse<SearchProduct[]>;
        if (!cancelled) setCandidates(Array.isArray(unwrapApiData(json)) ? unwrapApiData(json) : []);
      } catch {
        if (!cancelled) setCandidates([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search]);

  function addProduct(product: SearchProduct) {
    onLinesChange(addOrIncrementProduct(lines, { id: product.id, sku: product.sku, name: product.name, cost: product.cost ?? null }));
    setSearch("");
    setCandidates([]);
  }

  async function resolveAndAddCode(code: string) {
    const exactAmongCandidates = findExactProductMatch(code, candidates);
    if (exactAmongCandidates) { addProduct(exactAmongCandidates); return; }
    try {
      const res = await apiFetch(`/api/catalog/products?q=${encodeURIComponent(code)}&isActive=true&limit=5`);
      const json = (await res.json()) as ApiResponse<SearchProduct[]>;
      const found = Array.isArray(unwrapApiData(json)) ? unwrapApiData(json) : [];
      const exact = findExactProductMatch(code, found);
      if (exact) { addProduct(exact); return; }
      toast.error(`No se encontró ningún producto con el código "${code}".`);
    } catch (error) {
      toast.error(getErr(error, "Error al buscar el código."));
    }
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const text = search.trim();
    if (!text) return;
    e.preventDefault();
    if (looksLikeScannedCode(text) || candidates.length === 1) {
      void resolveAndAddCode(text);
    }
  }

  function updateLine(index: number, next: MatrixLine) {
    const copy = [...lines];
    copy[index] = next;
    onLinesChange(copy);
  }

  function removeLine(index: number) {
    onLinesChange(lines.filter((_, i) => i !== index));
  }

  function focusCell(rowIndex: number, colKey: string) {
    const target = cellRefs.current[String(rowIndex)]?.[colKey];
    target?.focus();
  }

  function handleCellKeyDown(e: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, colKey: string) {
    if (e.key === "Enter") {
      e.preventDefault();
      focusCell(rowIndex + 1, colKey);
    }
  }

  async function applyPaste() {
    const text = pasteText.trim();
    if (!text) return;
    setPasting(true);
    try {
      const codes = Array.from(new Set(text.split(/\r?\n/).map((row) => row.split("\t")[0]?.trim()).filter((c): c is string => !!c)));
      const pool: TsvPasteProduct[] = [];
      for (const code of codes) {
        try {
          const res = await apiFetch(`/api/catalog/products?q=${encodeURIComponent(code)}&isActive=true&limit=5`);
          const json = (await res.json()) as ApiResponse<SearchProduct[]>;
          const found = Array.isArray(unwrapApiData(json)) ? unwrapApiData(json) : [];
          pool.push(...found);
        } catch { /* ese código queda como no-encontrado, se reporta abajo */ }
      }
      const branchIdByCode: Record<string, string> = {};
      for (const b of branches) branchIdByCode[b.code.toUpperCase()] = b.id;
      const { matched, unmatchedCodes } = parseMatrixTsvPaste(text, pool, branchIdByCode);

      let next = lines;
      for (const row of matched) {
        const idx = next.findIndex((l) => l.productId === row.product.id);
        const base: MatrixLine = idx === -1
          ? { productId: row.product.id, sku: row.product.sku, name: row.product.name, cost: row.product.cost ?? null, forAll: 0, overrides: {} }
          : next[idx];
        const updated: MatrixLine = { ...base, forAll: row.forAll, overrides: { ...base.overrides, ...row.overrides } };
        next = idx === -1 ? [...next, updated] : next.map((l, i) => (i === idx ? updated : l));
      }
      onLinesChange(next);

      if (unmatchedCodes.length > 0) toast.error(`${unmatchedCodes.length} código(s) no encontrado(s): ${unmatchedCodes.join(", ")}`);
      else toast.success(`${matched.length} producto(s) cargado(s) desde el pegado.`);
      setPasteText("");
      setPasteOpen(false);
    } finally {
      setPasting(false);
    }
  }

  const totals = computeMatrixTotals(lines, selectedBranchIds);
  const shortfalls = kind === "TRANSFER" && originStockByProductId ? computeOriginShortfalls(lines, selectedBranchIds, originStockByProductId) : [];
  const shortfallByProductId = new Map(shortfalls.map((s) => [s.productId, s]));

  return (
    <div className="space-y-4">
      {/* Chips de sucursal */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--color-text-muted)]">Sucursales</span>
          <div className="flex gap-2 text-xs font-semibold text-[var(--color-master-600)]">
            <button type="button" onClick={() => selectBranches(branches.map((b) => b.id))} className="hover:underline">Todas</button>
            <button type="button" onClick={() => selectBranches([])} className="hover:underline">Ninguna</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {branches.map((b) => {
            const active = selectedBranchIds.includes(b.id);
            return (
              <label
                key={b.id}
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${active ? "border-[var(--color-master-600)] bg-[var(--color-master-50)] text-[var(--color-master-700)]" : "border-[var(--color-border)] text-[var(--color-text-muted)]"}`}
              >
                <input type="checkbox" className="hidden" checked={active} onChange={() => toggleBranch(b.id)} />
                {b.code} · {b.name}
              </label>
            );
          })}
        </div>
      </div>

      {/* Agregar productos: buscador + escáner cámara */}
      <div className="relative">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-soft)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Buscar o escanear código (lector USB funciona acá)..."
              className="hm-input h-11 w-full rounded-lg pl-8 text-sm"
              autoFocus
            />
            {candidates.length > 0 && (
              <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-modal)]">
                {candidates.map((p) => (
                  <button key={p.id} type="button" onClick={() => addProduct(p)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--color-surface-alt)]">
                    <span><span className="font-mono font-semibold">{p.sku}</span> <span className="text-[var(--color-text-secondary)]">{p.name}</span></span>
                    <Plus className="h-3.5 w-3.5 text-[var(--color-master-600)]" />
                  </button>
                ))}
              </div>
            )}
            {searching && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[0.65rem] text-[var(--color-text-soft)]">...</span>}
          </div>
          {cameraAvailable && (
            <button type="button" onClick={() => setShowCamera((v) => !v)} className="hm-icon-btn h-11 w-11" title="Escanear con cámara">
              <Camera className="h-4 w-4" />
            </button>
          )}
          <button type="button" onClick={() => setPasteOpen((v) => !v)} className="hm-icon-btn h-11 w-11" title="Pegar desde Excel">
            <Upload className="h-4 w-4" />
          </button>
        </div>
        {showCamera && (
          <div className="mt-2">
            <CameraScanner className="max-w-sm" onClose={() => setShowCamera(false)} onDecode={(rawText) => { void resolveAndAddCode(rawText); }} />
          </div>
        )}
        {pasteOpen && (
          <div className="mt-2 space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
            <p className="text-xs text-[var(--color-text-muted)]">Pegá columnas: código, cantidad para todas y, opcionalmente, una columna por sucursal con su código como encabezado.</p>
            <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={4} placeholder={"SKU-1\t10\nSKU-2\t5"} className="hm-input w-full rounded-lg font-mono text-xs" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setPasteOpen(false); setPasteText(""); }} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)]">Cancelar</button>
              <button type="button" onClick={applyPaste} disabled={pasting || !pasteText.trim()} className="rounded-lg bg-[var(--color-master-600)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{pasting ? "Procesando..." : "Aplicar"}</button>
            </div>
          </div>
        )}
      </div>

      {/* Tabla (≥1024) */}
      <div className="hidden overflow-x-auto rounded-xl border border-[var(--color-border-strong)] lg:block">
        <table className="hm-sheet-table">
          <thead>
            <tr>
              <th>Producto</th>
              {showCost && <th className="hm-num">Costo</th>}
              <th className="hm-num">Para todas</th>
              {selectedBranchIds.map((id) => <th key={id} className="hm-num">{branches.find((b) => b.id === id)?.code ?? id}</th>)}
              <th className="hm-num">Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, rowIndex) => {
              const shortfall = shortfallByProductId.get(line.productId);
              const rowTotal = selectedBranchIds.reduce((sum, id) => sum + quantityForBranch(line, id), 0);
              return (
                <tr key={line.productId}>
                  <td>
                    <span className="font-medium text-[var(--color-text)]">{line.name}</span>
                    <span className="ml-1 font-mono text-[0.68rem] text-[var(--color-text-muted)]">{line.sku}</span>
                    {shortfall && <div className="text-[0.7rem] font-semibold text-[var(--color-danger-600)]">Faltan {qty(shortfall.shortfall)} (stock origen: {qty(shortfall.available)})</div>}
                  </td>
                  {showCost && (
                    <td className="hm-num">
                      <input
                        type="number" min="0" step="0.01" value={line.cost ?? ""}
                        onChange={(e) => updateLine(rowIndex, setCost(line, e.target.value === "" ? null : Number(e.target.value)))}
                        className="hm-input h-9 w-24 rounded-lg text-right text-sm"
                      />
                    </td>
                  )}
                  <td className="hm-num">
                    <input
                      ref={(el) => { (cellRefs.current[String(rowIndex)] ??= {}).ALL = el; }}
                      type="text" defaultValue={String(line.forAll)}
                      onKeyDown={(e) => handleCellKeyDown(e, rowIndex, "ALL")}
                      onBlur={(e) => { const parsed = parseQuantityInput(e.target.value); if (parsed !== null) updateLine(rowIndex, setForAll(line, parsed)); else e.target.value = String(line.forAll); }}
                      className="hm-input h-9 w-20 rounded-lg text-right text-sm"
                    />
                  </td>
                  {selectedBranchIds.map((branchId) => {
                    const overridden = isOverridden(line, branchId);
                    const value = quantityForBranch(line, branchId);
                    return (
                      <td key={branchId} className="hm-num">
                        <div className="flex items-center justify-end gap-1">
                          <input
                            ref={(el) => { (cellRefs.current[String(rowIndex)] ??= {})[branchId] = el; }}
                            type="text" defaultValue={String(value)}
                            onKeyDown={(e) => handleCellKeyDown(e, rowIndex, branchId)}
                            onBlur={(e) => {
                              const parsed = parseQuantityInput(e.target.value);
                              if (parsed !== null) updateLine(rowIndex, setOverride(line, branchId, parsed));
                              else e.target.value = String(value);
                            }}
                            className={`hm-input h-9 w-16 rounded-lg text-right text-sm ${overridden ? "border-[var(--color-warning-400)] bg-[var(--color-warning-50)]" : ""} ${value === 0 ? "text-[var(--color-text-soft)] line-through" : ""}`}
                            title={value === 0 ? "No lleva" : undefined}
                          />
                          {overridden && (
                            <button type="button" onClick={() => updateLine(rowIndex, resetOverride(line, branchId))} className="hm-icon-btn h-6 w-6" title="Igualar a 'para todas'">
                              <RotateCcw className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td className="hm-num font-semibold">{qty(rowTotal)}</td>
                  <td><button type="button" onClick={() => removeLine(rowIndex)} className="hm-icon-btn hm-icon-btn-danger"><X className="h-3.5 w-3.5" /></button></td>
                </tr>
              );
            })}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={showCost ? 2 : 1}>Totales</td>
                <td className="hm-num">{qty(totals.grandUnits)}</td>
                {selectedBranchIds.map((id) => (
                  <td key={id} className="hm-num">
                    {qty(totals.byBranch[id]?.units ?? 0)}
                    {showCost && totals.byBranch[id]?.amount !== null && <div className="text-[0.68rem] text-[var(--color-text-muted)]">{money(totals.byBranch[id]?.amount ?? 0)}</div>}
                  </td>
                ))}
                <td className="hm-num">{qty(totals.grandUnits)}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
        {lines.length === 0 && <p className="p-6 text-center text-sm text-[var(--color-text-muted)]">Agregá productos con el buscador, el escáner o pegando desde Excel.</p>}
      </div>

      {/* Tarjetas (<1024) */}
      <div className="space-y-3 lg:hidden">
        {lines.map((line, rowIndex) => {
          const shortfall = shortfallByProductId.get(line.productId);
          return (
            <div key={line.productId} className="rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-[var(--color-text)]">{line.name}</p>
                  <p className="font-mono text-[0.7rem] text-[var(--color-text-muted)]">{line.sku}</p>
                  {shortfall && <p className="text-[0.7rem] font-semibold text-[var(--color-danger-600)]">Faltan {qty(shortfall.shortfall)} (stock origen: {qty(shortfall.available)})</p>}
                </div>
                <button type="button" onClick={() => removeLine(rowIndex)} className="hm-icon-btn hm-icon-btn-danger min-h-[44px] min-w-[44px]"><X className="h-4 w-4" /></button>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {showCost && (
                  <label className="text-xs">
                    <span className="mb-1 block text-[var(--color-text-muted)]">Costo</span>
                    <input type="number" min="0" step="0.01" value={line.cost ?? ""} onChange={(e) => updateLine(rowIndex, setCost(line, e.target.value === "" ? null : Number(e.target.value)))} className="hm-input h-11 w-24 rounded-lg text-sm" />
                  </label>
                )}
                <label className="text-xs">
                  <span className="mb-1 block text-[var(--color-text-muted)]">Para todas</span>
                  <StepperInput value={line.forAll} onChange={(n) => updateLine(rowIndex, setForAll(line, n))} />
                </label>
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-semibold text-[var(--color-master-600)]">Distinto por sucursal ▾</summary>
                <div className="mt-2 space-y-2">
                  {selectedBranchIds.map((branchId) => {
                    const overridden = isOverridden(line, branchId);
                    const value = quantityForBranch(line, branchId);
                    const branch = branches.find((b) => b.id === branchId);
                    return (
                      <div key={branchId} className="flex items-center justify-between gap-2">
                        <span className="text-xs text-[var(--color-text-secondary)]">{branch?.code ?? branchId}</span>
                        <div className="flex items-center gap-1">
                          <StepperInput value={value} onChange={(n) => updateLine(rowIndex, setOverride(line, branchId, n))} highlighted={overridden} />
                          {overridden && <button type="button" onClick={() => updateLine(rowIndex, resetOverride(line, branchId))} className="hm-icon-btn min-h-[44px] min-w-[44px]"><RotateCcw className="h-4 w-4" /></button>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </details>
            </div>
          );
        })}
        {lines.length === 0 && <p className="rounded-lg border border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-text-muted)]">Agregá productos con el buscador, el escáner o pegando desde Excel.</p>}
      </div>
    </div>
  );
}

function StepperInput({ value, onChange, highlighted }: { value: number; onChange: (n: number) => void; highlighted?: boolean }) {
  return (
    <div className={`flex items-center gap-1 rounded-lg border ${highlighted ? "border-[var(--color-warning-400)] bg-[var(--color-warning-50)]" : "border-[var(--color-border)]"}`}>
      <button type="button" onClick={() => onChange(Math.max(0, value - 1))} className="flex h-11 w-11 items-center justify-center text-lg font-semibold">−</button>
      <input
        type="text" value={String(value)}
        onChange={(e) => { const parsed = parseQuantityInput(e.target.value); if (parsed !== null) onChange(parsed); }}
        className={`h-11 w-14 bg-transparent text-center text-sm ${value === 0 ? "text-[var(--color-text-soft)] line-through" : ""}`}
      />
      <button type="button" onClick={() => onChange(value + 1)} className="flex h-11 w-11 items-center justify-center text-lg font-semibold">+</button>
    </div>
  );
}
