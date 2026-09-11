"use client";

import { useState } from "react";
import { LogOut, type LucideIcon } from "lucide-react";
import { apiFetch } from "@/lib/client/api";

// `icon` conserva el ícono que ya usaba cada shell (pos-shell: X, resto: LogOut).
export function LogoutButton({ icon: Icon = LogOut }: { icon?: LucideIcon }) {
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    setLoading(true);
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* redirige igual */
    }
    // Navegación dura: descarta el estado en memoria del SPA (caches de
    // CSRF/sesión, datos de la cuenta anterior) antes del login.
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
      <Icon className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "var(--color-cashier-400, #fb7185)" }} />
      {loading ? "Saliendo…" : "Cerrar sesión"}
    </button>
  );
}
