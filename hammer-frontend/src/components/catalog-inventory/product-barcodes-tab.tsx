"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import type { Route } from "next";
import toast from "react-hot-toast";
import { Barcode, Camera, Printer, Star, ArrowRightLeft, Trash2, AlertTriangle, Plus, X, Pencil, MoreHorizontal, RefreshCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CameraScanner } from "@/components/scanner/camera-scanner";
import { ProductCombobox, type ComboboxProduct } from "@/components/catalog-inventory/product-combobox";
import { MergeWizard } from "@/components/catalog-inventory/duplicates-panel";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { useCameraAvailable } from "@/lib/client/use-camera-available";
import { useSession } from "@/lib/client/session";
import { getActiveBranchId } from "@/lib/client/active-branch";
import { printProductLabels } from "@/lib/client/print-product-labels";
import { fmtDateTime } from "@/lib/format";
import { checksumWarningForCode } from "@/lib/scanner";
import { canSaveBarcodeEdit, removeBarcodeWarningLines, isUndoStillAvailable, UNDO_WINDOW_MS, parseBarcodeConflict, type BarcodeEditDraft, type BarcodeKind } from "@/lib/barcode-manager-logic";

/**
 * prompt-codigos-y-duplicados.md Fase 2 — ficha de producto, pestaña
 * "Códigos". Rediseño (prompt-codigos-editar-eliminar.md Fase 3.1): botones
 * con texto ("Editar" visible + "⋯ Más" para el resto), edición en línea,
 * modal de quitar propio con aviso de consecuencias y "Deshacer" por 10s, y
 * el chip "No coincide con el SKU" + "Regenerar e imprimir" para un HMR-
 * desactualizado.
 */

type ProductBarcodeRow = { id: string; code: string; kind: BarcodeKind; isPrimary: boolean; createdAt: string };
type ConflictInfo = { id: string; name: string; sku: string; barcode: string; isActive?: boolean };
type RemovedBuffer = { productId: string; code: string; kind: BarcodeKind; wasPrimary: boolean; removedAtMs: number };

const KIND_LABELS: Record<BarcodeKind, string> = { FACTORY: "Fábrica", INTERNAL: "Interno", SUPPLIER: "Proveedor" };
const KIND_OPTIONS: BarcodeKind[] = ["FACTORY", "SUPPLIER", "INTERNAL"];

export function ProductBarcodesTab({
  productId,
  productName,
  productSku,
  productUnit,
  productTotalStock,
  standardSalePrice,
  autoEditPrimary,
}: {
  productId: string;
  productName: string;
  productSku: string;
  productUnit: string;
  productTotalStock: number;
  standardSalePrice: number;
  /** Llega desde el menú rápido del chip de código en catalog-inventory-admin.tsx (?editPrimary=1) — abre el editor del código principal apenas cargan los códigos. */
  autoEditPrimary?: boolean;
}) {
  const [rows, setRows] = useState<ProductBarcodeRow[] | null>(null);
  const [addingCode, setAddingCode] = useState("");
  const [addingKind, setAddingKind] = useState<BarcodeKind>("FACTORY");
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const [showMergeWizard, setShowMergeWizard] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<ComboboxProduct | null>(null);
  const [allProducts, setAllProducts] = useState<ComboboxProduct[]>([]);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<BarcodeEditDraft>({ code: "", kind: "FACTORY" });
  const [savingEdit, setSavingEdit] = useState(false);
  const [removingRow, setRemovingRow] = useState<ProductBarcodeRow | null>(null);
  const [removing, setRemoving] = useState(false);
  const [undoBuffer, setUndoBuffer] = useState<RemovedBuffer | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const cameraAvailable = useCameraAvailable();
  const sessionState = useSession();
  const undoTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/catalog/products/${productId}/barcodes`);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudieron cargar los códigos.");
      setRows(unwrapApiData(raw) as ProductBarcodeRow[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudieron cargar los códigos.");
    }
  }, [productId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (undoTimer.current) window.clearTimeout(undoTimer.current); }, []);

  const autoEditHandled = useRef(false);
  useEffect(() => {
    if (!autoEditPrimary || autoEditHandled.current || !rows) return;
    autoEditHandled.current = true;
    const primary = rows.find((r) => r.isPrimary);
    if (primary) startEdit(primary);
  }, [autoEditPrimary, rows]);

  async function handleAdd(rawCode: string) {
    const code = rawCode.trim();
    if (!code || submitting) return;
    setConflict(null);
    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/catalog/products/${productId}/barcodes`, {
        method: "POST",
        body: JSON.stringify({ code, kind: addingKind }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) {
        const parsedConflict = parseBarcodeConflict(raw);
        if (parsedConflict) { setConflict(parsedConflict); return; }
        throw new Error(raw?.error?.message ?? "No se pudo agregar el código.");
      }
      toast.success("Código agregado.");
      setAddingCode("");
      setShowCamera(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo agregar el código.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleAddKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void handleAdd(addingCode);
  }

  async function handleSetPrimary(barcodeId: string) {
    setMenuOpenId(null);
    try {
      const res = await apiFetch(`/api/catalog/products/${productId}/barcodes/${barcodeId}/primary`, { method: "POST" });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo marcar como principal.");
      toast.success("Código principal actualizado.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo marcar como principal.");
    }
  }

  function openRemoveModal(row: ProductBarcodeRow) {
    setMenuOpenId(null);
    setRemovingRow(row);
  }

  async function confirmRemove() {
    const row = removingRow;
    if (!row) return;
    setRemoving(true);
    try {
      const res = await apiFetch(`/api/catalog/products/${productId}/barcodes/${row.id}`, { method: "DELETE" });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo quitar el código.");
      const data = unwrapApiData(raw) as { removed: { code: string; kind: BarcodeKind; wasPrimary: boolean } };
      setRemovingRow(null);
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
      setUndoBuffer({ productId, code: data.removed.code, kind: data.removed.kind, wasPrimary: data.removed.wasPrimary, removedAtMs: Date.now() });
      undoTimer.current = window.setTimeout(() => setUndoBuffer(null), UNDO_WINDOW_MS);
      toast.success("Código quitado.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo quitar el código.");
    } finally {
      setRemoving(false);
    }
  }

  async function handleUndoRemove() {
    if (!undoBuffer) return;
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    const buffer = undoBuffer;
    setUndoBuffer(null);
    try {
      const res = await apiFetch(`/api/catalog/products/${buffer.productId}/barcodes/restore`, {
        method: "POST",
        body: JSON.stringify({ code: buffer.code, kind: buffer.kind, makePrimary: buffer.wasPrimary }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo deshacer — es posible que otro usuario ya haya tomado ese código.");
      toast.success("Código restaurado.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo deshacer.");
    }
  }

  function startEdit(row: ProductBarcodeRow) {
    setMenuOpenId(null);
    setEditingId(row.id);
    setEditDraft({ code: row.code, kind: row.kind });
  }
  function cancelEdit() {
    setEditingId(null);
  }
  async function saveEdit(row: ProductBarcodeRow) {
    if (!canSaveBarcodeEdit({ code: row.code, kind: row.kind }, editDraft) || savingEdit) return;
    setSavingEdit(true);
    try {
      const res = await apiFetch(`/api/catalog/products/${productId}/barcodes/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ code: editDraft.code.trim(), kind: editDraft.kind }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) {
        const parsedConflict = parseBarcodeConflict(raw);
        if (parsedConflict) { setConflict(parsedConflict); return; }
        throw new Error(raw?.error?.message ?? "No se pudo guardar el código.");
      }
      const data = unwrapApiData(raw) as { warnings: string[] };
      if (data.warnings.includes("CHECKSUM_INVALID")) {
        toast("Código guardado — el dígito verificador no cuadra. Revisalo si podés.", { icon: "⚠️" });
      } else {
        toast.success("Código actualizado.");
      }
      setEditingId(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar el código.");
    } finally {
      setSavingEdit(false);
    }
  }
  function handleEditKeyDown(event: KeyboardEvent<HTMLInputElement>, row: ProductBarcodeRow) {
    if (event.key === "Enter") { event.preventDefault(); void saveEdit(row); }
    if (event.key === "Escape") { event.preventDefault(); cancelEdit(); }
  }

  async function regenerateInternal(row: ProductBarcodeRow) {
    setMenuOpenId(null);
    setRegeneratingId(row.id);
    try {
      const res = await apiFetch(`/api/catalog/products/${productId}/barcodes/${row.id}/regenerate-internal`, { method: "POST" });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo regenerar el código.");
      toast.success("Código interno regenerado — hay que reimprimir la etiqueta.");
      await load();
      await handlePrint(row.id, (unwrapApiData(raw) as { code: string }).code);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo regenerar el código.");
    } finally {
      setRegeneratingId(null);
    }
  }

  async function startMove(barcodeId: string) {
    setMenuOpenId(null);
    setMovingId(barcodeId);
    setMoveTarget(null);
    if (allProducts.length > 0) return;
    try {
      const res = await apiFetch(`/api/catalog/products?limit=1000&isActive=true`);
      const raw = await res.json();
      const data = unwrapApiData(raw) as Array<{ id: string; sku: string; name: string; unit: string }>;
      setAllProducts(data);
    } catch {
      toast.error("No se pudo cargar la lista de productos.");
    }
  }

  async function confirmMove(barcodeId: string) {
    if (!moveTarget) return;
    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/catalog/products/${productId}/barcodes/${barcodeId}/move`, {
        method: "POST",
        body: JSON.stringify({ toProductId: moveTarget.id }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo mover el código.");
      toast.success(`Código movido a ${moveTarget.name}.`);
      setMovingId(null);
      setMoveTarget(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo mover el código.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePrint(barcodeId: string, code: string) {
    setMenuOpenId(null);
    if (sessionState.status !== "authenticated") {
      toast.error("No se pudo determinar la sucursal para la etiqueta.");
      return;
    }
    const branchId = getActiveBranchId(sessionState.session.branchIds, sessionState.session.primaryBranchId);
    if (!branchId) {
      toast.error("No tenés una sucursal asignada para imprimir.");
      return;
    }
    setPrintingId(barcodeId);
    try {
      await printProductLabels({
        products: [{ id: productId, name: productName, sku: productSku, barcode: code, standardSalePrice }],
        branchId,
      });
    } catch {
      toast.error("No se pudo generar la etiqueta.");
    } finally {
      setPrintingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {undoBuffer && isUndoStillAvailable(undoBuffer.removedAtMs, Date.now()) ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-master-200)] bg-[var(--color-master-50)] px-4 py-2.5 text-sm">
          <span className="text-[var(--color-master-800)]">Código <span className="font-mono font-semibold">{undoBuffer.code}</span> quitado.</span>
          <Button size="sm" variant="primary" onClick={() => void handleUndoRemove()}>Deshacer</Button>
        </div>
      ) : null}

      <div className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden shadow-sm">
        <div className="hm-card-header-blue px-5 py-3 flex items-center gap-2">
          <Barcode className="h-5 w-5" />
          <h2 className="font-semibold">Códigos de barra</h2>
        </div>

        {rows === null ? (
          <p className="p-8 text-center text-sm text-[var(--color-text-muted)] animate-pulse">Cargando códigos…</p>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center">
            <Barcode className="h-10 w-10 mx-auto mb-3 text-[var(--color-text-muted)]" />
            <p className="text-sm font-medium text-[var(--color-text-secondary)]">Este producto todavía no tiene ningún código registrado</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {rows.map((row) => {
              const internalMismatch = row.kind === "INTERNAL" && row.code !== `HMR-${productSku}`;
              const hasChecksumWarning = checksumWarningForCode(editingId === row.id ? editDraft.code : row.code);
              return (
                <div key={row.id} className="px-5 py-3">
                  {editingId === row.id ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-[200px] flex-1">
                        <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Código</label>
                        <Input
                          className="font-mono"
                          value={editDraft.code}
                          onChange={(e) => setEditDraft((d) => ({ ...d, code: e.target.value }))}
                          onKeyDown={(e) => handleEditKeyDown(e, row)}
                          autoFocus
                        />
                        {hasChecksumWarning ? <p className="mt-1 text-xs text-[var(--color-warning-700)]">El dígito verificador no cuadra: ¿lo escribiste bien? Guardar igual.</p> : null}
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Tipo</label>
                        <select className="hm-input h-11 w-36" value={editDraft.kind} onChange={(e) => setEditDraft((d) => ({ ...d, kind: e.target.value as BarcodeKind }))}>
                          {KIND_OPTIONS.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
                        </select>
                      </div>
                      <Button size="sm" variant="success" disabled={!canSaveBarcodeEdit({ code: row.code, kind: row.kind }, editDraft) || savingEdit} loading={savingEdit} onClick={() => void saveEdit(row)}>Guardar</Button>
                      <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={savingEdit}>Cancelar</Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-[var(--color-text)]">{row.code}</span>
                        {row.isPrimary && <Badge variant="success">Principal</Badge>}
                        <Badge variant="neutral">{KIND_LABELS[row.kind]}</Badge>
                        {internalMismatch ? <Badge variant="warning" title="El código interno ya no coincide con el SKU actual del producto">No coincide con el SKU</Badge> : null}
                        <span className="text-xs text-[var(--color-text-muted)]">desde {fmtDateTime(row.createdAt)}</span>
                      </div>
                      <div className="relative flex items-center gap-1">
                        <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => startEdit(row)}>Editar</Button>
                        {internalMismatch ? (
                          <Button size="sm" variant="secondary" loading={regeneratingId === row.id} icon={<RefreshCcw className="h-3.5 w-3.5" />} onClick={() => void regenerateInternal(row)}>Regenerar e imprimir</Button>
                        ) : null}
                        <button type="button" title="Más acciones" onClick={() => setMenuOpenId((id) => (id === row.id ? null : row.id))} className="hm-icon-btn min-h-[44px] min-w-[44px]">
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {menuOpenId === row.id ? (
                          <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-xl">
                            {!row.isPrimary && (
                              <button type="button" onClick={() => void handleSetPrimary(row.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-alt)]">
                                <Star className="h-3.5 w-3.5" /> Marcar principal
                              </button>
                            )}
                            <button type="button" onClick={() => void startMove(row.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-alt)]">
                              <ArrowRightLeft className="h-3.5 w-3.5" /> Mover
                            </button>
                            <button type="button" onClick={() => void handlePrint(row.id, row.code)} disabled={printingId === row.id} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-alt)]">
                              <Printer className="h-3.5 w-3.5" /> Imprimir
                            </button>
                            <button type="button" onClick={() => openRemoveModal(row)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--color-danger-600)] hover:bg-[var(--color-danger-50)]">
                              <Trash2 className="h-3.5 w-3.5" /> Quitar
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}

                  {movingId === row.id && (
                    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-[var(--color-surface-alt)] p-3">
                      <div className="min-w-[240px] flex-1">
                        <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">
                          Este código estaba en el producto equivocado — mover a:
                        </label>
                        <ProductCombobox
                          products={allProducts}
                          value={moveTarget}
                          onSelect={setMoveTarget}
                          excludeId={productId}
                          placeholder="Buscar producto destino…"
                        />
                      </div>
                      <Button size="sm" variant="success" disabled={!moveTarget || submitting} loading={submitting} onClick={() => void confirmMove(row.id)}>
                        Mover
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setMovingId(null); setMoveTarget(null); }} disabled={submitting}>
                        Cancelar
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Agregar código ── */}
      <Card>
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Agregar código</h3>

        {conflict && (
          <div className="mb-3 rounded-lg border-2 border-amber-300 bg-amber-50 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-600" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-800">
                  Ese código ya es de otro producto: {conflict.name} ({conflict.sku})
                  {conflict.isActive === false && <span className="ml-1 font-normal">— inactivo</span>}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link
                    href={`/app/master/catalog-inventory/products/${conflict.id}` as Route}
                    className="inline-flex h-8 items-center rounded-lg border border-amber-300 bg-white px-3 text-xs font-medium text-amber-800 hover:bg-amber-100"
                  >
                    Ver ese producto
                  </Link>
                  <button
                    type="button"
                    onClick={() => setShowMergeWizard(true)}
                    className="inline-flex h-8 items-center rounded-lg border border-amber-300 bg-white px-3 text-xs font-medium text-amber-800 hover:bg-amber-100"
                  >
                    Son el mismo producto → Unificar
                  </button>
                  <button
                    type="button"
                    onClick={() => setConflict(null)}
                    className="inline-flex h-8 items-center gap-1 rounded-lg px-3 text-xs font-medium text-amber-700 hover:bg-amber-100"
                  >
                    <X className="h-3.5 w-3.5" />
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="h-11 flex-1 min-w-[220px] font-mono"
            placeholder="Escaneá (USB/Bluetooth) o tecleá el código y presioná Enter"
            value={addingCode}
            onChange={(e) => setAddingCode(e.target.value)}
            onKeyDown={handleAddKeyDown}
            autoComplete="off"
            disabled={submitting}
          />
          <select
            className="hm-input h-11 w-36"
            value={addingKind}
            onChange={(e) => setAddingKind(e.target.value as BarcodeKind)}
            disabled={submitting}
          >
            {KIND_OPTIONS.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
          </select>
          <Button variant="primary" className="h-11" icon={<Plus className="h-4 w-4" />} onClick={() => void handleAdd(addingCode)} disabled={submitting || !addingCode.trim()} loading={submitting}>
            Agregar
          </Button>
          {cameraAvailable && (
            <Button
              variant={showCamera ? "primary" : "ghost"}
              className="h-11"
              icon={<Camera className="h-4 w-4" />}
              onClick={() => setShowCamera((v) => !v)}
            >
              {showCamera ? "Ocultar cámara" : "Usar cámara"}
            </Button>
          )}
        </div>

        {cameraAvailable && showCamera && (
          <div className="mt-3 max-w-sm">
            <CameraScanner
              onClose={() => setShowCamera(false)}
              onDecode={(rawText) => {
                setAddingCode(rawText);
                void handleAdd(rawText);
              }}
            />
          </div>
        )}
      </Card>

      {showMergeWizard && conflict && (
        <MergeWizard
          pair={{
            // categoryId/createdAt no los usa MergeWizard (solo los necesita
            // el detector de duplicados en lista) — placeholders inertes acá.
            productA: { id: productId, sku: productSku, name: productName, categoryId: "", unit: productUnit, barcode: null, totalStock: productTotalStock, createdAt: new Date().toISOString() },
            productB: { id: conflict.id, sku: conflict.sku, name: conflict.name, categoryId: "", unit: productUnit, barcode: conflict.barcode, totalStock: 0, createdAt: new Date().toISOString() },
            similarity: 1,
            suggestedPrimaryId: productId,
          }}
          onClose={() => setShowMergeWizard(false)}
          onDone={() => { setShowMergeWizard(false); setConflict(null); void load(); }}
        />
      )}

      {removingRow ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">Quitar código</h3>
            <p className="mt-2 font-mono text-lg font-semibold text-[var(--color-text)]">{removingRow.code}</p>
            <div className="mt-3 space-y-1.5">
              {removeBarcodeWarningLines({
                isPrimary: removingRow.isPrimary,
                kind: removingRow.kind,
                nextPrimaryCode: removingRow.isPrimary ? (rows?.filter((r) => r.id !== removingRow.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.code ?? null) : null,
              }).map((line, i) => (
                <p key={i} className="text-xs text-[var(--color-text-secondary)]">{line}</p>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setRemovingRow(null)} disabled={removing}>Cancelar</Button>
              <Button type="button" variant="danger" loading={removing} onClick={() => void confirmRemove()} icon={<Trash2 className="h-4 w-4" />}>Quitar</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
