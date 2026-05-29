"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch, unwrapApiData, type ApiResponse } from "@/lib/client/api";
import { Printer, Save, RefreshCw, CheckCircle, AlertCircle } from "lucide-react";

type Branch = { id: string; code: string; name: string };

type PrintSettingsData = {
  id?: string;
  branchId: string;
  printerName: string | null;
  printerMode: string;
  paperWidth: string;
  fontSize: number;
  logoUrl: string | null;
  footerText: string | null;
  autoPrint: boolean;
  copies: number;
  cutPaper: boolean;
  openDrawer: boolean;
  showQr: boolean;
};

const PRINTER_MODES = [
  { value: "BROWSER_PRINT", label: "Impresión del navegador" },
  { value: "QZ_TRAY", label: "QZ Tray (térmica)" },
  { value: "NETWORK_ESCPOS", label: "Red ESC/POS" },
  { value: "PDF_ONLY", label: "Solo PDF" },
];

const PAPER_WIDTHS = [
  { value: "W58MM", label: "58mm (térmica pequeña)" },
  { value: "W80MM", label: "80mm (térmica estándar)" },
  { value: "A4", label: "A4 (carta)" },
];

const DEFAULT_SETTINGS: Omit<PrintSettingsData, "branchId"> = {
  printerName: null,
  printerMode: "BROWSER_PRINT",
  paperWidth: "W80MM",
  fontSize: 12,
  logoUrl: null,
  footerText: null,
  autoPrint: false,
  copies: 1,
  cutPaper: true,
  openDrawer: false,
  showQr: false,
};

export default function PrintSettingsPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [settings, setSettings] = useState<PrintSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Cargar sucursales
  useEffect(() => {
    apiFetch("/api/branches")
      .then(async (r) => {
        if (!r.ok) return;
        const json = await r.json();
        const data = unwrapApiData(json as ApiResponse<Branch[]>);
        const list = Array.isArray(data) ? data : [];
        setBranches(list);
        if (list.length > 0) setSelectedBranch(list[0].id);
      })
      .finally(() => setLoading(false));
  }, []);

  // Cargar configuración cuando cambia sucursal
  const loadSettings = useCallback(async (branchId: string) => {
    if (!branchId) return;
    try {
      const r = await apiFetch(`/api/master/print-settings/${branchId}`);
      if (r.ok) {
        const json = await r.json();
        const data = unwrapApiData(json as ApiResponse<PrintSettingsData>);
        setSettings(data);
      } else if (r.status === 404) {
        // No hay configuración, crear con defaults
        setSettings({ ...DEFAULT_SETTINGS, branchId });
      }
    } catch {
      setSettings({ ...DEFAULT_SETTINGS, branchId });
    }
  }, []);

  useEffect(() => {
    if (selectedBranch) loadSettings(selectedBranch);
  }, [selectedBranch, loadSettings]);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    setMessage(null);
    try {
      const r = await apiFetch("/api/master/print-settings", {
        method: "POST",
        body: JSON.stringify(settings),
      });
      if (r.ok) {
        const json = await r.json();
        const saved = unwrapApiData(json as ApiResponse<PrintSettingsData>);
        setSettings(saved);
        setMessage({ type: "success", text: "Configuración guardada exitosamente." });
      } else {
        setMessage({ type: "error", text: "Error al guardar la configuración." });
      }
    } catch {
      setMessage({ type: "error", text: "Error de conexión al guardar." });
    } finally {
      setSaving(false);
    }
  };

  const updateField = <K extends keyof PrintSettingsData>(key: K, value: PrintSettingsData[K]) => {
    if (!settings) return;
    setSettings({ ...settings, [key]: value });
    setMessage(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <span className="text-sm text-[var(--color-text-muted)] animate-pulse">Cargando configuración...</span>
      </div>
    );
  }

  return (
    <section className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-[var(--color-primary-50)] flex items-center justify-center">
          <Printer className="h-5 w-5 text-[var(--color-primary-600)]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text)]">Configuración de Impresión</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Configura impresoras y formato de documentos por sucursal.
          </p>
        </div>
      </div>

      {/* Selector de sucursal */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <label className="block text-sm font-medium text-[var(--color-text)] mb-2">Sucursal</label>
        <select
          value={selectedBranch}
          onChange={(e) => setSelectedBranch(e.target.value)}
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]"
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
          ))}
        </select>
      </div>

      {settings && (
        <>
          {/* Configuración de impresora */}
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-4">
            <h2 className="text-base font-semibold text-[var(--color-text)]">Impresora</h2>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Modo de impresión</label>
                <select
                  value={settings.printerMode}
                  onChange={(e) => updateField("printerMode", e.target.value)}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                >
                  {PRINTER_MODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Ancho de papel</label>
                <select
                  value={settings.paperWidth}
                  onChange={(e) => updateField("paperWidth", e.target.value)}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                >
                  {PAPER_WIDTHS.map((w) => (
                    <option key={w.value} value={w.value}>{w.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Nombre de impresora</label>
                <input
                  type="text"
                  value={settings.printerName ?? ""}
                  onChange={(e) => updateField("printerName", e.target.value || null)}
                  placeholder="Ej: EPSON TM-T20III"
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Tamaño de fuente</label>
                <input
                  type="number"
                  min={8}
                  max={24}
                  value={settings.fontSize}
                  onChange={(e) => updateField("fontSize", Number(e.target.value))}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Copias</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={settings.copies}
                  onChange={(e) => updateField("copies", Number(e.target.value))}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Comportamiento */}
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-4">
            <h2 className="text-base font-semibold text-[var(--color-text)]">Comportamiento</h2>

            <div className="grid gap-3 sm:grid-cols-2">
              {([
                { key: "autoPrint" as const, label: "Imprimir automáticamente al pagar" },
                { key: "cutPaper" as const, label: "Cortar papel (térmica)" },
                { key: "openDrawer" as const, label: "Abrir cajón al imprimir" },
                { key: "showQr" as const, label: "Incluir código QR en documentos" },
              ]).map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings[key]}
                    onChange={(e) => updateField(key, e.target.checked)}
                    className="rounded border-[var(--color-border)]"
                  />
                  <span className="text-sm text-[var(--color-text)]">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Personalización */}
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-4">
            <h2 className="text-base font-semibold text-[var(--color-text)]">Personalización</h2>

            <div>
              <label className="block text-sm font-medium text-[var(--color-text)] mb-1">URL del logo</label>
              <input
                type="text"
                value={settings.logoUrl ?? ""}
                onChange={(e) => updateField("logoUrl", e.target.value || null)}
                placeholder="https://ejemplo.com/logo.png"
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Texto de pie de página</label>
              <textarea
                value={settings.footerText ?? ""}
                onChange={(e) => updateField("footerText", e.target.value || null)}
                placeholder="Ej: Gracias por su compra. Válido para garantía."
                rows={3}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm resize-none"
              />
            </div>
          </div>

          {/* Mensajes y botón guardar */}
          {message && (
            <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
              message.type === "success"
                ? "bg-[var(--color-success-50)] text-[var(--color-success-700)] border border-[var(--color-success-200)]"
                : "bg-[var(--color-danger-50)] text-[var(--color-danger-700)] border border-[var(--color-danger-200)]"
            }`}>
              {message.type === "success" ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
              <span>{message.text}</span>
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-[var(--color-primary-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-primary-700)] disabled:opacity-50 transition-colors"
            >
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Guardando..." : "Guardar configuración"}
            </button>

            <button
              type="button"
              onClick={() => loadSettings(selectedBranch)}
              className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              Recargar
            </button>
          </div>

          {/* Nota informativa */}
          <div className="rounded-lg bg-[var(--color-info-50)] border border-[var(--color-info-200)] p-4 text-sm text-[var(--color-info-700)]">
            <p className="font-medium mb-1">ℹ️ Nota sobre impresión</p>
            <p>
              La impresión real de documentos será habilitada en la FASE 3. Esta pantalla permite
              pre-configurar las preferencias de impresión por sucursal. Los modos QZ Tray y Red ESC/POS
              requieren configuración adicional del hardware.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
