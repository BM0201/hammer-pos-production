"use client";

import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import type { Route } from "next";
import toast from "react-hot-toast";
import { Barcode, Camera, Printer, Star, ArrowRightLeft, Trash2, AlertTriangle, Plus, X } from "lucide-react";
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

/**
 * prompt-codigos-y-duplicados.md Fase 2 — ficha de producto, pestaña
 * "Códigos": varios códigos por producto (Fase 1, product-barcode-service.ts).
 * Extraído a su propio archivo desde el primer commit (no vive inline en
 * product-360.tsx) para poder cargarlo diferido con next/dynamic, mismo
 * patrón que kardex-tab.tsx/wac-history-tab.tsx/price-history-tab.tsx
 * (Fase 5, prompt-flujo-velocidad.md).
 */

type BarcodeKind = "FACTORY" | "INTERNAL" | "SUPPLIER";
type ProductBarcodeRow = { id: string; code: string; kind: BarcodeKind; isPrimary: boolean; createdAt: string };
type ConflictInfo = { id: string; name: string; sku: string; barcode: string; isActive?: boolean };

const KIND_LABELS: Record<BarcodeKind, string> = { FACTORY: "Fábrica", INTERNAL: "Interno", SUPPLIER: "Proveedor" };
const KIND_OPTIONS: BarcodeKind[] = ["FACTORY", "SUPPLIER", "INTERNAL"];

export function ProductBarcodesTab({
  productId,
  productName,
  productSku,
  productUnit,
  productTotalStock,
  standardSalePrice,
}: {
  productId: string;
  productName: string;
  productSku: string;
  productUnit: string;
  productTotalStock: number;
  standardSalePrice: number;
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
  const cameraAvailable = useCameraAvailable();
  const sessionState = useSession();

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
        if (raw?.error?.code === "BARCODE_ALREADY_EXISTS" && raw.error.details) {
          setConflict(raw.error.details as ConflictInfo);
          return;
        }
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

  async function handleRemove(barcodeId: string) {
    if (!window.confirm("¿Quitar este código del producto?")) return;
    try {
      const res = await apiFetch(`/api/catalog/products/${productId}/barcodes/${barcodeId}`, { method: "DELETE" });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo quitar el código.");
      toast.success("Código quitado.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo quitar el código.");
    }
  }

  async function startMove(barcodeId: string) {
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
            {rows.map((row) => (
              <div key={row.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-[var(--color-text)]">{row.code}</span>
                    {row.isPrimary && <Badge variant="success">Principal</Badge>}
                    <Badge variant="neutral">{KIND_LABELS[row.kind]}</Badge>
                    <span className="text-xs text-[var(--color-text-muted)]">desde {fmtDateTime(row.createdAt)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {!row.isPrimary && (
                      <button
                        type="button"
                        title="Marcar como principal"
                        onClick={() => void handleSetPrimary(row.id)}
                        className="hm-icon-btn"
                      >
                        <Star className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      title="Mover a otro producto"
                      onClick={() => void startMove(row.id)}
                      className="hm-icon-btn"
                    >
                      <ArrowRightLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      title="Imprimir etiqueta"
                      onClick={() => void handlePrint(row.id, row.code)}
                      disabled={printingId === row.id}
                      className="hm-icon-btn"
                    >
                      <Printer className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      title="Quitar código"
                      onClick={() => void handleRemove(row.id)}
                      className="hm-icon-btn text-[var(--color-danger-600)]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

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
            ))}
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
    </div>
  );
}
