"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import type { Route } from "next";
import toast from "react-hot-toast";
import { ArrowLeft, Camera, Check, Loader2, Package, Printer, QrCode, ScanLine, Search, Undo2, Link2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CameraScanner } from "@/components/scanner/camera-scanner";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { useSubmitting } from "@/lib/client/use-submitting";
import { useSession } from "@/lib/client/session";
import { useCameraAvailable } from "@/lib/client/use-camera-available";
import { getActiveBranchId } from "@/lib/client/active-branch";
import { printProductLabels } from "@/lib/client/print-product-labels";
import { money } from "@/lib/format";
import {
  decideScanStep,
  shouldIgnoreRepeatedCode,
  loadRememberedProductDefaults,
  saveRememberedProductDefaults,
  loadRememberedScanMode,
  saveRememberedScanMode,
  findSimilarProductByName,
  needsSecondCodeConfirmation,
  type ScanStep,
  type ScanMode,
  type RememberedProductDefaults,
  type NameSimilarityCandidate,
} from "@/lib/quick-add-product";

/**
 * prompt-alta-productos-qr.md Fase 2 — alta en serie con lector USB/
 * Bluetooth (escribe el código como teclado + Enter) O con la cámara
 * (CameraScanner, modo continuo — botón solo visible si useCameraAvailable).
 * Las dos entran por el MISMO camino: lookupCode(código), con el mismo
 * debounce de 1.5s (shouldIgnoreRepeatedCode) para ignorar una lectura
 * repetida entre cuadros continuos.
 *
 * prompt-codigos-y-duplicados.md Fase 2 — "Escanear productos" (antes
 * "Alta rápida con escáner"): dos modos, recordados entre sesiones.
 * Registrar nuevos es el comportamiento de siempre (código no encontrado →
 * formulario de alta). Etiquetar catálogo es nuevo: código no encontrado →
 * buscar el producto YA existente y vincularle este código — nunca crea un
 * producto nuevo desde ese modo.
 */

type Category = { id: string; code: string; name: string; isActive: boolean };

// Mismo listado que el alta manual (catalog-inventory-admin.tsx) — unidades
// fijas del catálogo, no texto libre.
const UNIT_OPTIONS = [
  { value: "UN", label: "UN — Unidad" },
  { value: "KG", label: "KG — Kilogramo" },
  { value: "LB", label: "LB — Libra" },
  { value: "M", label: "M — Metro" },
  { value: "M2", label: "M2 — Metro cuadrado" },
  { value: "M3", label: "M3 — Metro cúbico" },
  { value: "L", label: "L — Litro" },
  { value: "GAL", label: "GAL — Galón" },
  { value: "BOLSA", label: "BOLSA" },
  { value: "SACO", label: "SACO" },
  { value: "ROLLO", label: "ROLLO" },
  { value: "CAJA", label: "CAJA" },
  { value: "PAR", label: "PAR" },
  { value: "JUEGO", label: "JUEGO" },
];

type SessionRow = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  standardSalePrice: number;
  isInternalCode: boolean;
  printLabel: boolean;
};

type FormState = {
  name: string;
  sku: string;
  showSkuField: boolean;
  categoryId: string;
  unit: string;
  standardSalePrice: string;
  allowsFraction: boolean;
};

function defaultForm(remembered: RememberedProductDefaults | null): FormState {
  return {
    name: "",
    sku: "",
    showSkuField: false,
    categoryId: remembered?.categoryId ?? "",
    unit: remembered?.unit ?? "UN",
    standardSalePrice: "",
    allowsFraction: remembered?.allowsFraction ?? false,
  };
}

function readRememberedDefaults(): RememberedProductDefaults | null {
  try {
    return loadRememberedProductDefaults(window.localStorage);
  } catch {
    return null;
  }
}

function readRememberedMode(): ScanMode {
  try {
    return loadRememberedScanMode(window.localStorage);
  } catch {
    return "REGISTER";
  }
}

type LabelSearchResult = {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  barcodes?: string[];
  standardSalePrice: number | string;
  isActive: boolean;
  category?: { name: string } | null;
};

type LinkedEntry = { barcodeId: string; productId: string; productName: string; code: string };

export default function QuickAddProductPage() {
  const [mode, setMode] = useState<ScanMode>(() => readRememberedMode());
  const [categories, setCategories] = useState<Category[]>([]);
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [step, setStep] = useState<ScanStep | null>(null);
  const [noCodeMode, setNoCodeMode] = useState(false);
  const [form, setForm] = useState<FormState>(() => defaultForm(null));
  const [sessionRows, setSessionRows] = useState<SessionRow[]>([]);
  const [submitting, runSubmit] = useSubmitting();
  const [printing, setPrinting] = useState(false);
  const sessionState = useSession();
  const cameraAvailable = useCameraAvailable();
  const [showCamera, setShowCamera] = useState(false);

  // ── Registrar nuevos: "¿este producto ya está en el catálogo?" ──
  const [nameSuggestion, setNameSuggestion] = useState<NameSimilarityCandidate | null>(null);
  const [linkingExisting, setLinkingExisting] = useState(false);

  // ── Etiquetar catálogo ──
  const [labelQuery, setLabelQuery] = useState("");
  const [labelResults, setLabelResults] = useState<LabelSearchResult[]>([]);
  const [labelSearching, setLabelSearching] = useState(false);
  const [labelSelected, setLabelSelected] = useState<LabelSearchResult | null>(null);
  const [labelSubmitting, setLabelSubmitting] = useState(false);
  const [linkedCount, setLinkedCount] = useState(0);
  const [lastLinked, setLastLinked] = useState<LinkedEntry | null>(null);

  const codeInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const labelSearchRef = useRef<HTMLInputElement>(null);
  const lastCodeRef = useRef<{ code: string; at: number } | null>(null);
  const nameCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const labelSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/catalog/categories");
        const data = unwrapApiData(await res.json()) as Category[];
        setCategories(data.filter((c) => c.isActive));
      } catch {
        toast.error("No se pudieron cargar las categorías.");
      }
    })();
  }, []);

  useEffect(() => () => {
    if (nameCheckTimer.current) clearTimeout(nameCheckTimer.current);
    if (labelSearchTimer.current) clearTimeout(labelSearchTimer.current);
  }, []);

  // Foco permanente en el campo Código salvo cuando el formulario de alta
  // está abierto (ahí el foco va al Nombre) o el buscador de Etiquetar
  // catálogo está abierto (foco al buscador).
  useEffect(() => {
    if (step?.kind === "REGISTER_NOT_FOUND") {
      nameInputRef.current?.focus();
    } else if (step?.kind === "LABEL_SEARCH") {
      labelSearchRef.current?.focus();
    } else {
      codeInputRef.current?.focus();
    }
  }, [step]);

  function switchMode(next: ScanMode) {
    if (next === mode) return;
    setMode(next);
    try {
      saveRememberedScanMode(window.localStorage, next);
    } catch {
      // No crítico.
    }
    resetToScan();
  }

  const lookupCode = useCallback(async (rawCode: string) => {
    const trimmed = rawCode.trim();
    if (!trimmed) return;

    const now = Date.now();
    if (shouldIgnoreRepeatedCode(trimmed, now, lastCodeRef.current)) return;
    lastCodeRef.current = { code: trimmed, at: now };

    setChecking(true);
    setNoCodeMode(false);
    setNameSuggestion(null);
    setLabelSelected(null);
    setLabelQuery("");
    setLabelResults([]);
    try {
      const res = await apiFetch(`/api/catalog/products/by-code?code=${encodeURIComponent(trimmed)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const message = (body?.error?.message as string | undefined) ?? "No se pudo consultar el código.";
        setStep(decideScanStep({ mode, code: trimmed, response: null, errorMessage: message }));
        return;
      }
      const data = unwrapApiData(body);
      const decided = decideScanStep({ mode, code: trimmed, response: data });
      setStep(decided);
      if (decided.kind === "REGISTER_NOT_FOUND") {
        setForm(defaultForm(readRememberedDefaults()));
      }
    } catch {
      setStep(decideScanStep({ mode, code: trimmed, response: null, errorMessage: "Error de red." }));
    } finally {
      setChecking(false);
    }
  }, [mode]);

  function handleCodeKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void lookupCode(code);
  }

  function handleStartNoCode() {
    lastCodeRef.current = null;
    setCode("");
    setNoCodeMode(true);
    setStep({ kind: "REGISTER_NOT_FOUND", code: "" });
    setForm(defaultForm(readRememberedDefaults()));
  }

  function resetToScan() {
    setStep(null);
    setNoCodeMode(false);
    setCode("");
    setNameSuggestion(null);
    setLabelSelected(null);
    setLabelQuery("");
    setLabelResults([]);
  }

  // ── Registrar nuevos: "¿ya existe?" — se dispara al tipear el nombre, con
  // el mismo debounce de 350ms que usa el buscador del catálogo. Pura
  // sugerencia: nunca bloquea seguir escribiendo ni guardar como nuevo.
  function handleNameChange(value: string) {
    setForm((prev) => ({ ...prev, name: value }));
    if (nameCheckTimer.current) clearTimeout(nameCheckTimer.current);
    if (value.trim().length < 3) {
      setNameSuggestion(null);
      return;
    }
    nameCheckTimer.current = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/catalog/products?q=${encodeURIComponent(value.trim())}&limit=10`);
        const raw = await res.json();
        const data = unwrapApiData(raw) as Array<{ id: string; name: string; sku: string }>;
        setNameSuggestion(findSimilarProductByName(value, data));
      } catch {
        // Silencioso — es una sugerencia, no un chequeo obligatorio.
      }
    }, 350);
  }

  async function handleLinkToExisting(productId: string, productName: string) {
    if (step?.kind !== "REGISTER_NOT_FOUND" || !step.code) return;
    setLinkingExisting(true);
    try {
      const res = await apiFetch(`/api/catalog/products/${productId}/barcodes`, {
        method: "POST",
        body: JSON.stringify({ code: step.code, kind: "FACTORY" }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo vincular el código.");
      toast.success(`Código vinculado a ${productName}.`);
      resetToScan();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo vincular el código.");
    } finally {
      setLinkingExisting(false);
    }
  }

  // ── Etiquetar catálogo: buscador ──
  function handleLabelQueryChange(value: string) {
    setLabelQuery(value);
    setLabelSelected(null);
    if (labelSearchTimer.current) clearTimeout(labelSearchTimer.current);
    if (value.trim().length < 2) {
      setLabelResults([]);
      return;
    }
    labelSearchTimer.current = setTimeout(async () => {
      setLabelSearching(true);
      try {
        const res = await apiFetch(`/api/catalog/products?q=${encodeURIComponent(value.trim())}&limit=20`);
        const raw = await res.json();
        setLabelResults(unwrapApiData(raw) as LabelSearchResult[]);
      } catch {
        toast.error("No se pudo buscar en el catálogo.");
      } finally {
        setLabelSearching(false);
      }
    }, 350);
  }

  async function handleLinkLabel() {
    if (step?.kind !== "LABEL_SEARCH" || !labelSelected) return;
    setLabelSubmitting(true);
    try {
      const res = await apiFetch(`/api/catalog/products/${labelSelected.id}/barcodes`, {
        method: "POST",
        body: JSON.stringify({ code: step.code, kind: "FACTORY" }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo vincular el código.");
      const created = unwrapApiData(raw) as { id: string };
      setLinkedCount((n) => n + 1);
      setLastLinked({ barcodeId: created.id, productId: labelSelected.id, productName: labelSelected.name, code: step.code });
      toast.success(`Vinculado a ${labelSelected.name}.`);
      resetToScan();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo vincular el código.");
    } finally {
      setLabelSubmitting(false);
    }
  }

  async function handleUndoLastLink() {
    if (!lastLinked) return;
    try {
      const res = await apiFetch(`/api/catalog/products/${lastLinked.productId}/barcodes/${lastLinked.barcodeId}`, { method: "DELETE" });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo deshacer.");
      setLinkedCount((n) => Math.max(0, n - 1));
      toast.success(`Deshecho: ${lastLinked.code} ya no está vinculado a ${lastLinked.productName}.`);
      setLastLinked(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo deshacer.");
    }
  }

  async function handleSave() {
    if (step?.kind !== "REGISTER_NOT_FOUND") return;
    if (!form.name.trim() || !form.categoryId || !form.standardSalePrice) {
      toast.error("Nombre, categoría y precio son obligatorios.");
      return;
    }

    await runSubmit(async () => {
      try {
        const res = await apiFetch("/api/catalog/products", {
          method: "POST",
          body: JSON.stringify({
            name: form.name.trim(),
            sku: form.sku.trim() || undefined,
            barcode: !noCodeMode && step.code ? step.code : undefined,
            categoryId: form.categoryId,
            unit: form.unit,
            standardSalePrice: Number(form.standardSalePrice),
            allowsFraction: form.allowsFraction,
          }),
        });
        const body = await res.json().catch(() => null);

        if (!res.ok) {
          if (body?.error?.code === "BARCODE_ALREADY_EXISTS" && body.error.details) {
            // Otra persona lo registró mientras tanto — mostrar el producto existente.
            toast.error(body.error.message as string);
            setStep({ kind: "FOUND", product: body.error.details, matchedBy: "barcode" });
            return;
          }
          throw new Error((body?.error?.message as string | undefined) ?? "No se pudo crear el producto.");
        }

        const createdProduct = unwrapApiData(body) as {
          id: string; name: string; sku: string; barcode: string | null; standardSalePrice: number | string;
        };

        let finalBarcode = createdProduct.barcode;
        let isInternalCode = false;
        if (noCodeMode || !finalBarcode) {
          try {
            const internalRes = await apiFetch(`/api/catalog/products/${createdProduct.id}/internal-barcode`, { method: "POST" });
            const internalBody = await internalRes.json().catch(() => null);
            if (internalRes.ok) {
              const internalProduct = unwrapApiData(internalBody) as { barcode: string };
              finalBarcode = internalProduct.barcode;
              isInternalCode = true;
            }
          } catch {
            // El producto ya se guardó; el código interno se puede asignar después desde el catálogo.
          }
        }

        const remembered: RememberedProductDefaults = {
          categoryId: form.categoryId,
          unit: form.unit,
          allowsFraction: form.allowsFraction,
        };
        try {
          saveRememberedProductDefaults(window.localStorage, remembered);
        } catch {
          // No crítico — ver quick-add-product.ts.
        }

        setSessionRows((prev) => [
          {
            id: createdProduct.id,
            name: createdProduct.name,
            sku: createdProduct.sku,
            barcode: finalBarcode,
            standardSalePrice: Number(createdProduct.standardSalePrice),
            isInternalCode,
            printLabel: isInternalCode,
          },
          ...prev,
        ]);

        toast.success(`${createdProduct.name} (${createdProduct.sku}) guardado.`);
        resetToScan();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Error al guardar.");
      }
    });
  }

  function toggleSessionRowPrint(id: string) {
    setSessionRows((prev) => prev.map((row) => (row.id === id ? { ...row, printLabel: !row.printLabel } : row)));
  }

  const marked = sessionRows.filter((row) => row.printLabel && row.barcode);

  async function handlePrintMarked() {
    if (sessionState.status !== "authenticated") {
      toast.error("No se pudo determinar la sucursal para la etiqueta.");
      return;
    }
    const branchId = getActiveBranchId(sessionState.session.branchIds, sessionState.session.primaryBranchId);
    if (!branchId) {
      toast.error("No tenés una sucursal asignada para imprimir.");
      return;
    }
    setPrinting(true);
    try {
      const result = await printProductLabels({
        products: marked.map((row) => ({ id: row.id, name: row.name, sku: row.sku, barcode: row.barcode, standardSalePrice: row.standardSalePrice })),
        branchId,
      });
      if (result.printed > 0) toast.success(`${result.printed} etiqueta(s) enviada(s) a imprimir.`);
    } catch {
      toast.error("No se pudieron generar las etiquetas.");
    } finally {
      setPrinting(false);
    }
  }

  const formLocked = step?.kind === "REGISTER_NOT_FOUND" || step?.kind === "LABEL_SEARCH";
  const labelConfirming = step?.kind === "LABEL_SEARCH" && labelSelected && needsSecondCodeConfirmation(labelSelected.barcodes?.length ?? 0);

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <Link
          href={"/app/master/catalog-inventory?tab=products" as Route}
          className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 text-sm font-medium hover:bg-[var(--color-surface-alt)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Catálogo
        </Link>
        <div>
          <h1 className="text-xl font-medium" style={{ color: "var(--color-text)" }}>Escanear productos</h1>
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            Escaneá o tecleá el código y presioná Enter — la cámara, el lector USB y el lector Bluetooth escriben igual.
          </p>
        </div>
      </div>

      {/* ── Selector de modo — recordado entre sesiones ── */}
      <div className="inline-flex rounded-lg border border-[var(--color-border)] p-1" style={{ background: "var(--color-surface-alt)" }}>
        <button
          type="button"
          onClick={() => switchMode("REGISTER")}
          disabled={formLocked}
          className={`h-9 rounded-md px-4 text-sm font-semibold transition-colors disabled:opacity-50 ${
            mode === "REGISTER" ? "bg-[var(--color-master-600)] text-white" : "text-[var(--color-text-secondary)]"
          }`}
        >
          Registrar nuevos
        </button>
        <button
          type="button"
          onClick={() => switchMode("LABEL")}
          disabled={formLocked}
          className={`h-9 rounded-md px-4 text-sm font-semibold transition-colors disabled:opacity-50 ${
            mode === "LABEL" ? "bg-[var(--color-master-600)] text-white" : "text-[var(--color-text-secondary)]"
          }`}
        >
          Etiquetar catálogo
        </button>
        {mode === "LABEL" && linkedCount > 0 && (
          <span className="ml-2 flex items-center gap-1 px-2 text-xs font-medium text-[var(--color-text-muted)]">
            <Link2 className="h-3.5 w-3.5" />
            Vinculados en esta sesión: {linkedCount}
          </span>
        )}
      </div>

      {mode === "LABEL" && lastLinked && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-success-300)] bg-[var(--color-success-50)] px-4 py-2.5 text-sm">
          <span className="text-[var(--color-success-800)]">
            {lastLinked.code} vinculado a <strong>{lastLinked.productName}</strong>.
          </span>
          <Button size="sm" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => void handleUndoLastLink()}>
            Deshacer
          </Button>
        </div>
      )}

      {/* ── Campo de código: foco permanente mientras no hay formulario/buscador abierto ── */}
      <Card>
        <div className="space-y-3">
          <label htmlFor="quick-add-code" className="block text-sm font-semibold" style={{ color: "var(--color-text)" }}>
            Código
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <input
              id="quick-add-code"
              ref={codeInputRef}
              className="hm-input h-11 flex-1 min-w-[220px] font-mono text-base"
              placeholder="Escaneá o tecleá el código y presioná Enter"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={handleCodeKeyDown}
              disabled={formLocked}
              autoComplete="off"
            />
            <Button
              variant="secondary"
              className="h-11"
              onClick={() => void lookupCode(code)}
              disabled={checking || !code.trim() || formLocked}
              loading={checking}
            >
              Buscar
            </Button>
            {mode === "REGISTER" && (
              <Button
                variant="ghost"
                className="h-11"
                icon={<QrCode className="h-4 w-4" />}
                onClick={handleStartNoCode}
                disabled={formLocked}
              >
                Sin código — generar QR
              </Button>
            )}
            {cameraAvailable && (
              <Button
                variant={showCamera ? "primary" : "ghost"}
                className="h-11"
                icon={<Camera className="h-4 w-4" />}
                onClick={() => setShowCamera((v) => !v)}
                disabled={formLocked}
              >
                {showCamera ? "Ocultar cámara" : "Usar cámara"}
              </Button>
            )}
          </div>
          {/* Modo continuo: se oculta mientras el formulario/buscador está
              abierto (el campo Código queda bloqueado) y reaparece solo al
              volver a escanear (resetToScan) — mismo criterio que el
              bloqueo del input de arriba. */}
          {cameraAvailable && showCamera && !formLocked && (
            <CameraScanner
              className="max-w-sm"
              onClose={() => setShowCamera(false)}
              onDecode={(rawText) => {
                setCode(rawText);
                void lookupCode(rawText);
              }}
            />
          )}
        </div>
      </Card>

      {/* ── Tarjeta "Ya registrado" ── */}
      {step?.kind === "FOUND" && (
        <Card className="border-2 border-[var(--color-master-300)]">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-master-50)] text-[var(--color-master-600)]">
                <Package className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-master-600)]">Ya registrado</p>
                <p className="text-base font-semibold" style={{ color: "var(--color-text)" }}>{step.product.name}</p>
                <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                  SKU {step.product.sku} · {step.product.category.name} · {money(step.product.standardSalePrice)}
                  {!step.product.isActive && <span className="ml-2 font-semibold text-red-600">(inactivo)</span>}
                </p>
              </div>
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <Link
              href={`/app/master/catalog-inventory/products/${step.product.id}` as Route}
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-[var(--color-border)] px-4 text-sm font-medium hover:bg-[var(--color-surface-alt)]"
            >
              Ver producto
            </Link>
            <Button variant="primary" className="h-11" onClick={resetToScan}>
              Siguiente
            </Button>
          </div>
        </Card>
      )}

      {/* ── Error al consultar el código ── */}
      {step?.kind === "ERROR" && (
        <Card className="border-2 border-red-300 bg-red-50">
          <p className="text-sm font-semibold text-red-700">No se pudo consultar el código.</p>
          <p className="text-sm text-red-600">{step.message}</p>
          <Button variant="secondary" className="mt-3 h-11" onClick={() => void lookupCode(step.code)}>
            Reintentar
          </Button>
        </Card>
      )}

      {/* ── ETIQUETAR CATÁLOGO: buscador de producto existente ── */}
      {step?.kind === "LABEL_SEARCH" && (
        <Card>
          <div className="mb-4 flex items-center gap-2">
            <Search className="h-4 w-4" style={{ color: "var(--color-master-600)" }} />
            <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
              Código <span className="font-mono">{step.code}</span> no está registrado — buscá el producto en el catálogo
            </h2>
          </div>

          <Input
            ref={labelSearchRef}
            className="h-11"
            value={labelQuery}
            onChange={(e) => handleLabelQueryChange(e.target.value)}
            placeholder="Buscar por nombre o SKU…"
          />

          {labelSearching && (
            <p className="mt-2 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando…
            </p>
          )}

          {!labelSelected && labelResults.length > 0 && (
            <div className="mt-3 max-h-72 divide-y divide-[var(--color-border)] overflow-y-auto rounded-lg border border-[var(--color-border)]">
              {labelResults.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setLabelSelected(p)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-[var(--color-surface-alt)]"
                >
                  <div>
                    <span className="font-medium text-[var(--color-text)]">{p.name}</span>
                    <span className="ml-2 font-mono text-xs text-[var(--color-text-muted)]">{p.sku}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {(p.barcodes?.length ?? 0) > 0 && <Badge variant="neutral">{p.barcodes!.length} código{p.barcodes!.length === 1 ? "" : "s"}</Badge>}
                    {!p.isActive && <Badge variant="warning">Inactivo</Badge>}
                  </div>
                </button>
              ))}
            </div>
          )}

          {labelSelected && (
            <div className="mt-3 rounded-lg border-2 border-[var(--color-master-300)] bg-[var(--color-master-50)] p-3">
              <p className="text-sm font-semibold text-[var(--color-text)]">{labelSelected.name}</p>
              <p className="text-xs text-[var(--color-text-muted)]">SKU {labelSelected.sku}</p>

              {labelConfirming && (
                <div className="mt-2 flex items-start gap-2 rounded-lg bg-amber-100 p-2.5 text-xs text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <span>
                    Este producto ya tiene {labelSelected.barcodes?.length} código{labelSelected.barcodes?.length === 1 ? "" : "s"} registrado(s) —
                    {" "}<span className="font-mono">{step.code}</span> se agregaría como código adicional, no como principal.
                  </span>
                </div>
              )}

              <div className="mt-3 flex gap-2">
                <Button variant="success" className="h-10" loading={labelSubmitting} disabled={labelSubmitting} onClick={() => void handleLinkLabel()} icon={<Link2 className="h-4 w-4" />}>
                  {labelConfirming ? "Sí, agregar como código adicional" : "Vincular código"}
                </Button>
                <Button variant="ghost" className="h-10" onClick={() => setLabelSelected(null)} disabled={labelSubmitting}>
                  Elegir otro
                </Button>
              </div>
            </div>
          )}

          <div className="mt-4 border-t border-[var(--color-border)] pt-3">
            <Button variant="ghost" className="h-10" onClick={resetToScan}>
              Cancelar
            </Button>
          </div>
        </Card>
      )}

      {/* ── Formulario de alta rápida (Registrar nuevos) ── */}
      {step?.kind === "REGISTER_NOT_FOUND" && (
        <Card>
          <div className="mb-4 flex items-center gap-2">
            <ScanLine className="h-4 w-4" style={{ color: "var(--color-master-600)" }} />
            <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
              {noCodeMode ? "Producto sin código de fábrica" : "Producto nuevo"}
            </h2>
          </div>

          {nameSuggestion && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border-2 border-amber-300 bg-amber-50 p-3">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-600" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-800">¿Este producto ya está en el catálogo?</p>
                <p className="text-sm text-amber-700">Encontramos &ldquo;{nameSuggestion.name}&rdquo; ({nameSuggestion.sku}) con un nombre muy parecido.</p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="success" loading={linkingExisting} disabled={linkingExisting || noCodeMode} onClick={() => void handleLinkToExisting(nameSuggestion.id, nameSuggestion.name)}>
                    Sí, es este — vincular código
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setNameSuggestion(null)} disabled={linkingExisting}>
                    No, seguir creando nuevo
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold" style={{ color: "var(--color-text-secondary)" }}>Código</label>
              <input className="hm-input h-11 font-mono" value={noCodeMode ? "Se genera al guardar (HMR-…)" : step.code} readOnly disabled />
            </div>
            <Input
              ref={nameInputRef}
              label="Nombre *"
              className="h-11"
              value={form.name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Ej: Cemento Canal 42.5 kg"
            />
            <div>
              <label className="mb-1 block text-xs font-bold" style={{ color: "var(--color-text-secondary)" }}>Categoría *</label>
              <select
                className="hm-input h-11"
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              >
                <option value="">Seleccionar categoría</option>
                {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold" style={{ color: "var(--color-text-secondary)" }}>Unidad</label>
              <select className="hm-input h-11" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                {UNIT_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
            <Input
              label="Precio de venta *"
              className="h-11"
              type="number"
              min="0.01"
              step="0.01"
              value={form.standardSalePrice}
              onChange={(e) => setForm({ ...form, standardSalePrice: e.target.value })}
              placeholder="Ej: 350.00"
              onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); }}
            />
            <div className="flex items-end">
              <label className="inline-flex h-11 cursor-pointer select-none items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5 rounded border-gray-300 text-[var(--color-master-600)] focus:ring-[var(--color-master-500)]"
                  checked={form.allowsFraction}
                  onChange={(e) => setForm({ ...form, allowsFraction: e.target.checked })}
                />
                Permite fracción
              </label>
            </div>
          </div>

          {!form.showSkuField ? (
            <button
              type="button"
              className="mt-3 text-xs font-medium text-[var(--color-master-600)] hover:underline"
              onClick={() => setForm({ ...form, showSkuField: true })}
            >
              Escribir SKU a mano (opcional)
            </button>
          ) : (
            <div className="mt-3 max-w-xs">
              <Input
                label="SKU (opcional — se genera automáticamente si se deja vacío)"
                className="h-11"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
              />
            </div>
          )}

          <div className="mt-5 flex gap-3 border-t border-[var(--color-border)] pt-4">
            <Button variant="success" className="h-11" onClick={() => void handleSave()} disabled={submitting} loading={submitting} icon={<Check className="h-4 w-4" />}>
              {submitting ? "Guardando…" : "Guardar"}
            </Button>
            <Button variant="ghost" className="h-11" onClick={resetToScan} disabled={submitting}>
              Cancelar
            </Button>
          </div>
        </Card>
      )}

      {checking && (
        <p className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
          <Loader2 className="h-4 w-4 animate-spin" /> Consultando código…
        </p>
      )}

      {/* ── Registrados en esta sesión (solo modo Registrar nuevos) ── */}
      {mode === "REGISTER" && sessionRows.length > 0 && (
        <Card noPadding>
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "0.5px solid var(--color-border)" }}>
            <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
              Registrados en esta sesión ({sessionRows.length})
            </h2>
            <Button
              variant="secondary"
              className="h-9"
              icon={<Printer className="h-4 w-4" />}
              onClick={() => void handlePrintMarked()}
              disabled={printing || marked.length === 0}
              loading={printing}
            >
              Imprimir etiquetas ({marked.length})
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
                  <th className="px-4 py-2">Nombre</th>
                  <th className="px-4 py-2">SKU</th>
                  <th className="px-4 py-2">Código</th>
                  <th className="px-4 py-2 text-right">Precio</th>
                  <th className="px-4 py-2 text-center">Imprimir etiqueta</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {sessionRows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-2 font-medium">{row.name}</td>
                    <td className="px-4 py-2 font-mono text-xs">{row.sku}</td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {row.barcode ?? "—"}
                      {row.isInternalCode && <span className="ml-1 rounded bg-blue-50 px-1 text-[10px] font-semibold text-blue-600">HMR</span>}
                    </td>
                    <td className="px-4 py-2 text-right">{money(row.standardSalePrice)}</td>
                    <td className="px-4 py-2 text-center">
                      <input
                        type="checkbox"
                        className="h-5 w-5 rounded border-gray-300 text-[var(--color-master-600)]"
                        checked={row.printLabel}
                        onChange={() => toggleSessionRowPrint(row.id)}
                        disabled={!row.barcode}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </section>
  );
}
