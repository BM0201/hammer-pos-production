"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Printer, RefreshCw, Save } from "lucide-react";
import { apiFetch, unwrapApiData, type ApiResponse } from "@/lib/client/api";
import { printHtml } from "@/lib/printing";

type Branch = { id: string; code: string; name: string };

type PrintSettingsData = {
  id?: string | null;
  branchId: string;
  cashRegisterId?: string | null;
  printerName?: string | null;
  printerMode: string;
  paperWidth: string;
  fontSize: number;
  logoUrl?: string | null;
  footerText?: string | null;
  autoPrint: boolean;
  autoPrintDelivery?: boolean;
  copies: number;
  copiesDeliveryOrder?: number;
  cutPaper: boolean;
  openDrawer: boolean;
  showQr: boolean;
  businessName?: string | null;
  businessLegalName?: string | null;
  taxId?: string | null;
  address?: string | null;
  phone?: string | null;
  showPricesOnDeliveryOrder?: boolean;
  showCashierName?: boolean;
  showCustomerData?: boolean;
  ticketTemplate?: string | null;
  deliveryTemplate?: string | null;
  receiptTemplate?: string | null;
};

type PrintSettingsApiData = Partial<PrintSettingsData> & {
  footerMessage?: string | null;
  autoPrintTicket?: boolean;
  copiesTicket?: number;
  legacy?: Partial<PrintSettingsData>;
};

const PRINTER_MODES = [
  { value: "BROWSER_PRINT", label: "Navegador" },
  { value: "QZ_TRAY", label: "Termica por navegador" },
  { value: "NETWORK_ESCPOS", label: "ESC/POS futuro" },
  { value: "PDF_ONLY", label: "Solo PDF" },
];

const PAPER_WIDTHS = [
  { value: "W58MM", label: "58mm" },
  { value: "W80MM", label: "80mm" },
  { value: "A4", label: "A4" },
];

function defaultSettings(branchId: string): PrintSettingsData {
  return {
    branchId,
    printerName: null,
    printerMode: "BROWSER_PRINT",
    paperWidth: "W80MM",
    fontSize: 12,
    logoUrl: null,
    footerText: null,
    autoPrint: false,
    autoPrintDelivery: false,
    copies: 1,
    copiesDeliveryOrder: 1,
    cutPaper: true,
    openDrawer: false,
    showQr: false,
    businessName: null,
    businessLegalName: null,
    taxId: null,
    address: null,
    phone: null,
    showPricesOnDeliveryOrder: false,
    showCashierName: true,
    showCustomerData: true,
    ticketTemplate: null,
    deliveryTemplate: null,
    receiptTemplate: null,
  };
}

function fromApi(data: PrintSettingsApiData | null | undefined, branchId: string): PrintSettingsData {
  if (!data) return defaultSettings(branchId);
  return {
    ...defaultSettings(branchId),
    ...data.legacy,
    ...data,
    branchId: data.branchId ?? branchId,
    printerMode: data.legacy?.printerMode ?? data.printerMode ?? "BROWSER_PRINT",
    paperWidth: data.legacy?.paperWidth ?? data.paperWidth ?? "W80MM",
    footerText: data.footerText ?? data.footerMessage ?? null,
    autoPrint: data.legacy?.autoPrint ?? data.autoPrintTicket ?? data.autoPrint ?? false,
    copies: data.legacy?.copies ?? data.copiesTicket ?? data.copies ?? 1,
  };
}

export default function PrintSettingsPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [settings, setSettings] = useState<PrintSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch("/api/branches")
      .then(async (response) => {
        if (!response.ok) return;
        const json = await response.json();
        const data = unwrapApiData(json as ApiResponse<Branch[]>);
        const list = Array.isArray(data) ? data : [];
        setBranches(list);
        if (list[0]) setSelectedBranch(list[0].id);
      })
      .finally(() => setLoading(false));
  }, []);

  const loadSettings = useCallback(async (branchId: string) => {
    if (!branchId) return;
    try {
      const response = await apiFetch(`/api/printing/settings?branchId=${branchId}`);
      if (!response.ok) {
        setSettings(defaultSettings(branchId));
        return;
      }
      const json = await response.json();
      setSettings(fromApi(unwrapApiData(json as ApiResponse<PrintSettingsApiData>), branchId));
    } catch {
      setSettings(defaultSettings(branchId));
    }
  }, []);

  useEffect(() => {
    if (selectedBranch) void loadSettings(selectedBranch);
  }, [selectedBranch, loadSettings]);

  const updateField = <K extends keyof PrintSettingsData>(key: K, value: PrintSettingsData[K]) => {
    if (!settings) return;
    setSettings({ ...settings, [key]: value });
  };

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const response = await apiFetch("/api/printing/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!response.ok) throw new Error("No se pudo guardar");
      const json = await response.json();
      setSettings(fromApi(unwrapApiData(json as ApiResponse<PrintSettingsApiData>), settings.branchId));
      toast.success("Configuracion guardada.");
    } catch {
      toast.error("Error al guardar la configuracion.");
    } finally {
      setSaving(false);
    }
  };

  const previewTicket = () => {
    if (!settings) return;
    printHtml(`<!doctype html><html><body style="font-family:monospace;width:80mm;padding:8px">
      <h3>${settings.businessName || "HAMMER POS"}</h3>
      <p>Ticket POS - vista previa</p><hr/>
      <p>1 UND Producto de ejemplo</p><p>Total: C$ 100.00</p><hr/>
      <small>${settings.footerText || "Documento operativo / comprobante interno"}</small>
    </body></html>`);
  };

  const previewDelivery = () => {
    if (!settings) return;
    printHtml(`<!doctype html><html><body style="font-family:monospace;width:80mm;padding:8px">
      <h3>${settings.businessName || "HAMMER POS"}</h3>
      <p>Orden de entrega - vista previa</p><hr/>
      <p>Producto de ejemplo - Cantidad 1</p>
      ${settings.showPricesOnDeliveryOrder ? "<p>Total: C$ 100.00</p>" : ""}
      <br/><p>Firma entrega: __________________</p>
      <small>Orden de entrega / no sustituye factura fiscal</small>
    </body></html>`);
  };

  if (loading) {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-[var(--color-text-muted)]">Cargando configuracion...</div>;
  }

  return (
    <section className="max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-primary-50)]">
          <Printer className="h-5 w-5 text-[var(--color-primary-600)]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text)]">Impresion y documentos</h1>
          <p className="text-sm text-[var(--color-text-muted)]">Configura tickets, ordenes de entrega y recibos por sucursal.</p>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <label className="block text-sm font-medium text-[var(--color-text)] mb-2">Sucursal</label>
        <select value={selectedBranch} onChange={(event) => setSelectedBranch(event.target.value)} className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]">
          {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} ({branch.code})</option>)}
        </select>
      </div>

      {settings && (
        <>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-4">
            <h2 className="text-base font-semibold text-[var(--color-text)]">Impresora</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-[var(--color-text)]">Tipo de impresora
                <select value={settings.printerMode} onChange={(event) => updateField("printerMode", event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
                  {PRINTER_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-[var(--color-text)]">Tamano papel
                <select value={settings.paperWidth} onChange={(event) => updateField("paperWidth", event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
                  {PAPER_WIDTHS.map((paper) => <option key={paper.value} value={paper.value}>{paper.label}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-[var(--color-text)]">Copias ticket
                <input type="number" min={1} max={5} value={settings.copies} onChange={(event) => updateField("copies", Number(event.target.value))} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm" />
              </label>
              <label className="text-sm font-medium text-[var(--color-text)]">Copias orden de entrega
                <input type="number" min={1} max={5} value={settings.copiesDeliveryOrder ?? 1} onChange={(event) => updateField("copiesDeliveryOrder", Number(event.target.value))} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm" />
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-4">
            <h2 className="text-base font-semibold text-[var(--color-text)]">Datos del negocio</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                ["businessName", "Nombre comercial"],
                ["businessLegalName", "Razon social"],
                ["taxId", "RUC / Tax ID"],
                ["phone", "Telefono"],
                ["address", "Direccion"],
                ["logoUrl", "URL del logo"],
              ].map(([key, label]) => (
                <label key={key} className="text-sm font-medium text-[var(--color-text)]">{label}
                  <input value={(settings[key as keyof PrintSettingsData] as string | null) ?? ""} onChange={(event) => updateField(key as keyof PrintSettingsData, (event.target.value || null) as never)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm" />
                </label>
              ))}
            </div>
            <label className="block text-sm font-medium text-[var(--color-text)]">Mensaje final
              <textarea value={settings.footerText ?? ""} onChange={(event) => updateField("footerText", event.target.value || null)} rows={3} className="mt-1 w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm" />
            </label>
          </div>

          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-4">
            <h2 className="text-base font-semibold text-[var(--color-text)]">Opciones</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["autoPrint", "Auto imprimir ticket"],
                ["autoPrintDelivery", "Auto imprimir orden de entrega"],
                ["showPricesOnDeliveryOrder", "Mostrar precios en orden de entrega"],
                ["showCashierName", "Mostrar cajero"],
                ["showCustomerData", "Mostrar cliente"],
                ["cutPaper", "Cortar papel"],
                ["openDrawer", "Abrir cajon"],
                ["showQr", "Incluir QR"],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                  <input type="checkbox" checked={Boolean(settings[key as keyof PrintSettingsData])} onChange={(event) => updateField(key as keyof PrintSettingsData, event.target.checked as never)} />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={handleSave} disabled={saving} className="flex items-center gap-2 rounded-lg bg-[var(--color-primary-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-primary-700)] disabled:opacity-50">
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Guardando..." : "Guardar configuracion"}
            </button>
            <button type="button" onClick={previewTicket} className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]">Vista previa ticket</button>
            <button type="button" onClick={previewDelivery} className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]">Vista previa orden de entrega</button>
            <button type="button" onClick={() => loadSettings(selectedBranch)} className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]"><RefreshCw className="h-4 w-4" />Recargar</button>
          </div>

          <div className="rounded-lg border border-[var(--color-info-200)] bg-[var(--color-info-50)] p-4 text-sm text-[var(--color-info-700)]">
            Estos documentos son operativos internos y no sustituyen una factura fiscal oficial.
          </div>
        </>
      )}
    </section>
  );
}
