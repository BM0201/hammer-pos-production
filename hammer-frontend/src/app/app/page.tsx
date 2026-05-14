"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client/api";
import { resolveRoleHome } from "@/modules/rbac/role-routing";

export default function AppIndexPage() {
  const router = useRouter();

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
        if (cancelled || !payload) return;
        // /api/auth/session returns { authenticated: boolean, user: {...} }
        if (!payload.authenticated || !payload.user) {
          router.replace("/login");
          return;
        }
        const home = resolveRoleHome(payload.user.roleCode, payload.user.globalRoles ?? []);
        router.replace(home);
      })
      .catch(() => {
        if (!cancelled) router.replace("/login");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--color-page-bg)]">
      <span className="text-sm text-[var(--color-text-muted)] animate-pulse">Redirigiendo…</span>
    </div>
  );
}
