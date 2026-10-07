"use client";

import { useEffect, useState } from "react";

/**
 * prompt-alta-productos-qr.md Fase 2 — "useCameraAvailable solo decide si
 * se muestra el botón de cámara; la pantalla también sirve con un lector
 * USB o Bluetooth". Chequea CAPACIDAD del navegador + que exista al menos
 * un dispositivo de video — nunca pide permiso de cámara solo para decidir
 * si mostrar el botón (enumerateDevices() no requiere permiso para listar
 * `kind`, aunque las etiquetas vengan vacías sin él).
 */
export function useCameraAvailable(): boolean {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        return;
      }
      if (!navigator.mediaDevices.enumerateDevices) {
        // El navegador soporta getUserMedia pero no enumerar — asumimos que
        // sí hay cámara (mejor ofrecer el botón de más que de menos).
        if (!cancelled) setAvailable(true);
        return;
      }
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasVideoInput = devices.some((d) => d.kind === "videoinput");
        if (!cancelled) setAvailable(hasVideoInput);
      } catch {
        if (!cancelled) setAvailable(false);
      }
    }

    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  return available;
}
