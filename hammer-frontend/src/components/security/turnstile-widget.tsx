"use client";

import { useEffect, useRef } from "react";

/**
 * Widget de Cloudflare Turnstile (renderizado explícito).
 *
 * Carga el script de Cloudflare bajo demanda (una sola vez por página) y
 * renderiza el challenge. `onToken` recibe el token al resolverse, o `null`
 * si expira o falla — el caller debe enviar ese token en el body del login.
 *
 * CSP: el script se inserta dinámicamente desde nuestro bundle (confiable vía
 * nonce + 'strict-dynamic'); challenges.cloudflare.com está además permitido
 * en script-src/frame-src/connect-src (ver middleware.ts del frontend).
 */

type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      theme?: "light" | "dark" | "auto";
      callback: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    },
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export function TurnstileWidget({
  siteKey,
  onToken,
  theme = "auto",
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
  theme?: "light" | "dark" | "auto";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    function renderWidget() {
      if (cancelled || !containerRef.current || !window.turnstile || widgetIdRef.current !== null) {
        return;
      }
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme,
        callback: (token) => onToken(token),
        "expired-callback": () => onToken(null),
        "error-callback": () => onToken(null),
      });
    }

    if (window.turnstile) {
      renderWidget();
    } else {
      const existing = document.querySelector<HTMLScriptElement>(
        'script[src^="https://challenges.cloudflare.com/turnstile/"]',
      );
      if (existing) {
        existing.addEventListener("load", renderWidget, { once: true });
        renderWidget();
      } else {
        const script = document.createElement("script");
        script.src = SCRIPT_SRC;
        script.async = true;
        script.addEventListener("load", renderWidget, { once: true });
        document.head.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      if (widgetIdRef.current !== null && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // El widget pudo haber sido removido por navegación — ignorar.
        }
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, onToken, theme]);

  /** Resetea el widget para obtener un token nuevo (los tokens son de un solo uso). */
  return <div ref={containerRef} data-testid="turnstile-widget" />;
}

export function resetTurnstile(): void {
  try {
    window.turnstile?.reset();
  } catch {
    // sin widget activo — nada que resetear
  }
}
