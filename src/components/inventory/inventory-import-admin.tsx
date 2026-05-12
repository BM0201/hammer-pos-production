"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/client/api";

type Branch = { id: string; code: string; name: string };
type Category = { id: string; name: string };
type PreviewItem = {
  rowNumber: number;
  sku: string;
  name: string;
  quantity: number;
  unitCost: number;
  targetBranchId: string;
  targetBranchCode: string;
  productStatus: "EXISTING" | "NEW";
  action: "IMPORT_EXISTING" | "CREATE_AND_IMPORT";
  status: "READY" | "ERROR";
  messages: string[];
};

type DestinationMode = "SINGLE" | "MULTI" | "ALL" | "FILE";
type Summary = {
  parsedRows: number;
  expandedRows: number;
  existingProducts: number;
  newProducts: number;
  ready: number;
  errors: number;
  globalWarnings?: string[];
  blocksExecution?: boolean;
};

export function InventoryImportAdmin({ branches, categories }: { branches: Branch[]; categories: Category[] }) {
  const [fileName, setFileName] = useState("");
  const [filePayload, setFilePayload] = useState<{ fileContent?: string; fileBase64?: string; fileName?: string }>({});
  const [destinationMode, setDestinationMode] = useState<DestinationMode>("SINGLE");
  const [defaultBranchId, setDefaultBranchId] = useState(branches[0]?.id ?? "");
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [createMissingProducts, setCreateMissingProducts] = useState(false);
  const [defaultCategoryId, setDefaultCategoryId] = useState(categories[0]?.id ?? "");
  const [defaultUnit, setDefaultUnit] = useState("UN");
  const [defaultStandardSalePrice, setDefaultStandardSalePrice] = useState("1");
  const [feedback, setFeedback] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

  const readyItems = useMemo(() => previewItems.filter((item) => item.status === "READY"), [previewItems]);

  async function onFileChange(file: File | null) {
    if (!file) {
      setFileName("");
      setFilePayload({});
      return;
    }
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (extension === "xlsx") {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
      setFilePayload({ fileBase64: btoa(binary), fileName: file.name });
    } else {
      const text = await file.text();
      setFilePayload({ fileContent: text, fileName: file.name });
    }
    setFileName(file.name);
    setPreviewItems([]);
    setSummary(null);
  }

  async function handlePreview() {
    if (!filePayload.fileContent?.trim() && !filePayload.fileBase64) {
      setFeedback({ tone: "error", text: "Debes cargar un archivo XLSX/CSV/TSV/TXT con datos de inventario." });
      return;
    }

    setLoadingPreview(true);
    setFeedback({ tone: "info", text: "Procesando preview..." });
    try {
      const response = await apiFetch("/api/master/inventory/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "preview",
          ...filePayload,
          destinationMode,
          branchIds: destinationMode === "MULTI" ? selectedBranchIds : undefined,
          defaultBranchId: destinationMode === "SINGLE" ? defaultBranchId : undefined,
        }),
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.message ?? "No se pudo generar preview.");
      }

      setPreviewItems(json.data.items ?? []);
      setSummary(json.data.summary ?? null);
      setFeedback({ tone: "success", text: "Preview generado. Revisa el diagnóstico global antes de ejecutar." });
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "No se pudo generar preview." });
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleExecute() {
    if (summary?.blocksExecution) {
      setFeedback({ tone: "error", text: "El archivo fue clasificado como catálogo/no apto. Corrige el archivo antes de importar stock." });
      return;
    }
    if (readyItems.length === 0) {
      setFeedback({ tone: "error", text: "No hay filas READY para ejecutar." });
      return;
    }

    setExecuting(true);
    setFeedback({ tone: "info", text: "Ejecutando importación..." });
    try {
      const response = await apiFetch("/api/master/inventory/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "execute",
          items: previewItems,
          createMissingProducts,
          defaultCategoryId: createMissingProducts ? defaultCategoryId : undefined,
          defaultUnit,
          defaultStandardSalePrice: Number(defaultStandardSalePrice),
        }),
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.message ?? "No se pudo ejecutar importación.");
      }

      const data = json.data as { insertados: number; actualizados: number; omitidos: number; errores: number };
      setFeedback({
        tone: "success",
        text: `Importación completada. Insertados: ${data.insertados}, Actualizados: ${data.actualizados}, Omitidos: ${data.omitidos}, Errores: ${data.errores}.`,
      });
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "No se pudo ejecutar importación." });
    } finally {
      setExecuting(false);
    }
  }

  return (
    <Card className="space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Importación masiva de inventario (XLSX/CSV/TSV/TXT)</h2>
        <p className="text-xs text-[var(--color-text-muted)]">
          Encabezados recomendados: SKU/código, Producto/nombre, Qty./cantidad, Cost price/costo. Soporta archivos exportados desde Excel y ERP.
        </p>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <Input type="file" accept=".xlsx,.csv,.tsv,.txt" onChange={(event) => onFileChange(event.target.files?.[0] ?? null)} />
        <select className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" value={destinationMode} onChange={(e) => setDestinationMode(e.target.value as DestinationMode)}>
          <option value="SINGLE">Importar a una sucursal</option>
          <option value="MULTI">Importar a varias sucursales</option>
          <option value="ALL">Replicar a todas las sucursales activas</option>
          <option value="FILE">Usar sucursal del archivo</option>
        </select>
      </div>

      {destinationMode === "SINGLE" ? (
        <select className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" value={defaultBranchId} onChange={(e) => setDefaultBranchId(e.target.value)}>
          {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>)}
        </select>
      ) : null}

      {destinationMode === "MULTI" ? (
        <div className="grid gap-1 rounded border border-[var(--color-border)] p-2 text-sm">
          {branches.map((branch) => (
            <label key={branch.id} className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={selectedBranchIds.includes(branch.id)}
                onChange={(e) => {
                  setSelectedBranchIds((prev) => e.target.checked ? [...prev, branch.id] : prev.filter((id) => id !== branch.id));
                }}
              />
              <span>{branch.code} · {branch.name}</span>
            </label>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" loading={loadingPreview} onClick={handlePreview}>Generar preview</Button>
        <Button type="button" variant="success" loading={executing} onClick={handleExecute} disabled={loadingPreview || previewItems.length === 0}>
          Ejecutar importación
        </Button>
      </div>

      <div className="grid gap-2 rounded border border-[var(--color-border)] p-3 md:grid-cols-4">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={createMissingProducts} onChange={(e) => setCreateMissingProducts(e.target.checked)} />
          Crear productos no encontrados
        </label>
        <select className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" value={defaultCategoryId} onChange={(e) => setDefaultCategoryId(e.target.value)} disabled={!createMissingProducts}>
          {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
        </select>
        <Input value={defaultUnit} onChange={(e) => setDefaultUnit(e.target.value)} disabled={!createMissingProducts} placeholder="Unidad por defecto" />
        <Input type="number" min="0.01" step="0.01" value={defaultStandardSalePrice} onChange={(e) => setDefaultStandardSalePrice(e.target.value)} disabled={!createMissingProducts} placeholder="Precio por defecto" />
      </div>

      {summary ? (
        <div className="grid gap-2 rounded border border-[var(--color-border)] p-3 text-xs text-[var(--color-text-muted)] md:grid-cols-3">
          <div>Archivo: {fileName || "sin nombre"}</div>
          <div>Filas parseadas: {summary.parsedRows}</div>
          <div>Filas expandidas: {summary.expandedRows}</div>
          <div>Existentes: {summary.existingProducts}</div>
          <div>Nuevos: {summary.newProducts}</div>
          <div>READY: {summary.ready} | ERROR: {summary.errors}</div>
          <div>Warnings globales: {summary.globalWarnings?.length ?? 0}</div>
        </div>
      ) : null}

      {summary?.globalWarnings?.length ? (
        <div className="rounded-lg border border-[var(--color-warning-300)] bg-[var(--color-warning-50)] p-3 text-sm text-[var(--color-warning-700)]">
          <p className="font-semibold">Diagnóstico global del archivo</p>
          <ul className="list-disc pl-5">
            {summary.globalWarnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      ) : null}

      {feedback ? (
        <div className={`rounded-lg border p-3 text-sm ${feedback.tone === "success" ? "border-[var(--color-success-300)] bg-[var(--color-success-50)] text-[var(--color-success-700)]" : ""} ${feedback.tone === "error" ? "border-[var(--color-danger-300)] bg-[var(--color-danger-50)] text-[var(--color-danger-700)]" : ""} ${feedback.tone === "info" ? "border-[var(--color-info-300)] bg-[var(--color-info-50)] text-[var(--color-info-700)]" : ""}`}>
          {feedback.text}
        </div>
      ) : null}

      {previewItems.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left uppercase tracking-wide text-[var(--color-text-soft)]">
                <th className="px-2 py-2">Fila</th>
                <th className="px-2 py-2">SKU</th>
                <th className="px-2 py-2">Producto</th>
                <th className="px-2 py-2">Sucursal</th>
                <th className="px-2 py-2">Cantidad</th>
                <th className="px-2 py-2">Costo</th>
                <th className="px-2 py-2">Estado</th>
                <th className="px-2 py-2">Mensajes</th>
              </tr>
            </thead>
            <tbody>
              {previewItems.slice(0, 200).map((item, idx) => (
                <tr key={`${item.rowNumber}-${item.sku}-${item.targetBranchId}-${idx}`} className="border-b border-[var(--color-border)]">
                  <td className="px-2 py-2">{item.rowNumber}</td>
                  <td className="px-2 py-2">{item.sku}</td>
                  <td className="px-2 py-2">{item.name || "—"}</td>
                  <td className="px-2 py-2">{item.targetBranchCode}</td>
                  <td className="px-2 py-2">{item.quantity}</td>
                  <td className="px-2 py-2">{item.unitCost}</td>
                  <td className="px-2 py-2">{item.status}</td>
                  <td className="px-2 py-2">{item.messages.join(" | ") || "OK"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}
