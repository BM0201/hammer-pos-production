"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import type { Route } from "next";
import toast from "react-hot-toast";
import { ArrowLeft, Check, Loader2, Package, QrCode, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { useSubmitting } from "@/lib/client/use-submitting";
import { money } from "@/lib/format";
import {
  decideQuickAddStep,
  shouldIgnoreRepeatedCode,
  loadRememberedProductDefaults,
  saveRememberedProductDefaults,
  type QuickAddStep,
  type RememberedProductDefaults,
} from "@/lib/quick-add-product";

/**
 * prompt-alta-productos-qr.md Fase 2 — alta en serie con lector USB/
 * Bluetooth (escribe el código como teclado + Enter). El botón de cámara
 * (CameraScanner en modo continuo) queda FUERA de esta pantalla hasta que
 * exista el prompt del lector de cámara (components/scanner/camera-scanner.tsx,
 * lib/scanner.ts) — decisión explícita para no inventar esa pieza.
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

export default function QuickAddProductPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [step, setStep] = useState<QuickAddStep | null>(null);
  const [noCodeMode, setNoCodeMode] = useState(false);
  const [form, setForm] = useState<FormState>(() => defaultForm(null));
  const [sessionRows, setSessionRows] = useState<SessionRow[]>([]);
  const [submitting, runSubmit] = useSubmitting();

  const codeInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const lastCodeRef = useRef<{ code: string; at: number } | null>(null);

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

  // Foco permanente en el campo Código salvo cuando el formulario de alta
  // está abierto (ahí el foco va al Nombre, punto 2 del doc).
  useEffect(() => {
    if (step?.kind === "NOT_FOUND") {
      nameInputRef.current?.focus();
    } else {
      codeInputRef.current?.focus();
    }
  }, [step]);

  const lookupCode = useCallback(async (rawCode: string) => {
    const trimmed = rawCode.trim();
    if (!trimmed) return;

    const now = Date.now();
    if (shouldIgnoreRepeatedCode(trimmed, now, lastCodeRef.current)) return;
    lastCodeRef.current = { code: trimmed, at: now };

    setChecking(true);
    setNoCodeMode(false);
    try {
      const res = await apiFetch(`/api/catalog/products/by-code?code=${encodeURIComponent(trimmed)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const message = (body?.error?.message as string | undefined) ?? "No se pudo consultar el código.";
        setStep(decideQuickAddStep({ code: trimmed, response: null, errorMessage: message }));
        return;
      }
      const data = unwrapApiData(body);
      const decided = decideQuickAddStep({ code: trimmed, response: data });
      setStep(decided);
      if (decided.kind === "NOT_FOUND") {
        setForm(defaultForm(readRememberedDefaults()));
      }
    } catch {
      setStep(decideQuickAddStep({ code: trimmed, response: null, errorMessage: "Error de red." }));
    } finally {
      setChecking(false);
    }
  }, []);

  function handleCodeKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void lookupCode(code);
  }

  function handleStartNoCode() {
    lastCodeRef.current = null;
    setCode("");
    setNoCodeMode(true);
    setStep({ kind: "NOT_FOUND", code: "" });
    setForm(defaultForm(readRememberedDefaults()));
  }

  function resetToScan() {
    setStep(null);
    setNoCodeMode(false);
    setCode("");
  }

  async function handleSave() {
    if (step?.kind !== "NOT_FOUND") return;
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
          <h1 className="text-xl font-medium" style={{ color: "var(--color-text)" }}>Alta rápida con escáner</h1>
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            Escaneá o tecleá el código y presioná Enter — la cámara, el lector USB y el lector Bluetooth escriben igual.
          </p>
        </div>
      </div>

      {/* ── Campo de código: foco permanente mientras no hay formulario abierto ── */}
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
              disabled={step?.kind === "NOT_FOUND"}
              autoComplete="off"
            />
            <Button
              variant="secondary"
              className="h-11"
              onClick={() => void lookupCode(code)}
              disabled={checking || !code.trim() || step?.kind === "NOT_FOUND"}
              loading={checking}
            >
              Buscar
            </Button>
            <Button
              variant="ghost"
              className="h-11"
              icon={<QrCode className="h-4 w-4" />}
              onClick={handleStartNoCode}
              disabled={step?.kind === "NOT_FOUND"}
            >
              Sin código — generar QR
            </Button>
          </div>
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

      {/* ── Formulario de alta rápida ── */}
      {step?.kind === "NOT_FOUND" && (
        <Card>
          <div className="mb-4 flex items-center gap-2">
            <ScanLine className="h-4 w-4" style={{ color: "var(--color-master-600)" }} />
            <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
              {noCodeMode ? "Producto sin código de fábrica" : "Producto nuevo"}
            </h2>
          </div>
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
              onChange={(e) => setForm({ ...form, name: e.target.value })}
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

      {/* ── Registrados en esta sesión ── */}
      {sessionRows.length > 0 && (
        <Card noPadding>
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "0.5px solid var(--color-border)" }}>
            <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
              Registrados en esta sesión ({sessionRows.length})
            </h2>
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
