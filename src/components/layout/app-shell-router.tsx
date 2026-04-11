"use client";

import { useMemo } from "react";
import { useSelectedLayoutSegments } from "next/navigation";
import type { ReactNode } from "react";
import type { SessionPayload } from "@/types/auth";
import { AppSidebar } from "@/components/navigation/app-sidebar";
import { RoleBadge } from "@/components/ui/role-badge";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { AppFooter } from "@/components/layout/app-footer";
import { PosShellWrapper } from "@/components/pos/PosShellWrapper";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

type ShellSession = Pick<
  SessionPayload,
  "username" | "roleCode" | "globalRoles" | "branchMemberships"
>;

const POS_SEGMENT_MATCHERS: ReadonlyArray<(segments: string[]) => boolean> = [
  (segments) =>
    segments[0] === "branch" &&
    segments[1] === "sales" &&
    segments[2] === "orders",
  (segments) =>
    segments[0] === "branch" &&
    segments[1] === "cashier" &&
    segments[2] === "payments",
];

function usesPosShell(segments: string[]): boolean {
  return POS_SEGMENT_MATCHERS.some((matcher) => matcher(segments));
}

function resolvePosMode(segments: string[]): "sales" | "cashier" {
  return segments[1] === "cashier" ? "cashier" : "sales";
}

export function AppShellRouter({
  session,
  children,
}: {
  session: ShellSession;
  children: ReactNode;
}) {
  const segments = useSelectedLayoutSegments();
  const isPosShell = useMemo(() => usesPosShell(segments), [segments]);
  const posMode = useMemo(() => resolvePosMode(segments), [segments]);

  if (isPosShell) {
    return (
      <div className="flex min-h-screen bg-[var(--color-page-bg)]">
        <AppSidebar
          roleCode={session.roleCode}
          globalRoles={session.globalRoles}
          branchMemberships={session.branchMemberships}
          username={session.username}
        />
        <div className="flex-1 flex flex-col min-w-0">
          <PosShellWrapper username={session.username} roleCode={session.roleCode} mode={posMode} integrated exitHref="/app/branch">
            {children}
          </PosShellWrapper>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[var(--color-page-bg)]">
      <AppSidebar
        roleCode={session.roleCode}
        globalRoles={session.globalRoles}
        branchMemberships={session.branchMemberships}
        username={session.username}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur-sm">
          <div className="flex items-center justify-between px-5 lg:px-8 h-14">
            <div className="flex items-center gap-3 md:ml-0 ml-12">
              <span className="text-sm font-semibold text-[var(--color-text)]">
                H.A.M.M.E.R.
              </span>
              <RoleBadge roleCode={session.roleCode} size="sm" />
            </div>

            <div className="flex items-center gap-3">
              <span className="hidden sm:block text-xs text-[var(--color-text-muted)]">
                {session.username}
              </span>
              <form action="/api/auth/logout" method="post">
                <Button
                  variant="ghost"
                  size="sm"
                  type="submit"
                  title="Cerrar sesión"
                  className="text-[var(--color-text-soft)] hover:text-[var(--color-danger-600)]"
                  icon={<LogOut className="h-4 w-4" />}
                >
                  <span className="hidden sm:inline">Salir</span>
                </Button>
              </form>
            </div>
          </div>
        </header>

        <main className="flex-1 p-5 lg:p-8 animate-fade-in-up">
          <Breadcrumbs />
          {children}
        </main>

        <AppFooter />
      </div>
    </div>
  );
}
