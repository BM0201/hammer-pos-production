"use client";

import { useContext, useEffect } from "react";
import { useRouter } from "next/navigation";
import { SessionContext } from "@/lib/client/session";
import { resolveRoleHome } from "@/modules/rbac/role-routing";

/**
 * Inicio de la app (la tablet abre en "/" → "/app"): manda a cada quien a su
 * pantalla. La sesión ya la trajo el layout de /app (si no hay, el layout
 * manda al login), así que no se vuelve a pedir al servidor.
 */
export default function AppIndexPage() {
  const router = useRouter();
  const session = useContext(SessionContext);

  useEffect(() => {
    if (session) router.replace(resolveRoleHome(session.roleCode, session.globalRoles ?? []));
  }, [session, router]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--color-page-bg)]">
      <span className="text-sm text-[var(--color-text-muted)] animate-pulse">Redirigiendo…</span>
    </div>
  );
}
