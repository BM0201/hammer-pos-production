"use client";

import { useState, FormEvent } from "react";
import { Lock, Eye, EyeOff, AlertTriangle, CheckCircle2 } from "lucide-react";

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const passwordChecks = [
    { label: "Al menos 8 caracteres", valid: newPassword.length >= 8 },
    { label: "Una letra mayúscula", valid: /[A-Z]/.test(newPassword) },
    { label: "Una letra minúscula", valid: /[a-z]/.test(newPassword) },
    { label: "Un número", valid: /[0-9]/.test(newPassword) },
    { label: "Un carácter especial", valid: /[^A-Za-z0-9]/.test(newPassword) },
  ];

  const allValid = passwordChecks.every((c) => c.valid) && newPassword === confirmPassword && currentPassword.length > 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!allValid) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Error al cambiar la contraseña");
        return;
      }

      setSuccess(true);
      // Redirect after password change
      setTimeout(() => {
        window.location.href = "/login";
      }, 2000);
    } catch {
      setError("Error de conexión. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-gray-900 mb-2">¡Contraseña Actualizada!</h3>
          <p className="text-gray-600">Tu contraseña ha sido cambiada exitosamente. Serás redirigido al login...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-amber-100 p-2 rounded-lg">
            <Lock className="h-6 w-6 text-amber-600" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-gray-900">Cambiar Contraseña</h3>
            <p className="text-sm text-gray-500">Debes cambiar tu contraseña por defecto antes de continuar</p>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña Actual</label>
            <div className="relative">
              <input
                type={showCurrent ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="Ingresa tu contraseña actual"
                required
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nueva Contraseña</label>
            <div className="relative">
              <input
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="Ingresa tu nueva contraseña"
                required
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar Nueva Contraseña</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Confirma tu nueva contraseña"
              required
            />
            {confirmPassword && newPassword !== confirmPassword && (
              <p className="text-xs text-red-500 mt-1">Las contraseñas no coinciden</p>
            )}
          </div>

          {/* Password requirements */}
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs font-semibold text-gray-600 mb-2">Requisitos de la contraseña:</p>
            <div className="space-y-1">
              {passwordChecks.map((check) => (
                <div key={check.label} className="flex items-center gap-2 text-xs">
                  {check.valid ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <div className="h-3.5 w-3.5 rounded-full border border-gray-300" />
                  )}
                  <span className={check.valid ? "text-green-700" : "text-gray-500"}>{check.label}</span>
                </div>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={!allValid || loading}
            className="w-full bg-indigo-600 text-white py-2.5 rounded-lg font-semibold text-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Cambiando contraseña..." : "Cambiar Contraseña"}
          </button>
        </form>
      </div>
    </div>
  );
}
