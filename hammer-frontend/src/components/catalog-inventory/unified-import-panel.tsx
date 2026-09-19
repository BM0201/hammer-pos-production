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
  CATALOG_ONLY: { label: "Solo Catálogo", desc: "Crear o actualizar productos. Solo necesitas nombre y categoría.", color: "text-blue-600" },
  CATALOG_WITH_INITIAL_INVENTORY: { label: "Catálogo + Inventario", desc: "Crear productos con stock inicial. Necesitas nombre, categoría, cantidad y costo.", color: "text-emerald-600" },
  INVENTORY_ONLY: { label: "Solo Inventario", desc: "Agregar stock a productos existentes (requiere SKU).", color: "text-amber-600" },
  PRICES_COSTS_ONLY: { label: "Solo Precios/Costos", desc: "Actualizar precios y costos (requiere SKU).", color: "text-purple-600" },
  PHYSICAL_COUNT: { label: "Conteo Físico", desc: "Ajustar stock por conteo real (requiere SKU).", color: "text-red-600" },
};

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
      const response = await apiFetch("/api/master/catalog-inventory/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "analyze",
          importType,
          destinationMode,
          defaultCategoryId: defaultCategoryId || undefined,
          ...filePayload,
        }),
      });
      const raw = await response.json();
      if (!response.ok) throw new Error(raw.message ?? "No se pudo analizar el archivo.");
      const result = unwrapApiData(raw) as AnalysisResult;
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
        const response = await apiFetch("/api/master/catalog-inventory/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "create-categories", categoryCodes: analysis.missingCategories }),
        });
        const raw = await response.json();
        if (!response.ok) throw new Error(raw.message ?? "No se pudo crear las categorías.");
        const result = unwrapApiData(raw);
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
      const response = await apiFetch("/api/master/catalog-inventory/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        }),
      });
      const raw = await response.json();
      if (!response.ok) throw new Error(raw.message ?? "No se pudo generar preview.");
      const result = unwrapApiData(raw);
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
    try {
      const response = await apiFetch("/api/master/catalog-inventory/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "execute", batchId }),
      });
      const raw = await response.json();
      if (!response.ok) throw new Error(raw.message ?? "No se pudo ejecutar importación.");
      const result = unwrapApiData(raw);
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

  const readyRows = Number(summary?.readyRows ?? summary?.ready ?? 0);
  const errorRows = Number(summary?.errorRows ?? summary?.errors ?? 0);
  const canExecute = Boolean(batchId && summary?.status === "PREVIEWED" && readyRows > 0);
  const hasFile = Boolean(filePayload.fileBase64 || filePayload.fileContent);

  return (
    <div className="space-y-4">
      {/* ── Step 1: Info Banner ── */}
      <Card noPadding>
        <div className="hm-card-header-blue px-5 py-4">
          <h2 className="text-base font-bold flex items-center gap-2"><Zap className="h-5 w-5" /> Importación Simplificada</h2>
          <p className="text-white/85 text-xs mt-1 relative z-10">Solo necesitas <strong>Nombre</strong> y <strong>Categoría</strong>. El SKU se genera automáticamente.</p>
        </div>
        <div className="p-4 space-y-4">

          {/* ── Quick guide ── */}
          <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
            <Info className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-blue-900 space-y-1">
              <p className="font-semibold">¿Cómo funciona?</p>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>Descarga la <strong>plantilla</strong> según el tipo de importación</li>
                <li>Llena los datos en Excel o CSV (mínimo: <strong>nombre</strong> y <strong>categoría</strong>)</li>
                <li>Sube el archivo → <strong>Preview</strong> para verificar → <strong>Ejecutar</strong></li>
              </ol>
              <p className="text-blue-700 mt-1">💡 <strong>SKU automático:</strong> Si no incluyes columna SKU, el sistema genera códigos inteligentes basados en el nombre del producto (ej: <code className="bg-blue-100 px-1 rounded">CEM-CEM-425KG-0001</code>).</p>
            </div>
          </div>

          {/* ── Import type selector ── */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Tipo de importación</label>
            <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-5">
              {Object.entries(IMPORT_TYPE_LABELS).map(([key, info]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setImportType(key); resetState(); }}
                  className={`text-left rounded-lg border-2 p-3 transition-all text-xs ${
                    importType === key
                      ? "border-blue-500 bg-blue-50 shadow-sm"
                      : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  <span className={`font-semibold block ${importType === key ? "text-blue-700" : "text-gray-800"}`}>{info.label}</span>
                  <span className="text-gray-500 block mt-0.5 leading-tight">{info.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Template + File Upload side by side ── */}
          <div className="grid gap-4 md:grid-cols-2">
            {/* Template download */}
            <div className="rounded-lg border border-dashed border-emerald-300 bg-emerald-50 p-4 text-center">
              <FileSpreadsheet className="h-8 w-8 text-emerald-600 mx-auto mb-2" />
              <p className="text-xs font-semibold text-emerald-800">Plantilla {typeInfo.label}</p>
              <p className="text-xs text-emerald-600 mt-1">
                Columnas: <strong>{(IMPORT_TEMPLATES[importType] ?? IMPORT_TEMPLATES.CATALOG_ONLY).headers.join(", ")}</strong>
              </p>
              <button
                type="button"
                onClick={() => downloadTemplate(importType)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors"
              >
                <Download className="h-3.5 w-3.5" /> Descargar Plantilla CSV
              </button>
            </div>

            {/* File upload */}
            <div
              className={`rounded-lg border-2 border-dashed p-4 text-center transition-colors cursor-pointer ${
                hasFile ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-blue-400 hover:bg-blue-50/50"
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
              <FileUp className={`h-8 w-8 mx-auto mb-2 ${hasFile ? "text-blue-600" : "text-gray-400"}`} />
              {hasFile ? (
                <>
                  <p className="text-xs font-semibold text-blue-800">{fileName}</p>
                  <p className="text-xs text-blue-600 mt-1">Archivo cargado ✓ — Clic para cambiar</p>
                </>
              ) : (
                <>
                  <p className="text-xs font-semibold text-gray-600">Subir archivo Excel o CSV</p>
                  <p className="text-xs text-gray-500 mt-1">Clic aquí o arrastra tu archivo (.xlsx, .csv)</p>
                </>
              )}
            </div>
          </div>

          {/* ── Branch + Category config ── */}
          <div className="grid gap-3 md:grid-cols-3">
            {needsBranchSelection ? (
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Sucursal destino</label>
                <select className="hm-input w-full" value={destinationMode} onChange={(e) => { setDestinationMode(e.target.value); resetState(); }}>
                  <option value="SINGLE">Una sucursal</option><option value="ALL">Todas las sucursales</option><option value="FILE">Desde el archivo (columna sucursal)</option>
                </select>
              </div>
            ) : null}
            {needsBranchSelection && destinationMode === "SINGLE" ? (
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Sucursal</label>
                <select className="hm-input w-full" value={defaultBranchId} onChange={(e) => { setDefaultBranchId(e.target.value); resetState(); }}>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
                </select>
              </div>
            ) : null}
            {isCatalogType ? (
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Categoría por defecto</label>
                <select className="hm-input w-full" value={defaultCategoryId} onChange={(e) => setDefaultCategoryId(e.target.value)}>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <p className="text-[10px] text-gray-500 mt-0.5">Se usa si el archivo no trae columna categoría</p>
              </div>
            ) : null}
          </div>

          {/* ── Parte B.2: "una planilla de inventario no debería reescribir
              precios de venta salvo que alguien lo pida explícitamente" —
              casilla separada, apagada por defecto. Solo aplica cuando el
              archivo también trae columna de precio junto a la carga de
              existencias (CATALOG_WITH_INITIAL_INVENTORY). ── */}
          {importType === "CATALOG_WITH_INITIAL_INVENTORY" ? (
            <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={updateSalePrices}
                onChange={(e) => { setUpdateSalePrices(e.target.checked); resetState(); }}
                className="mt-0.5"
              />
              <span>
                <span className="font-semibold text-amber-800">Actualizar también los precios de venta</span>
                <span className="block text-amber-700 mt-0.5">
                  Si tu archivo trae columna &quot;precio&quot; y NO marcas esto, solo se cargan existencias — los precios de venta existentes quedan intactos.
                </span>
              </span>
            </label>
          ) : null}

          {/* ── Advanced toggle ── */}
          <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
            <Settings2 className="h-3.5 w-3.5" /> Opciones avanzadas {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {showAdvanced ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs space-y-2">
              <p className="text-gray-600">El sistema auto-genera SKU, crea productos nuevos y usa unidad &quot;UN&quot; por defecto. Columnas opcionales en tu archivo:</p>
              <div className="grid gap-1 md:grid-cols-2">
                <span className="text-gray-500">• <strong>sku</strong> — código manual (si prefieres no auto-generar)</span>
                <span className="text-gray-500">• <strong>unidad</strong> — unidad de medida (UN, KG, M, etc.)</span>
                <span className="text-gray-500">• <strong>precio</strong> — precio de venta sugerido</span>
                <span className="text-gray-500">• <strong>sucursal</strong> — código de sucursal (modo &quot;Desde archivo&quot;)</span>
              </div>
            </div>
          ) : null}

          {/* ── Parte B.2: "el preview del lote tiene que mostrar 'N
              productos van a cambiar de precio' con la lista y el
              antes/después de cada uno" ── */}
          {priceChanges.length > 0 ? (
            <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-3">
              <p className="text-xs font-bold text-amber-800 mb-1.5">
                {priceChanges.length} producto{priceChanges.length !== 1 ? "s" : ""} van a cambiar de precio de venta:
              </p>
              <ul className="text-xs text-amber-700 space-y-0.5 max-h-32 overflow-y-auto font-mono">
                {priceChanges.map((p) => (
                  <li key={p.sku}>{p.sku} — {p.name}: {money(p.previousPrice)} → {money(p.newPrice)}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* ── Action buttons ── */}
          <div className="flex items-center gap-3 pt-2 border-t border-gray-200">
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
              <div className="rounded-lg border-2 border-orange-300 bg-orange-50 p-4 space-y-2">
                <div className="flex items-center gap-2 text-orange-800">
                  <Tags className="h-5 w-5" />
                  <h3 className="text-sm font-bold">Hay categorías que no están creadas para el SKU. ¿Crearlas?</h3>
                </div>
                <p className="text-xs text-orange-700">
                  Se detectaron <strong>{analysis.missingCategories.length}</strong> categoría(s) que no existen en el sistema. Si confirmas, se crearán automáticamente:
                </p>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {analysis.missingCategories.map((code) => (
                    <span key={code} className="inline-flex items-center rounded-full bg-orange-200 px-2.5 py-1 text-xs font-semibold text-orange-900">
                      {code}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {/* New products with auto-SKU */}
            {analysis.autoSkuCount > 0 ? (
              <div className="rounded-lg border-2 border-blue-300 bg-blue-50 p-4 space-y-2">
                <div className="flex items-center gap-2 text-blue-800">
                  <Wand2 className="h-5 w-5" />
                  <h3 className="text-sm font-bold">Hay productos que serán creados y tendrán su SKU basado en su categoría</h3>
                </div>
                <p className="text-xs text-blue-700">
                  Se detectaron <strong>{analysis.autoSkuCount} producto{analysis.autoSkuCount !== 1 ? "s" : ""}</strong> sin SKU que se crearán con un código generado automáticamente basado en su categoría y nombre.
                </p>
                <p className="text-xs text-blue-600 flex items-center gap-1">
                  <Sparkles className="h-3.5 w-3.5" />
                  Ejemplo: <code className="bg-blue-100 px-1.5 py-0.5 rounded font-mono text-[11px]">ALM-CEM-425KG-0001</code>
                </p>
              </div>
            ) : null}

            {/* New products total (with manual SKU) */}
            {analysis.newProductCount > analysis.autoSkuCount ? (
              <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
                <div className="flex items-center gap-2 text-emerald-800">
                  <Package className="h-5 w-5" />
                  <h3 className="text-sm font-bold">{analysis.newProductCount - analysis.autoSkuCount} producto{analysis.newProductCount - analysis.autoSkuCount !== 1 ? "s" : ""} nuevos con SKU manual</h3>
                </div>
                <p className="text-xs text-emerald-700 mt-1">
                  Estos productos tienen SKU en el archivo y se crearán con ese código.
                </p>
              </div>
            ) : null}

            {/* Summary */}
            <div className="flex items-center gap-3 rounded-lg bg-gray-50 border border-gray-200 p-3">
              <Info className="h-4 w-4 text-gray-500 flex-shrink-0" />
              <p className="text-xs text-gray-600">
                Total de filas: <strong>{analysis.totalRows}</strong> · Productos nuevos: <strong>{analysis.newProductCount}</strong> · Categorías por crear: <strong>{analysis.missingCategories.length}</strong>
              </p>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3 pt-3 border-t border-gray-200">
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
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-center">
                <span className="text-lg font-bold text-gray-800">{summary.parsedRows ?? items.length}</span>
                <p className="text-[10px] text-gray-500">Filas leídas</p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-center">
                <span className="text-lg font-bold text-emerald-700">{readyRows}</span>
                <p className="text-[10px] text-emerald-600">Listas (READY)</p>
              </div>
              <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-center">
                <span className="text-lg font-bold text-red-700">{errorRows}</span>
                <p className="text-[10px] text-red-600">Con errores</p>
              </div>
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-center">
                <span className="text-lg font-bold text-blue-700">{summary.newProducts ?? 0}</span>
                <p className="text-[10px] text-blue-600">Productos nuevos</p>
              </div>
              <div className="rounded-lg border border-purple-200 bg-purple-50 p-2.5 text-center">
                <span className="text-lg font-bold text-purple-700">{summary.existingProducts ?? 0}</span>
                <p className="text-[10px] text-purple-600">Ya existentes</p>
              </div>
            </div>

            {step === "done" ? (
              <div className="grid gap-2 md:grid-cols-4 text-xs">
                <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2"><strong className="text-emerald-700">{summary.executedLines ?? 0}</strong> ejecutadas</div>
                <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2"><strong className="text-blue-700">{summary.createdProducts ?? 0}</strong> productos creados</div>
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2"><strong className="text-amber-700">{summary.inventoryMovements ?? 0}</strong> movimientos</div>
                <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2"><strong className="text-gray-700">{summary.skippedLines ?? 0}</strong> omitidas</div>
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
          <thead className="sticky top-0 bg-white z-10">
            <tr>
              <th className="w-12">Fila</th>
              <th>SKU <span title="Auto-generado"><Wand2 className="h-3 w-3 inline text-blue-500 ml-1" /></span></th>
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
              <tr key={`${item.rowNumber}-${index}`} className={item.status === "ERROR" || item.status === "FAILED" ? "bg-red-50" : ""}>
                <td className="text-center">{item.rowNumber}</td>
                <td className="font-mono text-[10px]">{item.sku}</td>
                <td>{item.name}</td>
                <td><Badge variant={item.action === "Crear producto" ? "info" : item.action === "Error" ? "danger" : "warning"}>{item.action}</Badge></td>
                <td>{item.targetBranchCode}</td>
                <td className="text-right">{item.quantity ?? ""}</td>
                <td className="text-right">{item.unitCost ?? ""}</td>
                <td className="text-right">{item.standardSalePrice ?? ""}</td>
                <td>
                  <Badge variant={item.status === "READY" || item.status === "EXECUTED" ? "success" : item.status === "ERROR" || item.status === "FAILED" ? "danger" : "warning"}>
                    {item.status}
                  </Badge>
                </td>
                <td className="text-[10px] text-gray-600">{item.messages?.join(" | ") || "OK"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Pagination */}
      {totalPreviewPages > 1 ? (
        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-500">
            Mostrando {(previewPage - 1) * PREVIEW_PAGE_SIZE + 1}–{Math.min(previewPage * PREVIEW_PAGE_SIZE, items.length)} de {items.length} filas
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPreviewPage(Math.max(1, previewPage - 1))}
              disabled={previewPage === 1}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
                  <span key={`ellipsis-${idx}`} className="px-1 text-xs text-gray-400">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPreviewPage(p)}
                    className={`min-w-[32px] rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      previewPage === p
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
            <button
              onClick={() => setPreviewPage(Math.min(totalPreviewPages, previewPage + 1))}
              disabled={previewPage === totalPreviewPages}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

