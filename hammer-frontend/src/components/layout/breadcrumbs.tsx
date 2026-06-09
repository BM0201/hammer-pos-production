"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";

const LABEL_MAP: Record<string, string> = {
  app: "Inicio",
  master: "Master",
  branch: "Sucursal",
  owner: "Owner",
  "system-admin": "Sistema",
  users: "Usuarios",
  branches: "Sucursales",
  catalog: "Catalogo",
  "catalog-inventory": "Catalogo e inventario",
  categories: "Categorias",
  products: "Productos",
  inventory: "Inventario",
  sales: "Ventas",
  orders: "Ordenes",
  cashier: "Caja",
  payments: "Pagos",
  warehouse: "Bodega",
  dispatch: "Despacho",
  approvals: "Aprobaciones",
  audit: "Auditoria",
  reports: "Reportes",
  timber: "Madera",
  trips: "Viajes",
  expenses: "Gastos y precios",
  employees: "Personal y nomina",
  analytics: "Analytics ABC-XYZ",
  brain: "Brain",
  settings: "Configuracion",
  print: "Impresion",
  "cash-boxes": "Cajas",
  "module-config": "Modulos",
  "role-config": "Roles",
};

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  // ── UX: La barra de breadcrumbs ("Sucursal > Caja > Pagos") se considera
  // redundante respecto al encabezado del módulo y al menú lateral, por lo que
  // se oculta globalmente. El sistema de sucursales sigue intacto; solo se
  // elimina la visualización del breadcrumb. Para reactivarlo, cambiar a
  // `const HIDE_BREADCRUMBS = false;`.
  const HIDE_BREADCRUMBS = true;
  if (HIDE_BREADCRUMBS) return null;

  if (segments.length <= 2) return null;

  const crumbs = segments.map((seg, i) => ({
    label: LABEL_MAP[seg] ?? seg.charAt(0).toUpperCase() + seg.slice(1),
    href: "/" + segments.slice(0, i + 1).join("/"),
    isLast: i === segments.length - 1,
  }));

  return (
    <nav
      className="mb-4 flex min-w-0 items-center gap-1 overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2 text-xs text-[var(--color-text-muted)] shadow-sm"
      aria-label="Breadcrumb"
    >
      <Link
        href="/app"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)]"
      >
        <Home className="h-3.5 w-3.5" />
      </Link>
      {crumbs.slice(1).map((crumb) => (
        <span key={crumb.href} className="flex min-w-0 shrink-0 items-center gap-1">
          <ChevronRight className="h-3.5 w-3.5 text-[var(--color-text-soft)]" />
          {crumb.isLast ? (
            <span className="max-w-[180px] truncate rounded-md bg-[var(--color-surface-alt)] px-2 py-1 font-medium text-[var(--color-text)]">
              {crumb.label}
            </span>
          ) : (
            <Link
              href={crumb.href as Route}
              className="max-w-[160px] truncate rounded-md px-2 py-1 transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)]"
            >
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
