"use client";

import { useState, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client/api";
import { AppShellRouter } from "@/components/layout/app-shell-router";
import type { SessionPayload } from "@/types/auth";

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
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
        // /api/auth/session returns { authenticated: boolean, user: {...} }
        if (payload?.authenticated && payload.user) {
          // Reconstruct session with required fields (defaults for those not surfaced via API)
          setSession({
            ...payload.user,
            sessionVersion: payload.user.sessionVersion ?? 0,
            exp: payload.user.exp ?? Math.floor(Date.now() / 1000) + 3600,
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
  }, [router]);

  if (loading || !session) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--color-page-bg)]">
        <span className="text-sm text-[var(--color-text-muted)] animate-pulse">Cargando…</span>
      </div>
    );
  }

  return <AppShellRouter session={session}>{children}</AppShellRouter>;
}
