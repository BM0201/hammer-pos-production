"use client";

import { useEffect, useRef, useState } from "react";
import { CameraOff } from "lucide-react";
import { startContinuousScan, type ScannerHandle } from "@/lib/scanner";

export type CameraScannerProps = {
  /**
   * Texto CRUDO de cada lectura (modo CONTINUO — sigue escaneando después
   * de cada una). El caller decide normalizar/debounce (mismo camino que
   * el lector USB, que entra por el campo Código vía Enter).
   *
   * Debe ser una función ESTABLE (useCallback con deps fijas, o definida
   * fuera del render) — este componente la captura una sola vez al montar
   * la cámara, no la vuelve a leer en cada render.
   */
  onDecode: (rawText: string) => void;
  onClose?: () => void;
  className?: string;
};

/**
 * prompt-alta-productos-qr.md — lector de código de barras/QR por cámara,
 * modo continuo. Diseñado desde cero (no existía un prompt previo con su
 * especificación) a pedido explícito del usuario — ver lib/scanner.ts para
 * el porqué de @zxing/browser (EAN/UPC/Code128 + QR, no solo QR).
 */
export function CameraScanner({ onDecode, onClose, className = "" }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const handleRef = useRef<ScannerHandle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setError(null);
    handleRef.current = startContinuousScan({
      videoElement: video,
      onDecode,
      onError: (err) => {
        const name = err instanceof Error ? err.name : "";
        if (name === "NotAllowedError") {
          setError("Permiso de cámara denegado. Habilitalo en el navegador para escanear.");
        } else if (name === "NotFoundError") {
          setError("No se encontró ninguna cámara disponible.");
        } else if (name === "NotReadableError") {
          setError("La cámara está en uso por otra aplicación.");
        } else {
          setError("No se pudo iniciar la cámara.");
        }
      },
    });

    return () => {
      handleRef.current?.stop();
      handleRef.current = null;
    };
    // Arranca UNA vez al montar — onDecode debe ser estable (ver tipo arriba).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`overflow-hidden rounded-lg border border-[var(--color-border)] bg-black ${className}`}>
      {error ? (
        <div className="flex flex-col items-center gap-2 p-6 text-center">
          <CameraOff className="h-6 w-6 text-red-400" />
          <p className="text-sm text-white">{error}</p>
        </div>
      ) : (
        <div className="relative">
          <video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-6 rounded-lg border-2 border-white/70" />
        </div>
      )}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="h-11 w-full bg-black/60 text-xs font-medium text-white hover:bg-black/80"
        >
          Cerrar cámara
        </button>
      )}
    </div>
  );
}
