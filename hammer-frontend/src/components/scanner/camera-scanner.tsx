"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { CameraOff, Flashlight, FlashlightOff, ZoomIn, SwitchCamera, Maximize2, X, Keyboard, Volume2, VolumeX } from "lucide-react";
import { startContinuousScan, computeRoi, type ScannerHandle, type CameraDeviceLike } from "@/lib/scanner";
import {
  readSoundPreference,
  writeSoundPreference,
  shouldShowScanHelp,
  toggleZoomValue,
  mapRoiToOverlayRect,
  type ZoomRange,
} from "@/lib/camera-scanner-logic";

export type CameraScannerProps = {
  /**
   * Texto CRUDO de cada lectura (modo CONTINUO — sigue escaneando después
   * de cada una, ya validada: dígito verificador + consenso, ver
   * lib/scanner.ts). El caller decide normalizar/debounce (mismo camino que
   * el lector USB, que entra por el campo Código vía Enter).
   *
   * Debe ser una función ESTABLE (useCallback con deps fijas, o definida
   * fuera del render) — este componente la captura una sola vez al montar
   * la cámara, no la vuelve a leer en cada render.
   */
  onDecode: (rawText: string) => void;
  onClose?: () => void;
  /** "Escribir el código a mano" — si no se pasa, cierra la cámara (onClose) nada más; un caller que además quiera enfocar su input de Código puede pasar su propio handler. */
  onManualEntry?: () => void;
  className?: string;
};

const BEEP_DURATION_MS = 80;
const FLASH_DURATION_MS = 200;
const CHIP_DURATION_MS = 2000;

/** Un tono corto con WebAudio — sin archivos de audio (E · Fase 2, prompt-completo-pendientes-2026-10.md). */
function playBeep() {
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 1200;
    gain.gain.value = 0.15;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + BEEP_DURATION_MS / 1000);
    osc.onended = () => void ctx.close();
  } catch {
    /* WebAudio no disponible — el sonido es una cortesía, no crítico. */
  }
}

/**
 * E · Fase 2 (prompt-completo-pendientes-2026-10.md) — recuadro guía REAL
 * (el mismo ROI que de verdad se decodifica, no decorativo), linterna,
 * zoom, cambio de cámara, sonido/vibración al leer, pantalla completa y
 * ayuda cuando no lee. Diseñado para tablet — 44px de controles.
 */
export function CameraScanner({ onDecode, onClose, onManualEntry, className = "" }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<ScannerHandle | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  const [phase, setPhase] = useState<"opening" | "ready" | "error">("opening");
  const [error, setError] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [flashActive, setFlashActive] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoomRange, setZoomRange] = useState<ZoomRange | null>(null);
  const [zoomValue, setZoomValue] = useState(1);
  const [cameras, setCameras] = useState<CameraDeviceLike[]>([]);
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    setSoundOn(readSoundPreference());
  }, []);

  const handleDecode = useCallback((rawText: string) => {
    lastActivityRef.current = Date.now();
    setShowHelp(false);
    setLastCode(rawText);
    setFlashActive(true);
    setTimeout(() => setFlashActive(false), FLASH_DURATION_MS);
    setTimeout(() => setLastCode((prev) => (prev === rawText ? null : prev)), CHIP_DURATION_MS);
    if (readSoundPreference()) playBeep();
    navigator.vibrate?.(60);
    onDecode(rawText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (typeof window === "undefined" || !window.isSecureContext || !navigator.mediaDevices) {
      setPhase("error");
      setError("Este navegador no permite la cámara: usá Chrome.");
      return;
    }

    setPhase("opening");
    setError(null);
    lastActivityRef.current = Date.now();

    const handle = startContinuousScan({
      videoElement: video,
      onDecode: handleDecode,
      onError: (err) => {
        const name = err instanceof Error ? err.name : "";
        if (name === "NotAllowedError") setError("Permiso de cámara denegado. Habilitalo en el navegador para escanear.");
        else if (name === "NotFoundError") setError("No se encontró ninguna cámara disponible.");
        else if (name === "NotReadableError") setError("La cámara está en uso por otra aplicación.");
        else setError("No se pudo iniciar la cámara.");
        setPhase("error");
      },
    });
    handleRef.current = handle;

    const onLoadedMetadata = () => {
      setPhase("ready");
      setHasTorch(handle.hasTorch());
      setZoomRange(handle.getZoomRange());
      setVideoSize({ width: video.videoWidth, height: video.videoHeight });
      void handle.listCameras().then(setCameras);
    };
    video.addEventListener("loadedmetadata", onLoadedMetadata);

    return () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      handle.stop();
      handleRef.current = null;
    };
    // handleDecode es estable (useCallback []) — este efecto solo corre de nuevo si cambia el <video> montado.
  }, [handleDecode]);

  // Mide el contenedor para mapear el ROI real al overlay — se recalcula en resize/orientación.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // "Si pasan 6s sin lectura con la cámara abierta" — revisa cada segundo, sin esperar a la próxima lectura para desaparecer si ya no aplica.
  useEffect(() => {
    if (phase !== "ready") return;
    const interval = setInterval(() => {
      setShowHelp(shouldShowScanHelp(lastActivityRef.current, Date.now()));
    }, 1000);
    return () => clearInterval(interval);
  }, [phase]);

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    writeSoundPreference(next);
  }

  async function toggleTorch() {
    const next = !torchOn;
    await handleRef.current?.setTorch(next);
    setTorchOn(next);
  }

  async function toggleZoom() {
    if (!zoomRange) return;
    const next = toggleZoomValue(zoomValue, zoomRange);
    await handleRef.current?.setZoom(next);
    setZoomValue(next);
  }

  async function switchToCamera(deviceId: string) {
    await handleRef.current?.switchCamera(deviceId);
  }

  function handleManualEntry() {
    (onManualEntry ?? onClose)?.();
  }

  const bandRoi = computeRoi(videoSize.width, videoSize.height, "band");
  const squareRoi = computeRoi(videoSize.width, videoSize.height, "square");
  const bandRect = mapRoiToOverlayRect(videoSize.width, videoSize.height, containerSize.width, containerSize.height, bandRoi);
  const squareRect = mapRoiToOverlayRect(videoSize.width, videoSize.height, containerSize.width, containerSize.height, squareRoi);

  return (
    <div className={`overflow-hidden rounded-lg border border-[var(--color-border)] bg-black ${className} ${fullscreen ? "fixed inset-0 z-50 flex flex-col rounded-none border-0" : ""}`}>
      {phase === "error" ? (
        <div className="flex flex-col items-center gap-2 p-6 text-center">
          <CameraOff className="h-6 w-6 text-red-400" />
          <p className="text-sm text-white">{error}</p>
        </div>
      ) : (
        <div ref={containerRef} className={`relative bg-black ${fullscreen ? "flex-1" : ""}`}>
          <video
            ref={videoRef}
            className={`w-full object-contain ${fullscreen ? "h-full" : "aspect-video"}`}
            muted
            playsInline
            aria-hidden="true"
          />

          {phase === "opening" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/30 border-t-white" />
              <p className="text-sm text-white">Abriendo cámara…</p>
            </div>
          )}

          {phase === "ready" && containerSize.width > 0 && (
            <>
              {/* Fondo oscurecido fuera del recuadro de 1D — el "spotlight cutout" clásico con box-shadow. */}
              <div
                className={`pointer-events-none absolute rounded-md border-2 transition-colors ${flashActive ? "border-[var(--color-success-400)]" : "border-white/80"}`}
                style={{
                  left: `${bandRect.leftPercent}%`,
                  top: `${bandRect.topPercent}%`,
                  width: `${bandRect.widthPercent}%`,
                  height: `${bandRect.heightPercent}%`,
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
                }}
              >
                {/* Línea animada para 1D. */}
                <div className="animate-scan-line absolute inset-x-0 h-0.5 bg-[var(--color-danger-500)]" />
              </div>
              {/* Esquinas marcadas para QR, superpuestas (mismo ROI que computeRoi "square"). */}
              <div
                className="pointer-events-none absolute"
                style={{ left: `${squareRect.leftPercent}%`, top: `${squareRect.topPercent}%`, width: `${squareRect.widthPercent}%`, height: `${squareRect.heightPercent}%` }}
              >
                {["top-0 left-0 border-t-2 border-l-2", "top-0 right-0 border-t-2 border-r-2", "bottom-0 left-0 border-b-2 border-l-2", "bottom-0 right-0 border-b-2 border-r-2"].map((pos) => (
                  <div key={pos} className={`absolute h-5 w-5 border-white/80 ${pos}`} />
                ))}
              </div>
            </>
          )}

          {lastCode && (
            <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/80 px-3 py-1.5 text-xs font-medium text-white">
              {lastCode}
            </div>
          )}

          {showHelp && phase === "ready" && (
            <div className="absolute inset-x-3 bottom-16 flex flex-col items-center gap-2 rounded-lg bg-black/80 p-3 text-center">
              <p className="text-xs text-white">Acercá el código a unos 15–20 cm, buena luz, sin reflejo.</p>
              {hasTorch && !torchOn && (
                <button type="button" onClick={() => void toggleTorch()} className="flex h-11 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-xs font-semibold text-white">
                  <Flashlight className="h-4 w-4" /> Encender linterna
                </button>
              )}
            </div>
          )}

          {/* aria-live para lectores de pantalla — "Código leído: …" (accesibilidad). */}
          <span aria-live="polite" className="sr-only">{lastCode ? `Código leído: ${lastCode}` : ""}</span>

          {phase === "ready" && (
            <div className="absolute right-2 top-2 flex flex-col gap-2">
              {hasTorch && (
                <button type="button" onClick={() => void toggleTorch()} aria-label="Linterna" className={`flex h-11 w-11 items-center justify-center rounded-full ${torchOn ? "bg-[var(--color-warning-500)]" : "bg-black/60"} text-white`}>
                  {torchOn ? <Flashlight className="h-5 w-5" /> : <FlashlightOff className="h-5 w-5" />}
                </button>
              )}
              {zoomRange && zoomRange.max > zoomRange.min && (
                <button type="button" onClick={() => void toggleZoom()} aria-label="Zoom" className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-xs font-bold text-white">
                  <ZoomIn className="h-5 w-5" />
                </button>
              )}
              {cameras.length > 1 && (
                <button
                  type="button"
                  aria-label="Cambiar cámara"
                  onClick={() => {
                    const currentId = handleRef.current?.getCurrentDeviceId() ?? null;
                    const idx = cameras.findIndex((c) => c.deviceId === currentId);
                    const next = cameras[(idx + 1) % cameras.length] ?? cameras[0];
                    void switchToCamera(next.deviceId);
                  }}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white"
                >
                  <SwitchCamera className="h-5 w-5" />
                </button>
              )}
              <button type="button" onClick={() => setFullscreen((v) => !v)} aria-label="Pantalla completa" className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white md:hidden">
                <Maximize2 className="h-5 w-5" />
              </button>
            </div>
          )}

          {phase === "ready" && (
            <button type="button" onClick={toggleSound} aria-label={soundOn ? "Desactivar sonido al escanear" : "Activar sonido al escanear"} className="absolute left-2 top-2 flex h-11 items-center gap-1 rounded-full bg-black/60 px-2.5 text-[10px] font-semibold text-white">
              {soundOn ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
              {soundOn ? "Sonido" : "Sin sonido"}
            </button>
          )}
        </div>
      )}

      <div className="flex">
        <button
          type="button"
          onClick={handleManualEntry}
          className="flex h-11 flex-1 items-center justify-center gap-1.5 bg-black/60 text-xs font-medium text-white hover:bg-black/80"
        >
          <Keyboard className="h-4 w-4" /> Escribir el código a mano
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar cámara"
            className="flex h-11 w-11 items-center justify-center bg-black/60 text-white hover:bg-black/80"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
