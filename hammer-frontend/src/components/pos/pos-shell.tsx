"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
  LogOut,
  Menu,
  ChevronRight,
} from "lucide-react";
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

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  group: "venta" | "caja";
};

function buildPosNav(session: ShellSession): NavItem[] {
  const items: NavItem[] = [];

  if (canInAnyAssignedBranch(session, CAPABILITIES.POS_VIEW)) {
    items.push({ href: "/app/branch/sales/orders", label: "Vender", icon: <ShoppingCart className="h-4 w-4" />, group: "venta" });
  }
  if (canInAnyAssignedBranch(session, CAPABILITIES.PAYMENT_QUEUE_VIEW)) {
    items.push({ href: "/app/branch/cashier/payments", label: "Cobros", icon: <CreditCard className="h-4 w-4" />, group: "caja" });
  }
  if (
    canInAnyAssignedBranch(session, CAPABILITIES.CASH_SESSION_USE) ||
    canInAnyAssignedBranch(session, CAPABILITIES.CASH_SESSION_OPEN)
  ) {
    items.push({ href: "/app/branch/cash", label: "Caja", icon: <Wallet className="h-4 w-4" />, group: "caja" });
  }

  // Mi día — siempre
  items.push({ href: "/app/branch", label: "Mi día", icon: <LayoutDashboard className="h-4 w-4" />, group: "caja" });

  if (canInAnyAssignedBranch(session, CAPABILITIES.CASH_SESSION_CLOSE_REQUEST)) {
    items.push({ href: "/app/branch/cash", label: "Cierre", icon: <ClipboardList className="h-4 w-4" />, group: "caja" });
  }

  // Deduplicate by href+label
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.href + item.label)) return false;
    seen.add(item.href + item.label);
    return true;
  });
}

export function PosShell({ session, children }: { session: ShellSession; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const roleCfg = getRoleColor(session.roleCode);

  const branchId = getActiveBranchId(session.branchIds, session.primaryBranchId) ?? "";
  const { realtimeSummary, summaryUpdatedAt } = usePosRealtimeSummary(branchId);
  const { activeCashSessionId } = usePosCashContext(branchId);

  // Apply stored theme once
  useEffect(() => {
    applyUserTheme(session.userId);
  }, [session.userId]);

  // Heartbeat (same as AppShellRouter)
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  useEffect(() => {
    let stopped = false;
    let lastBeat = 0;

    const sendHeartbeat = async () => {
      try {
        const response = await apiFetch("/api/auth/heartbeat", {
          method: "POST",
          body: JSON.stringify({
            branchId: session.primaryBranchId,
            currentPath: pathnameRef.current,
            currentModule: "branch",
          }),
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

    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [router, session.primaryBranchId]);

  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    try { await apiFetch("/api/auth/logout", { method: "POST" }); } catch { /* ignore */ }
    router.push("/login");
  }, [router]);

  const navItems = buildPosNav(session);
  const initials = session.username.charAt(0).toUpperCase();

  return (
    <div className="flex min-h-screen bg-[var(--color-page-bg)]" data-testid="pos-shell">
      {/* ══════════════ SIDEBAR ══════════════ */}
      <aside
        style={{
          width: collapsed ? "4rem" : "13.25rem",
          transition: "width 240ms cubic-bezier(.32,.72,0,1)",
        }}
        className="relative flex shrink-0 flex-col overflow-hidden bg-[var(--color-sidebar)]"
        data-testid="pos-sidebar"
      >
        {/* ── Brand (Hammer) ── */}
        <div className={[
          "flex items-center gap-2.5 border-b border-white/10 py-4",
          collapsed ? "justify-center px-0" : "px-4",
        ].join(" ")}>
          <span
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-brand-500)] text-white"
            style={{
              animation: "hammer-tap 900ms cubic-bezier(.36,.07,.19,.97) both",
              transformOrigin: "64% 74%",
            }}
          >
            <Hammer className="h-4 w-4" />
          </span>
          {!collapsed ? (
            <span className="text-sm font-bold tracking-tight text-[var(--color-sidebar-text-active)]">
              Hammer POS
            </span>
          ) : null}
        </div>

        {/* ── Navigation ── */}
        <nav className="mt-2 flex-1 px-2" aria-label="POS navigation">
          {(["venta", "caja"] as const).map((group) => {
            const groupItems = navItems.filter((i) => i.group === group);
            if (groupItems.length === 0) return null;
            const label = group === "venta" ? "Venta" : "Caja";
            return (
              <div key={group} className="mb-1">
                {!collapsed ? (
                  <p className="mb-0.5 px-2 text-[0.625rem] font-semibold uppercase tracking-widest text-[var(--color-sidebar-section)]">
                    {label}
                  </p>
                ) : null}
                <div className="space-y-0.5">
                  {groupItems.map((item) => {
                    const isActive =
                      item.href === "/app/branch"
                        ? pathname === "/app/branch"
                        : pathname === item.href || pathname.startsWith(item.href + "/");
                    return (
                      <Link
                        key={item.href + item.label}
                        href={item.href as Route}
                        className={[
                          "flex items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium transition-colors",
                          isActive
                            ? "bg-[color-mix(in_srgb,var(--color-pay)_18%,transparent)] text-[var(--color-pay-on-dark)]"
                            : "text-[var(--color-sidebar-text)] hover:bg-[var(--color-sidebar-hover)] hover:text-[var(--color-sidebar-text-active)]",
                          collapsed ? "justify-center" : "",
                        ].join(" ")}
                        title={collapsed ? item.label : undefined}
                      >
                        <span className={isActive ? "text-[var(--color-pay-on-dark)]" : "text-[var(--color-sidebar-section)]"}>
                          {item.icon}
                        </span>
                        {!collapsed ? <span>{item.label}</span> : null}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* ── User info ── */}
        <div className={[
          "border-t border-white/10 py-3",
          collapsed ? "px-2" : "px-3",
        ].join(" ")}>
          <div className={[
            "flex items-center gap-2.5",
            collapsed ? "justify-center" : "",
          ].join(" ")}>
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-bold text-white"
              style={{ background: `var(--color-${roleCfg.cssPrefix}-600)` }}
            >
              {initials}
            </div>
            {!collapsed ? (
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.7rem] font-semibold text-[var(--color-sidebar-text-active)]">
                  {session.username}
                </p>
                <p className="truncate text-[0.6rem] text-[var(--color-sidebar-section)]">
                  {session.roleCode}
                </p>
              </div>
            ) : null}
          </div>

          {!collapsed ? (
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-[var(--color-sidebar-section)] hover:bg-[var(--color-sidebar-hover)] hover:text-[var(--color-sidebar-text-active)] transition-colors"
            >
              <LogOut className="h-3.5 w-3.5 shrink-0" />
              {loggingOut ? "Saliendo..." : "Cerrar sesión"}
            </button>
          ) : null}
        </div>
      </aside>

      {/* ══════════════ MAIN ══════════════ */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* ── Topbar ── */}
        <header
          className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 bg-[var(--color-sidebar)] px-3"
          data-testid="pos-topbar"
        >
          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-sidebar-text)] hover:bg-[var(--color-sidebar-hover)] hover:text-[var(--color-sidebar-text-active)] transition-colors"
            aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>

          {/* Day stats chips */}
          <div className="flex-1 overflow-hidden">
            <PosSummaryCards
              realtimeSummary={realtimeSummary}
              summaryUpdatedAt={summaryUpdatedAt}
              activeCashSessionId={activeCashSessionId}
            />
          </div>

          {/* Theme toggle */}
          <div className="shrink-0">
            <ThemeToggle userId={session.userId} />
          </div>
        </header>

        {/* ── Page content ── */}
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden p-4 lg:p-5">
          {children}
        </main>
      </div>
    </div>
  );
}
