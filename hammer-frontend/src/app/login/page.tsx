"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { resolveRoleHome } from "@/modules/rbac/role-routing";
import { Hammer, Shield, Zap, BarChart3, Globe } from "lucide-react";

const FEATURES = [
  {
    icon: Shield,
    label: "Control de acceso por roles",
    desc: "Master, Admin, Ventas, Caja, Bodega",
    color: "from-blue-500/20 to-indigo-500/20 border-blue-500/30",
    iconColor: "text-blue-300",
  },
  {
    icon: Zap,
    label: "Operaciones en tiempo real",
    desc: "Inventario, ventas y cobros sincronizados",
    color: "from-emerald-500/20 to-teal-500/20 border-emerald-500/30",
    iconColor: "text-emerald-300",
  },
  {
    icon: BarChart3,
    label: "Reportes & Auditoría",
    desc: "Trazabilidad completa de cada operación",
    color: "from-violet-500/20 to-purple-500/20 border-violet-500/30",
    iconColor: "text-violet-300",
  },
  {
    icon: Globe,
    label: "Multi-sucursal",
    desc: "Centraliza el control de todas tus tiendas",
    color: "from-amber-500/20 to-orange-500/20 border-amber-500/30",
    iconColor: "text-amber-300",
  },
];

export default function LoginPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/auth/session")
      .then(async (r) => {
        if (!r.ok) return null;
        return r.json();
      })
      .then((raw) => {
        if (cancelled || !raw) return;
        const payload = unwrapApiData(raw);
        if (payload.authenticated && payload.user) {
          router.replace(resolveRoleHome(payload.user.roleCode, payload.user.globalRoles ?? []));
        }
      })
      .catch(() => {
        /* swallow — show login form */
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--color-page-bg)]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-[2.5px] border-slate-200 border-t-indigo-500 animate-spin" />
          <span className="text-sm text-[var(--color-text-muted)]">Verificando sesión…</span>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen flex">
      {/* ── Left panel — branding + features ── */}
      <div className="hidden lg:flex lg:w-[46%] xl:w-[42%] flex-col justify-between relative overflow-hidden">
        {/* Background layers */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950" />
        {/* Decorative orbs */}
        <div className="absolute -top-40 -left-20 h-80 w-80 rounded-full bg-indigo-600/10 blur-3xl pointer-events-none" />
        <div className="absolute top-1/2 -right-20 h-60 w-60 rounded-full bg-violet-600/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 left-1/4 h-72 w-72 rounded-full bg-blue-600/10 blur-3xl pointer-events-none" />
        {/* Subtle dot grid */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: "radial-gradient(circle, #6366f1 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />

        {/* Content */}
        <div className="relative z-10 p-10 flex flex-col h-full">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-11 h-11 rounded-2xl bg-white/10 backdrop-blur-sm ring-1 ring-white/20">
              <Hammer className="h-6 w-6 text-indigo-300" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">H.A.M.M.E.R.</h1>
              <p className="text-[0.6875rem] text-slate-400 font-medium tracking-wide">POS / ERP Multi-Sucursal</p>
            </div>
          </div>

          {/* Hero text */}
          <div className="mt-14 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-400 mb-3">
              Sistema Empresarial
            </p>
            <h2 className="text-[2rem] font-extrabold leading-[1.15] text-white mb-4">
              Gestiona todas tus<br />
              sucursales desde<br />
              <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-teal-400 bg-clip-text text-transparent">
                un solo lugar.
              </span>
            </h2>
            <p className="text-sm text-slate-400 leading-relaxed max-w-xs">
              Inventario, ventas, caja y reportes integrados en tiempo real con control de acceso por rol.
            </p>

            {/* Features */}
            <div className="mt-9 space-y-3">
              {FEATURES.map((f, i) => (
                <div
                  key={f.label}
                  className={`flex items-center gap-3.5 rounded-xl border bg-gradient-to-r ${f.color} p-3.5 backdrop-blur-sm animate-fade-in-up`}
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/10 flex-shrink-0">
                    <f.icon className={`h-4 w-4 ${f.iconColor}`} />
                  </div>
                  <div>
                    <p className="text-[0.8125rem] font-semibold text-white">{f.label}</p>
                    <p className="text-[0.6875rem] text-slate-400">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <p className="text-[0.625rem] text-slate-600 mt-6">
            &copy; 2026 H.A.M.M.E.R. — Todos los derechos reservados.
          </p>
        </div>
      </div>

      {/* ── Right panel — login form ── */}
      <div className="flex-1 flex items-center justify-center p-6 bg-[var(--color-page-bg)] relative">
        {/* Subtle background orb */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-20 right-0 h-64 w-64 rounded-full bg-indigo-50 blur-3xl opacity-60" />
          <div className="absolute bottom-0 left-0 h-48 w-48 rounded-full bg-blue-50 blur-3xl opacity-40" />
        </div>

        <div className="relative w-full max-w-sm animate-fade-in-up">
          {/* Mobile-only logo */}
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 shadow-md shadow-indigo-500/25">
              <Hammer className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-lg font-bold text-[var(--color-text)]">H.A.M.M.E.R.</p>
              <p className="text-[0.6875rem] text-[var(--color-text-muted)]">POS / ERP</p>
            </div>
          </div>

          {/* Form card */}
          <div className="bg-[var(--color-surface)] rounded-2xl shadow-[var(--shadow-xl)] border border-[var(--color-border)] p-8">
            <div className="mb-6">
              <h2 className="text-[1.375rem] font-extrabold text-[var(--color-text)] tracking-tight">
                Bienvenido de vuelta
              </h2>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                Inicia sesión para acceder al sistema.
              </p>
            </div>

            <LoginForm />
          </div>

          <p className="lg:hidden mt-6 text-center text-[0.625rem] text-[var(--color-text-soft)]">
            &copy; 2026 H.A.M.M.E.R.
          </p>
        </div>
      </div>
    </main>
  );
}
