"use client";

import { useState, useEffect, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Toaster } from "react-hot-toast";
import { apiFetch, unwrapApiData, type ApiResponse } from "@/lib/client/api";
import { AppShellRouter } from "@/components/layout/app-shell-router";
import type { SessionPayload } from "@/types/auth";

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
        // Usar unwrapApiData para contrato estándar { ok, data }
        const data = unwrapApiData(payload as ApiResponse<{ authenticated: boolean; user: SessionPayload & { mustChangePassword?: boolean } }>);
        if (data?.authenticated && data.user) {
          // If user must change password, redirect to change-password page
          // (unless they're already there)
          if (data.user.mustChangePassword && pathname !== "/app/change-password") {
            router.replace("/app/change-password");
            return;
          }

          // Reconstruct session with required fields (defaults for those not surfaced via API)
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
    return () => {
      cancelled = true;
    };
  }, [router, pathname]);

  if (loading || !session) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--color-page-bg)]">
        <span className="text-sm text-[var(--color-text-muted)] animate-pulse">Cargando...</span>
      </div>
    );
  }

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
      <AppShellRouter session={session}>{children}</AppShellRouter>
    </>
  );
}
