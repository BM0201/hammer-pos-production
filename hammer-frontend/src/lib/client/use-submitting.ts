"use client";

import { useCallback, useRef, useState } from "react";

/**
 * prompt-seguridad-basica.md Fase 2 — defensa de UI contra doble click: si
 * ya hay un `run(fn)` en vuelo, una segunda invocación se ignora en
 * silencio (no encola, no relanza) hasta que la primera termine (éxito o
 * error). No reemplaza la deduplicación de `apiFetch` (esa protege aunque
 * dos pantallas/pestañas distintas disparen el mismo request) — esto evita
 * que la MISMA pantalla dispare una segunda acción mientras la primera
 * corre, para poder deshabilitar el botón de submit sin reescribir cada
 * pantalla a mano.
 *
 * `fn` se pasa en cada llamada a `run` (no una vez al montar el hook) para
 * que nunca quede atrapado en un closure viejo con props/estado obsoletos.
 *
 * "No migrar todas las pantallas" — usar solo donde el submit no se
 * deshabilita ya por otro medio (ver prompt-seguridad-basica.md Fase 2,
 * reporte de cierre: lista de pantallas migradas vs. no migradas).
 */
export function useSubmitting(): [boolean, <T>(fn: () => Promise<T>) => Promise<T | undefined>] {
  const [submitting, setSubmitting] = useState(false);
  const inFlightRef = useRef(false);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (inFlightRef.current) return undefined;
    inFlightRef.current = true;
    setSubmitting(true);
    try {
      return await fn();
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }, []);

  return [submitting, run];
}
