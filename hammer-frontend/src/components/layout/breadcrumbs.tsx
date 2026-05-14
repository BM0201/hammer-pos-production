"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";

const LABEL_MAP: Record<string, string> = {
  app: "Inicio",
  master: "Master",
  branch: "Sucursal",
  users: "Usuarios",
  catalog: "Catálogo",
  categories: "Categorías",
  products: "Productos",
  inventory: "Inventario",
  sales: "Ventas",
  orders: "Órdenes",
  cashier: "Caja",
  payments: "Pagos",
  warehouse: "Bodega",
  dispatch: "Despacho",
  approvals: "Aprobaciones",
  audit: "Auditoría",
  reports: "Reportes",
  timber: "Madera",
  trips: "Viajes",
  expenses: "Gastos & Precios",
  employees: "Personal & Nómina",
  analytics: "Analytics ABC-XYZ",
};

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length <= 2) return null; // Don't show for top-level pages

  const crumbs = segments.map((seg, i) => ({
    label: LABEL_MAP[seg] ?? seg.charAt(0).toUpperCase() + seg.slice(1),
    href: "/" + segments.slice(0, i + 1).join("/"),
    isLast: i === segments.length - 1,
  }));

  return (
    <nav className="flex items-center gap-1.5 text-sm text-[var(--color-text-soft)] mb-4" aria-label="Breadcrumb">
      <Link href="/app" className="hover:text-[var(--color-text-secondary)] transition-colors">
        <Home className="h-4 w-4" />
      </Link>
      {crumbs.slice(1).map((crumb) => (
        <span key={crumb.href} className="flex items-center gap-1.5">
          <ChevronRight className="h-3.5 w-3.5 text-[var(--color-text-soft)]" />
          {crumb.isLast ? (
            <span className="font-medium text-[var(--color-text)]">{crumb.label}</span>
          ) : (
            <Link href={crumb.href as any} className="hover:text-[var(--color-text-secondary)] transition-colors underline-offset-2 hover:underline">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
