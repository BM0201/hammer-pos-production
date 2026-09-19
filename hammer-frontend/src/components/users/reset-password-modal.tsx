"use client";

import { useCallback, useState } from "react";
import { KeyRound, X, Check, Eye, EyeOff, Copy, Info, AlertTriangle, Loader2 } from "lucide-react";
import { copyTextToClipboard } from "@/lib/client/clipboard";
import type { UserRow } from "@/components/users/users-admin";

/**
 * Fase 5 (prompt-flujo-velocidad.md): extraído de users-admin.tsx para
 * poder cargarlo con next/dynamic — solo se monta al abrir el reseteo de
 * contraseña de un usuario, no en cada visita a Usuarios & Roles.
 */
export function ResetPasswordModal({
  user,
  open,
  onClose,
  onConfirm,
  loading,
  tempPassword,
}: {
  user: UserRow;
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  loading: boolean;
  tempPassword: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const copyToClipboard = useCallback(async (pwd: string) => {
    await copyTextToClipboard(pwd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-md bg-[var(--color-surface)] rounded-xl shadow-2xl border border-[var(--color-border)] animate-fade-in overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-warning-100)]">
              <KeyRound className="h-5 w-5 text-[var(--color-warning-700)]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[var(--color-text)]">Resetear Contraseña</h3>
              <p className="text-xs text-[var(--color-text-muted)]">Usuario: {user.username}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--color-text-soft)] hover:text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] transition-colors"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {tempPassword ? (
            <>
              <div className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800 flex items-start gap-2">
                <Check className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <p>Contraseña restablecida. Copia y comparte esta contraseña temporal con el usuario.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                  Contraseña temporal (solo visible ahora):
                </label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={tempPassword}
                      readOnly
                      className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2.5 pr-10 text-sm font-mono tracking-wider select-all focus:ring-2 focus:ring-[var(--color-master-500)] focus:border-[var(--color-master-500)]"
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-soft)] hover:text-[var(--color-text-muted)] transition-colors p-1"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(tempPassword)}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                      copied
                        ? "bg-[var(--color-success-50)] text-[var(--color-success-700)] border border-green-300"
                        : "bg-[var(--color-master-600)] text-white hover:bg-[var(--color-master-700)]"
                    }`}
                    title="Copiar al portapapeles"
                  >
                    {copied ? (
                      <><Check className="h-4 w-4" /><span>¡Copiado!</span></>
                    ) : (
                      <><Copy className="h-4 w-4" /><span>Copiar</span></>
                    )}
                  </button>
                </div>
              </div>
              <div className="rounded-lg border border-[var(--color-info-300)] bg-[var(--color-info-50)] p-3 text-sm text-[var(--color-info-700)] flex items-start gap-2">
                <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <p>Al iniciar sesión con esta contraseña, el usuario será obligado a crear una contraseña personal y segura.</p>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] p-3 text-sm text-[var(--color-warning-700)] flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <p>Se generará una contraseña temporal única para este usuario. El usuario deberá cambiarla en su próximo inicio de sesión.</p>
              </div>
              <div className="rounded-lg border border-[var(--color-info-300)] bg-[var(--color-info-50)] p-3 text-sm text-[var(--color-info-700)] flex items-start gap-2">
                <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <p>La contraseña temporal solo se mostrará una vez al confirmar. Tendrás que copiarla y comunicársela al usuario.</p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--color-border)] bg-[var(--color-surface-alt)]">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] transition-colors disabled:opacity-50"
          >
            {tempPassword ? "Cerrar" : "Cancelar"}
          </button>
          {!tempPassword && (
            <button
              type="button"
              onClick={() => onConfirm()}
              disabled={loading}
              className="flex items-center gap-2 rounded-lg bg-[var(--color-warning-600)] px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
            >
              {loading ? (
                <><Loader2 className="h-4 w-4 animate-spin" />Reseteando...</>
              ) : (
                <><KeyRound className="h-4 w-4" />Confirmar Reset</>
              )}
            </button>
          )}
        </div>
      </div>

    </div>
  );
}
