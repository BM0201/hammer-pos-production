"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { isOwnerRole, isSystemAdminRole } from "@/modules/rbac/role-routing";
import { BranchModuleConfigPanel } from "@/components/owner/branch-module-config";
import { useSession } from "@/lib/client/session";

export default function ModuleConfigPage() {
  const router = useRouter();
  const sessionState = useSession();

  useEffect(() => {
    if (sessionState.status === "unauthenticated") {
      router.replace("/login");
      return;
    }
    if (sessionState.status === "authenticated") {
      const role = sessionState.session.roleCode as string;
      const globals = (sessionState.session.globalRoles ?? []) as unknown as string[];
      if (!isOwnerRole(role, globals) && !isSystemAdminRole(role, globals)) {
        router.replace("/app");
      }
    }
  }, [router, sessionState]);

  if (sessionState.status !== "authenticated") {
    return <p className="text-[var(--color-text-muted)] animate-pulse">Cargando…</p>;
  }

  const role = sessionState.session.roleCode as string;
  const globals = (sessionState.session.globalRoles ?? []) as unknown as string[];
  if (!isOwnerRole(role, globals) && !isSystemAdminRole(role, globals)) {
    return null;
  }

  return <BranchModuleConfigPanel />;
}
