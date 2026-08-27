"use client";

import { useState, useEffect, useCallback, useRef, type CSSProperties } from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { isMasterRole, isMasterOrAbove, isOwnerRole, isSystemAdminRole, isAccountantRole, resolveRoleHome } from "@/modules/rbac/role-routing";
import { getRoleColor } from "@/lib/role-colors";
import { getEffectiveCapabilitySet, hasEffectiveCapability } from "@/lib/navigation/visible-modules";
import type { SessionPayload } from "@/types/auth";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { useOperationalPolling } from "@/lib/realtime/use-operational-polling";
import { getActiveBranchId } from "@/lib/client/active-branch";
import { CashIndicatorPanel } from "@/components/navigation/cash-indicator-panel";
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
  ChevronUp,
  TreePine,
  Menu,
  X,
  Landmark,
  PieChart,
  ClipboardPlus,
  ArrowLeftRight,
  Tag,
  Shield,
  Settings,
  Brain,
  Printer,
  Factory,
  History,
  LogOut,
  Merge,
  ScrollText,
  ReceiptText,
  Camera,
  PiggyBank,
  DollarSign,
  Calculator,
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

/**
 * Fuente única del menú master. Owner y SystemAdmin lo consumen tal cual + sus
 * propios extras (ver OWNER_EXTRAS/SYSADMIN_EXTRAS) — nunca lo copian. Qué ve
 * cada rol lo decide el filtrado por capabilities existente (canSee/hasEffectiveCapability),
 * no una lista aparte por rol.
 */
const MASTER_NAV: NavSection[] = [
  {
    title: "GENERAL",
    items: [
      { href: "/app/master", label: "Centro de Comando", icon: Globe },
    ],
  },
  {
    title: "COMERCIAL",
    items: [
      { href: "/app/master/sales/orders", label: "Órdenes", icon: ShoppingCart, capabilities: [CAPABILITIES.MASTER_SALES_VIEW] },
      { href: "/app/master/discounts", label: "Descuentos", icon: Tag, capabilities: [CAPABILITIES.PRICING_VIEW, CAPABILITIES.PRICING_EDIT_GLOBAL] },
    ],
  },
  {
    title: "INVENTARIO & ABASTECIMIENTO",
    items: [
      { href: "/app/master/catalog-inventory", label: "Catálogo e Inventario", icon: Boxes, capabilities: [CAPABILITIES.MASTER_CATALOG_MANAGE, CAPABILITIES.INVENTORY_VIEW] },
      // Fase 2.3 (prompt-mudanza-zona-precios.md) — junto a Catálogo e Inventario,
      // no junto a Finanzas: precios es una decisión comercial sobre el producto,
      // no contabilidad. Dos capabilities por diseño (decisión previa del mismo
      // prompt): PRICING_VIEW (Contador) y FINANCE_VIEW_PRICING (Admin de
      // Sucursal) llegaban hoy a la calculadora por caminos distintos — Admin de
      // Sucursal tiene FINANCE_VIEW_PRICING pero NO PRICING_VIEW, así que
      // gatear solo con PRICING_VIEW le habría quitado un acceso que ya tenía.
      { href: "/app/master/pricing", label: "Precios", icon: Calculator, capabilities: [CAPABILITIES.PRICING_VIEW, CAPABILITIES.FINANCE_VIEW_PRICING] },
      { href: "/app/master/purchase-orders", label: "Pedidos de Compra", icon: ClipboardPlus, capabilities: [CAPABILITIES.PURCHASES_VIEW] },
      { href: "/app/master/replenishment", label: "Reposición", icon: ArrowLeftRight, capabilities: [CAPABILITIES.TRANSFERS_VIEW] },
      { href: "/app/master/production", label: "Producción de Materiales", icon: Factory, capabilities: [CAPABILITIES.PRODUCTION_DASHBOARD_VIEW] },
      { href: "/app/master/timber", label: "Madera", icon: TreePine },
      { href: "/app/master/inventory-fusion", label: "Fusión de Inventario", icon: Merge, capabilities: [CAPABILITIES.MASTER_CATALOG_MANAGE] },
    ],
  },
  {
    title: "OPERACIÓN",
    items: [
      { href: "/app/master/operations", label: "Día Operativo 360", icon: ClipboardList, capabilities: [CAPABILITIES.MASTER_DASHBOARD_VIEW, CAPABILITIES.OPERATIONS_VIEW] },
      { href: "/app/master/cash-boxes", label: "Cajas", icon: Wallet, capabilities: [CAPABILITIES.MASTER_ACCESS] },
      { href: "/app/master/cash-closure-reports", label: "Cierres de Caja", icon: ReceiptText, capabilities: [CAPABILITIES.FINANCE_VIEW] },
    ],
  },
  {
    title: "ADMINISTRACIÓN",
    items: [
      { href: "/app/master/users", label: "RRHH", icon: Users, capabilities: [CAPABILITIES.MASTER_USERS_VIEW, CAPABILITIES.MASTER_USERS_MANAGE] },
      { href: "/app/master/finance", label: "Finanzas & Contabilidad", icon: Landmark, capabilities: [CAPABILITIES.FINANCE_VIEW, CAPABILITIES.PRICING_VIEW] },
      { href: "/app/master/treasury", label: "Tesorería", icon: PiggyBank, capabilities: [CAPABILITIES.TREASURY_MANAGE] },
      { href: "/app/master/branches", label: "Sucursales", icon: Building2, capabilities: [CAPABILITIES.MASTER_ACCESS] },
      { href: "/app/master/approvals", label: "Aprobaciones", icon: ShieldCheck, capabilities: [CAPABILITIES.APPROVAL_REQUEST_REVIEW] },
      { href: "/app/master/security", label: "Security Center", icon: Shield, capabilities: [CAPABILITIES.MASTER_ACCESS] },
      { href: "/app/master/cameras", label: "Cámaras", icon: Camera, capabilities: [CAPABILITIES.MASTER_CAMERAS_VIEW] },
      { href: "/app/master/audit", label: "Auditoría", icon: ScrollText, capabilities: [CAPABILITIES.AUDIT_VIEW] },
      { href: "/app/master/settings/print", label: "Impresión", icon: Printer },
    ],
  },
  {
    title: "INTELIGENCIA",
    items: [
      { href: "/app/master/brain", label: "Centro de Decisiones", icon: Brain, capabilities: [CAPABILITIES.BRAIN_VIEW] },
      { href: "/app/master/reports", label: "Reportes & KPIs", icon: BarChart3, capabilities: [CAPABILITIES.REPORTS_EXPORT] },
      { href: "/app/master/analytics/abc-xyz", label: "Analytics ABC-XYZ", icon: PieChart, capabilities: [CAPABILITIES.MASTER_INVENTORY_VIEW] },
      { href: "/app/master/history", label: "Historial Completo", icon: History },
    ],
  },
];

/** Únicamente lo que hoy es exclusivo de Owner — el resto lo hereda de MASTER_NAV. */
const OWNER_EXTRAS: NavSection[] = [
  {
    title: "GENERAL",
    items: [
      { href: "/app/owner", label: "Panel Propietario", icon: LayoutDashboard, capabilities: [CAPABILITIES.MASTER_DASHBOARD_VIEW, CAPABILITIES.MASTER_ACCESS] },
      { href: "/app/owner/module-config", label: "Config. Módulos", icon: Settings, capabilities: [CAPABILITIES.SYSTEM_ADMIN_SETTINGS, CAPABILITIES.MASTER_ACCESS] },
    ],
  },
];

/** Únicamente lo que hoy es exclusivo de SystemAdmin — el resto lo hereda de MASTER_NAV. */
const SYSADMIN_EXTRAS: NavSection[] = [
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
    ],
  },
];

/** Concatena grupos de secciones fusionando por título (evita títulos repetidos al mezclar extras + canónico). */
function mergeSections(...sectionGroups: NavSection[][]): NavSection[] {
  const merged: NavSection[] = [];
  const indexByTitle = new Map<string, number>();
  for (const group of sectionGroups) {
    for (const section of group) {
      const existingIndex = indexByTitle.get(section.title);
      if (existingIndex === undefined) {
        indexByTitle.set(section.title, merged.length);
        merged.push({ title: section.title, items: [...section.items] });
      } else {
        merged[existingIndex] = { ...merged[existingIndex], items: [...merged[existingIndex].items, ...section.items] };
      }
    }
  }
  return merged;
}

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

  /* ── OWNER: extras propios + el canónico completo, filtrado por capabilities ── */
  if (isOwnerRole(roleCode as string, globalRoles as unknown as string[])) {
    return visibleSections(mergeSections(OWNER_EXTRAS, MASTER_NAV));
  }

  /* ── SYSTEM_ADMIN: extras propios + el canónico completo, filtrado por capabilities ── */
  if (isSystemAdminRole(roleCode as string, globalRoles as unknown as string[])) {
    return visibleSections(mergeSections(SYSADMIN_EXTRAS, MASTER_NAV));
  }

  /* ── MASTER: el canónico tal cual ── */
  if (isMasterRole(roleCode as string, globalRoles as unknown as string[])) {
    return visibleSections(MASTER_NAV);
  }

  /* ── Contador (ACCOUNTANT) solo ve el área de contabilidad. Se mantiene como
     lista explícita (no fusionada con MASTER_NAV): varios ítems del canónico
     no tienen capabilities propias (p.ej. "Centro de Comando", "Historial
     Completo") y quedarían visibles igual para este rol si se fusionara. ── */
  if (isAccountantRole(roleCode as string, globalRoles as unknown as string[])) {
    return visibleSections([
      {
        title: "CONTABILIDAD",
        items: [
          { href: "/app/master/finance", label: "Finanzas & Contabilidad", icon: Landmark },
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
  if (hasAny(CAPABILITIES.TREASURY_VIEW_BRANCH) && canInAnyAssignedBranch(session, CAPABILITIES.TREASURY_VIEW_BRANCH)) {
    operationItems.push({ href: "/app/branch/money-week", label: "Dinero de la semana", icon: PiggyBank });
  }
  // Fase 4 (prompt-motor-precios-lote-herencia-gobierno.md) — ajustar precio dentro de la banda de su categoría.
  if (hasAny(CAPABILITIES.PRICING_EDIT_BRANCH) && canInAnyAssignedBranch(session, CAPABILITIES.PRICING_EDIT_BRANCH)) {
    operationItems.push({ href: "/app/branch/pricing", label: "Precios", icon: DollarSign });
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
  const [loading, setLoading] = useState(false);
  const handleLogout = async () => {
    setLoading(true);
    try { await apiFetch("/api/auth/logout", { method: "POST" }); } catch {}
    // Navegación dura (no router.push): descarta todo el estado en memoria del
    // SPA (caches de CSRF/sesión, datos de la cuenta anterior) antes del login.
    window.location.assign("/login");
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
  branchIds,
  primaryBranchId,
  username,
  userId,
}: Pick<SessionPayload, "roleCode" | "globalRoles" | "branchMemberships" | "effectiveCapabilities" | "branchIds" | "primaryBranchId"> & { username: string; userId: string }) {
  const pathname = usePathname();
  const sections = buildNavSections({ roleCode, globalRoles, branchMemberships, effectiveCapabilities });

  // Ítem activo = el href más largo que sea prefijo de la ruta actual (gana solo
  // uno). Con startsWith por ítem, "/app/master" quedaba resaltado en TODAS las
  // páginas master a la vez que el ítem específico de la página.
  const activeHref = sections
    .flatMap((section) => section.items)
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .reduce<string | null>((best, item) => (best === null || item.href.length > best.length ? item.href : best), null);

  const isMaster = isMasterOrAbove(roleCode as string, globalRoles as unknown as string[]);
  const roleCfg = getRoleColor(roleCode);
  const homeHref = resolveRoleHome(roleCode as string, globalRoles as unknown as string[]);

  // Aviso persistente de días operativos esperando confirmación
  // (reviewStatus PENDING): se muestra como badge en "Día Operativo 360"
  // para que sea visible desde cualquier pantalla, no solo el Centro de
  // Comando. No es una alarma — solo informa que hay días esperando firma.
  const [pendingReviewDaysCount, setPendingReviewDaysCount] = useState(0);
  const fetchPendingReviewDays = useCallback(async () => {
    const res = await apiFetch("/api/master/operations/live-blockers");
    if (!res.ok) return;
    const raw = await res.json();
    const data = unwrapApiData(raw) as { pendingReviewDaysCount: number };
    setPendingReviewDaysCount(data.pendingReviewDaysCount ?? 0);
  }, []);
  useOperationalPolling({ enabled: isMaster, intervalMs: 60_000, task: fetchPendingReviewDays });

  // Contador de cámaras en falla (módulo Cámaras, prompt §4.2) — snapshot
  // ligero, nunca el estado en vivo: se recalcula tras cada heartbeat.
  const [camerasFailingCount, setCamerasFailingCount] = useState(0);
  const fetchCamerasSummary = useCallback(async () => {
    const res = await apiFetch("/api/master/cameras/summary");
    if (!res.ok) return;
    const raw = await res.json();
    const data = unwrapApiData(raw) as { failingCount: number };
    setCamerasFailingCount(data.failingCount ?? 0);
  }, []);
  useOperationalPolling({ enabled: isMaster, intervalMs: 60_000, task: fetchCamerasSummary });

  // Indicador de efectivo (prompt-indicador-efectivo-inteligente.md) — misma
  // sucursal activa que usa el resto de la app (getActiveBranchId), no una
  // resuelta aparte solo para este panel. Exclusivo de Admin de Sucursal
  // (prompt-ajustes-finales-tesoreria.md §1): lo que Master veía acá ahora
  // vive en la sección "Efectivo por sucursal" de la pantalla de Tesorería,
  // sin ninguna sucursal oculta detrás de un link.
  const cashIndicatorBranchId = getActiveBranchId(branchIds, primaryBranchId) || null;
  const capabilitySession = { globalRoles, branchMemberships };
  const canViewCashIndicator = cashIndicatorBranchId !== null && canInBranch(capabilitySession, cashIndicatorBranchId, CAPABILITIES.TREASURY_VIEW_BRANCH);
  const canSendCashDeposit = cashIndicatorBranchId !== null && canInBranch(capabilitySession, cashIndicatorBranchId, CAPABILITIES.CASH_SESSION_OPERATE);

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

  /* Outside clicks are handled by the overlay backdrop (see desktop sidebar
     markup). Escape closes both the expanded rail and the mobile drawer. */
  useEffect(() => {
    if (collapsed && !mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDesktopRail();
        closeMobile();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [collapsed, mobileOpen, closeDesktopRail, closeMobile]);

  /* Role-specific color classes */
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
        {isCollapsed && !isMobileView ? (
          /* Collapsed rail (desktop): the hammer mark IS the expand button.
             It only toggles the rail — it never navigates, so clicking to
             expand can no longer land the user on a nav page. */
          <button
            type="button"
            onClick={toggleCollapse}
            className="brand-mark flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0"
            style={{ background: "var(--color-brand-500)", border: "none", cursor: "pointer" }}
            title="Expandir menú"
            aria-label="Expandir menú"
            aria-expanded={false}
          >
            <Hammer className="h-4 w-4 text-white" />
          </button>
        ) : (
          <>
            {/* Brand mark (martillo + wordmark) → navigates home */}
            <Link href={(isMaster ? "/app/master" : homeHref) as Route} onClick={handleNavigation} className="flex items-center gap-2.5 min-w-0">
              <div
                key={brandAnimKey}
                className="brand-mark flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0"
                style={{ background: "var(--color-brand-500)" }}
              >
                <Hammer className="h-4 w-4 text-white" />
              </div>
              <span
                className="sidebar-label text-[0.875rem] font-semibold tracking-tight truncate"
                style={{ color: "var(--color-sidebar-text-active)" }}
              >
                H.A.M.M.E.R.
              </span>
            </Link>
            {/* Collapse toggle — hammer icon, desktop only */}
            {!isMobileView && (
              <button
                type="button"
                onClick={toggleCollapse}
                className="hammer-toggle flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-md transition-colors"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--color-sidebar-section)",
                  cursor: "pointer",
                }}
                title="Colapsar menú"
                aria-label="Colapsar menú"
                aria-expanded={true}
              >
                <Hammer className="hammer-toggle-icon h-4 w-4" />
              </button>
            )}
          </>
        )}
      </div>

      {/* ── 1.5. Indicador de efectivo — exclusivo de Admin de Sucursal (oculto colapsado / Master / sin permiso / sin nada que reportar) ── */}
      {!isCollapsed && canViewCashIndicator && !isMaster && (
        <CashIndicatorPanel branchId={cashIndicatorBranchId} canSendDeposit={canSendCashDeposit} />
      )}

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
                const active = item.href === activeHref;
                const Icon = item.icon;
                const pendingBadge = item.href === "/app/master/operations"
                  ? pendingReviewDaysCount
                  : item.href === "/app/master/cameras"
                    ? camerasFailingCount
                    : 0;
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
                      title={isCollapsed ? (pendingBadge > 0 ? `${item.label} (${pendingBadge} día(s) esperando cierre)` : item.label) : undefined}
                    >
                      <span className="relative flex-shrink-0">
                        <Icon
                          className="h-4 w-4 transition-colors duration-[140ms]"
                          style={{
                            color: active ? "var(--sidebar-item-icon-hover)" : "var(--sidebar-item-icon)",
                          }}
                        />
                        {isCollapsed && pendingBadge > 0 && (
                          <span
                            className="absolute -top-1 -right-1 h-2 w-2 rounded-full"
                            style={{ background: "var(--color-danger-500)" }}
                            aria-hidden="true"
                          />
                        )}
                      </span>
                      {!isCollapsed && (
                        <span className="sidebar-label truncate flex-1">{item.label}</span>
                      )}
                      {!isCollapsed && pendingBadge > 0 && (
                        <span
                          className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[0.625rem] font-bold leading-none text-white"
                          style={{ background: "var(--color-danger-500)" }}
                          title={`${pendingBadge} día(s) operativo(s) esperando cierre`}
                        >
                          {pendingBadge}
                        </span>
                      )}
                    </Link>
                    {isCollapsed && (
                      <span className="sidebar-tooltip">
                        {pendingBadge > 0 ? `${item.label} (${pendingBadge})` : item.label}
                      </span>
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

      {/* ── Desktop sidebar ──
          The flow always reserves the collapsed rail width, so expanding the
          sidebar never reflows the page content. When expanded the panel floats
          on top (overlay) and a transparent backdrop captures any outside click
          to collapse it — this is what prevents a stray click from being routed
          into a nav item (the old "click expand / outside → Día Operativo o
          Roles" bug). */}
      <div
        className="hidden md:block relative flex-shrink-0"
        style={{ width: "var(--sidebar-width-collapsed)" }}
      >
        {/* Backdrop — only while expanded; closes rail without navigating */}
        {!collapsed && (
          <div
            className="fixed inset-0 z-40 animate-fade-in"
            style={{ background: "rgba(0,0,0,0.04)" }}
            onClick={closeDesktopRail}
            aria-hidden="true"
          />
        )}
        <aside
          className={`
            app-sidebar-desktop hm-sidebar flex flex-col bg-[var(--color-sidebar)] select-none
            ${collapsed ? "sidebar-collapsed" : "sidebar-expanded"}
          `}
          ref={desktopSidebarRef}
          style={{
            position: collapsed ? "sticky" : "fixed",
            top: 0,
            left: 0,
            height: "100vh",
            width: collapsed ? "var(--sidebar-width-collapsed)" : "var(--sidebar-width-expanded)",
            transition: "width var(--sidebar-transition)",
            zIndex: collapsed ? 30 : 50,
            boxShadow: collapsed ? "none" : "var(--shadow-xl)",
            ...sidebarRoleStyle,
          }}
        >
          {renderContent(collapsed, false)}
        </aside>
      </div>
    </>
  );
}
