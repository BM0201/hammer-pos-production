"use client";

import { useEffect, useRef } from "react";

/* Misma paleta que login/page.tsx */
const C = {
  base:     "#EDECEA",
  surface:  "#E4E2DE",
  border:   "#CCCAC5",
  ink:      "#2E2D2A",
  ink3:     "#9B9892",
  accent:   "#D4380D",
  accentLo: "#A82B08",
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
 */
export function HammerSplash() {
  const dotRef = useRef<SVGCircleElement>(null);

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
        background: C.base,
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
          backgroundImage: "radial-gradient(circle, #C5C3BE 1px, transparent 1px)",
          backgroundSize: "20px 20px",
          opacity: 0.4,
        }}
      />
      {/* Textura de cuadrícula */}
      <div
        aria-hidden
        style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          backgroundImage: `linear-gradient(${C.border} 1px, transparent 1px), linear-gradient(90deg, ${C.border} 1px, transparent 1px)`,
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
        <line x1="36" y1="12" x2="66" y2="64" stroke={C.border} strokeWidth="1.5" />
        <line x1="66" y1="64" x2="6"  y2="64" stroke={C.border} strokeWidth="1.5" />
        <line x1="6"  y1="64" x2="36" y2="12" stroke={C.border} strokeWidth="1.5" />
        <circle cx="36" cy="12" r="6" fill={C.ink} />
        <circle cx="66" cy="64" r="5" fill={C.ink3} />
        <circle cx="6"  cy="64" r="5" fill={C.ink3} />
        <circle
          ref={dotRef}
          cx="36"
          cy="12"
          r="3"
          fill={C.accent}
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
          background: C.surface,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: "38%",
            background: `linear-gradient(90deg, ${C.accentLo}, ${C.accent})`,
            borderRadius: "0 2px 2px 0",
            animation: "hmSplashSlide 1.4s cubic-bezier(0.4,0,0.2,1) infinite",
          }}
        />
      </div>
    </div>
  );
}
