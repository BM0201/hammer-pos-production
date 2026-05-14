"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { canInAnyAssignedBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { isMasterRole, isMasterOrAbove, isOwnerRole, isSystemAdminRole, resolveRoleHome } from "@/modules/rbac/role-routing";
import { getRoleColor } from "@/lib/role-colors";
import type { SessionPayload } from "@/types/auth";
import {
  LayoutDashboard,
  Users,
  Tags,
  Package,
  Boxes,
  ShoppingCart,
  CreditCard,
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
  UserCheck,
  PieChart,
  ClipboardPlus,
  ArrowLeftRight,
  Tag,
  Shield,
  Settings,
  Brain,
  PackageSearch,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/* ────────────────────────────────────────────────────────────── */

type NavSection = { title: string; items: NavItem[] };
type NavItem = { href: string; label: string; icon: LucideIcon };

function buildNavSections(
  session: Pick<SessionPayload, "roleCode" | "globalRoles" | "branchMemberships">,
): NavSection[] {
  const { roleCode, globalRoles } = session;

  /* ── OWNER gets a strategic owner nav ── */
  if (isOwnerRole(roleCode as string, globalRoles as unknown as string[])) {
    return [
      {
        title: "Propietario",
        items: [
          { href: "/app/owner", label: "Panel Propietario", icon: LayoutDashboard },
          { href: "/app/owner/module-config", label: "Config. Modulos", icon: Settings },
        ],
      },
      {
        title: "Comercial",
        items: [
          { href: "/app/master/catalog/products", label: "Catalogo", icon: Package },
          { href: "/app/master/catalog/categories", label: "Categorias", icon: Tags },
          { href: "/app/master/discounts", label: "Descuentos", icon: Tag },
          { href: "/app/master/expenses", label: "Gastos & Precios", icon: Receipt },
        ],
      },
      {
        title: "Operaciones",
        items: [
          { href: "/app/master/inventory", label: "Inventario Global", icon: Boxes },
          { href: "/app/master/purchase-orders", label: "Pedidos de Compra", icon: ClipboardPlus },
          { href: "/app/master/transfers", label: "Envios Sucursales", icon: ArrowLeftRight },
          { href: "/app/master/reorder", label: "Reposición", icon: PackageSearch },
          { href: "/app/master/sales/orders", label: "Ordenes", icon: ShoppingCart },
          { href: "/app/master/timber", label: "Madera", icon: TreePine },
        ],
      },
      {
        title: "Control",
        items: [
          { href: "/app/master/users", label: "Personal & Roles", icon: Users },
          { href: "/app/master/approvals", label: "Aprobaciones", icon: ShieldCheck },
          { href: "/app/master/cash-boxes", label: "Cajas Fisicas", icon: Settings },
          { href: "/app/master/cash-closure-reports", label: "Cierres de Caja", icon: CreditCard },
          { href: "/app/master/audit", label: "Auditoria", icon: ClipboardList },
          { href: "/app/master/reports", label: "Reportes & KPIs", icon: BarChart3 },
        ],
      },
      {
        title: "Inteligencia",
        items: [
          { href: "/app/master/ai-insights", label: "Analisis Inteligente", icon: Brain },
          { href: "/app/master/analytics/abc-xyz", label: "Analytics ABC-XYZ", icon: PieChart },
        ],
      },
    ];
  }

  /* ── SYSTEM_ADMIN gets a super admin nav ── */
  if (isSystemAdminRole(roleCode as string, globalRoles as unknown as string[])) {
    return [
      {
        title: "Inicio",
        items: [
          { href: "/app/system-admin", label: "Dashboard Admin", icon: Shield },
        ],
      },
      {
        title: "Configuración",
        items: [
          { href: "/app/system-admin/role-config", label: "Config. de Roles", icon: Users },
          { href: "/app/system-admin/settings", label: "Configuraciones", icon: Settings },
        ],
      },
      {
        title: "Comercial",
        items: [
          { href: "/app/master/catalog/products", label: "Catálogo", icon: Package },
          { href: "/app/master/catalog/categories", label: "Categorías", icon: Tags },
          { href: "/app/master/discounts", label: "Descuentos", icon: Tag },
          { href: "/app/master/expenses", label: "Gastos & Precios", icon: Receipt },
        ],
      },
      {
        title: "Operaciones",
        items: [
          { href: "/app/master/inventory", label: "Inventario Global", icon: Boxes },
          { href: "/app/master/purchase-orders", label: "Pedidos de Compra", icon: ClipboardPlus },
          { href: "/app/master/transfers", label: "Envíos Sucursales", icon: ArrowLeftRight },
          { href: "/app/master/reorder", label: "Reposición", icon: PackageSearch },
          { href: "/app/master/sales/orders", label: "Órdenes", icon: ShoppingCart },
          { href: "/app/master/timber", label: "Madera", icon: TreePine },
        ],
      },
      {
        title: "Control",
        items: [
          { href: "/app/master/users", label: "Personal & Roles", icon: Users },
          { href: "/app/master/approvals", label: "Aprobaciones", icon: ShieldCheck },
          { href: "/app/master/cash-boxes", label: "Cajas Físicas", icon: Settings },
          { href: "/app/master/cash-closure-reports", label: "Cierres de Caja", icon: CreditCard },
          { href: "/app/master/audit", label: "Auditoría", icon: ClipboardList },
          { href: "/app/master/reports", label: "Reportes & KPIs", icon: BarChart3 },
        ],
      },
      {
        title: "Inteligencia",
        items: [
          { href: "/app/master/ai-insights", label: "Análisis Inteligente", icon: Brain },
          { href: "/app/master/analytics/abc-xyz", label: "Analytics ABC-XYZ", icon: PieChart },
        ],
      },
    ];
  }

  /* ── MASTER gets a corporate/strategic nav ── */
  if (isMasterRole(roleCode as string, globalRoles as unknown as string[])) {
    return [
      {
        title: "Inicio",
        items: [
          { href: "/app/master", label: "Dashboard Global", icon: Globe },
        ],
      },
      {
        title: "Comercial",
        items: [
          { href: "/app/master/catalog/products", label: "Catálogo", icon: Package },
          { href: "/app/master/catalog/categories", label: "Categorías", icon: Tags },
          { href: "/app/master/discounts", label: "Descuentos", icon: Tag },
          { href: "/app/master/expenses", label: "Gastos & Precios", icon: Receipt },
        ],
      },
      {
        title: "Operaciones",
        items: [
          { href: "/app/master/inventory", label: "Inventario Global", icon: Boxes },
          { href: "/app/master/purchase-orders", label: "Pedidos de Compra", icon: ClipboardPlus },
          { href: "/app/master/transfers", label: "Envíos Sucursales", icon: ArrowLeftRight },
          { href: "/app/master/reorder", label: "Reposición", icon: PackageSearch },
          { href: "/app/master/sales/orders", label: "Órdenes", icon: ShoppingCart },
          { href: "/app/master/timber", label: "Madera", icon: TreePine },
        ],
      },
      {
        title: "Control",
        items: [
          { href: "/app/master/users", label: "Personal & Roles", icon: Users },
          { href: "/app/master/approvals", label: "Aprobaciones", icon: ShieldCheck },
          { href: "/app/master/cash-closure-reports", label: "Cierres de Caja", icon: CreditCard },
          { href: "/app/master/audit", label: "Auditoría", icon: ClipboardList },
          { href: "/app/master/reports", label: "Reportes & KPIs", icon: BarChart3 },
        ],
      },
      {
        title: "Inteligencia",
        items: [
          { href: "/app/master/ai-insights", label: "Análisis Inteligente", icon: Brain },
          { href: "/app/master/analytics/abc-xyz", label: "Analytics ABC-XYZ", icon: PieChart },
        ],
      },
    ];
  }

  /* ── Branch roles get an operational nav ── */
  const sections: NavSection[] = [];
  const overviewItems: NavItem[] = [];
  const operationItems: NavItem[] = [];
  const governanceItems: NavItem[] = [];

  if (canInAnyAssignedBranch(session, CAPABILITIES.BRANCH_DASHBOARD_VIEW)) {
    overviewItems.push({ href: "/app/branch", label: "Mi Sucursal", icon: Store });
  }
  if (canInAnyAssignedBranch(session, CAPABILITIES.BRANCH_CATALOG_VIEW)) {
    overviewItems.push({ href: "/app/branch/catalog/products", label: "Productos", icon: Package });
  }
  if (canInAnyAssignedBranch(session, CAPABILITIES.BRANCH_INVENTORY_VIEW)) {
    overviewItems.push({ href: "/app/branch/inventory", label: "Inventario", icon: Boxes });
  }

  if (canInAnyAssignedBranch(session, CAPABILITIES.SALES_VIEW)) {
    operationItems.push({ href: "/app/branch/sales/orders", label: "Punto de Venta", icon: ShoppingCart });
  }
  if (canInAnyAssignedBranch(session, CAPABILITIES.CASH_PAYMENTS_VIEW)) {
    operationItems.push({ href: "/app/branch/cashier/payments", label: "Caja", icon: CreditCard });
  }
  if (canInAnyAssignedBranch(session, CAPABILITIES.DISPATCH_VIEW)) {
    operationItems.push({ href: "/app/branch/warehouse/dispatch", label: "Despacho", icon: Truck });
  }

  if (canInAnyAssignedBranch(session, CAPABILITIES.APPROVAL_REQUEST_REVIEW)) {
    governanceItems.push({ href: "/app/branch/approvals", label: "Aprobaciones", icon: ShieldCheck });
  }
  if (canInAnyAssignedBranch(session, CAPABILITIES.AUDIT_VIEW)) {
    governanceItems.push({ href: "/app/branch/audit", label: "Bitácora", icon: ClipboardList });
  }
  if (canInAnyAssignedBranch(session, CAPABILITIES.REPORTS_EXPORT)) {
    governanceItems.push({ href: "/app/branch/reports", label: "Reportes", icon: BarChart3 });
  }

  if (overviewItems.length) sections.push({ title: "General", items: overviewItems });
  if (operationItems.length) sections.push({ title: "Operación", items: operationItems });
  if (governanceItems.length) sections.push({ title: "Control", items: governanceItems });

  return sections;
}

/* ────────────────────────────────────────────────────────────── */

export function AppSidebar({
  roleCode,
  globalRoles,
  branchMemberships,
  username,
}: Pick<SessionPayload, "roleCode" | "globalRoles" | "branchMemberships"> & { username: string }) {
  const pathname = usePathname();
  const sections = buildNavSections({ roleCode, globalRoles, branchMemberships });
  const isMaster = isMasterOrAbove(roleCode as string, globalRoles as unknown as string[]);
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

  /* Shared content renderer to avoid duplication */
  const renderContent = (isCollapsed: boolean, isMobileView: boolean) => (
    <>
      {/* ── Toggle button at TOP (desktop only) ── */}
      {!isMobileView && (
        <div className="px-2 pt-2 pb-0">
          <button
            onClick={toggleCollapse}
            className="w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[0.75rem]
              text-[var(--color-sidebar-text)] hover:bg-[var(--color-sidebar-hover)]
              hover:text-[var(--color-sidebar-text-active)] transition-colors duration-150"
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
          href={(isMaster ? "/app/master" : homeHref) as any}
          className="flex items-center gap-2.5"
          onClick={handleNavigation}
        >
          <div
            className="flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0"
            style={{ background: `linear-gradient(135deg, ${roleGradientFrom}, ${roleGradientTo})` }}
          >
            <Hammer className="h-5 w-5 text-white" />
          </div>
          {!isCollapsed && (
            <div className="sidebar-brand-text">
              <span className="text-[0.9375rem] font-bold tracking-tight text-white">
                H.A.M.M.E.R.
              </span>
              <span
                className="ml-1.5 text-[0.6rem] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded"
                style={{
                  background: `color-mix(in srgb, ${roleActiveBg} 30%, transparent)`,
                  color: roleActiveText,
                }}
              >
                {roleCfg.label}
              </span>
            </div>
          )}
        </Link>
      </div>

      {/* ── User card ── */}
      <div className={`mx-2 mb-3 rounded-xl bg-[var(--color-sidebar-hover)] ${isCollapsed ? "px-2 py-2.5" : "px-3 py-2.5"}`}>
        <div className={`flex items-center ${isCollapsed ? "justify-center" : "gap-2.5"}`}>
          <div
            className="flex items-center justify-center w-8 h-8 rounded-lg text-xs font-bold text-white flex-shrink-0"
            style={{ background: `linear-gradient(135deg, ${roleGradientFrom}, ${roleActiveBg})` }}
          >
            {username.charAt(0).toUpperCase()}
          </div>
          {!isCollapsed && (
            <div className="min-w-0 sidebar-user-info">
              <p className="text-xs font-semibold text-white truncate">
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
      <nav className={`flex-1 overflow-y-auto px-2 space-y-4 pb-4`}>
        {sections.map((section) => (
          <div key={section.title}>
            {!isCollapsed && (
              <p
                className="sidebar-section-title px-3 mb-1.5 text-[0.625rem] font-bold uppercase tracking-[0.12em]"
                style={{ color: "rgba(255, 255, 255, 0.6)" }}
              >
                {section.title}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <div key={item.href} className="relative sidebar-nav-item">
                    <Link
                      href={item.href as any}
                      onClick={handleNavigation}
                      className={`
                        hm-sidebar-item group flex items-center gap-2.5 rounded-lg text-[0.8125rem] font-semibold
                        transition-all duration-150
                        ${isCollapsed ? "px-0 py-2 justify-center" : "px-3 py-2"}
                        ${active ? "is-active" : ""}
                        ${!isCollapsed && active ? "hm-sidebar-item-expanded-active" : ""}
                      `}
                      title={isCollapsed ? item.label : undefined}
                    >
                      <span data-sidebar-icon className={`hm-sidebar-icon-wrap ${active ? "active" : ""}`}>
                        <Icon
                          className="hm-sidebar-icon h-[1.125rem] w-[1.125rem] flex-shrink-0 transition-colors duration-150"
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
        <p className="text-[0.5625rem] sidebar-footer-text" style={{ color: "rgba(255, 255, 255, 0.7)" }}>
          {isCollapsed ? "v3" : "H.A.M.M.E.R. v3.0 · POS/ERP"}
        </p>
      </div>
    </>
  );

  return (
    <>
      {/* ── Mobile hamburger button ── */}
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-3 left-3 z-50 p-2 rounded-lg bg-[var(--color-sidebar)] text-white shadow-lg"
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
          hm-sidebar md:hidden fixed top-0 left-0 z-50 h-full w-[16.25rem] flex flex-col
          bg-[var(--color-sidebar)] select-none
          transition-transform duration-250 ease-in-out
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
        `}
        style={{
          ["--sidebar-role-active-bg" as any]: roleActiveBg,
          ["--sidebar-role-active-text" as any]: roleActiveText,
          ["--sidebar-role-icon" as any]: roleIcon,
        }}
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
          hm-sidebar hidden md:flex flex-col bg-[var(--color-sidebar)] select-none
          ${collapsed ? "sidebar-collapsed" : "sidebar-expanded"}
        `}
        ref={desktopSidebarRef}
        style={{
          width: collapsed ? "var(--sidebar-width-collapsed)" : "var(--sidebar-width-expanded)",
          transition: "width var(--sidebar-transition)",
          minWidth: collapsed ? "var(--sidebar-width-collapsed)" : "var(--sidebar-width-expanded)",
          ["--sidebar-role-active-bg" as any]: roleActiveBg,
          ["--sidebar-role-active-text" as any]: roleActiveText,
          ["--sidebar-role-icon" as any]: roleIcon,
        }}
      >
        {renderContent(collapsed, false)}
      </aside>
    </>
  );
}