"use client";

import { useState, useEffect, useCallback, useRef, type CSSProperties } from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { canInAnyAssignedBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { isMasterRole, isMasterOrAbove, isOwnerRole, isSystemAdminRole, resolveRoleHome } from "@/modules/rbac/role-routing";
import { getRoleColor } from "@/lib/role-colors";
import { getEffectiveCapabilitySet, hasEffectiveCapability } from "@/lib/navigation/visible-modules";
import type { SessionPayload } from "@/types/auth";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { apiFetch } from "@/lib/client/api";
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
  ChevronUp,
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
  LogOut,
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

function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const handleLogout = async () => {
    setLoading(true);
    try { await apiFetch("/api/auth/logout", { method: "POST" }); } catch {}
    router.push("/login");
  };
  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-[0.75rem] transition-colors"
      style={{
        background: "transparent",
        border: "none",
        cursor: loading ? "not-allowed" : "pointer",
        color: "var(--color-sidebar-text)",
        opacity: loading ? 0.6 : 1,
      }}
    >
      <LogOut className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "var(--color-cashier-400, #fb7185)" }} />
      {loading ? "Saliendo…" : "Cerrar sesión"}
    </button>
  );
}

/* ────────────────────────────────────────────────────────────── */

export function AppSidebar({
  roleCode,
  globalRoles,
  branchMemberships,
  effectiveCapabilities,
  username,
  userId,
}: Pick<SessionPayload, "roleCode" | "globalRoles" | "branchMemberships" | "effectiveCapabilities"> & { username: string; userId: string }) {
  const pathname = usePathname();
  const sections = buildNavSections({ roleCode, globalRoles, branchMemberships, effectiveCapabilities });
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
  const roleActiveBg = `var(--color-${roleCfg.cssPrefix}-600)`;
  const roleActiveText = `var(--color-${roleCfg.cssPrefix}-200)`;
  const roleIcon = `var(--color-${roleCfg.cssPrefix}-400)`;
  const sidebarRoleStyle: SidebarRoleStyle = {
    "--sidebar-role-active-bg": roleActiveBg,
    "--sidebar-role-active-text": roleActiveText,
    "--sidebar-role-icon": roleIcon,
  };

  /* Hammer animation — replay on expand */
  const [brandAnimKey, setBrandAnimKey] = useState(0);
  const prevCollapsed = useRef(true);
  useEffect(() => {
    if (prevCollapsed.current && !collapsed) setBrandAnimKey((k) => k + 1);
    prevCollapsed.current = collapsed;
  }, [collapsed]);

  /* Account popover */
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!accountOpen) return;
    const handler = (e: MouseEvent) => {
      if (!accountRef.current?.contains(e.target as Node)) setAccountOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [accountOpen]);

  /* Shared content renderer */
  const renderContent = (isCollapsed: boolean, isMobileView: boolean) => (
    <div className="flex flex-col h-full">

      {/* ── 1. Brand bar ── */}
      <div className={`flex items-center gap-2.5 px-3 py-3 ${isCollapsed ? "justify-center" : "justify-between"}`}>
        {/* Brand mark (martillo + wordmark) */}
        <Link href={(isMaster ? "/app/master" : homeHref) as Route} onClick={handleNavigation} className="flex items-center gap-2.5 min-w-0">
          <div
            key={brandAnimKey}
            className="brand-mark flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0"
            style={{ background: "var(--color-brand-500)" }}
          >
            <Hammer className="h-4 w-4 text-white" />
          </div>
          {!isCollapsed && (
            <span
              className="sidebar-label text-[0.875rem] font-semibold tracking-tight truncate"
              style={{ color: "var(--color-sidebar-text-active)" }}
            >
              H.A.M.M.E.R.
            </span>
          )}
        </Link>
        {/* Collapse toggle (desktop only) */}
        {!isMobileView && (
          <button
            onClick={toggleCollapse}
            className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-md transition-colors"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--color-sidebar-section)",
              cursor: "pointer",
            }}
            title={isCollapsed ? "Expandir" : "Colapsar"}
            aria-label={isCollapsed ? "Expandir sidebar" : "Colapsar sidebar"}
          >
            {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      {/* ── 2. Nav (flex-1, overflow-y auto) ── */}
      <nav className="flex-1 overflow-y-auto px-2 py-1 space-y-4">
        {sections.map((section) => (
          <div key={section.title}>
            {!isCollapsed && (
              <p
                className="sidebar-section-title px-2 mb-1 text-[11px] font-medium tracking-[0.04em]"
                style={{ color: "var(--color-sidebar-section)" }}
              >
                {section.title.charAt(0) + section.title.slice(1).toLowerCase()}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <div key={item.href} className="relative sidebar-nav-item">
                    <Link
                      href={item.href as Route}
                      onClick={handleNavigation}
                      className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[0.8125rem] font-medium transition-colors duration-[140ms]"
                      style={{
                        background: active ? "var(--color-sidebar-active)" : "transparent",
                        color: active ? "var(--color-sidebar-text-active)" : "var(--color-sidebar-text)",
                      }}
                      title={isCollapsed ? item.label : undefined}
                    >
                      <Icon
                        className="h-4 w-4 flex-shrink-0 transition-colors duration-[140ms]"
                        style={{
                          color: active ? "var(--sidebar-item-icon-hover)" : "var(--sidebar-item-icon)",
                        }}
                      />
                      {!isCollapsed && (
                        <span className="sidebar-label truncate">{item.label}</span>
                      )}
                    </Link>
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

      {/* ── 3. Account button + popover ── */}
      <div
        ref={accountRef}
        className="relative px-2 pb-2 pt-1 border-t"
        style={{ borderColor: "var(--color-sidebar-border, #1E293B)" }}
      >
        <button
          type="button"
          onClick={() => setAccountOpen((v) => !v)}
          className={`w-full flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors duration-[140ms] ${isCollapsed ? "justify-center" : ""}`}
          style={{
            background: accountOpen ? "var(--color-sidebar-hover)" : "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--color-sidebar-text)",
          }}
          aria-expanded={accountOpen}
          aria-haspopup="true"
        >
          {/* Avatar */}
          <div
            className="flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0 text-[0.6875rem] font-bold text-white"
            style={{ background: roleActiveBg }}
          >
            {username.charAt(0).toUpperCase()}
          </div>
          {!isCollapsed && (
            <>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[0.75rem] font-semibold truncate" style={{ color: "var(--color-sidebar-text-active)" }}>
                  {username}
                </p>
                <p className="text-[0.625rem] truncate" style={{ color: "var(--color-sidebar-section)" }}>
                  {roleCfg.label}
                </p>
              </div>
              <ChevronUp
                className="h-3.5 w-3.5 flex-shrink-0 transition-transform duration-150"
                style={{
                  color: "var(--color-sidebar-section)",
                  transform: accountOpen ? "rotate(0deg)" : "rotate(180deg)",
                }}
              />
            </>
          )}
        </button>

        {/* Popover */}
        {accountOpen && (
          <div
            className="absolute bottom-full left-2 right-2 mb-1 rounded-lg overflow-hidden"
            style={{
              background: "var(--color-sidebar-hover)",
              border: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "0 -8px 24px rgba(0,0,0,0.35)",
              animation: "accountPopIn 150ms cubic-bezier(.23,1,.32,1) both",
              zIndex: 60,
            }}
          >
            {/* Popover header */}
            <div
              className="flex items-center gap-2.5 px-3 py-2.5 border-b"
              style={{ borderColor: "rgba(255,255,255,0.07)" }}
            >
              <div
                className="flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0 text-[0.75rem] font-bold text-white"
                style={{ background: roleActiveBg }}
              >
                {username.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-[0.75rem] font-semibold truncate" style={{ color: "var(--color-sidebar-text-active)" }}>
                  {username}
                </p>
                <p className="text-[0.625rem]" style={{ color: "var(--color-sidebar-section)" }}>
                  Cuenta {roleCfg.label}
                </p>
              </div>
            </div>

            {/* Dark mode row */}
            <div
              className="flex items-center justify-between px-3 py-2"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
            >
              <span className="text-[0.75rem]" style={{ color: "var(--color-sidebar-text)" }}>
                Modo nocturno
              </span>
              <ThemeToggle
                userId={userId}
                className="flex items-center justify-center w-6 h-6 rounded-md border-0 bg-transparent cursor-pointer transition-colors"
                style={{ color: "var(--color-sidebar-section)" }}
              />
            </div>

            {/* Logout */}
            <LogoutButton />
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* ── Mobile hamburger button ── */}
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-3 left-3 z-50 p-2 rounded-lg shadow-lg bg-[var(--color-sidebar)] text-white"
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
          app-sidebar-desktop hm-sidebar hidden md:flex flex-col bg-[var(--color-sidebar)] select-none
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
