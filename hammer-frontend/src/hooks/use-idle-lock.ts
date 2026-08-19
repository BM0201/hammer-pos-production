"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Detecta ausencia de interacción (mouse/teclado/touch/scroll) y marca la
 * pantalla como bloqueada pasado el umbral. Pensado para terminales POS/caja
 * compartidas entre turnos: el bloqueo es solo visual (overlay) — la sesión,
 * la cookie y el estado de la venta en curso NO se tocan.
 */
export function useIdleLock(timeoutMinutes: number): { locked: boolean; unlock: () => void } {
  const [locked, setLocked] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const lockedRef = useRef(false);

  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  useEffect(() => {
    const markActivity = () => {
      // Mientras está bloqueado, la actividad no cuenta (solo desbloquear resetea).
      if (!lockedRef.current) {
        lastActivityRef.current = Date.now();
      }
    };

    const events: Array<keyof WindowEventMap> = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
      "scroll",
      "wheel",
    ];
    events.forEach((event) => window.addEventListener(event, markActivity, { passive: true }));

    const timeoutMs = Math.max(1, timeoutMinutes) * 60_000;
    const interval = setInterval(() => {
      if (!lockedRef.current && Date.now() - lastActivityRef.current >= timeoutMs) {
        setLocked(true);
      }
    }, 5_000);

    return () => {
      events.forEach((event) => window.removeEventListener(event, markActivity));
      clearInterval(interval);
    };
  }, [timeoutMinutes]);

  const unlock = useCallback(() => {
    lastActivityRef.current = Date.now();
    setLocked(false);
  }, []);

  return { locked, unlock };
}
