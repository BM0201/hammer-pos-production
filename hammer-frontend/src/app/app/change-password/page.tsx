"use client";

import { useState, useEffect, FormEvent, useRef } from "react";
import { Lock, Eye, EyeOff, AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import { apiFetch, unwrapApiData, type ApiResponse } from "@/lib/client/api";
import type { SessionPayload } from "@/types/auth";

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isFirstLogin, setIsFirstLogin] = useState(false);
  const currentPasswordRef = useRef<HTMLInputElement>(null);

  // Check if this is a forced password change (first login)
  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/auth/session")
      .then(async (r) => {
        if (!r.ok) return;
        const payload = await r.json();
        const data = unwrapApiData(payload as ApiResponse<{ authenticated: boolean; user: SessionPayload & { mustChangePassword?: boolean } }>);
        if (!cancelled && data?.user?.mustChangePassword) {
          setIsFirstLogin(true);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Auto-focus on current password field
  useEffect(() => {
    currentPasswordRef.current?.focus();
  }, []);

  const passwordChecks = [
    { label: "Al menos 8 caracteres", valid: newPassword.length >= 8 },
    { label: "Una letra mayúscula", valid: /[A-Z]/.test(newPassword) },
    { label: "Una letra minúscula", valid: /[a-z]/.test(newPassword) },
    { label: "Un número", valid: /[0-9]/.test(newPassword) },
    { label: "Un carácter especial (!@#$%...)", valid: /[^A-Za-z0-9]/.test(newPassword) },
  ];

  const passwordsMatch = newPassword === confirmPassword && confirmPassword.length > 0;
  const allValid = passwordChecks.every((c) => c.valid) && passwordsMatch && currentPassword.length > 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!allValid) return;

    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? data?.message ?? "Error al cambiar la contraseña");
        return;
      }

      setSuccess(true);
      // Redirect to login after successful change
      setTimeout(() => {
        window.location.href = "/login";
      }, 2500);
    } catch {
      setError("Error de conexión. Verifica tu conexión e intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center animate-fade-in">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <CheckCircle2 className="h-10 w-10 text-green-500" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">¡Contraseña Actualizada!</h3>
          <p className="text-gray-600 mb-4">Tu contraseña ha sido cambiada exitosamente.</p>
          <p className="text-sm text-gray-500">Serás redirigido al login en unos segundos...</p>
          <div className="mt-4 h-1 w-full bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full animate-[progress_2.5s_ease-in-out]" style={{ animation: "progress 2.5s ease-in-out forwards" }} />
          </div>
        </div>
        <style>{`@keyframes progress { from { width: 0% } to { width: 100% } }`}</style>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white rounded-xl shadow-lg p-6 sm:p-8 max-w-md w-full">
        {/* First login banner */}
        {isFirstLogin && (
          <div className="mb-6 flex items-start gap-3 rounded-lg border border-blue-300 bg-blue-50 p-4">
            <ShieldAlert className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-blue-800">Debe cambiar su contraseña inicial</p>
              <p className="text-xs text-blue-700 mt-1">
                La contraseña <span className="font-mono font-medium">ElChele1234!</span> es temporal.
                Debes crear una contraseña personal y segura antes de acceder al sistema.
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100">
            <Lock className="h-5 w-5 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-gray-900">Cambiar Contraseña</h3>
            <p className="text-sm text-gray-500">
              {isFirstLogin
                ? "Crea una contraseña segura para tu cuenta"
                : "Actualiza tu contraseña de acceso"}
            </p>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2 animate-fade-in">
            <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Current password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="currentPassword">
              Contraseña Actual <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                ref={currentPasswordRef}
                id="currentPassword"
                type={showCurrent ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 pr-10 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                placeholder={isFirstLogin ? "ElChele1234!" : "Ingresa tu contraseña actual"}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors p-1"
                aria-label={showCurrent ? "Ocultar" : "Mostrar"}
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* New password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="newPassword">
              Nueva Contraseña <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                id="newPassword"
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 pr-10 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                placeholder="Crea una contraseña segura"
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors p-1"
                aria-label={showNew ? "Ocultar" : "Mostrar"}
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Confirm new password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="confirmPassword">
              Confirmar Nueva Contraseña <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                id="confirmPassword"
                type={showConfirm ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`w-full border rounded-lg px-3 py-2.5 pr-10 text-sm focus:ring-2 focus:ring-indigo-500 transition-colors ${
                  confirmPassword && !passwordsMatch
                    ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                    : confirmPassword && passwordsMatch
                    ? "border-green-300 focus:border-green-500 focus:ring-green-500"
                    : "border-gray-300 focus:border-indigo-500"
                }`}
                placeholder="Repite tu nueva contraseña"
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors p-1"
                aria-label={showConfirm ? "Ocultar" : "Mostrar"}
              >
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {confirmPassword && !passwordsMatch && (
              <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Las contraseñas no coinciden
              </p>
            )}
            {passwordsMatch && (
              <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Las contraseñas coinciden
              </p>
            )}
          </div>

          {/* Password requirements checklist */}
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
            <p className="text-xs font-semibold text-gray-600 mb-2">Requisitos de la contraseña:</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
              {passwordChecks.map((check) => (
                <div key={check.label} className="flex items-center gap-2 text-xs">
                  {check.valid ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                  ) : (
                    <div className="h-3.5 w-3.5 rounded-full border-2 border-gray-300 flex-shrink-0" />
                  )}
                  <span className={check.valid ? "text-green-700 font-medium" : "text-gray-500"}>
                    {check.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={!allValid || loading}
            className="w-full bg-indigo-600 text-white py-2.5 rounded-lg font-semibold text-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Cambiando contraseña...
              </>
            ) : (
              <>
                <Lock className="h-4 w-4" />
                Cambiar Contraseña
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
