"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { canInAnyAssignedBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { isMasterRole, isSystemAdminRole } from "@/modules/rbac/role-routing";
import type { SessionPayload } from "@/types/auth";

type NavItem = { href: string; label: string };

function buildNavItems(session: Pick<SessionPayload, "roleCode" | "globalRoles" | "branchMemberships">): NavItem[] {
  const { roleCode, globalRoles } = session;

  if (isSystemAdminRole(roleCode as string, globalRoles as unknown as string[])) {
    return [
      { href: "/app/system-admin", label: "Dashboard" },
      { href: "/app/system-admin/role-config", label: "Roles" },
      { href: "/app/system-admin/settings", label: "Config" },
      { href: "/app/master", label: "Master" },
      { href: "/app/master/discounts", label: "Descuentos" },
      { href: "/app/master/audit", label: "Auditoría" },
    ];
  }

  if (isMasterRole(roleCode as string, globalRoles as unknown as string[])) {
    return [
      { href: "/app/master", label: "Dashboard" },
      { href: "/app/master/branches", label: "Sucursales" },
      { href: "/app/master/users", label: "Usuarios" },
      { href: "/app/master/catalog-inventory", label: "Catálogo e Inventario" },
      { href: "/app/master/brain", label: "Centro de Decisiones" },
      { href: "/app/master/operations", label: "Dia Operativo" },
      { href: "/app/master/discounts", label: "Descuentos" },
      { href: "/app/master/sales/orders", label: "Órdenes" },
      { href: "/app/master/audit", label: "Auditoría" },
      { href: "/app/master/history", label: "Historial" },
      { href: "/app/master/reports", label: "Reportes" },
    ];
  }

  const items: NavItem[] = [];
  if (canInAnyAssignedBranch(session, CAPABILITIES.BRANCH_DASHBOARD_VIEW)) items.push({ href: "/app/branch", label: "Inicio" });
  if (canInAnyAssignedBranch(session, CAPABILITIES.BRANCH_CATALOG_VIEW)) items.push({ href: "/app/branch/catalog/products", label: "Productos" });
  if (canInAnyAssignedBranch(session, CAPABILITIES.SALES_VIEW)) items.push({ href: "/app/branch/sales/orders", label: "Ventas" });
  if (canInAnyAssignedBranch(session, CAPABILITIES.OPERATIONS_VIEW)) items.push({ href: "/app/branch/operations", label: "Operacion" });
  if (canInAnyAssignedBranch(session, CAPABILITIES.CASH_PAYMENTS_VIEW)) items.push({ href: "/app/branch/cashier/payments", label: "Caja" });
  if (canInAnyAssignedBranch(session, CAPABILITIES.DISPATCH_VIEW)) items.push({ href: "/app/branch/warehouse/dispatch", label: "Despacho" });
  if (canInAnyAssignedBranch(session, CAPABILITIES.REPORTS_EXPORT)) items.push({ href: "/app/branch/reports", label: "Reportes" });
  return items;
}

export function AppRoleNav({
  roleCode,
  globalRoles,
  branchMemberships,
}: Pick<SessionPayload, "roleCode" | "globalRoles" | "branchMemberships">) {
  const pathname = usePathname();
  const items = buildNavItems({ roleCode, globalRoles, branchMemberships });
  const isMaster = isMasterRole(roleCode as string, globalRoles as unknown as string[]);

  return (
    <nav className="flex gap-1 px-4 py-2 overflow-x-auto scrollbar-hide">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href as Route}
            className={`
              rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap
              transition-all duration-150
              ${active
                ? isMaster
                  ? "bg-[var(--color-master-600)] text-white shadow-sm"
                  : "bg-[var(--color-branch-600)] text-white shadow-sm"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)]"
              }
            `}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
