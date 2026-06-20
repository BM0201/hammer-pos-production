"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useSelectedLayoutSegments, useRouter } from "next/navigation";
import type { Route } from "next";
import type { ReactNode } from "react";
import type { SessionPayload } from "@/types/auth";
import { AppSidebar } from "@/components/navigation/app-sidebar";
import { RoleBadge } from "@/components/ui/role-badge";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { AppFooter } from "@/components/layout/app-footer";
import { BranchSelector } from "@/components/branch-selector";
import { ChevronLeft, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle, applyUserTheme } from "@/components/ui/theme-toggle";
import { apiFetch } from "@/lib/client/api";
import { getRoleColor } from "@/lib/role-colors";

type ShellSession = Pick<
  SessionPayload,
  "userId" | "username" | "roleCode" | "globalRoles" | "branchMemberships" | "branchIds" | "primaryBranchId" | "effectiveCapabilities"
>;

const MODULE_META: Record<string, { title: string; subtitle: string }> = {
  master: {
    title: "Centro Master",
    subtitle: "Control global de sucursales, usuarios, inventario y decisiones.",
  },
  branch: {
    title: "Operacion de sucursal",
    subtitle: "Ventas, caja, despacho e inventario operativo.",
  },
  owner: {
    title: "Owner",
    subtitle: "Configuracion global de modulos y permisos.",
  },
  "system-admin": {
    title: "System Admin",
    subtitle: "Roles, permisos y salud tecnica del sistema.",
  },
};

const SECTION_META: Record<string, { title: string; subtitle: string }> = {
  branches: { title: "Sucursales", subtitle: "Estructura, estado y configuracion operativa." },
  users: { title: "Usuarios", subtitle: "Roles, accesos y membresias por sucursal." },
  "catalog-inventory": { title: "Catalogo e Inventario", subtitle: "Productos, precios, costos, existencias e importaciones." },
  brain: { title: "Brain", subtitle: "Bandeja de decisiones, recomendaciones y ejecuciones." },
  reports: { title: "Reportes", subtitle: "Indicadores y consultas para seguimiento gerencial." },
  approvals: { title: "Aprobaciones", subtitle: "Solicitudes pendientes, evidencia y resoluciones." },
  audit: { title: "Auditoria", subtitle: "Bitacora de cambios y actividad sensible." },
  "cash-boxes": { title: "Cajas", subtitle: "Sesiones, diferencias y control de efectivo." },
  inventory: { title: "Inventario", subtitle: "Existencias, movimientos y alertas de stock." },
  dispatch: { title: "Despacho", subtitle: "Preparacion, carga, ruta y entrega de ordenes." },
  payments: { title: "Pagos", subtitle: "Ordenes pendientes y confirmacion de cobro." },
  orders: { title: "Ventas", subtitle: "Ordenes, tickets y seguimiento comercial." },
  settings: { title: "Configuracion", subtitle: "Preferencias del sistema y operaciones." },
  "module-config": { title: "Modulos", subtitle: "Capacidades disponibles para la operacion." },
  "role-config": { title: "Roles y permisos", subtitle: "Matriz de acceso por perfil y modulo." },
};

function resolveHeaderMeta(segments: string[]) {
  const root = segments[0] ?? "master";

  if (root === "branch" && segments[1] === "sales") {
    return { title: "Punto de Venta", subtitle: "Captura de tickets y envio fluido a caja." };
  }
  if (root === "branch" && segments[1] === "cashier") {
    return { title: "Caja & Cobros", subtitle: "Cobro operativo y control de caja en tiempo real." };
  }

  const section = [...segments].reverse().find((segment) => SECTION_META[segment]);
  return section ? SECTION_META[section] : MODULE_META[root] ?? MODULE_META.master;
}

export function AppShellRouter({
  session,
  children,
}: {
  session: ShellSession;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const segments = useSelectedLayoutSegments();
  const headerMeta = useMemo(() => resolveHeaderMeta(segments), [segments]);
  const canReturnToModules = segments[0] !== "branch" && segments.length > 1;
  const [loggingOut, setLoggingOut] = useState(false);

  const roleCfg = getRoleColor(session.roleCode);

  // Apply this user's stored theme once the session is known
  useEffect(() => {
    applyUserTheme(session.userId);
  }, [session.userId]);

  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* redirect anyway */
    } finally {
      router.push("/login");
    }
  }, [router]);

  useEffect(() => {
    let stopped = false;

    const sendHeartbeat = async () => {
      try {
        const response = await apiFetch("/api/auth/heartbeat", {
          method: "POST",
          body: JSON.stringify({
            branchId: session.primaryBranchId,
            currentPath: pathname,
            currentModule: segments[0] ?? "app",
          }),
        });
        if (!stopped && response.status === 401) {
          router.replace("/login");
        }
      } catch {
        /* presence is best-effort */
      }
    };

    let lastBeat = 0;

    const maybeSendHeartbeat = (minGapMs = 0) => {
      if (stopped) return;
      if (document.hidden) return;
      if (Date.now() - lastBeat < minGapMs) return;
      lastBeat = Date.now();
      void sendHeartbeat();
    };

    maybeSendHeartbeat();
    const interval = window.setInterval(() => maybeSendHeartbeat(), 120_000);
    const onFocus = () => maybeSendHeartbeat(5_000);
    window.addEventListener("focus", onFocus);

    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [pathname, router, segments, session.primaryBranchId]);

  return (
    <div className="flex min-h-screen bg-[var(--color-page-bg)]">
      <AppSidebar
        roleCode={session.roleCode}
        globalRoles={session.globalRoles}
        branchMemberships={session.branchMemberships}
        effectiveCapabilities={session.effectiveCapabilities}
        username={session.username}
        userId={session.userId}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ── Sticky top header ── */}
        <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-surface)]/96 shadow-[0_1px_3px_rgba(15,23,42,0.04)] backdrop-blur-md">
          {/* Role accent bar — 2px gradient strip tied to current user role */}
          <div
            className="h-[2px]"
            style={{
              background: `linear-gradient(90deg, var(--color-${roleCfg.cssPrefix}-500), var(--color-${roleCfg.cssPrefix}-300), transparent)`,
            }}
          />

          <div className="flex min-h-[3.5rem] items-center justify-between gap-4 px-5 py-2.5 lg:px-8">
            {/* Left — back btn + title */}
            <div className="ml-12 flex min-w-0 items-center gap-3 md:ml-0">
              {canReturnToModules && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  title="Volver a modulos"
                  onClick={() => router.push(`/app/${segments[0]}` as Route)}
                  icon={<ChevronLeft className="h-4 w-4" />}
                >
                  <span className="sr-only">Volver a modulos</span>
                </Button>
              )}

              {/* Role icon dot */}
              <div
                className="hidden h-8 w-8 items-center justify-center rounded-lg sm:flex flex-shrink-0"
                style={{
                  background: `color-mix(in srgb, var(--color-${roleCfg.cssPrefix}-100) 70%, transparent)`,
                }}
              >
                <div
                  className="h-3 w-3 rounded-full"
                  style={{ background: `var(--color-${roleCfg.cssPrefix}-500)` }}
                />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-sm font-bold text-[var(--color-text)] sm:text-[0.9375rem]">
                    {headerMeta.title}
                  </h1>
                  <RoleBadge roleCode={session.roleCode} size="sm" />
                </div>
                <p className="hidden truncate text-xs text-[var(--color-text-muted)] md:block leading-tight">
                  {headerMeta.subtitle}
                </p>
              </div>
            </div>

            {/* Right — branch selector + theme toggle + user + logout */}
            <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
              <BranchSelector
                branchIds={session.branchIds}
                primaryBranchId={session.primaryBranchId}
              />

              {/* Username chip */}
              <div className="hidden max-w-[140px] truncate rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-2.5 py-1.5 lg:flex items-center gap-2">
                <div
                  className="h-5 w-5 rounded-full flex items-center justify-center text-[0.5625rem] font-bold text-white flex-shrink-0"
                  style={{ background: `var(--color-${roleCfg.cssPrefix}-600)` }}
                >
                  {session.username.charAt(0).toUpperCase()}
                </div>
                <span className="text-xs text-[var(--color-text-muted)] truncate">{session.username}</span>
              </div>

              <ThemeToggle userId={session.userId} />

              {/* Logout */}
              <Button
                variant="ghost"
                size="sm"
                type="button"
                disabled={loggingOut}
                onClick={handleLogout}
                title="Cerrar sesion"
                className="text-[var(--color-text-soft)] hover:text-[var(--color-danger-600)] hover:bg-[var(--color-danger-50)]"
                icon={<LogOut className="h-4 w-4" />}
              >
                <span className="hidden sm:inline text-xs">{loggingOut ? "Saliendo..." : "Salir"}</span>
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 p-5 lg:p-8 animate-fade-in-up">
          <Breadcrumbs />
          {children}
        </main>

        <AppFooter />
      </div>
    </div>
  );
}
