"use client";

import { useState, useEffect, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Toaster } from "react-hot-toast";
import { apiFetch, unwrapApiData, type ApiResponse } from "@/lib/client/api";
import { AppShellRouter } from "@/components/layout/app-shell-router";
import { PosShell } from "@/components/pos/pos-shell";
import { HammerSplash } from "@/components/layout/hammer-splash";
import type { SessionPayload } from "@/types/auth";

/** Routes that bypass the management shell and use PosShell instead. */
function isPosRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/app/branch/sales/orders") ||
    pathname.startsWith("/app/branch/cashier/payments") ||
    pathname.startsWith("/app/branch/cash") ||
    pathname.startsWith("/app/branch/approvals") ||
    pathname === "/app/branch"
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/auth/session")
      .then(async (r) => {
        if (!r.ok) {
          if (!cancelled) router.replace("/login");
          return null;
        }
        return r.json();
      })
      .then((payload) => {
        if (cancelled) return;
        const data = unwrapApiData(payload as ApiResponse<{ authenticated: boolean; user: SessionPayload & { mustChangePassword?: boolean } }>);
        if (data?.authenticated && data.user) {
          if (data.user.mustChangePassword && pathname !== "/app/change-password") {
            router.replace("/app/change-password");
            return;
          }
          setSession({
            ...data.user,
            sessionVersion: data.user.sessionVersion ?? 0,
            mustChangePassword: data.user.mustChangePassword ?? false,
            exp: data.user.exp ?? Math.floor(Date.now() / 1000) + 3600,
          } as SessionPayload);
        } else {
          router.replace("/login");
        }
      })
      .catch(() => {
        if (!cancelled) router.replace("/login");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [router, pathname]);

  if (loading || !session) {
    return <HammerSplash />;
  }

  const usePosShell = isPosRoute(pathname);

  return (
    <>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3500,
          style: { borderRadius: "0.75rem", padding: "12px 16px", fontSize: "0.875rem" },
          success: { iconTheme: { primary: "#16a34a", secondary: "#fff" } },
          error: { iconTheme: { primary: "#dc2626", secondary: "#fff" } },
        }}
      />
      {usePosShell ? (
        <PosShell session={session}>{children}</PosShell>
      ) : (
        <AppShellRouter session={session}>{children}</AppShellRouter>
      )}
    </>
  );
}
