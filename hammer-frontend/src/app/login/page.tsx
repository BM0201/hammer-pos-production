"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, unwrapApiData, type ApiResponse } from "@/lib/client/api";
import { resolveRoleHome } from "@/modules/rbac/role-routing";

/* ── Palette ──────────────────────────────────────────────────────── */
const C = {
  /* ── Structural palette ── */
  base:      "#EDECEA",
  surface:   "#E4E2DE",
  surfaceHi: "#F5F4F2",
  border:    "#CCCAC5",
  borderMid: "#B5B3AD",
  ink:       "#2E2D2A",
  ink2:      "#6B6965",
  ink3:      "#9B9892",
  /* ── Accent ── */
  accent:    "#D4380D",
  accentHi:  "#E04010",
  accentLo:  "#A82B08",
  accentDim: "rgba(212,56,13,0.10)",
  /* ── v7 semantic roles ── */
  success:          "#2D7D46",   successText:    "#1A4D2C",
  info:             "#2C5F8A",   infoText:       "#1A3A55",
  warning:          "#A36A0E",   warningText:    "#5C3B08",
  inactive:         "#7A7873",   inactiveText:   "#4A4944",
  brandAccent:      "#B5651D",   brandText:      "#6B3C11",
  catInventario:    "#5C8A6E",   catText:        "#355241",
  roleAdmin:        "#5B4A8A",   roleAdminText:  "#352B52",
  /* ── Adaptive ink (3 surface variants per level) ── */
  ink2OnBase:       "#4A4843",   ink3OnBase:       "#6B6862",
  ink2OnSurface:    "#514F49",   ink3OnSurface:    "#6B6862",
  ink2OnSurfaceHi:  "#5C5A54",   ink3OnSurfaceHi:  "#847F77",
  /* ── Legacy alias ── */
  green:     "#2D7D46",
} as const;

/* ── Triangle nodes (overlay animation) ──────────────────────────── */
const NODES = [
  { cx: 36, cy: 12 }, // Top
  { cx: 66, cy: 64 }, // BottomRight
  { cx:  6, cy: 64 }, // BottomLeft
];

/* ── Last-access formatter ────────────────────────────────────────── */
function fmtAcceso(ts: string | null): string {
  if (!ts) return "Primer acceso";
  const d   = new Date(parseInt(ts));
  const now = new Date();
  const hora = d.toLocaleTimeString("es-NI", { hour: "2-digit", minute: "2-digit", hour12: true });
  if (now.toDateString() === d.toDateString())
    return `Hoy, ${hora}`;
  if (new Date(now.getTime() - 86400000).toDateString() === d.toDateString())
    return `Ayer, ${hora}`;
  return `${d.toLocaleDateString("es-NI", { day: "2-digit", month: "short" })}, ${hora}`;
}

/* ── Shared style helpers (outside component — no closure needed) ─── */
const LABEL_S: React.CSSProperties = {
  display: "block",
  fontFamily: "'DM Mono', monospace",
  fontSize: "11px",
  fontWeight: 500,
  color: C.ink2,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  marginBottom: "5px",
};

function inputS(hasErr: boolean, extraPad?: string): React.CSSProperties {
  return {
    width: "100%",
    background: C.surface,
    border: `1px solid ${hasErr ? C.accent : C.border}`,
    borderRadius: "5px",
    color: C.ink,
    fontFamily: "'DM Mono', monospace",
    fontSize: "14px",
    padding: extraPad ?? "10px 12px 10px 34px",
    outline: "none",
    boxShadow: hasErr ? `0 0 0 3px ${C.accentDim}` : "none",
    transition: "border-color 150ms ease, box-shadow 150ms ease",
  };
}

type LoginStep = "credentials" | "mfa";

/* ── Page ─────────────────────────────────────────────────────────── */
export default function LoginPage() {
  const router = useRouter();

  /* Session check */
  const [checking,   setChecking]   = useState(true);

  /* Corner info */
  const [lastAcceso, setLastAcceso] = useState("—");
  const [branches,   setBranches]   = useState<string[]>([
    "Central — Managua",
    "Masaya",
    "Rivas",
  ]);
  const [sucText,    setSucText]    = useState("Central — Managua");
  const [sucOpacity, setSucOpacity] = useState(1);

  /* Form state */
  const [step,       setStep]       = useState<LoginStep>("credentials");
  const [username,   setUsername]   = useState("");
  const [password,   setPassword]   = useState("");
  const [showPwd,    setShowPwd]    = useState(false);
  const [mfaCode,    setMfaCode]    = useState("");
  const [pending,    setPending]    = useState("");
  const [fullName,   setFullName]   = useState("");
  const [error,      setError]      = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errUser,    setErrUser]    = useState(false);
  const [errPass,    setErrPass]    = useState(false);
  const [btnHov,     setBtnHov]     = useState(false);

  /* Animation refs */
  const ovRef   = useRef<HTMLDivElement>(null);
  const svgRef  = useRef<SVGSVGElement>(null);
  const dotRef  = useRef<SVGCircleElement>(null);
  const nomRef  = useRef<HTMLParagraphElement>(null);
  const sucRef  = useRef<HTMLParagraphElement>(null);
  const progRef = useRef<HTMLDivElement>(null);

  /* ── Session check + redirect if already authenticated ─────────── */
  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/auth/session")
      .then(async (r) => (r.ok ? r.json() : null))
      .then((raw) => {
        if (cancelled || !raw) return;
        const p = unwrapApiData(raw);
        if (p?.authenticated && p.user) {
          router.replace(resolveRoleHome(p.user.roleCode, p.user.globalRoles ?? []));
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [router]);

  /* ── Last access from localStorage ─────────────────────────────── */
  useEffect(() => {
    setLastAcceso(fmtAcceso(localStorage.getItem("hammer_ultimo_acceso")));
  }, []);

  /* ── Fetch branches from API ────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;

    // La pantalla de login es pública. /api/branches puede requerir sesión en
    // producción; si responde 401, NO debe activar la redirección global del
    // cliente HTTP ni recargar /login en bucle. Conservamos las sucursales
    // estáticas como fallback decorativo y solo reemplazamos si la API responde OK.
    apiFetch("/api/branches", { suppressAuthRedirect: true })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((raw) => {
        if (cancelled || !raw) return;
        const data = unwrapApiData(raw);
        const list: unknown = Array.isArray(data) ? data : data?.data;
        if (Array.isArray(list) && list.length > 0) {
          const nextBranches = (list as { name?: unknown; city?: unknown }[])
            .map((b) => {
              const name = typeof b.name === "string" ? b.name.trim() : "";
              const city = typeof b.city === "string" ? b.city.trim() : "";
              return name && city ? `${name} — ${city}` : name || city;
            })
            .filter((label): label is string => label.length > 0);

          if (nextBranches.length > 0) setBranches(nextBranches);
        }
      })
      .catch(() => {
        // Fallback silencioso: la lista estática inicial mantiene el login estable.
      });

    return () => { cancelled = true; };
  }, []);

  /* ── Sucursal rotante ───────────────────────────────────────────── */
  useEffect(() => {
    if (branches.length === 0) return;
    setSucText(branches[0]);
    setSucOpacity(1);
    if (branches.length < 2) return;
    let idx = 0;
    let tid: ReturnType<typeof setTimeout> | null = null;
    const id = setInterval(() => {
      setSucOpacity(0);
      tid = setTimeout(() => {
        tid = null;
        idx = (idx + 1) % branches.length;
        setSucText(branches[idx]);
        setSucOpacity(1);
      }, 400);
    }, 3500);
    return () => {
      clearInterval(id);
      if (tid !== null) clearTimeout(tid);
    };
  }, [branches]);

  /* ── Transition animation — loading screen real ─────────────────── */
  function playTransition(userName: string, onDone: () => void) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      localStorage.setItem("hammer_ultimo_acceso", Date.now().toString());
      setLastAcceso(fmtAcceso(Date.now().toString()));
      onDone();
      return;
    }
    const ov   = ovRef.current;
    const svg  = svgRef.current;
    const dot  = dotRef.current;
    const nom  = nomRef.current;
    const suc  = sucRef.current;
    const prog = progRef.current;
    if (!ov || !svg || !dot || !nom || !suc) { onDone(); return; }

    // Extraer primer nombre para el saludo
    const firstName = userName.split(" ")[0] ?? userName;

    // Reset
    dot.setAttribute("cx", "36");
    dot.setAttribute("cy", "12");
    svg.style.cssText  = "";
    nom.style.cssText  = "";
    suc.style.cssText  = "";
    nom.textContent    = "Bienvenido de vuelta";
    suc.textContent    = firstName;
    if (prog) prog.style.cssText = "";

    // Phase 1 — fade-in overlay (cubre pantalla de inmediato)
    ov.style.display    = "flex";
    ov.style.opacity    = "0";
    ov.style.transition = "opacity 220ms ease";
    nom.style.animation = "hmFadeInUp 400ms ease 350ms both";
    suc.style.animation = "hmFadeInUp 450ms ease 520ms both";
    if (prog) {
      prog.style.animation = "hmProgress 2200ms cubic-bezier(0.1,0,0.3,1) 100ms both";
    }
    requestAnimationFrame(() => requestAnimationFrame(() => { ov.style.opacity = "1"; }));

    // Phase 2 — punto rojo recorre el triángulo (700ms × 3 vértices)
    [1, 2, 0].forEach((ni, i) => {
      setTimeout(() => {
        dot.setAttribute("cx", String(NODES[ni].cx));
        dot.setAttribute("cy", String(NODES[ni].cy));
      }, 700 * (i + 1));
    });

    // Phase 3 — SVG y texto se disuelven
    setTimeout(() => {
      svg.style.transition = "opacity 400ms ease";
      svg.style.opacity    = "0";
      nom.style.transition = "opacity 350ms ease 50ms";
      nom.style.opacity    = "0";
      suc.style.transition = "opacity 350ms ease";
      suc.style.opacity    = "0";

      // Phase 4 — NAVEGACIÓN
      // Pintamos el body con el mismo color de fondo para que cualquier frame
      // intermedio entre el overlay del login y HammerSplash sea invisible.
      document.documentElement.style.backgroundColor = "#EDECEA";
      document.body.style.backgroundColor = "#EDECEA";

      onDone();
      localStorage.setItem("hammer_ultimo_acceso", Date.now().toString());
      setLastAcceso(fmtAcceso(Date.now().toString()));

      // El overlay empieza a desvanecerse a los 700ms (antes era 300ms).
      // Esto da tiempo suficiente a que HammerSplash monte en la nueva página
      // antes de que el overlay desaparezca, eliminando cualquier corte visual.
      setTimeout(() => {
        ov.style.transition = "opacity 500ms ease";
        ov.style.opacity    = "0";
      }, 700);

      // Phase 5 — limpieza (el nuevo page ya está renderizado)
      setTimeout(() => {
        ov.style.display   = "none";
        svg.style.cssText  = "";
        nom.style.cssText  = "";
        suc.style.cssText  = "";
        if (prog) prog.style.cssText = "";
        dot.setAttribute("cx", "36");
        dot.setAttribute("cy", "12");
        document.documentElement.style.backgroundColor = "";
        document.body.style.backgroundColor = "";
      }, 1300);
    }, 2300);
  }

  /* ── Credentials submit ─────────────────────────────────────────── */
  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    let ok = true;
    if (!username.trim()) { setErrUser(true); ok = false; }
    if (!password)        { setErrPass(true); ok = false; }
    if (!ok) return;

    setSubmitting(true);
    setError(null);

    let dest         = "";
    let playAnim     = false;
    let resolvedName = "";

    try {
      const res  = await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: username.trim().toLowerCase(), password }),
      });
      const json = await res.json() as ApiResponse<{
        redirectTo?: string;
        mfaRequired?: boolean;
        pendingToken?: string;
        fullName?: string;
      }>;

      if (!res.ok) {
        const msg =
          !json.ok && "error" in json &&
          typeof json.error === "object" && json.error && "message" in json.error
            ? (json.error as { message: string }).message
            : res.status === 401 ? "Usuario o contraseña inválidos." : "No se pudo iniciar sesión.";
        setError(msg);
        setSubmitting(false);
        return;
      }

      const data = unwrapApiData(json);

      if (data.mfaRequired && data.pendingToken) {
        setPending(data.pendingToken);
        if (data.fullName) { setFullName(data.fullName); }
        setStep("mfa");
        setSubmitting(false);
        return;
      }

      if (!data.redirectTo) {
        setError("No se pudo iniciar sesión. Inténtalo de nuevo.");
        setSubmitting(false);
        return;
      }

      dest         = data.redirectTo;
      resolvedName = data.fullName || username;
      if (data.fullName) setFullName(data.fullName);
      playAnim     = true;
    } catch {
      setError("No se pudo iniciar sesión. Verifica tu conexión e inténtalo de nuevo.");
      setSubmitting(false);
    }

    if (playAnim) {
      playTransition(resolvedName, () => {
        router.push(dest as Parameters<typeof router.push>[0]);
        router.refresh();
      });
    }
  }

  /* ── MFA submit ─────────────────────────────────────────────────── */
  async function handleMfa(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    let dest         = "";
    let playAnim     = false;
    let resolvedName = fullName || username;

    try {
      const res  = await apiFetch("/api/auth/mfa", {
        method: "POST",
        body: JSON.stringify({ pendingToken: pending, code: mfaCode.trim() }),
      });
      const json = await res.json() as ApiResponse<{ redirectTo: string; fullName?: string }>;

      if (!res.ok) {
        const msg =
          !json.ok && "error" in json &&
          typeof json.error === "object" && json.error && "message" in json.error
            ? (json.error as { message: string }).message : "Código incorrecto.";
        setError(msg);
        setMfaCode("");
        setSubmitting(false);
        return;
      }

      const mfaData = unwrapApiData(json);
      dest = mfaData.redirectTo;
      if (mfaData.fullName) { resolvedName = mfaData.fullName; setFullName(mfaData.fullName); }
      playAnim = true;
    } catch {
      setError("No se pudo verificar el código. Verifica tu conexión e inténtalo de nuevo.");
      setSubmitting(false);
    }

    if (playAnim) {
      playTransition(resolvedName, () => {
        router.push(dest as Parameters<typeof router.push>[0]);
        router.refresh();
      });
    }
  }

  /* ── Session spinner ────────────────────────────────────────────── */
  if (checking) {
    return (
      <div style={{ minHeight: "100dvh", background: C.base, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{
          width: "1.25rem", height: "1.25rem", borderRadius: "50%",
          border: `2px solid ${C.border}`, borderTopColor: C.accent,
          animation: "hmSpin 0.7s linear infinite",
        }} />
        <style>{`@keyframes hmSpin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  /* ── Submit button (shared between steps) ──────────────────────── */
  const submitBtn = (label: string, loadingLabel: string) => (
    <button
      type="submit"
      disabled={submitting}
      onMouseEnter={() => setBtnHov(true)}
      onMouseLeave={() => setBtnHov(false)}
      style={{
        width: "100%",
        marginTop: "1.25rem",
        padding: "11px 20px",
        background: submitting ? C.accentLo : btnHov ? C.accentHi : C.accent,
        boxShadow: btnHov && !submitting ? "0 2px 10px rgba(212,56,13,0.22)" : "none",
        color: "#fff",
        fontFamily: "'Inter', system-ui, sans-serif",
        fontSize: "14px",
        fontWeight: 600,
        border: "none",
        borderRadius: "5px",
        cursor: submitting ? "not-allowed" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "7px",
        opacity: submitting ? 0.75 : 1,
        transition: "background 120ms ease, box-shadow 120ms ease",
      }}
    >
      {submitting ? (
        <>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ animation: "hmSpin 0.75s linear infinite" }} aria-hidden>
            <circle cx="8" cy="8" r="6" strokeDasharray="22 16" strokeLinecap="round"/>
          </svg>
          {loadingLabel}
        </>
      ) : (
        <>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M6 3H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h3" strokeLinecap="round"/>
            <path d="M10.5 11L13.5 8l-3-3" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M13.5 8H6" strokeLinecap="round"/>
          </svg>
          {label}
        </>
      )}
    </button>
  );

  /* ── Error box ──────────────────────────────────────────────────── */
  const errBox = (msg: string) => (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: "8px",
      padding: "10px 12px", marginBottom: "1rem",
      background: "rgba(212,56,13,0.08)",
      border: "1px solid rgba(212,56,13,0.20)",
      borderRadius: "5px", fontSize: "12px", color: C.accentLo,
    }}>
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
        style={{ flexShrink: 0, marginTop: "1px" }} aria-hidden>
        <circle cx="8" cy="8" r="6.5"/>
        <path d="M8 5v3.5M8 11h.01" strokeLinecap="round"/>
      </svg>
      <span>{msg}</span>
    </div>
  );

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
        @keyframes hmSpin     { to { transform: rotate(360deg); } }
        @keyframes hmPulse    { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes hmFadeInUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes hmProgress { from{width:0%} to{width:100%} }
        @media (prefers-reduced-motion: reduce) {
          #hm-red-dot { transition: none !important; }
          #hm-ov-svg  { transition: none !important; }
        }
        @media (max-width: 520px) {
          .hm-lg { grid-template-columns: 1fr !important; padding: 1.25rem !important; }
          .hm-mn { grid-column: 1 !important; grid-row: 1 !important; }
          .hm-cr { display: none !important; }
        }
      `}</style>

      {/* ── Background + grid layout ──────────────────────────────── */}
      <div
        className="hm-lg"
        style={{
          minHeight: "100dvh",
          background: C.base,
          display: "grid",
          gridTemplateColumns: "1fr 420px 1fr",
          gridTemplateRows: "1fr auto 1fr",
          padding: "2rem",
          position: "relative",
          fontFamily: "'Inter', system-ui, sans-serif",
          fontSize: "15px",
          color: C.ink,
          WebkitFontSmoothing: "antialiased",
          overflow: "hidden",
        }}
      >
        {/* Dot texture */}
        <div aria-hidden style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          backgroundImage: "radial-gradient(circle, #C5C3BE 1px, transparent 1px)",
          backgroundSize: "20px 20px", opacity: 0.5,
        }} />
        {/* Grid texture */}
        <div aria-hidden style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          backgroundImage: `linear-gradient(${C.border} 1px, transparent 1px), linear-gradient(90deg, ${C.border} 1px, transparent 1px)`,
          backgroundSize: "80px 80px", opacity: 0.18,
        }} />

        {/* ── Main card ─────────────────────────────────────────────── */}
        <main className="hm-mn" style={{ gridColumn: 2, gridRow: 2, position: "relative", zIndex: 1 }}>

          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "2rem" }}>
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden>
              <line x1="20" y1="7"  x2="7"  y2="30" stroke={C.border} strokeWidth="1.5"/>
              <line x1="20" y1="7"  x2="33" y2="30" stroke={C.border} strokeWidth="1.5"/>
              <line x1="7"  y1="30" x2="33" y2="30" stroke={C.border} strokeWidth="1.5"/>
              <circle cx="20" cy="7"  r="4.5" fill={C.ink}/>
              <circle cx="7"  cy="30" r="3.5" fill={C.ink3OnBase}/>
              <circle cx="33" cy="30" r="3.5" fill={C.ink3OnBase}/>
              <circle cx="20" cy="7"  r="2"   fill={C.accent}/>
            </svg>
            <div style={{ display: "flex", flexDirection: "column", gap: "1px", lineHeight: 1 }}>
              <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 500, fontSize: "26px", letterSpacing: "0.12em", color: C.ink }}>
                HAMMER
              </span>
              <span style={{ fontSize: "10px", color: C.ink3, letterSpacing: "0.04em", lineHeight: 1.4 }}>
                Herramienta de Administración Multisucursal<br />
                de Mercadería, Existencias y Reabastecimiento
              </span>
            </div>
          </div>

          {/* Card */}
          <div style={{
            background: C.surfaceHi,
            border: `1px solid ${C.border}`,
            borderRadius: "8px",
            overflow: "hidden",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04)",
          }}>
            {/* Card header */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 16px", background: C.surface, borderBottom: `1px solid ${C.border}`,
            }}>
              <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: C.accent }} />
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: C.borderMid }} />
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: C.borderMid }} />
              </div>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "11px", color: C.ink3, letterSpacing: "0.06em" }}>
                ACCESO AL SISTEMA
              </span>
              <span style={{
                fontFamily: "'DM Mono', monospace", fontSize: "10px", color: "#fff",
                background: C.accent, letterSpacing: "0.08em", padding: "2px 7px", borderRadius: "3px", fontWeight: 500,
              }}>
                BETA
              </span>
            </div>

            {/* Card body */}
            <div style={{ padding: "1.75rem 1.75rem 1.5rem" }}>

              {step === "credentials" ? (
                <>
                  <h1 style={{ fontSize: "17px", fontWeight: 600, color: C.ink, letterSpacing: "-0.02em", marginBottom: "3px" }}>
                    Iniciar sesión
                  </h1>
                  <p style={{ fontSize: "13px", color: C.ink2, marginBottom: "1.5rem" }}>
                    Ingresa tus credenciales para continuar.
                  </p>

                  <form onSubmit={handleCredentials} noValidate>
                    {/* Username */}
                    <div style={{ marginBottom: ".875rem" }}>
                      <label style={LABEL_S}>Usuario</label>
                      <div style={{ position: "relative" }}>
                        <svg aria-hidden style={{ position: "absolute", left: "11px", top: "50%", transform: "translateY(-50%)", width: "14px", height: "14px", color: C.ink3, pointerEvents: "none" }} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <circle cx="8" cy="5.5" r="2.5"/>
                          <path d="M2 13c0-3 2-5 6-5s6 2 6 5" strokeLinecap="round"/>
                        </svg>
                        <input
                          type="text"
                          value={username}
                          onChange={(e) => { setUsername(e.target.value); if (e.target.value.trim()) setErrUser(false); }}
                          placeholder="nombre.sucursal"
                          autoComplete="username"
                          autoCapitalize="none"
                          spellCheck={false}
                          style={inputS(errUser)}
                        />
                      </div>
                      {errUser && (
                        <span style={{ display: "block", marginTop: "4px", fontSize: "11px", color: C.accent, fontWeight: 500, fontFamily: "'DM Mono', monospace" }}>
                          {"// campo requerido"}
                        </span>
                      )}
                    </div>

                    {/* Password */}
                    <div style={{ marginBottom: ".875rem" }}>
                      <label style={LABEL_S}>Contraseña</label>
                      <div style={{ position: "relative" }}>
                        <svg aria-hidden style={{ position: "absolute", left: "11px", top: "50%", transform: "translateY(-50%)", width: "14px", height: "14px", color: C.ink3, pointerEvents: "none" }} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <rect x="3" y="7.5" width="10" height="7" rx="1.5"/>
                          <path d="M5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2" strokeLinecap="round"/>
                        </svg>
                        <input
                          type={showPwd ? "text" : "password"}
                          value={password}
                          onChange={(e) => { setPassword(e.target.value); if (e.target.value) setErrPass(false); }}
                          placeholder="••••••••"
                          autoComplete="current-password"
                          style={inputS(errPass, "10px 38px 10px 34px")}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPwd((v) => !v)}
                          aria-label={showPwd ? "Ocultar contraseña" : "Mostrar contraseña"}
                          style={{
                            position: "absolute", right: "9px", top: "50%", transform: "translateY(-50%)",
                            background: "none", border: "none", cursor: "pointer", color: C.ink3,
                            padding: "4px", display: "flex", alignItems: "center", borderRadius: "3px",
                          }}
                        >
                          {showPwd ? (
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                              <path d="M2 2l12 12M6.5 6.6A2 2 0 0 0 9.4 9.4M4.1 4.2C2.6 5.1 1.4 6.5 1 8c1 3 3.8 5 7 5a7 7 0 0 0 3.9-1.2M7 3.1A7 7 0 0 1 8 3c3.2 0 6 2 7 5-.4 1.1-1 2.1-1.8 2.9" strokeLinecap="round"/>
                            </svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                              <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z"/>
                              <circle cx="8" cy="8" r="2"/>
                            </svg>
                          )}
                        </button>
                      </div>
                      {errPass && (
                        <span style={{ display: "block", marginTop: "4px", fontSize: "11px", color: C.accent, fontWeight: 500, fontFamily: "'DM Mono', monospace" }}>
                          {"// campo requerido"}
                        </span>
                      )}
                    </div>

                    {error && errBox(error)}
                    {submitBtn("Entrar", "Autenticando…")}
                  </form>
                </>
              ) : (
                /* ── MFA step ─────────────────────────────────────── */
                <form onSubmit={handleMfa}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", paddingBottom: "1.25rem" }}>
                    <div style={{
                      width: "48px", height: "48px", borderRadius: "50%",
                      background: C.accentDim, display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke={C.accent} strokeWidth="1.5" aria-hidden>
                        <rect x="3" y="7" width="10" height="8" rx="1.5"/>
                        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" strokeLinecap="round"/>
                        <circle cx="8" cy="11" r="1" fill={C.accent} stroke="none"/>
                      </svg>
                    </div>
                    <h2 style={{ fontSize: "16px", fontWeight: 600, color: C.ink, letterSpacing: "-0.02em" }}>
                      Verificación en dos pasos
                    </h2>
                    <p style={{ fontSize: "12px", color: C.ink2, textAlign: "center", maxWidth: "260px", lineHeight: 1.5 }}>
                      Ingresa el código de 6 dígitos de tu aplicación de autenticación.
                    </p>
                  </div>

                  <div style={{ marginBottom: "1rem" }}>
                    <label style={LABEL_S}>Código de verificación</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={10}
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value)}
                      placeholder="000000"
                      required
                      style={{
                        width: "100%", background: C.surface, border: `1px solid ${C.border}`,
                        borderRadius: "5px", color: C.ink, fontFamily: "'DM Mono', monospace",
                        fontSize: "20px", padding: "10px 12px", outline: "none",
                        textAlign: "center", letterSpacing: "0.2em",
                      }}
                    />
                  </div>

                  {error && errBox(error)}
                  {submitBtn("Verificar código", "Verificando…")}

                  <button
                    type="button"
                    onClick={() => { setStep("credentials"); setMfaCode(""); setPending(""); setError(null); }}
                    style={{
                      display: "flex", width: "100%", alignItems: "center", justifyContent: "center",
                      gap: "6px", marginTop: "12px", background: "none", border: "none",
                      cursor: "pointer", fontSize: "12px", color: C.ink3,
                      fontFamily: "'Inter', system-ui, sans-serif",
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                      <path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Volver al inicio de sesión
                  </button>
                </form>
              )}
            </div>

            {/* Card footer */}
            <div style={{ padding: "10px 1.75rem", background: C.surface, borderTop: `1px solid ${C.border}` }}>
              <p style={{ fontSize: "12px", color: C.ink3, lineHeight: 1.5 }}>
                ¿Primer acceso? Tu administrador te envía la contraseña inicial.
              </p>
            </div>
          </div>
        </main>

        {/* ── Corner BL: sucursal rotante + último acceso ──────────── */}
        <div className="hm-cr" style={{ position: "fixed", bottom: "1.5rem", left: "1.75rem", zIndex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "10px", color: C.ink3OnBase, letterSpacing: "0.05em", textTransform: "uppercase" }}>
            Sucursal
          </span>
          <div style={{ height: "16px", overflow: "hidden" }}>
            <span style={{
              fontFamily: "'DM Mono', monospace", fontSize: "11px", color: C.ink2OnBase,
              letterSpacing: "0.03em", display: "block",
              opacity: sucOpacity, transition: "opacity 400ms ease",
            }}>
              {sucText}
            </span>
          </div>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "10px", color: C.ink3OnBase, letterSpacing: "0.05em", textTransform: "uppercase", marginTop: "6px" }}>
            Último acceso
          </span>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "11px", color: C.ink2OnBase }}>
            {lastAcceso}
          </span>
        </div>

        {/* ── Corner BR: status pill + copyright ──────────────────── */}
        <div className="hm-cr" style={{ position: "fixed", bottom: "1.5rem", right: "1.75rem", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontFamily: "'DM Mono', monospace", fontSize: "10px", color: C.success, letterSpacing: "0.04em" }}>
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: C.success, animation: "hmPulse 2.5s ease-in-out infinite", flexShrink: 0 }} />
            SISTEMA OPERATIVO
          </span>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "11px", color: C.ink2OnBase, marginTop: "4px" }}>
            © 2026 Hammer
          </span>
        </div>
      </div>

      {/* ── Pantalla de carga / transición ───────────────────────── */}
      <div
        ref={ovRef}
        role="status"
        aria-label="Cargando el sistema"
        style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: C.base,
          display: "none",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "0",
        }}
      >
        {/* Misma textura de fondo que el login */}
        <div aria-hidden style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          backgroundImage: "radial-gradient(circle, #C5C3BE 1px, transparent 1px)",
          backgroundSize: "20px 20px", opacity: 0.4,
        }} />
        <div aria-hidden style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          backgroundImage: `linear-gradient(${C.border} 1px, transparent 1px), linear-gradient(90deg, ${C.border} 1px, transparent 1px)`,
          backgroundSize: "80px 80px", opacity: 0.14,
        }} />

        {/* Triángulo */}
        <svg
          ref={svgRef}
          id="hm-ov-svg"
          width="96"
          height="96"
          viewBox="0 0 72 76"
          fill="none"
          aria-hidden
          style={{ marginBottom: "2.5rem" }}
        >
          <line x1="36" y1="12" x2="66" y2="64" stroke={C.border} strokeWidth="1.5"/>
          <line x1="66" y1="64" x2="6"  y2="64" stroke={C.border} strokeWidth="1.5"/>
          <line x1="6"  y1="64" x2="36" y2="12" stroke={C.border} strokeWidth="1.5"/>
          <circle cx="36" cy="12" r="6" fill={C.ink}/>
          <circle cx="66" cy="64" r="5" fill={C.ink3OnBase}/>
          <circle cx="6"  cy="64" r="5" fill={C.ink3OnBase}/>
          <circle
            ref={dotRef}
            id="hm-red-dot"
            cx="36" cy="12" r="3"
            fill={C.accent}
            style={{ transition: "cx 540ms cubic-bezier(0.4,0,0.2,1), cy 540ms cubic-bezier(0.4,0,0.2,1)" }}
          />
        </svg>

        {/* Texto de bienvenida */}
        <div style={{ textAlign: "center", position: "relative", zIndex: 1 }}>
          <p
            ref={nomRef}
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: "11px",
              fontWeight: 500,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: C.ink3OnBase,
              marginBottom: "8px",
              opacity: 0,
            }}
          />
          <p
            ref={sucRef}
            style={{
              fontFamily: "'Inter', system-ui, sans-serif",
              fontSize: "28px",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              color: C.ink,
              opacity: 0,
              lineHeight: 1.1,
            }}
          />
        </div>

        {/* Barra de progreso */}
        <div style={{
          position: "absolute",
          bottom: 0, left: 0, right: 0,
          height: "2px",
          background: C.surface,
          overflow: "hidden",
        }}>
          <div
            ref={progRef}
            style={{
              height: "100%",
              width: "0%",
              background: `linear-gradient(90deg, ${C.accentLo}, ${C.accent})`,
              borderRadius: "0 2px 2px 0",
            }}
          />
        </div>
      </div>
    </>
  );
}
