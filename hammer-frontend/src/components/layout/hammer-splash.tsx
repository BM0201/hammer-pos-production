"use client";

import { useEffect, useRef, useState } from "react";

/* Misma paleta que login/page.tsx, en sus dos variantes — el splash se pinta
   ANTES de que AppLayout resuelva la sesión, así que no puede depender de las
   variables CSS del tema (esas cascadean sobre <html>, pero este componente
   necesita leer data-theme directamente para no perder un frame). */
const LIGHT = {
  base: "#EDECEA",
  surface: "#E4E2DE",
  border: "#CCCAC5",
  ink: "#2E2D2A",
  ink3: "#9B9892",
  accent: "#D4380D",
  accentLo: "#A82B08",
  dots: "#C5C3BE",
} as const;

// Los valores dark salen de globals.css:294 — NO inventes otros, tienen que
// coincidir exactamente con las variables del tema oscuro.
const DARK = {
  base: "#1A1917",
  surface: "#232120",
  border: "#38352F",
  ink: "#F5F3EF",
  ink3: "#847F76",
  accent: "#D4380D",
  accentLo: "#A82B08",
  dots: "#A8A39A",
} as const;

const NODES = [
  { cx: 36, cy: 12 },
  { cx: 66, cy: 64 },
  { cx:  6, cy: 64 },
];

/**
 * Pantalla de carga de Hammer.
 * Misma estética que la animación de login: fondo cálido, triángulo con punto
 * rojo recorriendo los vértices, barra de progreso indeterminada.
 * Se usa mientras el AppLayout verifica la sesión y renderiza el shell.
 *
 * Lee data-theme del <html> (ya aplicado por el script inline pre-paint en
 * layout.tsx) en vez de tener una paleta fija — si no, el splash se pinta
 * siempre en claro encima de todo, aunque el usuario tenga oscuro activo.
 */
export function HammerSplash() {
  const dotRef = useRef<SVGCircleElement>(null);
  // Lazy initializer obligatorio: leerlo en un useEffect introduce el mismo
  // frame de retraso (un flash claro) que este componente existe para eliminar.
  const [pal, setPal] = useState(() =>
    typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? DARK : LIGHT,
  );

  useEffect(() => {
    const obs = new MutationObserver(() =>
      setPal(document.documentElement.dataset.theme === "dark" ? DARK : LIGHT),
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const dot = dotRef.current;
    if (!dot) return;

    let idx = 0;
    const id = setInterval(() => {
      idx = (idx + 1) % NODES.length;
      dot.setAttribute("cx", String(NODES[idx].cx));
      dot.setAttribute("cy", String(NODES[idx].cy));
    }, 700);

    return () => {
      clearInterval(id);
      // Limpia el color de fondo que el login puede haber inyectado
      // para cubrir frames intermedios en la transición.
      document.documentElement.style.backgroundColor = "";
      document.body.style.backgroundColor = "";
    };
  }, []);

  return (
    <div
      role="status"
      aria-label="Cargando el sistema"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: pal.base,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <style>{`
        @keyframes hmSplashSlide {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(260%); }
        }
      `}</style>

      {/* Textura de puntos */}
      <div
        aria-hidden
        style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          backgroundImage: `radial-gradient(circle, ${pal.dots} 1px, transparent 1px)`,
          backgroundSize: "20px 20px",
          opacity: 0.4,
        }}
      />
      {/* Textura de cuadrícula */}
      <div
        aria-hidden
        style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          backgroundImage: `linear-gradient(${pal.border} 1px, transparent 1px), linear-gradient(90deg, ${pal.border} 1px, transparent 1px)`,
          backgroundSize: "80px 80px",
          opacity: 0.14,
        }}
      />

      {/* Triángulo con punto rojo animado */}
      <svg
        width="96"
        height="96"
        viewBox="0 0 72 76"
        fill="none"
        aria-hidden
        style={{ position: "relative", zIndex: 1 }}
      >
        <line x1="36" y1="12" x2="66" y2="64" stroke={pal.border} strokeWidth="1.5" />
        <line x1="66" y1="64" x2="6"  y2="64" stroke={pal.border} strokeWidth="1.5" />
        <line x1="6"  y1="64" x2="36" y2="12" stroke={pal.border} strokeWidth="1.5" />
        <circle cx="36" cy="12" r="6" fill={pal.ink} />
        <circle cx="66" cy="64" r="5" fill={pal.ink3} />
        <circle cx="6"  cy="64" r="5" fill={pal.ink3} />
        <circle
          ref={dotRef}
          cx="36"
          cy="12"
          r="3"
          fill={pal.accent}
          style={{
            transition: "cx 540ms cubic-bezier(0.4,0,0.2,1), cy 540ms cubic-bezier(0.4,0,0.2,1)",
          }}
        />
      </svg>

      {/* Barra de progreso indeterminada */}
      <div
        style={{
          position: "absolute",
          bottom: 0, left: 0, right: 0,
          height: "2px",
          background: pal.surface,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: "38%",
            background: `linear-gradient(90deg, ${pal.accentLo}, ${pal.accent})`,
            borderRadius: "0 2px 2px 0",
            animation: "hmSplashSlide 1.4s cubic-bezier(0.4,0,0.2,1) infinite",
          }}
        />
      </div>
    </div>
  );
}
