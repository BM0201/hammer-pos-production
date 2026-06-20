"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, unwrapApiData, type ApiResponse } from "@/lib/client/api";
import { User, Lock, LogIn, AlertCircle, Eye, EyeOff, ShieldCheck, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Step = "credentials" | "mfa";

export function LoginForm() {
  const router = useRouter();
  const usernameRef = useRef<HTMLInputElement>(null);
  const mfaRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("credentials");
  const [pendingToken, setPendingToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  useEffect(() => {
    if (step === "mfa") mfaRef.current?.focus();
  }, [step]);

  async function onCredentialsSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: username.trim().toLowerCase(), password }),
      });

      const json = await response.json();

      if (!response.ok) {
        const apiErr = json as ApiResponse<unknown>;
        if (!apiErr.ok && "error" in apiErr) {
          const msg =
            typeof apiErr.error === "object" && apiErr.error && "message" in apiErr.error
              ? (apiErr.error as { message: string }).message
              : "Usuario o contraseña inválidos.";
          setError(msg);
        } else {
          setError(
            response.status === 401
              ? "Usuario o contraseña inválidos."
              : "No se pudo iniciar sesión.",
          );
        }
        return;
      }

      const data = unwrapApiData(
        json as ApiResponse<{
          redirectTo?: string;
          mustChangePassword?: boolean;
          mfaRequired?: boolean;
          pendingToken?: string;
        }>,
      );

      if (data.mfaRequired && data.pendingToken) {
        setPendingToken(data.pendingToken);
        setStep("mfa");
        return;
      }

      if (!data.redirectTo) {
        setError("No se pudo iniciar sesión. Inténtalo de nuevo.");
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.push(data.redirectTo as any);
      router.refresh();
    } catch {
      setError("No se pudo iniciar sesión. Verifica tu conexión e inténtalo de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onMfaSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await apiFetch("/api/auth/mfa", {
        method: "POST",
        body: JSON.stringify({ pendingToken, code: mfaCode.trim() }),
      });

      const json = await response.json();

      if (!response.ok) {
        const apiErr = json as ApiResponse<unknown>;
        const msg =
          !apiErr.ok && "error" in apiErr && typeof apiErr.error === "object" && apiErr.error && "message" in apiErr.error
            ? (apiErr.error as { message: string }).message
            : "Código incorrecto.";
        setError(msg);
        setMfaCode("");
        mfaRef.current?.focus();
        return;
      }

      const data = unwrapApiData(
        json as ApiResponse<{ redirectTo: string; mustChangePassword: boolean }>,
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.push(data.redirectTo as any);
      router.refresh();
    } catch {
      setError("No se pudo verificar el código. Verifica tu conexión e inténtalo de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  function backToCredentials() {
    setStep("credentials");
    setMfaCode("");
    setPendingToken("");
    setError(null);
  }

  if (step === "mfa") {
    return (
      <form className="space-y-5" onSubmit={onMfaSubmit}>
        <div className="flex flex-col items-center gap-2 pb-2">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-info-50)] text-[var(--color-info-600)]">
            <ShieldCheck className="h-6 w-6" />
          </span>
          <h2 className="text-base font-semibold text-[var(--color-text)]">
            Verificación en dos pasos
          </h2>
          <p className="text-xs text-center text-[var(--color-text-soft)] max-w-xs">
            Ingresa el código de 6 dígitos de tu aplicación de autenticación, o un código de recuperación.
          </p>
        </div>

        <div>
          <label
            className="block text-sm font-medium text-[var(--color-text)] mb-1.5"
            htmlFor="mfa-code"
          >
            Código de verificación
          </label>
          <Input
            ref={mfaRef}
            id="mfa-code"
            name="code"
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value)}
            placeholder="000000"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={10}
            className="text-center text-lg tracking-widest"
            required
          />
        </div>

        {error ? (
          <div className="flex items-start gap-3 p-4 rounded-lg border-l-4 border-[var(--color-danger-500)] bg-[var(--color-danger-50)] text-[var(--color-danger-700)] animate-fade-in text-sm">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        ) : null}

        <Button
          className="w-full"
          variant="primary"
          disabled={submitting}
          type="submit"
          loading={submitting}
          icon={!submitting ? <ShieldCheck className="h-4 w-4" /> : undefined}
        >
          {submitting ? "Verificando…" : "Verificar"}
        </Button>

        <button
          type="button"
          onClick={backToCredentials}
          className="flex w-full items-center justify-center gap-1.5 text-xs text-[var(--color-text-soft)] hover:text-[var(--color-text)] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Volver al inicio de sesión
        </button>
      </form>
    );
  }

  return (
    <form className="space-y-5" onSubmit={onCredentialsSubmit}>
      {/* Username */}
      <div>
        <label
          className="block text-sm font-medium text-[var(--color-text)] mb-1.5"
          htmlFor="username"
        >
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
        <label
          className="block text-sm font-medium text-[var(--color-text)] mb-1.5"
          htmlFor="password"
        >
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
        ¿Es tu primer ingreso? Solicita tu contraseña temporal al administrador.
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
