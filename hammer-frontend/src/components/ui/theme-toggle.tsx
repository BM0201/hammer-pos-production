"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { apiFetch } from "@/lib/client/api";

type Theme = "light" | "dark";

function userKey(userId: string) {
  return `hammer-theme-${userId}`;
}

/**
 * Reads this user's stored preference, applies it to <html>, and syncs the
 * FOUC hint keys so the next reload starts with the right theme immediately.
 *
 * Orden de precedencia: localStorage por usuario (lo que el usuario tocó en
 * ESTE dispositivo más recientemente) > preferencia guardada en el servidor
 * (serverPreference, para un dispositivo nuevo o caché limpiada) > sistema.
 */
export function applyUserTheme(userId: string, serverPreference?: Theme | null): Theme {
  try {
    const stored = localStorage.getItem(userKey(userId)) as Theme | null;
    const theme: Theme =
      stored ?? serverPreference ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem("hammer-theme", theme);
    localStorage.setItem("hammer-theme-user", userId);
    return theme;
  } catch {
    return "light";
  }
}

export function ThemeToggle({
  userId,
  className,
  style,
}: {
  userId: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  /* Read the current theme directly from the DOM so the initial render is
     correct without waiting for a useEffect (avoids the Sun→Moon flash). */
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof document !== "undefined") {
      return (document.documentElement.dataset.theme as Theme) || "light";
    }
    return "light";
  });

  /* Keep in sync if applyUserTheme or anything else changes data-theme */
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme((document.documentElement.dataset.theme as Theme) || "light");
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    try {
      localStorage.setItem(userKey(userId), next);
      localStorage.setItem("hammer-theme", next);
      localStorage.setItem("hammer-theme-user", userId);
    } catch {}
    setTheme(next);

    // Persiste en el servidor para que un dispositivo nuevo o una caché
    // limpiada arranquen con esta preferencia en vez del sistema operativo.
    // Fire-and-forget: es cosmético, un fallo de red no bloquea el toggle.
    apiFetch("/api/me/preferences", {
      method: "PATCH",
      body: JSON.stringify({ themePreference: next }),
    }).catch(() => {});
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className={className ?? "hm-icon-btn"}
      style={style}
      title={theme === "dark" ? "Modo claro" : "Modo oscuro"}
      aria-label={theme === "dark" ? "Activar modo claro" : "Activar modo oscuro"}
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
