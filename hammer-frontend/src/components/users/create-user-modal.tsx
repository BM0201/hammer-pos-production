"use client";

import { useCallback, useState } from "react";
import { UserPlus, X, Check, Eye, EyeOff, Copy, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyTextToClipboard } from "@/lib/client/clipboard";
import { RolePresetPicker, USER_ROLE_PRESETS } from "@/components/users/users-admin";
import type { CreateFormState, BranchOption, MembershipRole, UserRolePreset } from "@/components/users/users-admin";

/**
 * Fase 5 (prompt-flujo-velocidad.md): extraído de users-admin.tsx para
 * poder cargarlo con next/dynamic — mismo comportamiento, solo movido.
 */
export function CreateUserModal({
  open,
  onClose,
  form,
  setForm,
  branches,
  creating,
  onSubmit,
  selectedBranch,
  selectedPreset,
  isRoleAvailable,
  arePresetRolesAvailable,
  tempPassword,
}: {
  open: boolean;
  onClose: () => void;
  form: CreateFormState;
  setForm: React.Dispatch<React.SetStateAction<CreateFormState>>;
  branches: BranchOption[];
  creating: boolean;
  onSubmit: (event: React.FormEvent) => void;
  selectedBranch: BranchOption | null;
  selectedPreset: (typeof USER_ROLE_PRESETS)[number];
  isRoleAvailable: (branch: BranchOption | null, role: MembershipRole) => boolean;
  arePresetRolesAvailable: (branch: BranchOption | null, preset: (typeof USER_ROLE_PRESETS)[number]) => boolean;
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
      <div className="relative z-10 w-full max-w-2xl bg-[var(--color-surface)] rounded-xl shadow-2xl border border-[var(--color-border)] animate-fade-in overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-info-100)]">
              <UserPlus className="h-5 w-5 text-[var(--color-info-700)]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[var(--color-text)]">Crear usuario</h3>
              <p className="text-xs text-[var(--color-text-muted)]">
                La contraseña temporal se genera automáticamente y se mostrará al crear.
              </p>
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

        <form onSubmit={onSubmit}>
          {/* Body */}
          <div className="px-6 py-5 space-y-3 max-h-[70vh] overflow-y-auto">
            {tempPassword ? (
              /* Success state - show temp password */
              <>
                <div className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800 flex items-start gap-2">
                  <Check className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <p><strong>Usuario creado exitosamente.</strong> Copia esta contraseña temporal y compártela con el usuario.</p>
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
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
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
                    >
                      {copied ? (
                        <>
                          <Check className="h-4 w-4" />
                          Copiada
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4" />
                          Copiar
                        </>
                      )}
                    </button>
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] p-3 text-sm text-[var(--color-warning-700)] flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <p>El usuario deberá cambiar esta contraseña en su primer inicio de sesión.</p>
                </div>
              </>
            ) : (
              /* Form state - create user */
              <>
              <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Usuario *</span>
                <input
                  className="hm-input rounded-lg text-sm"
                  placeholder="ej. jperez"
                  value={form.username}
                  onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
                  required minLength={3} autoComplete="off"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Nombre completo *</span>
                <input
                  className="hm-input rounded-lg text-sm"
                  placeholder="Juan Pérez"
                  value={form.fullName}
                  onChange={(e) => setForm((prev) => ({ ...prev, fullName: e.target.value }))}
                  required minLength={2}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Correo</span>
                <input
                  className="hm-input rounded-lg text-sm"
                  placeholder="opcional"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Rol global</span>
                <select
                  className="hm-input rounded-lg text-sm"
                  value={form.globalRole}
                  onChange={(e) => setForm((prev) => ({ ...prev, globalRole: e.target.value }))}
                >
                  <option value="">Sin rol global</option>
                  <option value="MASTER">MASTER</option>
                  <option value="ACCOUNTANT">CONTADOR</option>
                </select>
              </label>
            </div>

            {form.globalRole !== "MASTER" && form.globalRole !== "ACCOUNTANT" ? (
              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Sucursal inicial *</span>
                    <select
                      className="hm-input rounded-lg text-sm"
                      value={form.branchId}
                      onChange={(e) => setForm((prev) => ({ ...prev, branchId: e.target.value }))}
                      required disabled={branches.length === 0}
                    >
                      {branches.length === 0 && <option value="">No hay sucursales disponibles</option>}
                      {branches.map((branch) => (
                        <option key={branch.id} value={branch.id} disabled={!branch.isActive}>
                          {branch.code} · {branch.name}{branch.isActive ? "" : " (Inactiva)"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Tipo de usuario *</span>
                    <select
                      className="hm-input rounded-lg text-sm"
                      value={form.rolePreset}
                      onChange={(e) => setForm((prev) => ({ ...prev, rolePreset: e.target.value as UserRolePreset }))}
                    >
                      {USER_ROLE_PRESETS.map((preset) => (
                        <option key={preset.value} value={preset.value} disabled={!arePresetRolesAvailable(selectedBranch, preset)}>
                          {preset.label}{arePresetRolesAvailable(selectedBranch, preset) ? "" : " (No disponible)"}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <RolePresetPicker preset={selectedPreset} branch={selectedBranch} isRoleAvailable={isRoleAvailable} />
              </div>
            ) : (
              <div className="rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] p-3 text-sm text-[var(--color-warning-700)]">
                {form.globalRole === "ACCOUNTANT"
                  ? "CONTADOR es un rol global de solo contabilidad: podrá ver únicamente el área de Finanzas & Contabilidad (todas las sucursales), sin acceso al resto del sistema. No requiere sucursal."
                  : "MASTER es un rol global. Si también necesita operar en una sucursal concreta, podrás agregarle membresías desde el panel de edición."}
              </div>
            )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--color-border)] bg-[var(--color-surface-alt)]">
            {tempPassword ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-[var(--color-master-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-master-700)] transition-colors"
              >
                Cerrar
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={creating}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <Button
                  type="submit"
                  loading={creating}
                  disabled={
                    form.globalRole !== "MASTER" && form.globalRole !== "ACCOUNTANT" &&
                    (branches.length === 0 || !arePresetRolesAvailable(selectedBranch, selectedPreset))
                  }
                  icon={<UserPlus className="h-4 w-4" />}
                >
                  Crear usuario
                </Button>
              </>
            )}
          </div>
        </form>
      </div>

    </div>
  );
}
