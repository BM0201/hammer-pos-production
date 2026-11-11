"use client";

import { useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  AlertTriangle, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  Download, FileSpreadsheet, FileUp, Info, Loader2, Package, RefreshCcw,
  Search, Settings2, Sparkles, Tags, Wand2, X, Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money } from "@/lib/format";
import type { Branch, Category } from "@/components/catalog-inventory/catalog-inventory-admin";

/**
 * Fase 5 (prompt-flujo-velocidad.md): extraído de catalog-inventory-admin.tsx
 * (era la pestaña "import") para poder cargarlo con next/dynamic — solo se
 * monta cuando el usuario abre esa pestaña. Mismo comportamiento, mismo
 * componente (incluye su sub-componente ImportPreviewTable), solo movido.
 */

type ImportPreviewItem = {
  rowNumber: number;
  sku: string;
  barcode?: string | null;
  name: string;
  action: string;
  targetBranchCode: string;
  quantity: number | null;
  unitCost: number | null;
  standardSalePrice: number | null;
  status: "READY" | "ERROR" | "EXECUTED" | "SKIPPED" | "FAILED" | "ROLLED_BACK";
  messages?: string[];
  executionMessage?: string | null;
};
type ImportSummary = {
  parsedRows?: number;
  expandedRows?: number;
  existingProducts?: number;
  newProducts?: number;
  readyRows?: number;
  errorRows?: number;
  ready?: number;
  errors?: number;
  status?: string;
  executedLines?: number;
  skippedLines?: number;
  failedLines?: number;
  createdProducts?: number;
  updatedProducts?: number;
  inventoryMovements?: number;
  priceUpdates?: number;
  costUpdates?: number;
  /** D · Fase 3 (prompt-completo-pendientes-2026-10.md) — "Costo igual al precio en N filas", no bloqueante. */
  costEqualsPriceCount?: number;
  /** Archivo sin columna "cantidad" en un tipo que carga existencias — todas las filas fallan por esto. */
  missingQuantityColumn?: string | null;
  /** "Catálogo + Inventario" suma: productos que ya tienen existencias en la sucursal y recibirán más. */
  addsOnTopOfStock?: number;
};

const IMPORT_TEMPLATES: Record<string, { headers: string[]; example: string[] }> = {
  CATALOG_ONLY: {
    headers: ["nombre", "categoria"],
    example: ["Cemento Canal 42.5kg", "CEMENTO"],
  },
  CATALOG_WITH_INITIAL_INVENTORY: {
    headers: ["nombre", "categoria", "cantidad", "costo"],
    example: ["Cemento Canal 42.5kg", "CEMENTO", "50", "185"],
  },
  INVENTORY_ONLY: {
    headers: ["sku", "cantidad", "costo"],
    example: ["CEM-CEM-425KG-0001", "50", "185"],
  },
  PRICES_COSTS_ONLY: {
    headers: ["sku", "costo", "precio"],
    example: ["CEM-CEM-425KG-0001", "185", "220"],
  },
  PHYSICAL_COUNT: {
    headers: ["sku", "cantidad"],
    example: ["CEM-CEM-425KG-0001", "48"],
  },
};

function downloadTemplate(importType: string) {
  const tmpl = IMPORT_TEMPLATES[importType] ?? IMPORT_TEMPLATES.CATALOG_ONLY;
  const csv = [tmpl.headers.join(","), tmpl.example.join(",")].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `plantilla-importacion-${importType.toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const IMPORT_TYPE_LABELS: Record<string, { label: string; desc: string; color: string }> = {
  CATALOG_ONLY: { label: "Solo Catálogo", desc: "Crear o actualizar productos. Solo necesitas nombre y categoría.", color: "text-[var(--color-master-700)]" },
  CATALOG_WITH_INITIAL_INVENTORY: { label: "Catálogo + Inventario", desc: "Crear productos con stock inicial. Necesitas nombre, categoría, cantidad y costo.", color: "text-[var(--color-success-700)]" },
  INVENTORY_ONLY: { label: "Solo Inventario", desc: "Agregar stock a productos existentes (requiere SKU).", color: "text-[var(--color-warning-700)]" },
  PRICES_COSTS_ONLY: { label: "Solo Precios/Costos", desc: "Actualizar precios y costos (requiere SKU).", color: "text-[var(--color-owner-700)]" },
  PHYSICAL_COUNT: { label: "Conteo Físico", desc: "Ajustar stock por conteo real (requiere SKU).", color: "text-[var(--color-danger-700)]" },
};

/**
 * POST al importador. El error del API viene en { error: { message } } (antes se leía
 * raw.message, que nunca existe → mensaje genérico), y un cuerpo vacío ya no revienta
 * con "Unexpected end of JSON input".
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function postImport(body: Record<string, unknown>, fallback: string): Promise<any> {
  const response = await apiFetch("/api/master/catalog-inventory/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await response.json().catch(() => null);
  if (!response.ok) throw new Error(raw?.error?.message ?? raw?.message ?? `${fallback} (error ${response.status})`);
  return unwrapApiData(raw);
}

type AnalysisResult = {
  totalRows: number;
  missingCategories: string[];
  newProductCount: number;
  autoSkuCount: number;
  defaultCategoryName: string | null;
};

export function UnifiedImportPanel({ branches, categories, onDone }: { branches: Branch[]; categories: Category[]; onDone: () => Promise<void> }) {
  const [step, setStep] = useState<"config" | "preview" | "done">("config");
  const [importType, setImportType] = useState("CATALOG_WITH_INITIAL_INVENTORY");
  const [destinationMode, setDestinationMode] = useState("SINGLE");
  const [defaultBranchId, setDefaultBranchId] = useState(branches[0]?.id ?? "");
  const [filePayload, setFilePayload] = useState<{ fileContent?: string; fileBase64?: string }>({});
  const [fileName, setFileName] = useState("");
  const [batchId, setBatchId] = useState("");
  const [items, setItems] = useState<ImportPreviewItem[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [previewCsv, setPreviewCsv] = useState("");
  const [errorCsv, setErrorCsv] = useState("");
  const [defaultCategoryId, setDefaultCategoryId] = useState(categories[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [showAnalysisDialog, setShowAnalysisDialog] = useState(false);
  // Parte B.2 — "una planilla de inventario no debería reescribir precios
  // de venta salvo que alguien lo pida explícitamente". Apagada por
  // defecto; solo aplica a CATALOG_WITH_INITIAL_INVENTORY (normaliza a
  // CATALOG_WITH_INITIAL_STOCK en el backend).
  const [updateSalePrices, setUpdateSalePrices] = useState(false);
  const [executeError, setExecuteError] = useState("");
  const [priceChanges, setPriceChanges] = useState<Array<{ sku: string; name: string; previousPrice: number; newPrice: number }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isCatalogType = importType === "CATALOG_ONLY" || importType === "CATALOG_WITH_INITIAL_INVENTORY";
  const needsBranchSelection = importType !== "CATALOG_ONLY" && importType !== "PRICES_COSTS_ONLY";
  const typeInfo = IMPORT_TYPE_LABELS[importType] ?? IMPORT_TYPE_LABELS.CATALOG_ONLY;

  function resetState() {
    setBatchId("");
    setItems([]);
    setSummary(null);
    setPreviewCsv("");
    setErrorCsv("");
    setAnalysis(null);
    setShowAnalysisDialog(false);
    setPriceChanges([]);
    setExecuteError("");
    setStep("config");
  }

  async function onFile(file: File | null) {
    if (!file) return;
    setFileName(file.name);
    if (file.name.toLowerCase().endsWith(".xlsx")) {
      const buffer = await file.arrayBuffer();
      let binary = "";
      new Uint8Array(buffer).forEach((byte) => { binary += String.fromCharCode(byte); });
      setFilePayload({ fileBase64: btoa(binary) });
    } else {
      setFilePayload({ fileContent: await file.text() });
    }
    resetState();
    setStep("config");
  }

  async function analyzeFile() {
    setLoading(true);
    try {
      const result: AnalysisResult = await postImport({
        mode: "analyze",
        importType,
        destinationMode,
        defaultCategoryId: defaultCategoryId || undefined,
        ...filePayload,
      }, "No se pudo analizar el archivo.");
      // If there are missing categories or new products → show dialog
      if (result.missingCategories.length > 0 || result.autoSkuCount > 0) {
        setAnalysis(result);
        setShowAnalysisDialog(true);
      } else {
        // Nothing special → go straight to preview
        await runPreview();
      }
    } finally {
      setLoading(false);
    }
  }

  async function createCategoriesAndPreview() {
    setShowAnalysisDialog(false);
    setLoading(true);
    try {
      // Create missing categories if any
      if (analysis && analysis.missingCategories.length > 0) {
        const result = await postImport({ mode: "create-categories", categoryCodes: analysis.missingCategories }, "No se pudo crear las categorías.");
        toast.success(`${result.created?.length ?? 0} categoría(s) creada(s) automáticamente`);
      }
      // Then run preview
      await runPreview();
    } finally {
      setLoading(false);
    }
  }

  async function runPreview() {
    setLoading(true);
    try {
      const result = await postImport({
        mode: "preview",
        importType,
        destinationMode,
        defaultBranchId,
        createMissingProducts: true,
        defaultCategoryId: defaultCategoryId || undefined,
        defaultUnit: "UN",
        defaultStandardSalePrice: 1,
        updateSalePrices,
        ...filePayload,
      }, "No se pudo generar preview.");
      setExecuteError("");
      setBatchId(result.batchId ?? "");
      setItems(result.items ?? []);
      setSummary(result.summary ?? null);
      setPreviewCsv(result.previewCsv ?? "");
      setErrorCsv("");
      setAnalysis(null);
      setPriceChanges(result.priceChanges ?? []);
      setStep("preview");
      toast.success(`Preview generado — ${result.summary?.readyRows ?? result.summary?.ready ?? 0} filas listas`);
    } finally {
      setLoading(false);
    }
  }

  async function execute() {
    if (!batchId || !summary || Number(summary.readyRows ?? summary.ready ?? 0) <= 0 || summary.status !== "PREVIEWED") {
      toast.error("Genera un preview vigente con líneas READY antes de ejecutar.");
      return;
    }
    const confirmed = window.confirm("¿Confirmas la importación? Esta acción modificará catálogo, precios o inventario de forma permanente.");
    if (!confirmed) return;
    setLoading(true);
    setExecuteError("");
    try {
      let result;
      try {
        result = await postImport({ mode: "execute", batchId }, "No se pudo ejecutar la importación.");
      } catch (error) {
        // El backend marca el lote como FAILED: no se puede reintentar el mismo lote,
        // hay que generar un preview nuevo. El mensaje queda fijo en pantalla, no solo en un toast.
        setSummary((prev) => (prev ? { ...prev, status: "FAILED" } : prev));
        setExecuteError(error instanceof Error ? error.message : String(error));
        throw error;
      }
      const nextSummary: ImportSummary = {
        status: result.status,
        executedLines: result.executedLines,
        skippedLines: result.skippedLines,
        failedLines: result.failedLines,
        createdProducts: result.createdProducts,
        updatedProducts: result.updatedProducts,
        inventoryMovements: result.inventoryMovements,
        priceUpdates: result.priceUpdates,
        costUpdates: result.costUpdates,
      };
      setSummary(nextSummary);
      setErrorCsv(result.errorCsv ?? "");
      setStep("done");
      toast.success(`✅ Importación completa — ${result.executedLines} ejecutadas, ${result.createdProducts ?? 0} productos creados`);
      await onDone();
    } finally {
      setLoading(false);
    }
  }

  function downloadCsv(content: string, filename: string) {
    if (!content) return;
    const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const [exporting, setExporting] = useState(false);
  async function exportCatalog() {
    setExporting(true);
    try {
      const res = await apiFetch("/api/master/catalog-inventory/export");
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? raw?.message ?? "No se pudo exportar el catálogo.");
      const result = unwrapApiData(raw) as { filename: string; base64: string; rowCount: number };
      const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Catálogo descargado — ${result.rowCount} productos.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo exportar el catálogo.");
    } finally {
      setExporting(false);
    }
  }

  const readyRows = Number(summary?.readyRows ?? summary?.ready ?? 0);
  const errorRows = Number(summary?.errorRows ?? summary?.errors ?? 0);
  const canExecute = Boolean(batchId && summary?.status === "PREVIEWED" && readyRows > 0);
  const hasFile = Boolean(filePayload.fileBase64 || filePayload.fileContent);

  return (
    <div className="space-y-4">
      {/* ── Exportar: el catálogo entero en .xlsx, re-importable ── */}
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <FileSpreadsheet className="h-6 w-6 flex-shrink-0 text-[var(--color-success-700)]" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-bold text-[var(--color-text)]">Exportar catálogo completo</h2>
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                Todos los productos en Excel: SKU, código de barras, nombre, categoría, unidad, precio, costo y existencias por sucursal.
                Puedes editarlo y volver a subirlo como <strong className="text-[var(--color-text-secondary)]">Solo Catálogo</strong> o <strong className="text-[var(--color-text-secondary)]">Solo Precios/Costos</strong>.
              </p>
            </div>
          </div>
          <Button
            variant="success"
            onClick={exportCatalog}
            disabled={exporting}
            icon={exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          >
            {exporting ? "Generando..." : "Descargar Excel"}
          </Button>
        </div>
      </Card>

      {/* ── Step 1: Info Banner ── */}
      <Card noPadding>
        <div className="hm-card-header-blue px-5 py-4">
          <h2 className="text-base font-bold flex items-center gap-2"><Zap className="h-5 w-5" /> Importación Simplificada</h2>
          <p className="text-white/85 text-xs mt-1 relative z-10">Solo necesitas <strong>Nombre</strong> y <strong>Categoría</strong>. El SKU se genera automáticamente.</p>
        </div>
        <div className="p-4 space-y-4">

          {/* ── Quick guide ── */}
          <div className="flex items-start gap-3 rounded-lg border border-[var(--color-master-200)] bg-[var(--color-master-50)] p-3">
            <Info className="h-5 w-5 text-[var(--color-master-700)] mt-0.5 flex-shrink-0" />
            <div className="text-xs text-[var(--color-master-700)] space-y-1">
              <p className="font-semibold">¿Cómo funciona?</p>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>Descarga la <strong>plantilla</strong> según el tipo de importación</li>
                <li>Llena los datos en Excel o CSV (mínimo: <strong>nombre</strong> y <strong>categoría</strong>)</li>
                <li>Sube el archivo → <strong>Preview</strong> para verificar → <strong>Ejecutar</strong></li>
              </ol>
              <p className="text-[var(--color-master-700)] mt-1"><Sparkles className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" /><strong>SKU automático:</strong> Si no incluyes columna SKU, el sistema genera códigos inteligentes basados en el nombre del producto (ej: <code className="bg-[var(--color-master-100)] px-1 rounded">CEM-CEM-425KG-0001</code>).</p>
            </div>
          </div>

          {/* ── Import type selector ── */}
          <div>
            <label className="block text-xs font-semibold text-[var(--color-text-secondary)] mb-1.5">Tipo de importación</label>
            <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-5">
              {Object.entries(IMPORT_TYPE_LABELS).map(([key, info]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setImportType(key); resetState(); }}
                  className={`text-left rounded-lg border-2 p-3 transition-all text-xs ${
                    importType === key
                      ? "border-[var(--color-master-400)] bg-[var(--color-master-50)] shadow-sm"
                      : "border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-alt)]"
                  }`}
                >
                  <span className={`font-semibold block ${importType === key ? "text-[var(--color-master-700)]" : "text-[var(--color-text)]"}`}>{info.label}</span>
                  <span className="text-[var(--color-text-muted)] block mt-0.5 leading-tight">{info.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Template + File Upload side by side ── */}
          <div className="grid gap-4 md:grid-cols-2">
            {/* Template download */}
            <div className="rounded-lg border border-dashed border-[var(--color-success-200)] bg-[var(--color-success-50)] p-4 text-center">
              <FileSpreadsheet className="h-8 w-8 text-[var(--color-success-700)] mx-auto mb-2" />
              <p className="text-xs font-semibold text-[var(--color-success-700)]">Plantilla {typeInfo.label}</p>
              <p className="text-xs text-[var(--color-success-700)] mt-1">
                Columnas: <strong>{(IMPORT_TEMPLATES[importType] ?? IMPORT_TEMPLATES.CATALOG_ONLY).headers.join(", ")}</strong>
              </p>
              <Button variant="secondary" size="sm" className="mt-3" onClick={() => downloadTemplate(importType)} icon={<Download className="h-3.5 w-3.5" />}>
                Descargar plantilla vacía (CSV)
              </Button>
            </div>

            {/* File upload */}
            <div
              className={`rounded-lg border-2 border-dashed p-4 text-center transition-colors cursor-pointer ${
                hasFile ? "border-[var(--color-master-400)] bg-[var(--color-master-50)]" : "border-[var(--color-border-strong)] hover:border-[var(--color-master-400)] hover:bg-blue-50/50"
              }`}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv,.tsv,.txt"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              />
              <FileUp className={`h-8 w-8 mx-auto mb-2 ${hasFile ? "text-[var(--color-master-700)]" : "text-[var(--color-text-soft)]"}`} />
              {hasFile ? (
                <>
                  <p className="text-xs font-semibold text-[var(--color-master-700)]">{fileName}</p>
                  <p className="text-xs text-[var(--color-master-700)] mt-1">Archivo cargado ✓ — Clic para cambiar</p>
                </>
              ) : (
                <>
                  <p className="text-xs font-semibold text-[var(--color-text-secondary)]">Subir archivo Excel o CSV</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">Clic aquí o arrastra tu archivo (.xlsx, .csv)</p>
                </>
              )}
            </div>
          </div>

          {/* ── Branch + Category config ── */}
          <div className="grid gap-3 md:grid-cols-3">
            {needsBranchSelection ? (
              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-secondary)] mb-1">Sucursal destino</label>
                <select className="hm-input w-full" value={destinationMode} onChange={(e) => { setDestinationMode(e.target.value); resetState(); }}>
                  <option value="SINGLE">Una sucursal</option><option value="ALL">Todas las sucursales</option><option value="FILE">Desde el archivo (columna sucursal)</option>
                </select>
              </div>
            ) : null}
            {needsBranchSelection && destinationMode === "SINGLE" ? (
              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-secondary)] mb-1">Sucursal</label>
                <select className="hm-input w-full" value={defaultBranchId} onChange={(e) => { setDefaultBranchId(e.target.value); resetState(); }}>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
                </select>
              </div>
            ) : null}
            {isCatalogType ? (
              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-secondary)] mb-1">Categoría por defecto</label>
                <select className="hm-input w-full" value={defaultCategoryId} onChange={(e) => setDefaultCategoryId(e.target.value)}>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">Se usa si el archivo no trae columna categoría</p>
              </div>
            ) : null}
          </div>

          {/* ── Parte B.2: "una planilla de inventario no debería reescribir
              precios de venta salvo que alguien lo pida explícitamente" —
              casilla separada, apagada por defecto. Solo aplica cuando el
              archivo también trae columna de precio junto a la carga de
              existencias (CATALOG_WITH_INITIAL_INVENTORY). ── */}
          {importType === "CATALOG_WITH_INITIAL_INVENTORY" ? (
            <label className="flex items-start gap-2 rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] p-3 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={updateSalePrices}
                onChange={(e) => { setUpdateSalePrices(e.target.checked); resetState(); }}
                className="mt-0.5"
              />
              <span>
                <span className="font-semibold text-[var(--color-warning-700)]">Actualizar también los precios de venta</span>
                <span className="block text-[var(--color-warning-700)] mt-0.5">
                  Si tu archivo trae columna &quot;precio&quot; y NO marcas esto, solo se cargan existencias — los precios de venta existentes quedan intactos.
                </span>
              </span>
            </label>
          ) : null}

          {/* ── Advanced toggle ── */}
          <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            <Settings2 className="h-3.5 w-3.5" /> Opciones avanzadas {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {showAdvanced ? (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-xs space-y-2">
              <p className="text-[var(--color-text-secondary)]">El sistema auto-genera SKU, crea productos nuevos y usa unidad &quot;UN&quot; por defecto. Columnas opcionales en tu archivo:</p>
              <div className="grid gap-1 md:grid-cols-2">
                <span className="text-[var(--color-text-muted)]">• <strong>sku</strong> — código manual (si prefieres no auto-generar)</span>
                <span className="text-[var(--color-text-muted)]">• <strong>unidad</strong> — unidad de medida (UN, KG, M, etc.)</span>
                <span className="text-[var(--color-text-muted)]">• <strong>precio</strong> — precio de venta sugerido</span>
                <span className="text-[var(--color-text-muted)]">• <strong>sucursal</strong> — código de sucursal (modo &quot;Desde archivo&quot;)</span>
              </div>
            </div>
          ) : null}

          {/* ── Parte B.2: "el preview del lote tiene que mostrar 'N
              productos van a cambiar de precio' con la lista y el
              antes/después de cada uno" ── */}
          {priceChanges.length > 0 ? (
            <div className="rounded-lg border-2 border-[var(--color-warning-200)] bg-[var(--color-warning-50)] p-3">
              <p className="text-xs font-bold text-[var(--color-warning-700)] mb-1.5">
                {priceChanges.length} producto{priceChanges.length !== 1 ? "s" : ""} van a cambiar de precio de venta:
              </p>
              <ul className="text-xs text-[var(--color-warning-700)] space-y-0.5 max-h-32 overflow-y-auto font-mono">
                {priceChanges.map((p) => (
                  <li key={p.sku}>{p.sku} — {p.name}: {money(p.previousPrice)} → {money(p.newPrice)}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* ── D · Fase 3 (prompt-completo-pendientes-2026-10.md) — "si la
              fila trae costo = precio... mostrar un aviso... No bloquea." ── */}
          {summary?.missingQuantityColumn ? (
            <div role="alert" className="flex items-start gap-2 rounded-lg border-2 border-[var(--color-danger-200)] bg-[var(--color-danger-50)] p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-danger-700)]" aria-hidden="true" />
              <p className="text-xs font-bold text-[var(--color-danger-700)]">{summary.missingQuantityColumn}</p>
            </div>
          ) : null}

          {step === "preview" && (summary?.addsOnTopOfStock ?? 0) > 0 ? (
            <div role="alert" className="flex items-start gap-2 rounded-lg border-2 border-[var(--color-warning-200)] bg-[var(--color-warning-50)] p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-warning-700)]" aria-hidden="true" />
              <p className="text-xs text-[var(--color-warning-700)]">
                <strong>{summary!.addsOnTopOfStock} producto{summary!.addsOnTopOfStock !== 1 ? "s" : ""} ya tienen existencias en la sucursal y este tipo las SUMA.</strong>{" "}
                Si tu archivo es un conteo de lo que hay ahora, usa <strong>Conteo Físico</strong>: fija el stock al número del archivo en vez de sumarlo.
              </p>
            </div>
          ) : null}

          {(summary?.costEqualsPriceCount ?? 0) > 0 ? (
            <div className="rounded-lg border-2 border-[var(--color-warning-200)] bg-[var(--color-warning-50)] p-3">
              <p className="text-xs font-bold text-[var(--color-warning-700)]">
                Costo igual al precio en {summary!.costEqualsPriceCount} fila{summary!.costEqualsPriceCount !== 1 ? "s" : ""}: ¿lo cargaste en la columna correcta?
              </p>
            </div>
          ) : null}

          {executeError ? (
            <div role="alert" className="flex items-start gap-2 rounded-lg border-2 border-[var(--color-danger-200)] bg-[var(--color-danger-50)] p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-danger-700)]" aria-hidden="true" />
              <div className="text-xs text-[var(--color-danger-700)]">
                <p className="font-bold">No se pudo ejecutar la importación</p>
                <p className="mt-0.5">{executeError}</p>
                <p className="mt-1">Corrige el archivo y vuelve a darle <strong>Preview</strong>: ese lote ya no se puede ejecutar.</p>
              </div>
            </div>
          ) : null}

          {/* ── Action buttons ── */}
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-[var(--color-border)]">
            <Button
              variant="secondary"
              onClick={() => analyzeFile().catch((e) => toast.error(e.message))}
              disabled={!hasFile || loading}
              icon={loading && step === "config" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            >
              {loading && step === "config" ? "Analizando..." : "Preview"}
            </Button>
            {step === "preview" ? (
              <Button
                variant="success"
                onClick={() => execute().catch((e) => toast.error(e.message))}
                disabled={!canExecute || loading}
                icon={loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              >
                {loading ? "Ejecutando..." : `Ejecutar (${readyRows} filas)`}
              </Button>
            ) : null}
            {step !== "config" ? (
              <Button variant="ghost" onClick={() => { resetState(); setFilePayload({}); setFileName(""); if (fileInputRef.current) fileInputRef.current.value = ""; }} icon={<RefreshCcw className="h-4 w-4" />}>Nueva importación</Button>
            ) : null}
          </div>
        </div>
      </Card>

      {/* ── Analysis Dialog (pre-import confirmation) ── */}
      {showAnalysisDialog && analysis ? (
        <Card noPadding>
          <div className="hm-card-header-amber px-5 py-4">
            <h2 className="text-base font-bold flex items-center gap-2"><AlertTriangle className="h-5 w-5" /> Análisis pre-importación</h2>
            <p className="text-white/85 text-xs mt-1 relative z-10">Se detectaron situaciones que requieren tu confirmación antes de continuar.</p>
          </div>
          <div className="p-5 space-y-4">
            {/* Missing categories */}
            {analysis.missingCategories.length > 0 ? (
              <div className="rounded-lg border-2 border-[var(--color-warning-200)] bg-[var(--color-warning-50)] p-4 space-y-2">
                <div className="flex items-center gap-2 text-[var(--color-warning-700)]">
                  <Tags className="h-5 w-5" />
                  <h3 className="text-sm font-bold">Hay categorías que no están creadas para el SKU. ¿Crearlas?</h3>
                </div>
                <p className="text-xs text-[var(--color-warning-700)]">
                  Se detectaron <strong>{analysis.missingCategories.length}</strong> categoría(s) que no existen en el sistema. Si confirmas, se crearán automáticamente:
                </p>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {analysis.missingCategories.map((code) => (
                    <span key={code} className="inline-flex items-center rounded-full bg-[var(--color-warning-100)] px-2.5 py-1 text-xs font-semibold text-[var(--color-warning-700)]">
                      {code}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {/* New products with auto-SKU */}
            {analysis.autoSkuCount > 0 ? (
              <div className="rounded-lg border-2 border-[var(--color-master-200)] bg-[var(--color-master-50)] p-4 space-y-2">
                <div className="flex items-center gap-2 text-[var(--color-master-700)]">
                  <Wand2 className="h-5 w-5" />
                  <h3 className="text-sm font-bold">Hay productos que serán creados y tendrán su SKU basado en su categoría</h3>
                </div>
                <p className="text-xs text-[var(--color-master-700)]">
                  Se detectaron <strong>{analysis.autoSkuCount} producto{analysis.autoSkuCount !== 1 ? "s" : ""}</strong> sin SKU que se crearán con un código generado automáticamente basado en su categoría y nombre.
                </p>
                <p className="text-xs text-[var(--color-master-700)] flex items-center gap-1">
                  <Sparkles className="h-3.5 w-3.5" />
                  Ejemplo: <code className="bg-[var(--color-master-100)] px-1.5 py-0.5 rounded font-mono text-[11px]">ALM-CEM-425KG-0001</code>
                </p>
              </div>
            ) : null}

            {/* New products total (with manual SKU) */}
            {analysis.newProductCount > analysis.autoSkuCount ? (
              <div className="rounded-lg border border-[var(--color-success-200)] bg-[var(--color-success-50)] p-4">
                <div className="flex items-center gap-2 text-[var(--color-success-700)]">
                  <Package className="h-5 w-5" />
                  <h3 className="text-sm font-bold">{analysis.newProductCount - analysis.autoSkuCount} producto{analysis.newProductCount - analysis.autoSkuCount !== 1 ? "s" : ""} nuevos con SKU manual</h3>
                </div>
                <p className="text-xs text-[var(--color-success-700)] mt-1">
                  Estos productos tienen SKU en el archivo y se crearán con ese código.
                </p>
              </div>
            ) : null}

            {/* Summary */}
            <div className="flex items-center gap-3 rounded-lg bg-[var(--color-surface-alt)] border border-[var(--color-border)] p-3">
              <Info className="h-4 w-4 text-[var(--color-text-muted)] flex-shrink-0" />
              <p className="text-xs text-[var(--color-text-secondary)]">
                Total de filas: <strong>{analysis.totalRows}</strong> · Productos nuevos: <strong>{analysis.newProductCount}</strong> · Categorías por crear: <strong>{analysis.missingCategories.length}</strong>
              </p>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3 pt-3 border-t border-[var(--color-border)]">
              <Button
                variant="success"
                onClick={() => createCategoriesAndPreview().catch((e) => toast.error(e.message))}
                disabled={loading}
                icon={loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              >
                {loading ? "Procesando..." : analysis.missingCategories.length > 0 ? "Crear categorías y continuar" : "Continuar con preview"}
              </Button>
              <Button variant="ghost" onClick={() => { setShowAnalysisDialog(false); setAnalysis(null); }} icon={<X className="h-4 w-4" />}>
                Cancelar
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {/* ── Preview Results ── */}
      {summary ? (
        <Card noPadding>
          <div className={`px-5 py-3 ${step === "done" ? "hm-card-header-green" : "hm-card-header-amber"}`}>
            <h3 className="text-sm font-bold flex items-center gap-2">
              {step === "done" ? <><Check className="h-4 w-4" /> Importación Completada</> : <><Search className="h-4 w-4" /> Resultado del Preview</>}
            </h3>
          </div>
          <div className="p-4 space-y-3">
            {/* Summary cards */}
            <div className="grid gap-2 md:grid-cols-5">
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-2.5 text-center">
                <span className="text-lg font-bold text-[var(--color-text)]">{summary.parsedRows ?? items.length}</span>
                <p className="text-[10px] text-[var(--color-text-muted)]">Filas leídas</p>
              </div>
              <div className="rounded-lg border border-[var(--color-success-200)] bg-[var(--color-success-50)] p-2.5 text-center">
                <span className="text-lg font-bold text-[var(--color-success-700)]">{readyRows}</span>
                <p className="text-[10px] text-[var(--color-success-700)]">Listas (READY)</p>
              </div>
              <div className="rounded-lg border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] p-2.5 text-center">
                <span className="text-lg font-bold text-[var(--color-danger-700)]">{errorRows}</span>
                <p className="text-[10px] text-[var(--color-danger-700)]">Con errores</p>
              </div>
              <div className="rounded-lg border border-[var(--color-master-200)] bg-[var(--color-master-50)] p-2.5 text-center">
                <span className="text-lg font-bold text-[var(--color-master-700)]">{summary.newProducts ?? 0}</span>
                <p className="text-[10px] text-[var(--color-master-700)]">Productos nuevos</p>
              </div>
              <div className="rounded-lg border border-[var(--color-owner-200)] bg-[var(--color-owner-50)] p-2.5 text-center">
                <span className="text-lg font-bold text-[var(--color-owner-700)]">{summary.existingProducts ?? 0}</span>
                <p className="text-[10px] text-[var(--color-owner-700)]">Ya existentes</p>
              </div>
            </div>

            {step === "done" ? (
              <div className="grid gap-2 md:grid-cols-4 text-xs">
                <div className="rounded border border-[var(--color-success-200)] bg-[var(--color-success-50)] px-3 py-2"><strong className="text-[var(--color-success-700)]">{summary.executedLines ?? 0}</strong> ejecutadas</div>
                <div className="rounded border border-[var(--color-master-200)] bg-[var(--color-master-50)] px-3 py-2"><strong className="text-[var(--color-master-700)]">{summary.createdProducts ?? 0}</strong> productos creados</div>
                <div className="rounded border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-3 py-2"><strong className="text-[var(--color-warning-700)]">{summary.inventoryMovements ?? 0}</strong> movimientos</div>
                <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2"><strong className="text-[var(--color-text)]">{summary.skippedLines ?? 0}</strong> omitidas</div>
              </div>
            ) : null}

            {/* CSV downloads */}
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" disabled={!previewCsv} onClick={() => downloadCsv(previewCsv, `preview-importacion-${batchId || "catalogo"}.csv`)} icon={<Download className="h-3.5 w-3.5" />}>Descargar preview CSV</Button>
              <Button variant="ghost" size="sm" disabled={!errorCsv} onClick={() => downloadCsv(errorCsv, `errores-importacion-${batchId || "catalogo"}.csv`)} icon={<Download className="h-3.5 w-3.5" />}>Descargar errores CSV</Button>
            </div>

            {/* Preview table with pagination */}
            {items.length ? <ImportPreviewTable items={items} /> : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   IMPORT PREVIEW TABLE (paginated, 50 per page)
   ═══════════════════════════════════════════════════════════ */
const PREVIEW_PAGE_SIZE = 50;

function ImportPreviewTable({ items }: { items: ImportPreviewItem[] }) {
  const [previewPage, setPreviewPage] = useState(1);
  const totalPreviewPages = Math.ceil(items.length / PREVIEW_PAGE_SIZE);
  const pagedItems = items.slice((previewPage - 1) * PREVIEW_PAGE_SIZE, previewPage * PREVIEW_PAGE_SIZE);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="hm-table min-w-[980px] w-full text-xs">
          <thead className="sticky top-0 bg-[var(--color-surface)] z-10">
            <tr>
              <th className="w-12">Fila</th>
              <th>SKU <span title="Auto-generado"><Wand2 className="h-3 w-3 inline text-[var(--color-master-700)] ml-1" /></span></th>
              <th>Producto</th>
              <th>Acción</th>
              <th>Sucursal</th>
              <th className="w-16">Cant.</th>
              <th className="w-16">Costo</th>
              <th className="w-16">Precio</th>
              <th className="w-20">Estado</th>
              <th>Mensajes</th>
            </tr>
          </thead>
          <tbody>
            {pagedItems.map((item, index) => (
              <tr key={`${item.rowNumber}-${index}`} className={item.status === "ERROR" || item.status === "FAILED" ? "bg-[var(--color-danger-50)]" : ""}>
                <td className="text-center">{item.rowNumber}</td>
                <td className="font-mono text-[10px]">{item.sku}</td>
                <td>{item.name}</td>
                <td><Badge variant={item.action === "Crear producto" ? "info" : item.action === "Error" ? "danger" : item.action === "Sin cambios" ? "neutral" : "warning"}>{item.action}</Badge></td>
                <td>{item.targetBranchCode}</td>
                <td className="text-right">{item.quantity ?? ""}</td>
                <td className="text-right">{item.unitCost ?? ""}</td>
                <td className="text-right">{item.standardSalePrice ?? ""}</td>
                <td>
                  <Badge variant={item.status === "READY" || item.status === "EXECUTED" ? "success" : item.status === "ERROR" || item.status === "FAILED" ? "danger" : "warning"}>
                    {item.status}
                  </Badge>
                </td>
                <td className="text-[10px] text-[var(--color-text-secondary)]">{item.messages?.join(" | ") || "OK"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Pagination */}
      {totalPreviewPages > 1 ? (
        <div className="flex items-center justify-between border-t border-[var(--color-border)] px-4 py-3">
          <p className="text-xs text-[var(--color-text-muted)]">
            Mostrando {(previewPage - 1) * PREVIEW_PAGE_SIZE + 1}–{Math.min(previewPage * PREVIEW_PAGE_SIZE, items.length)} de {items.length} filas
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPreviewPage(Math.max(1, previewPage - 1))}
              disabled={previewPage === 1}
              className="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            {Array.from({ length: totalPreviewPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPreviewPages || Math.abs(p - previewPage) <= 2)
              .reduce<(number | "...")[]>((acc, p, idx, arr) => {
                if (idx > 0 && p - (arr[idx - 1] ?? 0) > 1) acc.push("...");
                acc.push(p);
                return acc;
              }, [])
              .map((p, idx) =>
                p === "..." ? (
                  <span key={`ellipsis-${idx}`} className="px-1 text-xs text-[var(--color-text-soft)]">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPreviewPage(p)}
                    className={`min-w-[32px] rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      previewPage === p
                        ? "border-[var(--color-master-400)] bg-[var(--color-master-50)] text-[var(--color-master-700)]"
                        : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]"
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
            <button
              onClick={() => setPreviewPage(Math.min(totalPreviewPages, previewPage + 1))}
              disabled={previewPage === totalPreviewPages}
              className="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

