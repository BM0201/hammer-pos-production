"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { parseErrorResponse } from "@/lib/http/parse-error-response";
import { User, Lock, LogIn, AlertCircle, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm() {
  const router = useRouter();
  const usernameRef = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Auto-focus username field on mount
  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const { message } = await parseErrorResponse(response);
        setError(message);
        return;
      }

      const payload = (await response.json()) as { redirectTo?: string };
      if (!payload.redirectTo) {
        setError("No se pudo iniciar sesión. Inténtalo de nuevo.");
        return;
      }

      router.push(payload.redirectTo as any);
      router.refresh();
    } catch {
      setError("No se pudo iniciar sesión. Verifica tu conexión e inténtalo de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      {/* Username */}
      <div>
        <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5" htmlFor="username">
          Usuario
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-0 z-10 flex items-center pl-3 text-[var(--color-text-soft)]">
            <User className="h-4 w-4" />
          </span>
          <Input
            ref={usernameRef}
            id="username"
            name="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className="pl-10"
            placeholder="nombre.sucursal"
            autoComplete="username"
            required
          />
        </div>
      </div>

      {/* Password */}
      <div>
        <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5" htmlFor="password">
          Contraseña
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-0 z-10 flex items-center pl-3 text-[var(--color-text-soft)]">
            <Lock className="h-4 w-4" />
          </span>
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="pl-10 pr-11"
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
          <button
            type="button"
            aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            title={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-0 z-20 flex items-center rounded-r-lg px-3 text-[var(--color-text-soft)] hover:text-[var(--color-text)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-info-500)]"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Error */}
      {error ? (
        <div className="flex items-start gap-3 p-4 rounded-lg border-l-4 border-[var(--color-danger-500)] bg-[var(--color-danger-50)] text-[var(--color-danger-700)] animate-fade-in text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      ) : null}

      {/* First-time help hint */}
      <p className="text-xs text-center text-[var(--color-text-soft)]">
        ¿Primera vez? Usa la contraseña: <span className="font-mono font-medium">ElChele1234!</span>
      </p>

      {/* Submit */}
      <Button
        className="w-full"
        variant="primary"
        disabled={submitting}
        type="submit"
        loading={submitting}
        icon={!submitting ? <LogIn className="h-4 w-4" /> : undefined}
      >
        {submitting ? "Iniciando sesión…" : "Iniciar sesión"}
      </Button>
    </form>
  );
}
