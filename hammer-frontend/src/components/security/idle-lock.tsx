"use client";

import { useEffect, useState, type FormEvent } from "react";
import { KeyRound, Lock, LogOut } from "lucide-react";
import { apiFetch, unwrapApiData, type ApiResponse } from "@/lib/client/api";
import { useIdleLock } from "@/hooks/use-idle-lock";

/**
 * Bloqueo de pantalla por inactividad para terminales POS/caja compartidas.
 *
 * Pasado el umbral sin interacción, muestra un overlay que exige reintroducir
 * la contraseña del usuario ACTIVO para continuar. No cierra la sesión ni
 * desmonta la vista: el estado de la venta en curso (carrito, formularios)
 * se conserva intacto detrás del overlay.
 *
 * La re-autenticación reutiliza POST /api/auth/login con el username de la
 * sesión actual (obtenido de /api/auth/session): solo confirma identidad, no
 * hay flujo de login paralelo. Para usuarios con MFA, la respuesta
 * `mfaRequired` también prueba que la contraseña es correcta — suficiente
 * para desbloquear (la sesión ya existente completó su MFA al iniciarse).
 */
export function IdleLock({ timeoutMinutes = 5 }: { timeoutMinutes?: number }) {
  const { locked, unlock } = useIdleLock(timeoutMinutes);

  const [username, setUsername] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string>("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  // Identidad del usuario activo — se refresca cada vez que se bloquea.
  useEffect(() => {
    if (!locked) return;
    let cancelled = false;
    apiFetch("/api/auth/session", { suppressAuthRedirect: true })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((raw) => {
        if (cancelled || !raw) return;
        const data = unwrapApiData(raw as ApiResponse<{ authenticated?: boolean; user?: { username?: string; fullName?: string } }>);
        if (data?.authenticated && data.user?.username) {
          setUsername(data.user.username);
          setFullName(data.user.fullName ?? "");
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [locked]);

  async function handleUnlock(event: FormEvent) {
    event.preventDefault();
    if (!username || !password) return;

    setVerifying(true);
    setError(null);
    try {
      const res = await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
        suppressAuthRedirect: true,
      });

      if (res.ok) {
        setPassword("");
        unlock();
        return;
      }

      if (res.status === 429) {
        setError("Demasiados intentos. Espera unos minutos e intenta de nuevo.");
      } else if (res.status === 403) {
        setError("Se requiere verificación adicional. Cierra sesión e ingresa de nuevo.");
      } else {
        setError("Contraseña incorrecta.");
      }
    } catch {
      setError("No se pudo verificar. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setVerifying(false);
    }
  }

  async function handleLogout() {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // aunque falle el logout remoto, forzamos el regreso al login
    }
    window.location.assign("/login");
  }

  if (!locked) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      {/* Fondo opaco: oculta el contenido de la venta a quien pase frente a la terminal */}
      <div className="absolute inset-0 bg-[var(--color-surface)]/95 backdrop-blur-md" />

      <div className="relative z-10 w-full max-w-sm rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-2xl">
        <div className="flex flex-col items-center gap-2 pb-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-warning-100)]">
            <Lock className="h-6 w-6 text-[var(--color-warning-700)]" />
          </div>
          <h2 className="text-base font-bold text-[var(--color-text)]">Sesión bloqueada por inactividad</h2>
          <p className="text-xs text-[var(--color-text-muted)]">
            {fullName ? `${fullName} — ` : ""}ingresa tu contraseña para continuar. La venta en curso se conserva.
          </p>
        </div>

        <form onSubmit={handleUnlock} className="space-y-3">
          <label className="grid gap-1">
            <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              Contraseña{username ? ` de @${username}` : ""}
            </span>
            <input
              type="password"
              className="hm-input rounded-lg text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
              disabled={verifying}
            />
          </label>

          {error && (
            <p className="rounded-lg border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] px-3 py-2 text-xs text-[var(--color-danger-700)]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={verifying || !password || !username}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-master-600)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--color-master-700)] disabled:opacity-50"
          >
            <KeyRound className="h-4 w-4" />
            {verifying ? "Verificando…" : "Desbloquear"}
          </button>
        </form>

        <button
          type="button"
          onClick={handleLogout}
          className="mt-3 flex w-full items-center justify-center gap-1.5 text-xs text-[var(--color-text-soft)] transition-colors hover:text-[var(--color-text-muted)]"
        >
          <LogOut className="h-3.5 w-3.5" />
          ¿No eres tú? Cerrar sesión
        </button>
      </div>
    </div>
  );
}
