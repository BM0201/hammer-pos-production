"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeftCircle,
  Boxes,
  Building2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Home,
  LogOut,
  PackageSearch,
  ReceiptText,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RoleBadge } from "@/components/ui/role-badge";
import { apiFetch } from "@/lib/client/api";

type PosBranchConfig = {
  enableCashier: boolean;
  enableDispatch: boolean;
};

type NavItem = {
  label: string;
  href: Route;
  icon: typeof Home;
  enabled: boolean;
};

export function PosShellWrapper({
  children,
  username,
  roleCode,
  branchId,
  branchName,
  mode = "sales",
  integrated = false,
  exitHref = "/app/branch",
}: {
  children: ReactNode;
  username: string;
  roleCode: string;
  branchId?: string;
  branchName?: string;
  mode?: "sales" | "cashier";
  integrated?: boolean;
  exitHref?: Route;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [branchConfig, setBranchConfig] = useState<PosBranchConfig>({
    enableCashier: false,
    enableDispatch: false,
  });

  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    fetch(`/api/branch-config/${branchId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((raw) => {
        if (cancelled || !raw) return;
        const data = raw.data ?? raw;
        setBranchConfig({
          enableCashier: data?.enableCashier ?? false,
          enableDispatch: data?.enableDispatch ?? false,
        });
      })
      .catch(() => setBranchConfig({ enableCashier: false, enableDispatch: false }));
    return () => {
      cancelled = true;
    };
  }, [branchId]);

  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
    }
  }, [router]);

  const modeTitle = mode === "cashier" ? "Caja & Cobros" : "Punto de Venta";
  const modeSubtitle = mode === "cashier"
    ? "Cobro operativo y control de caja en tiempo real"
    : branchConfig.enableCashier
      ? "Captura de tickets y envio fluido a caja"
      : "Venta, cobro e impresion en mostrador";
  const ModeIcon = mode === "cashier" ? CreditCard : ShoppingCart;

  const navGroups = useMemo<Array<{ label: string; items: NavItem[] }>>(() => [
    {
      label: "GENERAL",
      items: [
        { label: "Mi sucursal", href: "/app/branch" as Route, icon: Home, enabled: true },
        { label: "Productos", href: "/app/branch/catalog/products" as Route, icon: PackageSearch, enabled: true },
      ],
    },
    {
      label: "OPERACION",
      items: [
        { label: "Punto de Venta", href: "/app/branch/sales/orders" as Route, icon: ShoppingCart, enabled: true },
        { label: "Operacion de hoy", href: "/app/branch/operations" as Route, icon: ReceiptText, enabled: true },
        { label: "Caja", href: "/app/branch/cashier/payments" as Route, icon: CreditCard, enabled: branchConfig.enableCashier },
        { label: "Bodega / Despacho", href: "/app/branch/warehouse/dispatch" as Route, icon: Boxes, enabled: branchConfig.enableDispatch },
        { label: "Entregas", href: "/app/branch/warehouse/dispatch" as Route, icon: Truck, enabled: branchConfig.enableDispatch },
      ],
    },
  ], [branchConfig.enableCashier, branchConfig.enableDispatch]);

  return (
    <div className={`flex ${integrated ? "min-h-0" : "min-h-screen"} bg-[var(--color-page-bg)] ${integrated ? "min-w-0" : ""}`}>
      <aside className={`hidden border-r border-[var(--color-border)] bg-[var(--color-surface)] transition-[width] duration-200 lg:flex lg:flex-col ${collapsed ? "w-[4.5rem]" : "w-[17rem]"}`}>
        <div className="border-b border-[var(--color-border)] p-3">
          <div className={`flex items-center gap-2 ${collapsed ? "justify-center" : "justify-between"}`}>
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-master-600)] text-white">
                <Building2 className="h-4 w-4" />
              </div>
              {!collapsed ? (
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold tracking-tight">H.A.M.M.E.R.</p>
                  <Badge variant="info" className="mt-0.5 text-[0.6rem]">VENTAS</Badge>
                </div>
              ) : null}
            </div>
            {!collapsed ? (
              <button
                type="button"
                className="rounded-md p-1.5 text-[var(--color-text-soft)] hover:bg-[var(--color-surface-alt)]"
                onClick={() => setCollapsed(true)}
                title="Colapsar"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          {collapsed ? (
            <button
              type="button"
              className="mt-3 flex w-full justify-center rounded-md p-1.5 text-[var(--color-text-soft)] hover:bg-[var(--color-surface-alt)]"
              onClick={() => setCollapsed(false)}
              title="Expandir"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-2">
              <div className="flex items-center justify-between gap-2">
                <RoleBadge roleCode={roleCode} size="sm" />
                <span className="truncate text-[0.7rem] text-[var(--color-text-muted)]">{username}</span>
              </div>
              <p className="mt-1 truncate text-[0.7rem] font-medium text-[var(--color-text)]">{branchName ?? "Sucursal actual"}</p>
              <p className="mt-1 text-[0.65rem] text-[var(--color-text-muted)]">
                {branchConfig.enableCashier ? "Caja separada" : "Cobro en POS"} · {branchConfig.enableDispatch ? "Bodega habilitada" : "Sin bodega"}
              </p>
            </div>
          )}
        </div>

        <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
          {navGroups.map((group) => (
            <div key={group.label}>
              {!collapsed ? <p className="mb-1.5 px-2 text-[0.62rem] font-bold tracking-wide text-[var(--color-text-soft)]">{group.label}</p> : null}
              <div className="space-y-1">
                {group.items.filter((item) => item.enabled).map((item) => {
                  const Icon = item.icon;
                  const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      title={item.label}
                      className={`flex h-10 items-center gap-2 rounded-lg px-2 text-sm font-medium transition ${collapsed ? "justify-center" : ""} ${active ? "bg-[var(--color-master-600)] text-white shadow-sm" : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)]"}`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!collapsed ? <span className="truncate">{item.label}</span> : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-[var(--color-border)] p-3">
          <Link
            href={exitHref}
            className={`mb-2 flex h-9 items-center gap-2 rounded-lg px-2 text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)] ${collapsed ? "justify-center" : ""}`}
            title="Volver a modulos"
          >
            <ArrowLeftCircle className="h-4 w-4" />
            {!collapsed ? <span>Modulos</span> : null}
          </Link>
          <button
            type="button"
            disabled={loggingOut}
            onClick={handleLogout}
            className={`flex h-9 w-full items-center gap-2 rounded-lg px-2 text-xs font-medium text-[var(--color-text-muted)] transition hover:bg-[var(--color-danger-50)] hover:text-[var(--color-danger-600)] ${collapsed ? "justify-center" : ""}`}
            title="Cerrar sesion"
          >
            <LogOut className="h-4 w-4" />
            {!collapsed ? <span>{loggingOut ? "Saliendo..." : "Salir"}</span> : null}
          </button>
          {!collapsed ? <p className="mt-3 text-[0.62rem] text-[var(--color-text-soft)]">HAMMER POS · Operacion</p> : null}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur-sm">
          <div className="flex h-14 items-center justify-between px-4 lg:px-6">
            <div className="flex items-center gap-3">
              <ModeIcon className="h-4 w-4 text-[var(--color-text-soft)]" />
              <div>
                <p className="text-sm font-semibold tracking-tight text-[var(--color-text)]">{modeTitle}</p>
                <p className="text-[0.7rem] text-[var(--color-text-muted)]">{modeSubtitle}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 lg:hidden">
              <RoleBadge roleCode={roleCode} size="sm" />
              <Button
                variant="ghost"
                size="sm"
                type="button"
                disabled={loggingOut}
                onClick={handleLogout}
                title="Cerrar sesion"
                className="text-[var(--color-text-soft)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-danger-600)]"
                icon={<LogOut className="h-4 w-4" />}
              >
                <span className="hidden sm:inline">{loggingOut ? "Saliendo..." : "Salir"}</span>
              </Button>
            </div>
          </div>
        </header>

        <main className={`flex-1 ${integrated ? "p-3 lg:p-4" : "p-4 lg:p-6"}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
