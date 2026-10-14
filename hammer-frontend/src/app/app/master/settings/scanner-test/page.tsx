"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ScanBarcode, FileText, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { startContinuousScan, getActiveEngine, type ScannerHandle, type ScannerEngine, type ScannerStats, type SupportedFormat } from "@/lib/scanner";

/**
 * E · Fase 3 (prompt-completo-pendientes-2026-10.md) — "sirve para probar
 * cada tablet y para que el dueño vea qué equipo lee peor." Motor activo,
 * cámara, resolución real e intentos por segundo EN VIVO (getStats()),
 * tiempo medio de decodificación, y las últimas 20 lecturas con formato,
 * código, dígito verificador y cuánto tardó desde que se abrió la cámara.
 * Solo Master (ya filtrado por la capability del ítem del sidebar; el
 * contenido en sí no hace ninguna llamada al backend — todo es diagnóstico
 * de cámara/motor en el propio navegador).
 */

type HistoryEntry = { code: string; format: SupportedFormat | "unknown"; checksumValid: boolean | null; elapsedSinceOpenMs: number; at: Date };

const FORMAT_LABEL: Record<string, string> = {
  ean_13: "EAN-13", ean_8: "EAN-8", upc_a: "UPC-A", upc_e: "UPC-E",
  code_128: "Code 128", code_39: "Code 39", itf: "ITF", qr_code: "QR", unknown: "?",
};

export default function ScannerTestPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const handleRef = useRef<ScannerHandle | null>(null);
  const [running, setRunning] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preflightEngine, setPreflightEngine] = useState<ScannerEngine | null>(null);
  const [stats, setStats] = useState<ScannerStats | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    void getActiveEngine().then(setPreflightEngine);
  }, []);

  useEffect(() => {
    if (!running) return;
    const video = videoRef.current;
    if (!video) return;

    setError(null);
    const handle = startContinuousScan({
      videoElement: video,
      onDecode: () => {},
      onError: (err) => {
        const name = err instanceof Error ? err.name : "";
        if (name === "NotAllowedError") setError("Permiso de cámara denegado.");
        else if (name === "NotFoundError") setError("No se encontró ninguna cámara disponible.");
        else if (name === "NotReadableError") setError("La cámara está en uso por otra aplicación.");
        else setError("No se pudo iniciar la cámara.");
      },
      onDecodeDetail: (detail) => {
        setHistory((prev) => [{ ...detail, at: new Date() }, ...prev].slice(0, 20));
      },
    });
    handleRef.current = handle;

    const interval = setInterval(() => setStats(handle.getStats()), 500);

    return () => {
      clearInterval(interval);
      handle.stop();
      handleRef.current = null;
    };
  }, [running]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-lg font-bold text-[var(--color-text)]"><ScanBarcode className="h-5 w-5" /> Prueba de escáner</h1>
        <div className="flex gap-2">
          <Link href={"/app/master/settings/scanner-test/sheet" as Route}>
            <Button type="button" variant="ghost" icon={<FileText className="h-4 w-4" />}>Hoja de prueba imprimible</Button>
          </Link>
          <Button type="button" variant={running ? "danger" : "primary"} onClick={() => setRunning((v) => !v)}>
            {running ? "Detener cámara" : "Iniciar cámara"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[320px_1fr]">
        <Card className="space-y-3 p-4">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Diagnóstico en vivo</h2>
          {running ? (
            <div className="overflow-hidden rounded-lg bg-black">
              <video ref={videoRef} className="aspect-video w-full object-contain" muted playsInline />
            </div>
          ) : (
            <p className="text-xs text-[var(--color-text-muted)]">Cámara detenida.</p>
          )}
          {error && <p className="text-xs text-[var(--color-danger-600)]">{error}</p>}
          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Motor (antes de abrir)</dt><dd className="font-semibold text-[var(--color-text)]">{preflightEngine ?? "…"}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Motor activo</dt><dd className="font-semibold text-[var(--color-text)]">{stats?.engine ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Resolución real</dt><dd className="font-semibold text-[var(--color-text)]">{stats?.resolutionWidth ? `${stats.resolutionWidth}×${stats.resolutionHeight}` : "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Intentos/seg</dt><dd className="font-semibold text-[var(--color-text)]">{stats?.attemptsPerSecond ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Tiempo medio de decodificación</dt><dd className="font-semibold text-[var(--color-text)]">{stats?.avgDecodeMs !== null && stats?.avgDecodeMs !== undefined ? `${stats.avgDecodeMs} ms` : "—"}</dd></div>
          </dl>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Últimas {history.length} lectura{history.length === 1 ? "" : "s"}</h2>
          {history.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">Todavía no hay lecturas.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">
                    <th className="px-2 py-1.5">Formato</th>
                    <th className="px-2 py-1.5">Código</th>
                    <th className="px-2 py-1.5 text-center">Verificador</th>
                    <th className="px-2 py-1.5 text-right">Desde que abrió</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={`${h.code}-${h.at.getTime()}-${i}`} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="px-2 py-1.5">{FORMAT_LABEL[h.format] ?? h.format}</td>
                      <td className="px-2 py-1.5 font-mono">{h.code}</td>
                      <td className="px-2 py-1.5 text-center">
                        {h.checksumValid === null ? <MinusCircle className="mx-auto h-4 w-4 text-[var(--color-text-soft)]" /> : h.checksumValid ? <CheckCircle2 className="mx-auto h-4 w-4 text-[var(--color-success-600)]" /> : <XCircle className="mx-auto h-4 w-4 text-[var(--color-danger-600)]" />}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{(h.elapsedSinceOpenMs / 1000).toFixed(1)}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
