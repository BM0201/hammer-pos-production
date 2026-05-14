import { LoginForm } from "@/components/login-form";
import { SessionExpiredToast } from "@/components/session-expired-toast";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/modules/auth/service";
import { getRoleAwareHome } from "@/modules/rbac/guards";
import { Hammer, Shield, Zap, BarChart3 } from "lucide-react";
import { Suspense } from "react";

export default async function LoginPage() {
  const session = await getCurrentSession();
  if (session) {
    redirect(getRoleAwareHome(session.roleCode, session.globalRoles));
  }

  return (
    <main className="min-h-screen flex">
      {/* ── Left panel — branding + features ── */}
      <div className="hidden lg:flex lg:w-[45%] xl:w-[40%] flex-col justify-between bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white p-10">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-11 h-11 rounded-2xl bg-white/10 backdrop-blur-sm">
              <Hammer className="h-6 w-6 text-indigo-300" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">H.A.M.M.E.R.</h1>
              <p className="text-xs text-slate-400">POS / ERP Multi-Sucursal</p>
            </div>
          </div>

          <div className="mt-16 space-y-8">
            <h2 className="text-2xl font-bold leading-tight">
              Gestiona todas tus<br />
              sucursales desde un<br />
              <span className="bg-gradient-to-r from-indigo-400 to-teal-400 bg-clip-text text-transparent">
                solo lugar.
              </span>
            </h2>

            <div className="space-y-5">
              {[
                { icon: Shield, label: "Control de acceso por roles", desc: "Master, Admin, Ventas, Caja, Bodega" },
                { icon: Zap, label: "Operaciones en tiempo real", desc: "Inventario, ventas y cobros sincronizados" },
                { icon: BarChart3, label: "Reportes & Auditoría", desc: "Trazabilidad completa de cada operación" },
              ].map((feature) => (
                <div key={feature.label} className="flex items-start gap-3">
                  <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-white/10 flex-shrink-0 mt-0.5">
                    <feature.icon className="h-4 w-4 text-indigo-300" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{feature.label}</p>
                    <p className="text-xs text-slate-400">{feature.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="text-[0.6875rem] text-slate-500">
          &copy; 2026 H.A.M.M.E.R. — Todos los derechos reservados.
        </p>
      </div>

      {/* ── Right panel — login form ── */}
      <div className="flex-1 flex items-center justify-center p-6 bg-[var(--color-page-bg)]">
        <div className="w-full max-w-sm animate-fade-in-up">
          {/* Mobile-only logo */}
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700">
              <Hammer className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-lg font-bold text-[var(--color-text)]">H.A.M.M.E.R.</p>
              <p className="text-xs text-[var(--color-text-muted)]">POS / ERP</p>
            </div>
          </div>

          <h2 className="text-xl font-bold text-[var(--color-text)]">Bienvenido</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Inicia sesión para acceder al sistema.
          </p>

          <div className="mt-6">
            <Suspense fallback={null}>
              <SessionExpiredToast />
            </Suspense>
            <LoginForm />
          </div>

          <p className="lg:hidden mt-8 text-center text-[0.6875rem] text-[var(--color-text-soft)]">
            &copy; 2026 H.A.M.M.E.R.
          </p>
        </div>
      </div>
    </main>
  );
}
