"use client";

import { useState, useEffect, useCallback, useRef, type CSSProperties } from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { canInAnyAssignedBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { isMasterRole, isMasterOrAbove, isOwnerRole, isSystemAdminRole, resolveRoleHome } from "@/modules/rbac/role-routing";
import { getRoleColor } from "@/lib/role-colors";
import { getEffectiveCapabilitySet, hasEffectiveCapability } from "@/lib/navigation/visible-modules";
import type { SessionPayload } from "@/types/auth";
import {
  LayoutDashboard,
  Users,

  Package,
  Boxes,
  ShoppingCart,
  CreditCard,
  Wallet,
  Truck,
  ShieldCheck,
  ClipboardList,
  BarChart3,
  Hammer,
  Building2,
  Globe,
  Store,
  ChevronLeft,
  ChevronRight,
  TreePine,
  Menu,
  X,
  Receipt,
  PieChart,
  ClipboardPlus,
  ArrowLeftRight,
  Tag,
  Shield,
  Settings,
  Brain,
  Printer,
  Factory,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/* ────────────────────────────────────────────────────────────── */

type NavSection = { title: string; items: NavItem[] };
type NavItem = { href: string; label: string; icon: LucideIcon; capabilities?: readonly string[] };
type SidebarRoleStyle = CSSProperties & {
  "--sidebar-role-active-bg": string;
  "--sidebar-role-active-text": string;
  "--sidebar-role-icon": string;
};

function buildNavSections(
  session: Pick<SessionPayload, "roleCode" | "globalRoles" | "branchMemberships" | "effectiveCapabilities">,
): NavSection[] {
  const { roleCode, globalRoles } = session;
  const effectiveCapabilities = getEffectiveCapabilitySet(session);
  const hasEffectiveSnapshot = effectiveCapabilities.size > 0;
  const canSee = (item: NavItem) => {
    if (!hasEffectiveSnapshot || !item.capabilities?.length) return true;
    return hasEffectiveCapability(session, item.capabilities);
  };
  const hasAny = (...capabilities: string[]) => !hasEffectiveSnapshot || capabilities.some((capability) => effectiveCapabilities.has(capability));
  const visibleSections = (sections: NavSection[]) =>
    sections
      .map((entry) => ({ ...entry, items: entry.items.filter(canSee) }))
      .filter((entry) => entry.items.length > 0);

  /* ── OWNER gets a strategic owner nav ── */
  if (isOwnerRole(roleCode as string, globalRoles as unknown as string[])) {
    return visibleSections([
      {
        title: "GENERAL",
        items: [
          { href: "/app/owner", label: "Panel Propietario", icon: LayoutDashboard, capabilities: [CAPABILITIES.MASTER_DASHBOARD_VIEW, CAPABILITIES.MASTER_ACCESS] },
          { href: "/app/owner/module-config", label: "Config. Modulos", icon: Settings, capabilities: [CAPABILITIES.SYSTEM_ADMIN_SETTINGS, CAPABILITIES.MASTER_ACCESS] },
        ],
      },
      {
        title: "ADMINISTRACION",
        items: [
          { href: "/app/master/catalog-inventory", label: "Catalogo e Inventario", icon: Boxes, capabilities: [CAPABILITIES.MASTER_CATALOG_MANAGE, CAPABILITIES.INVENTORY_VIEW] },
          { href: "/app/master/discounts", label: "Descuentos", icon: Tag, capabilities: [CAPABILITIES.PRICING_VIEW, CAPABILITIES.PRICING_EDIT_GLOBAL] },
          { href: "/app/master/expenses", label: "Gastos & Precios", icon: Receipt, capabilities: [CAPABILITIES.PRICING_VIEW] },
        ],
      },
      {
        title: "OPERACION",
        items: [
          { href: "/app/master/purchase-orders", label: "Pedidos de Compra", icon: ClipboardPlus, capabilities: [CAPABILITIES.PURCHASES_VIEW] },
          { href: "/app/master/transfers", label: "Reposición", icon: ArrowLeftRight, capabilities: [CAPABILITIES.TRANSFERS_VIEW] },
          { href: "/app/master/sales/orders", label: "Ordenes", icon: ShoppingCart, capabilities: [CAPABILITIES.MASTER_SALES_VIEW] },
          { href: "/app/master/operations", label: "Dia Operativo 360", icon: ClipboardList, capabilities: [CAPABILITIES.MASTER_DASHBOARD_VIEW, CAPABILITIES.OPERATIONS_VIEW] },
          { href: "/app/master/timber", label: "Madera", icon: TreePine },
        ],
      },
      {
        title: "CONTROL",
        items: [
          { href: "/app/master/users", label: "Personal & Roles", icon: Users, capabilities: [CAPABILITIES.MASTER_USERS_VIEW, CAPABILITIES.MASTER_USERS_MANAGE] },
          { href: "/app/master/branches", label: "Sucursales", icon: Building2, capabilities: [CAPABILITIES.MASTER_ACCESS] },
          { href: "/app/master/approvals", label: "Aprobaciones", icon: ShieldCheck, capabilities: [CAPABILITIES.APPROVAL_REQUEST_REVIEW] },
          { href: "/app/master/security", label: "Security Center", icon: Shield, capabilities: [CAPABILITIES.MASTER_ACCESS] },
          { href: "/app/master/audit", label: "Auditoria", icon: ClipboardList, capabilities: [CAPABILITIES.AUDIT_VIEW] },
          { href: "/app/master/reports", label: "Reportes & KPIs", icon: BarChart3, capabilities: [CAPABILITIES.REPORTS_EXPORT] },
        ],
      },
      {
        title: "REPORTES",
        items: [
          { href: "/app/master/brain", label: "Centro de Decisiones", icon: Brain, capabilities: [CAPABILITIES.BRAIN_VIEW] },
          { href: "/app/master/analytics/abc-xyz", label: "Analytics ABC-XYZ", icon: PieChart, capabilities: [CAPABILITIES.MASTER_INVENTORY_VIEW] },
        ],
      },
    ]);
  }

  /* ── SYSTEM_ADMIN gets a super admin nav ── */
  if (isSystemAdminRole(roleCode as string, globalRoles as unknown as string[])) {
    return visibleSections([
      {
        title: "GENERAL",
        items: [
          { href: "/app/system-admin", label: "Dashboard Admin", icon: Shield },
        ],
      },
      {
        title: "SISTEMA",
        items: [
          { href: "/app/system-admin/role-config", label: "Config. de Roles", icon: Users },
          { href: "/app/system-admin/settings", label: "Configuraciones", icon: Settings },
          { href: "/app/master/settings/print", label: "Impresión", icon: Printer },
        ],
      },
      {
        title: "ADMINISTRACION",
        items: [
          { href: "/app/master/catalog-inventory", label: "Catálogo e Inventario", icon: Boxes },
          { href: "/app/master/discounts", label: "Descuentos", icon: Tag },
          { href: "/app/master/expenses", label: "Gastos & Precios", icon: Receipt },
        ],
      },
      {
        title: "OPERACION",
        items: [
          { href: "/app/master/purchase-orders", label: "Pedidos de Compra", icon: ClipboardPlus },
          { href: "/app/master/transfers", label: "Reposición", icon: ArrowLeftRight },
          { href: "/app/master/sales/orders", label: "Órdenes", icon: ShoppingCart },
          { href: "/app/master/operations", label: "Dia Operativo 360", icon: ClipboardList },
          { href: "/app/master/timber", label: "Madera", icon: TreePine },
        ],
      },
      {
        title: "CONTROL",
        items: [
          { href: "/app/master/users", label: "Personal & Roles", icon: Users, capabilities: [CAPABILITIES.MASTER_USERS_VIEW, CAPABILITIES.MASTER_USERS_MANAGE] },
          { href: "/app/master/branches", label: "Sucursales", icon: Building2, capabilities: [CAPABILITIES.MASTER_ACCESS] },
          { href: "/app/master/approvals", label: "Aprobaciones", icon: ShieldCheck, capabilities: [CAPABILITIES.APPROVAL_REQUEST_REVIEW] },
          { href: "/app/master/security", label: "Security Center", icon: Shield, capabilities: [CAPABILITIES.MASTER_ACCESS] },
          { href: "/app/master/audit", label: "Auditoría", icon: ClipboardList, capabilities: [CAPABILITIES.AUDIT_VIEW] },
          { href: "/app/master/reports", label: "Reportes & KPIs", icon: BarChart3, capabilities: [CAPABILITIES.REPORTS_EXPORT] },
        ],
      },
      {
        title: "REPORTES",
        items: [
          { href: "/app/master/brain", label: "Centro de Decisiones", icon: Brain },
          { href: "/app/master/analytics/abc-xyz", label: "Analytics ABC-XYZ", icon: PieChart },
        ],
      },
    ]);
  }

  /* ── MASTER gets a corporate/strategic nav ── */
  if (isMasterRole(roleCode as string, globalRoles as unknown as string[])) {
    return visibleSections([
      {
        title: "GENERAL",
        items: [
          { href: "/app/master", label: "Centro de Comando", icon: Globe },
        ],
      },
      {
        title: "ADMINISTRACION",
        items: [
          { href: "/app/master/catalog-inventory", label: "Catálogo e Inventario", icon: Boxes },
          { href: "/app/master/discounts", label: "Descuentos", icon: Tag },
          { href: "/app/master/expenses", label: "Gastos & Precios", icon: Receipt },
        ],
      },
      {
        title: "OPERACION",
        items: [
          { href: "/app/master/purchase-orders", label: "Pedidos de Compra", icon: ClipboardPlus },
          { href: "/app/master/transfers", label: "Reposición", icon: ArrowLeftRight },
          { href: "/app/master/sales/orders", label: "Órdenes", icon: ShoppingCart },
          { href: "/app/master/operations", label: "Dia Operativo 360", icon: ClipboardList },
          { href: "/app/master/production", label: "Produccion Materiales", icon: Factory },
          { href: "/app/master/timber", label: "Madera", icon: TreePine },
        ],
      },
      {
        title: "CONTROL",
        items: [
          { href: "/app/master/users", label: "Personal & Roles", icon: Users, capabilities: [CAPABILITIES.MASTER_USERS_VIEW, CAPABILITIES.MASTER_USERS_MANAGE] },
          { href: "/app/master/branches", label: "Sucursales", icon: Building2, capabilities: [CAPABILITIES.MASTER_ACCESS] },
          { href: "/app/master/approvals", label: "Aprobaciones", icon: ShieldCheck, capabilities: [CAPABILITIES.APPROVAL_REQUEST_REVIEW] },
          { href: "/app/master/security", label: "Security Center", icon: Shield, capabilities: [CAPABILITIES.MASTER_ACCESS] },
          { href: "/app/master/audit", label: "Auditoría", icon: ClipboardList, capabilities: [CAPABILITIES.AUDIT_VIEW] },
          { href: "/app/master/reports", label: "Reportes & KPIs", icon: BarChart3, capabilities: [CAPABILITIES.REPORTS_EXPORT] },
          { href: "/app/master/inventory-fusion", label: "Fusión de Inventario", icon: ArrowLeftRight, capabilities: [CAPABILITIES.MASTER_CATALOG_MANAGE] },
          { href: "/app/master/settings/print", label: "Impresión", icon: Printer },
        ],
      },
      {
        title: "REPORTES",
        items: [
          { href: "/app/master/brain", label: "Centro de Decisiones", icon: Brain },
          { href: "/app/master/analytics/abc-xyz", label: "Analytics ABC-XYZ", icon: PieChart },
        ],
      },
    ]);
  }

  /* ── Branch roles get an operational nav ── */
  const sections: NavSection[] = [];
  const overviewItems: NavItem[] = [];
  const operationItems: NavItem[] = [];
  const governanceItems: NavItem[] = [];

  if (hasAny(CAPABILITIES.BRANCH_DASHBOARD_VIEW) && canInAnyAssignedBranch(session, CAPABILITIES.BRANCH_DASHBOARD_VIEW)) {
    overviewItems.push({ href: "/app/branch", label: "Mi Sucursal", icon: Store });
  }
  if (hasAny(CAPABILITIES.BRANCH_CATALOG_VIEW) && canInAnyAssignedBranch(session, CAPABILITIES.BRANCH_CATALOG_VIEW)) {
    overviewItems.push({ href: "/app/branch/catalog/products", label: "Productos", icon: Package });
  }
  if (hasAny(CAPABILITIES.BRANCH_INVENTORY_VIEW, CAPABILITIES.INVENTORY_VIEW) && canInAnyAssignedBranch(session, CAPABILITIES.BRANCH_INVENTORY_VIEW)) {
    overviewItems.push({ href: "/app/branch/inventory", label: "Inventario", icon: Boxes });
  }

  if (hasAny(CAPABILITIES.SALES_VIEW, CAPABILITIES.POS_VIEW) && canInAnyAssignedBranch(session, CAPABILITIES.SALES_VIEW)) {
    operationItems.push({ href: "/app/branch/sales/orders", label: "Punto de Venta", icon: ShoppingCart });
  }
  if (hasAny(CAPABILITIES.OPERATIONS_VIEW) && canInAnyAssignedBranch(session, CAPABILITIES.OPERATIONS_VIEW)) {
    operationItems.push({ href: "/app/branch/operations", label: "Operacion de hoy", icon: ClipboardList });
  }
  if (hasAny(CAPABILITIES.CASH_VIEW, CAPABILITIES.CASH_SESSION_MANAGE) && canInAnyAssignedBranch(session, CAPABILITIES.CASH_VIEW)) {
    operationItems.push({ href: "/app/branch/cash", label: "Caja", icon: Wallet });
  }
  if (hasAny(CAPABILITIES.CASH_PAYMENTS_VIEW, CAPABILITIES.CASH_VIEW) && canInAnyAssignedBranch(session, CAPABILITIES.CASH_PAYMENTS_VIEW)) {
    operationItems.push({ href: "/app/branch/cashier/payments", label: "Cobros", icon: CreditCard });
  }
  if (hasAny(CAPABILITIES.DISPATCH_VIEW, CAPABILITIES.WAREHOUSE_VIEW) && canInAnyAssignedBranch(session, CAPABILITIES.DISPATCH_VIEW)) {
    operationItems.push({ href: "/app/branch/warehouse/dispatch", label: "Despacho", icon: Truck });
  }
  if (hasAny(CAPABILITIES.APPROVAL_REQUEST_REVIEW) && canInAnyAssignedBranch(session, CAPABILITIES.APPROVAL_REQUEST_REVIEW)) {
    governanceItems.push({ href: "/app/branch/approvals", label: "Aprobaciones", icon: ShieldCheck });
  }
  if (hasAny(CAPABILITIES.AUDIT_VIEW) && canInAnyAssignedBranch(session, CAPABILITIES.AUDIT_VIEW)) {
    governanceItems.push({ href: "/app/branch/audit", label: "Bitácora", icon: ClipboardList });
  }
  if (hasAny(CAPABILITIES.REPORTS_EXPORT) && canInAnyAssignedBranch(session, CAPABILITIES.REPORTS_EXPORT)) {
    governanceItems.push({ href: "/app/branch/reports", label: "Reportes", icon: BarChart3 });
  }

  if (overviewItems.length) sections.push({ title: "GENERAL", items: overviewItems });
  if (operationItems.length) sections.push({ title: "OPERACION", items: operationItems });
  if (governanceItems.length) sections.push({ title: "CONTROL", items: governanceItems });

  return sections;
}

/* ────────────────────────────────────────────────────────────── */

export function AppSidebar({
  roleCode,
  globalRoles,
  branchMemberships,
  effectiveCapabilities,
  username,
}: Pick<SessionPayload, "roleCode" | "globalRoles" | "branchMemberships" | "effectiveCapabilities"> & { username: string }) {
  const pathname = usePathname();
  const sections = buildNavSections({ roleCode, globalRoles, branchMemberships, effectiveCapabilities });
  const isMaster = isMasterOrAbove(roleCode as string, globalRoles as unknown as string[]);
  const isWarmSidebar = isMaster;
  const roleCfg = getRoleColor(roleCode);
  const homeHref = resolveRoleHome(roleCode as string, globalRoles as unknown as string[]);

  /* ── Rail behavior: always starts collapsed, user expands temporarily ── */
  const [collapsed, setCollapsed] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const desktopSidebarRef = useRef<HTMLElement | null>(null);

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const closeDesktopRail = useCallback(() => setCollapsed(true), []);

  const handleNavigation = useCallback(() => {
    closeMobile();
    closeDesktopRail();
  }, [closeDesktopRail, closeMobile]);

  useEffect(() => {
    // After navigation resolves, rail/drawer returns to compact state.
    closeMobile();
    closeDesktopRail();
  }, [pathname, closeDesktopRail, closeMobile]);

  useEffect(() => {
    if (collapsed) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (desktopSidebarRef.current?.contains(target)) return;
      closeDesktopRail();
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (desktopSidebarRef.current?.contains(target)) return;
      closeDesktopRail();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDesktopRail();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [collapsed, closeDesktopRail]);

  /* Role-specific color classes */
  const roleGradientFrom = `var(--color-${roleCfg.cssPrefix}-500)`;
  const roleGradientTo = `var(--color-${roleCfg.cssPrefix}-700)`;
  const roleActiveBg = `var(--color-${roleCfg.cssPrefix}-600)`;
  const roleActiveText = `var(--color-${roleCfg.cssPrefix}-200)`;
  const roleIcon = `var(--color-${roleCfg.cssPrefix}-400)`;
  const sidebarRoleStyle: SidebarRoleStyle = {
    "--sidebar-role-active-bg": roleActiveBg,
    "--sidebar-role-active-text": isWarmSidebar ? "var(--color-master-700)" : roleActiveText,
    "--sidebar-role-icon": roleIcon,
  };

  /* Shared content renderer to avoid duplication */
  const renderContent = (isCollapsed: boolean, isMobileView: boolean) => (
    <>
      {/* ── Toggle button at TOP (desktop only) ── */}
      {!isMobileView && (
        <div className="px-2 pt-2 pb-0">
          <button
            onClick={toggleCollapse}
            style={{ background: "none", border: "none", transition: "background 120ms" }}
            className="w-full flex items-center justify-center gap-2 rounded-md px-3 py-2 text-[0.75rem]
              text-[var(--color-sidebar-text)] hover:bg-[var(--color-sidebar-hover)]
              hover:text-[var(--color-sidebar-text-active)]"
            title={isCollapsed ? "Expandir sidebar" : "Colapsar sidebar"}
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" />
                <span className="sidebar-label">Colapsar</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* ── Brand ── */}
      <div className={`px-3 pt-3 pb-3 ${isCollapsed ? "flex justify-center" : ""}`}>
        <Link
          href={(isMaster ? "/app/master" : homeHref) as Route}
          className="flex items-center gap-2.5"
          onClick={handleNavigation}
        >
          <div
            className="flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0"
            style={{ background: `linear-gradient(135deg, ${roleGradientFrom}, ${roleGradientTo})` }}
          >
            <Hammer className="h-5 w-5 text-white" />
          </div>
          {!isCollapsed && (
            <div className="sidebar-brand-text">
              <span className={`text-[0.9375rem] font-bold tracking-tight ${isWarmSidebar ? "text-[#2E2D2A]" : "text-white"}`}>
                H.A.M.M.E.R.
              </span>
              <span
                className="ml-1.5 text-[0.6rem] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded"
                style={{
                  background: isWarmSidebar ? "rgba(212,56,13,0.12)" : `color-mix(in srgb, ${roleActiveBg} 30%, transparent)`,
                  color: isWarmSidebar ? "#D4380D" : roleActiveText,
                }}
              >
                {roleCfg.label}
              </span>
            </div>
          )}
        </Link>
      </div>

      {/* ── Role accent bar ── */}
      {!isCollapsed && (
        <div
          className="mx-3 mb-2 h-0.5 rounded-full opacity-60"
          style={{ background: `linear-gradient(90deg, ${roleGradientFrom}, transparent)` }}
        />
      )}

      {/* ── User card — background transparent, blends with sidebar ── */}
      <div
        className={`mx-2 mb-3 rounded-lg border border-[var(--color-sidebar-border)] ${isCollapsed ? "px-2 py-2.5" : "px-3 py-2.5"}`}
        style={{ background: "transparent" }}
      >
        <div className={`flex items-center ${isCollapsed ? "justify-center" : "gap-2.5"}`}>
          <div
            className="flex items-center justify-center w-8 h-8 rounded-lg text-xs font-bold text-white flex-shrink-0"
            style={{ background: `linear-gradient(135deg, ${roleGradientFrom}, ${roleActiveBg})` }}
          >
            {username.charAt(0).toUpperCase()}
          </div>
          {!isCollapsed && (
            <div className="min-w-0 sidebar-user-info">
              <p className={`text-xs font-semibold truncate ${isWarmSidebar ? "text-[#2E2D2A]" : "text-white"}`}>
                {username}
              </p>
              <p className="text-[0.625rem]" style={{ color: `var(--color-${roleCfg.cssPrefix}-400)` }}>
                {roleCfg.label}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Navigation sections ── */}
      <nav className="flex-1 overflow-y-auto px-2 space-y-4 pb-4">
        {sections.map((section) => (
          <div key={section.title}>
            {!isCollapsed && (
              <p
                className="sidebar-section-title px-3 mb-1.5 text-[0.625rem] font-bold uppercase tracking-[0.12em]"
                style={{ color: isWarmSidebar ? "#9B9892" : "rgba(255, 255, 255, 0.6)" }}
              >
                {section.title}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const expanded = !isCollapsed && active;
                const Icon = item.icon;
                return (
                  <div key={item.href} className="relative sidebar-nav-item">
                    <Link
                      href={item.href as Route}
                      onClick={handleNavigation}
                      className={`
                        hm-sidebar-item group flex items-center gap-2.5 text-[0.8125rem] font-semibold
                        transition-all duration-150 py-2
                        ${isCollapsed ? "px-0 justify-center rounded-md" : expanded ? "rounded-r-md" : "rounded-md px-3"}
                      `}
                      style={{
                        background: active ? "var(--color-sidebar-active)" : undefined,
                        color: active
                          ? (isWarmSidebar ? "#2E2D2A" : "var(--sidebar-role-active-text)")
                          : undefined,
                        borderLeft: expanded
                          ? `2px solid ${isWarmSidebar ? "var(--v7-accent)" : roleActiveBg}`
                          : undefined,
                        paddingLeft: expanded ? "calc(0.75rem - 2px)" : (!isCollapsed ? "0.75rem" : undefined),
                        paddingRight: !isCollapsed ? "0.75rem" : undefined,
                      }}
                      title={isCollapsed ? item.label : undefined}
                    >
                      <span data-sidebar-icon className={`hm-sidebar-icon-wrap ${active ? "active" : ""}`}>
                        <Icon
                          className="hm-sidebar-icon h-[1.125rem] w-[1.125rem] flex-shrink-0 transition-colors duration-150"
                          style={active && isWarmSidebar ? { color: "#D4380D" } : undefined}
                        />
                      </span>
                      {!isCollapsed && (
                        <>
                          <span className="truncate sidebar-label">{item.label}</span>
                          {active && (
                            <span
                              className="ml-auto h-1.5 w-1.5 rounded-full"
                              style={{ background: roleIcon }}
                            />
                          )}
                        </>
                      )}
                    </Link>
                    {/* Tooltip for collapsed state */}
                    {isCollapsed && (
                      <span className="sidebar-tooltip">{item.label}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* ── Footer ── */}
      <div className={`border-t border-[var(--color-sidebar-border)] px-3 py-2 ${isCollapsed ? "text-center" : ""}`}>
        <p className="text-[0.5625rem] sidebar-footer-text" style={{ color: isWarmSidebar ? "#9B9892" : "rgba(255, 255, 255, 0.7)" }}>
          {isCollapsed ? "V2" : "H.A.M.M.E.R. V2 POS/ERP"}
        </p>
      </div>
    </>
  );

  return (
    <>
      {/* ── Mobile hamburger button ── */}
      <button
        onClick={() => setMobileOpen(true)}
        className={`md:hidden fixed top-3 left-3 z-50 p-2 rounded-lg shadow-lg ${isWarmSidebar ? "bg-[#2E2D2A] text-[#E4E2DE]" : "bg-[var(--color-sidebar)] text-white"}`}
        aria-label="Abrir menú"
        aria-expanded={mobileOpen}
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* ── Mobile overlay ── */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40 animate-fade-in"
          onClick={closeMobile}
        />
      )}

      {/* ── Mobile drawer ── */}
      <aside
        className={`
          hm-sidebar ${isWarmSidebar ? "hm-sidebar-warm" : ""} md:hidden fixed top-0 left-0 z-50 h-full w-[16.25rem] flex flex-col
          bg-[var(--color-sidebar)] select-none
          transition-transform duration-250 ease-in-out
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
        `}
        style={sidebarRoleStyle}
      >
        <button
          onClick={closeMobile}
          className="absolute top-3 right-3 p-1 rounded-lg text-[var(--color-sidebar-text)] hover:text-[var(--color-sidebar-text-active)] hover:bg-[var(--color-sidebar-hover)]"
          aria-label="Cerrar menú"
        >
          <X className="h-5 w-5" />
        </button>
        {renderContent(false, true)}
      </aside>

      {/* ── Desktop sidebar ── */}
      <aside
        className={`
          app-sidebar-desktop hm-sidebar ${isWarmSidebar ? "hm-sidebar-warm" : ""} hidden md:flex flex-col bg-[var(--color-sidebar)] select-none
          ${collapsed ? "sidebar-collapsed" : "sidebar-expanded"}
        `}
        ref={desktopSidebarRef}
        style={{
          width: collapsed ? "var(--sidebar-width-collapsed)" : "var(--sidebar-width-expanded)",
          transition: "width var(--sidebar-transition)",
          minWidth: collapsed ? "var(--sidebar-width-collapsed)" : "var(--sidebar-width-expanded)",
          ...sidebarRoleStyle,
        }}
      >
        {renderContent(collapsed, false)}
      </aside>
    </>
  );
}
