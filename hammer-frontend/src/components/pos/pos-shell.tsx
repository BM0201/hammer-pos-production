"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import {
  Hammer,
  ShoppingCart,
  CreditCard,
  Wallet,
  LayoutDashboard,
  ClipboardList,
  ChevronUp,
  Menu,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { canInAnyAssignedBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { getActiveBranchId } from "@/lib/client/active-branch";
import { applyUserTheme, ThemeToggle } from "@/components/ui/theme-toggle";
import { apiFetch } from "@/lib/client/api";
import { PosSummaryCards } from "./components/pos-summary-cards";
import { usePosRealtimeSummary } from "./hooks/use-pos-realtime-summary";
import { usePosCashContext } from "./hooks/use-pos-cash-context";
import type { SessionPayload } from "@/types/auth";
import { getRoleColor } from "@/lib/role-colors";

type ShellSession = Pick<
  SessionPayload,
  "userId" | "username" | "roleCode" | "globalRoles" | "branchMemberships" | "branchIds" | "primaryBranchId" | "effectiveCapabilities"
>;

type NavSection = { title: string; items: NavItem[] };
type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean };

type SidebarRoleStyle = CSSProperties & {
  "--sidebar-role-active-bg": string;
  "--sidebar-role-active-text": string;
  "--sidebar-role-icon": string;
};

function buildPosNav(session: ShellSession): NavSection[] {
  const ventaItems: NavItem[] = [];
  const cajaItems: NavItem[] = [];

  if (canInAnyAssignedBranch(session, CAPABILITIES.POS_VIEW)) {
    ventaItems.push({ href: "/app/branch/sales/orders", label: "Vender", icon: ShoppingCart });
  }
  if (canInAnyAssignedBranch(session, CAPABILITIES.PAYMENT_QUEUE_VIEW)) {
    cajaItems.push({ href: "/app/branch/cashier/payments", label: "Cobros", icon: CreditCard });
  }
  if (
    canInAnyAssignedBranch(session, CAPABILITIES.CASH_SESSION_USE) ||
    canInAnyAssignedBranch(session, CAPABILITIES.CASH_SESSION_OPEN)
  ) {
    cajaItems.push({ href: "/app/branch/cash", label: "Caja", icon: Wallet });
  }
  cajaItems.push({ href: "/app/branch", label: "Mi día", icon: LayoutDashboard, exact: true });
  if (canInAnyAssignedBranch(session, CAPABILITIES.CASH_SESSION_CLOSE_REQUEST)) {
    // Cierre only if not already showing Caja (same href)
    if (!cajaItems.some((i) => i.href === "/app/branch/cash")) {
      cajaItems.push({ href: "/app/branch/cash", label: "Cierre", icon: ClipboardList });
    }
  }

  const sections: NavSection[] = [];
  if (ventaItems.length) sections.push({ title: "Venta", items: ventaItems });
  if (cajaItems.length) sections.push({ title: "Caja", items: cajaItems });
  return sections;
}

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
      <X className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "var(--color-cashier-400, #fb7185)" }} />
      {loading ? "Saliendo…" : "Cerrar sesión"}
    </button>
  );
}

export function PosShell({ session, children }: { session: ShellSession; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const roleCfg = getRoleColor(session.roleCode);

  const branchId = getActiveBranchId(session.branchIds, session.primaryBranchId) ?? "";
  const { realtimeSummary, summaryUpdatedAt } = usePosRealtimeSummary(branchId);
  const { activeCashSessionId } = usePosCashContext(branchId);

  /* ── Sidebar state ── */
  const [collapsed, setCollapsed] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const desktopSidebarRef = useRef<HTMLElement | null>(null);

  const toggleCollapse = useCallback(() => setCollapsed((p) => !p), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const closeDesktopRail = useCallback(() => setCollapsed(true), []);
  const handleNavigation = useCallback(() => { closeMobile(); closeDesktopRail(); }, [closeMobile, closeDesktopRail]);

  /* Auto-collapse after navigation */
  useEffect(() => { closeMobile(); closeDesktopRail(); }, [pathname, closeDesktopRail, closeMobile]);

  /* Escape closes expanded rail */
  useEffect(() => {
    if (collapsed) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeDesktopRail(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [collapsed, closeDesktopRail]);

  /* Hammer animation replays on expand */
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

  /* Apply stored theme */
  useEffect(() => { applyUserTheme(session.userId); }, [session.userId]);

  /* Heartbeat */
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  useEffect(() => {
    let stopped = false;
    let lastBeat = 0;
    const sendHeartbeat = async () => {
      try {
        const response = await apiFetch("/api/auth/heartbeat", {
          method: "POST",
          body: JSON.stringify({ branchId: session.primaryBranchId, currentPath: pathnameRef.current, currentModule: "branch" }),
        });
        if (!stopped && response.status === 401) router.replace("/login");
      } catch { /* best-effort */ }
    };
    const maybeSend = (minGapMs = 0) => {
      if (stopped || document.hidden) return;
      if (Date.now() - lastBeat < minGapMs) return;
      lastBeat = Date.now();
      void sendHeartbeat();
    };
    maybeSend();
    const interval = window.setInterval(() => maybeSend(), 120_000);
    const onFocus = () => maybeSend(5_000);
    window.addEventListener("focus", onFocus);
    return () => { stopped = true; window.clearInterval(interval); window.removeEventListener("focus", onFocus); };
  }, [router, session.primaryBranchId]);

  const sections = buildPosNav(session);
  const roleActiveBg = `var(--color-${roleCfg.cssPrefix}-600)`;
  const sidebarRoleStyle: SidebarRoleStyle = {
    "--sidebar-role-active-bg": roleActiveBg,
    "--sidebar-role-active-text": `var(--color-${roleCfg.cssPrefix}-200)`,
    "--sidebar-role-icon": `var(--color-${roleCfg.cssPrefix}-400)`,
  };

  /* ── Shared sidebar content ── */
  const renderContent = (isCollapsed: boolean, isMobileView: boolean) => (
    <div className="flex flex-col h-full">

      {/* Brand bar */}
      <div className={`flex items-center gap-2.5 px-3 py-3 ${isCollapsed ? "justify-center" : "justify-between"}`}>
        {isCollapsed && !isMobileView ? (
          /* Collapsed: Hammer IS the expand toggle */
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
            {/* Brand wordmark */}
            <div key={brandAnimKey} className="flex items-center gap-2.5 min-w-0">
              <div
                className="brand-mark flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0"
                style={{ background: "var(--color-brand-500)" }}
              >
                <Hammer className="h-4 w-4 text-white" />
              </div>
              <span
                className="sidebar-label text-[0.875rem] font-semibold tracking-tight truncate"
                style={{ color: "var(--color-sidebar-text-active)" }}
              >
                Hammer POS
              </span>
            </div>
            {/* Collapse toggle (desktop only) */}
            {!isMobileView && (
              <button
                type="button"
                onClick={toggleCollapse}
                className="hammer-toggle flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-md transition-colors"
                style={{ background: "transparent", border: "none", color: "var(--color-sidebar-section)", cursor: "pointer" }}
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

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto px-2 py-1 space-y-4" aria-label="POS navigation">
        {sections.map((section) => (
          <div key={section.title}>
            {!isCollapsed && (
              <p
                className="sidebar-section-title px-2 mb-1 text-[11px] font-medium tracking-[0.04em]"
                style={{ color: "var(--color-sidebar-section)" }}
              >
                {section.title}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = item.exact
                  ? pathname === item.href
                  : pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <div key={item.href + item.label} className="relative sidebar-nav-item">
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
                          color: active
                            ? "var(--color-pay-on-dark)"
                            : "var(--sidebar-item-icon)",
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

      {/* Account button + popover */}
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
          <div
            className="flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0 text-[0.6875rem] font-bold text-white"
            style={{ background: roleActiveBg }}
          >
            {session.username.charAt(0).toUpperCase()}
          </div>
          {!isCollapsed && (
            <>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[0.75rem] font-semibold truncate" style={{ color: "var(--color-sidebar-text-active)" }}>
                  {session.username}
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
            <div
              className="flex items-center gap-2.5 px-3 py-2.5 border-b"
              style={{ borderColor: "rgba(255,255,255,0.07)" }}
            >
              <div
                className="flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0 text-[0.75rem] font-bold text-white"
                style={{ background: roleActiveBg }}
              >
                {session.username.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-[0.75rem] font-semibold truncate" style={{ color: "var(--color-sidebar-text-active)" }}>
                  {session.username}
                </p>
                <p className="text-[0.625rem]" style={{ color: "var(--color-sidebar-section)" }}>
                  Cuenta {roleCfg.label}
                </p>
              </div>
            </div>
            <div
              className="flex items-center justify-between px-3 py-2"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
            >
              <span className="text-[0.75rem]" style={{ color: "var(--color-sidebar-text)" }}>
                Modo nocturno
              </span>
              <ThemeToggle
                userId={session.userId}
                className="flex items-center justify-center w-6 h-6 rounded-md border-0 bg-transparent cursor-pointer transition-colors"
                style={{ color: "var(--color-sidebar-section)" }}
              />
            </div>
            <LogoutButton />
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-[var(--color-page-bg)]" data-testid="pos-shell">

      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-3 left-3 z-50 p-2 rounded-lg shadow-lg bg-[var(--color-sidebar)] text-white"
        aria-label="Abrir menú"
        aria-expanded={mobileOpen}
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40 animate-fade-in"
          onClick={closeMobile}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={[
          "hm-sidebar md:hidden fixed top-0 left-0 z-50 h-full w-[16.25rem] flex flex-col",
          "bg-[var(--color-sidebar)] select-none",
          "transition-transform duration-250 ease-in-out",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
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

      {/* Desktop sidebar — rail that floats on top when expanded */}
      <div
        className="hidden md:block relative flex-shrink-0"
        style={{ width: "var(--sidebar-width-collapsed)" }}
      >
        {!collapsed && (
          <div
            className="fixed inset-0 z-40 animate-fade-in"
            style={{ background: "rgba(0,0,0,0.04)" }}
            onClick={closeDesktopRail}
            aria-hidden="true"
          />
        )}
        <aside
          ref={desktopSidebarRef}
          className={[
            "app-sidebar-desktop hm-sidebar flex flex-col bg-[var(--color-sidebar)] select-none",
            collapsed ? "sidebar-collapsed" : "sidebar-expanded",
          ].join(" ")}
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
          data-testid="pos-sidebar"
        >
          {renderContent(collapsed, false)}
        </aside>
      </div>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header
          className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 bg-[var(--color-sidebar)] px-3"
          data-testid="pos-topbar"
        >
          <div className="flex-1 overflow-hidden">
            <PosSummaryCards
              realtimeSummary={realtimeSummary}
              summaryUpdatedAt={summaryUpdatedAt}
              activeCashSessionId={activeCashSessionId}
            />
          </div>
        </header>

        {/* Page content */}
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden p-4 lg:p-5">
          {children}
        </main>
      </div>
    </div>
  );
}
