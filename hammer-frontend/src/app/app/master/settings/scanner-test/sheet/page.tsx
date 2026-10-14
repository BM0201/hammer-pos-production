"use client";

import { useEffect, useState } from "react";
import { create as createQrCode } from "qrcode";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * E · Fase 3 (prompt-completo-pendientes-2026-10.md) — hoja de prueba
 * imprimible: un EAN-13, un UPC-A, un Code128 y un QR HMR-, cada uno a
 * 20mm y 15mm. bwip-js (1D) se carga diferido — nunca entra al bundle
 * principal, solo cuando se abre esta página. El QR reusa el MISMO patrón
 * que lib/product-labels.ts (qrcode, create() síncrono, SVG a mano) —
 * nada nuevo ahí.
 */

// Códigos REALES y válidos (mismo dígito verificador que valida
// isValidGtinChecksum en lib/scanner.ts) — una hoja con códigos inválidos
// no sirve para probar el escáner.
const EAN_13_CODE = "4006381333931";
const UPC_A_CODE = "036000291452";
const HMR_TEST_CODE = "HMR-TEST0001";
const SIZES_MM = [20, 15] as const;

function sizeSvgToMm(svg: string, widthMm: number): string {
  return svg.replace("<svg ", `<svg style="width:${widthMm}mm;height:auto;display:block" `);
}

function buildQrSvg(text: string, sizeMm: number): string {
  const qr = createQrCode(text, { errorCorrectionLevel: "M" });
  const modules = qr.modules;
  const size = modules.size;
  let cells = "";
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (modules.get(row, col)) cells += `<rect x="${col}" y="${row}" width="1" height="1"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" style="width:${sizeMm}mm;height:${sizeMm}mm;display:block" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><g fill="#000">${cells}</g></svg>`;
}

type Symbol = { label: string; svgBySize: Record<number, string> };

export default function ScannerTestSheetPage() {
  const [symbols, setSymbols] = useState<Symbol[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Subpath explícito ("/browser"), no el condicional "." — bwip-js
        // solo expone `types` bajo condiciones de exports ("browser"/"node"/
        // "electron"/"react-native") que TS no resuelve por defecto.
        const bwipjs = await import("bwip-js/browser");
        const build1d = (bcid: string, text: string): Record<number, string> => {
          const entries = SIZES_MM.map((mm) => [mm, sizeSvgToMm(bwipjs.toSVG({ bcid, text, includetext: true, scale: 2 }), mm)] as const);
          return Object.fromEntries(entries);
        };
        const buildQr = (text: string): Record<number, string> => {
          const entries = SIZES_MM.map((mm) => [mm, buildQrSvg(text, mm)] as const);
          return Object.fromEntries(entries);
        };
        if (cancelled) return;
        setSymbols([
          { label: `EAN-13 (${EAN_13_CODE})`, svgBySize: build1d("ean13", EAN_13_CODE) },
          { label: `UPC-A (${UPC_A_CODE})`, svgBySize: build1d("upca", UPC_A_CODE) },
          { label: `Code 128 (${HMR_TEST_CODE})`, svgBySize: build1d("code128", HMR_TEST_CODE) },
          { label: `QR (${HMR_TEST_CODE})`, svgBySize: buildQr(HMR_TEST_CODE) },
        ]);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "No se pudieron generar los códigos de prueba.");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <h1 className="text-lg font-bold text-[var(--color-text)]">Hoja de prueba del escáner</h1>
        <Button type="button" variant="primary" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()} disabled={!symbols}>Imprimir</Button>
      </div>

      {error && <p className="text-sm text-[var(--color-danger-600)] print:hidden">{error}</p>}

      {!symbols ? (
        <p className="text-sm text-[var(--color-text-muted)] print:hidden">Generando códigos…</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {symbols.map((symbol) => (
            <div key={symbol.label} className="space-y-3 rounded-lg border border-[var(--color-border)] p-4 print:break-inside-avoid">
              <p className="text-sm font-semibold text-[var(--color-text)]">{symbol.label}</p>
              {SIZES_MM.map((mm) => (
                <div key={mm} className="flex items-center gap-3">
                  <span className="w-12 shrink-0 text-xs text-[var(--color-text-muted)]">{mm}mm</span>
                  {/* SVG generado localmente (qrcode/bwip-js), no HTML de terceros. */}
                  <div dangerouslySetInnerHTML={{ __html: symbol.svgBySize[mm] }} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
