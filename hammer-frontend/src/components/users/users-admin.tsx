"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  ShieldAlert,
  UserPlus,
  KeyRound,
  Link2,
  UserRoundCheck,
  X,
  Copy,
  Check,
  Eye,
  EyeOff,
  Search,
  AlertTriangle,
  Info,
  Trash2,
  Pencil,
  Save,
  Table2,
  LayoutList,
  ShieldCheck,
} from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { fmtDate } from "@/lib/format";
import toast from "react-hot-toast";

// Las contraseñas temporales las genera el servidor de forma única por usuario.

type MembershipRole = "BRANCH_ADMIN" | "SALES" | "CASHIER" | "WAREHOUSE";
type BranchOption = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  roleAvailability?: Record<MembershipRole, boolean>;
};
type MembershipRow = {
  id: string;
  branchId: string;
  roleCode: MembershipRole;
  isActive: boolean;
  branch: { code: string; name: string };
};
type UserRow = {
  id: string;
  username: string;
  email: string;
  fullName: string;
  isActive: boolean;
  globalRole: "MASTER" | "ACCOUNTANT" | null;
  mustChangePassword?: boolean;
  createdAt: string;
  userBranchRoles: MembershipRow[];
};

type CreateFormState = {
  username: string;
  fullName: string;
  email: string;
  globalRole: string;
  branchId: string;
  rolePreset: UserRolePreset;
};

const ROLE_LABEL: Record<string, string> = {
  BRANCH_ADMIN: "Administrador sucursal",
  SALES: "Ventas",
  CASHIER: "Caja",
  WAREHOUSE: "Despacho / Bodega",
};

// Resumen informativo por rol — mantener alineado con hammer-api/src/modules/rbac/policies.ts (ROLE_CAPABILITIES).
const ROLE_CAPABILITY_HINTS: Record<MembershipRole, string[]> = {
  SALES: [
    "Crea ventas, borradores y cotizaciones",
    "Envía órdenes a caja para cobro",
    "Ve su historial de ventas",
  ],
  CASHIER: [
    "Cobra pagos y emite recibos",
    "Abre y cierra caja",
    "Registra movimientos de caja y facturas manuales",
    "Ejecuta devoluciones y cancelaciones aprobadas",
  ],
  WAREHOUSE: [
    "Despacha órdenes",
    "Ajusta y registra movimientos de inventario",
    "Gestiona inventario dañado",
  ],
  BRANCH_ADMIN: [
    "Aprueba devoluciones, cancelaciones y movimientos de caja",
    "Concilia caja y cierra el día operativo",
    "Ve finanzas, reportes y auditoría de su sucursal",
    "Opera POS y caja como cualquier operador",
  ],
};

const USER_ROLE_PRESETS = [
  {
    value: "SALES",
    label: "Vendedor",
    description: "Crea ventas, cotizaciones/ordenes y las envia a cobro.",
    roles: ["SALES"] as MembershipRole[],
  },
  {
    value: "CASHIER",
    label: "Cajero",
    description: "Cobra pagos, opera caja y registra documentos de cobro.",
    roles: ["CASHIER"] as MembershipRole[],
  },
  {
    value: "WAREHOUSE",
    label: "Despachador / Bodega",
    description: "Despacha ordenes, mueve inventario y opera produccion.",
    roles: ["WAREHOUSE"] as MembershipRole[],
  },
  {
    value: "BRANCH_ADMIN",
    label: "Administrador de sucursal",
    description: "Supervisa la sucursal, aprobaciones, reportes y auditoria.",
    roles: ["BRANCH_ADMIN"] as MembershipRole[],
  },
  {
    value: "SALES_CASHIER",
    label: "Vendedor + Cajero",
    description: "Perfil mixto para sucursales pequenas: vende y cobra.",
    roles: ["SALES", "CASHIER"] as MembershipRole[],
  },
  {
    value: "BRANCH_OPERATOR",
    label: "Operador completo de sucursal",
    description: "Vende, cobra, despacha y administra operaciones del local.",
    roles: ["BRANCH_ADMIN", "SALES", "CASHIER", "WAREHOUSE"] as MembershipRole[],
  },
] as const;

type UserRolePreset = (typeof USER_ROLE_PRESETS)[number]["value"];

function getRolePreset(value: UserRolePreset) {
  return USER_ROLE_PRESETS.find((preset) => preset.value === value) ?? USER_ROLE_PRESETS[0];
}

function getErrorMessage(
  payload?: { message?: string; reason?: string; error?: unknown },
  fallback?: string,
) {
  if (payload) {
    if (typeof payload.message === "string") return payload.message;
    if (typeof payload.reason === "string") return payload.reason;
    // Envelope estándar del API: { ok: false, error: { code, message } }
    if (typeof payload.error === "string") return payload.error;
    if (
      payload.error && typeof payload.error === "object" &&
      typeof (payload.error as { message?: unknown }).message === "string"
    ) {
      return (payload.error as { message: string }).message;
    }
  }
  return fallback ?? "No se pudo completar la operación.";
}

async function copyTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
}

/**
 * apiFetch con un reintento único ante 429: espera lo que indique Retry-After
 * (acotado a 70 s) y repite. Pensado para las acciones masivas, que disparan
 * una mutación por usuario y pueden rozar el límite de 60/min del API.
 */
async function apiFetchWithRateLimitRetry(
  url: string,
  options: Parameters<typeof apiFetch>[1],
): Promise<Response> {
  const res = await apiFetch(url, options);
  if (res.status !== 429) return res;

  const retryAfter = Number(res.headers.get("Retry-After"));
  const waitSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 70) : 61;
  await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
  return apiFetch(url, options);
}

// ─────────────────────────────────────────────────────────────────────────────
// Role Preset Picker — descripción de perfil + badges con preview de permisos
// ─────────────────────────────────────────────────────────────────────────────
function RolePresetPicker({
  preset,
  branch,
  isRoleAvailable,
}: {
  preset: (typeof USER_ROLE_PRESETS)[number];
  branch: BranchOption | null;
  isRoleAvailable: (branch: BranchOption | null, role: MembershipRole) => boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-2.5 text-xs text-[var(--color-text-secondary)]">
      {preset.description}
      <div className="mt-1.5 flex flex-wrap gap-1">
        {preset.roles.map((role) => {
          const available = isRoleAvailable(branch, role);
          return (
            <span
              key={role}
              className={`group relative inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.5625rem] font-semibold border ${
                available
                  ? "bg-[var(--color-info-50)] text-[var(--color-info-700)] border-[var(--color-info-200)]"
                  : "bg-[var(--color-warning-50)] text-[var(--color-warning-700)] border-[var(--color-warning-200)]"
              }`}
            >
              {ROLE_LABEL[role]}{available ? "" : " · deshabilitado"}
              <Info className="h-2.5 w-2.5 cursor-help" />
              <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden w-56 -translate-x-1/2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 text-left text-[0.6875rem] font-normal normal-case text-[var(--color-text-secondary)] shadow-lg group-hover:block">
                <span className="block font-semibold text-[var(--color-text)]">{ROLE_LABEL[role]}</span>
                <ul className="mt-1 list-disc space-y-0.5 pl-3.5">
                  {ROLE_CAPABILITY_HINTS[role].map((hint) => (
                    <li key={hint}>{hint}</li>
                  ))}
                </ul>
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create User Modal (with temp password display after creation)
// ─────────────────────────────────────────────────────────────────────────────
function CreateUserModal({
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

// ─────────────────────────────────────────────────────────────────────────────
// Bulk Password Reset Result Modal — muestra las contraseñas generadas una vez
// ─────────────────────────────────────────────────────────────────────────────
type BulkResetResult = { username: string; fullName: string; tempPassword: string };

function BulkResetResultModal({
  results,
  onClose,
}: {
  results: BulkResetResult[];
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copyAll = useCallback(async () => {
    await copyTextToClipboard(results.map((row) => `${row.username}: ${row.tempPassword}`).join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }, [results]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-lg bg-[var(--color-surface)] rounded-xl shadow-2xl border border-[var(--color-border)] animate-fade-in overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-warning-100)]">
              <KeyRound className="h-5 w-5 text-[var(--color-warning-700)]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[var(--color-text)]">Contraseñas temporales generadas</h3>
              <p className="text-xs text-[var(--color-text-muted)]">{results.length} usuario{results.length !== 1 ? "s" : ""}</p>
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
        <div className="px-6 py-5 space-y-3">
          <div className="rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] p-3 text-sm text-[var(--color-warning-700)] flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <p>Estas contraseñas solo se muestran una vez. Cópialas y compártelas con cada usuario; deberán cambiarlas en su próximo inicio de sesión.</p>
          </div>
          <div className="max-h-[40vh] overflow-y-auto rounded-lg border border-[var(--color-border)]">
            <table className="hm-table w-full">
              <thead>
                <tr>
                  <th className="text-left">Usuario</th>
                  <th className="text-left">Nombre</th>
                  <th className="text-left">Contraseña temporal</th>
                </tr>
              </thead>
              <tbody>
                {results.map((row) => (
                  <tr key={row.username}>
                    <td className="font-mono">{row.username}</td>
                    <td>{row.fullName}</td>
                    <td className="font-mono tracking-wider select-all">{row.tempPassword}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--color-border)] bg-[var(--color-surface-alt)]">
          <button
            type="button"
            onClick={copyAll}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 ${
              copied
                ? "bg-[var(--color-success-50)] text-[var(--color-success-700)] border border-green-300"
                : "bg-[var(--color-master-600)] text-white hover:bg-[var(--color-master-700)]"
            }`}
          >
            {copied ? (
              <><Check className="h-4 w-4" /><span>¡Copiado!</span></>
            ) : (
              <><Copy className="h-4 w-4" /><span>Copiar todo</span></>
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Password Reset Confirmation Modal
// ─────────────────────────────────────────────────────────────────────────────
function ResetPasswordModal({
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

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
export function UsersAdmin() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [branchFilterId, setBranchFilterId] = useState<string>("");
  const [tableView, setTableView] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createTempPassword, setCreateTempPassword] = useState<string | null>(null);

  // Bulk actions (vista tabla)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState<"deactivate" | "reset" | null>(null);
  const [bulkResetResults, setBulkResetResults] = useState<BulkResetResult[] | null>(null);

  const [initialLoading, setInitialLoading] = useState(true);
  const [creatingUser, setCreatingUser] = useState(false);
  const [savingUser, setSavingUser] = useState(false);
  const [assigningMembership, setAssigningMembership] = useState(false);
  const [deletingUser, setDeletingUser] = useState(false);
  const [updatingMembership, setUpdatingMembership] = useState<Record<string, boolean>>({});
  const [removingMembership, setRemovingMembership] = useState<Record<string, boolean>>({});
  const [, setResettingPassword] = useState(false);
  const [, setTogglingActiveState] = useState(false);

  // Password reset modal
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetModalLoading, setResetModalLoading] = useState(false);
  const [resetTempPassword, setResetTempPassword] = useState<string | null>(null);

  // Username editing
  const [editingUsername, setEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [savingUsername, setSavingUsername] = useState(false);

  // Full name editing
  const [editingFullName, setEditingFullName] = useState(false);
  const [newFullName, setNewFullName] = useState("");
  const [savingFullName, setSavingFullName] = useState(false);

  // Email editing
  const [editingEmail, setEditingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);

  // Global role editing
  const [confirmGlobalRoleChange, setConfirmGlobalRoleChange] = useState<"promote" | "demote" | null>(null);
  const [savingGlobalRole, setSavingGlobalRole] = useState(false);

  // Inline confirmations (replaces confirm() dialogs)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [confirmRemoveMembershipId, setConfirmRemoveMembershipId] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState<CreateFormState>({
    username: "",
    fullName: "",
    email: "",
    globalRole: "",
    branchId: "",
    rolePreset: "SALES" as UserRolePreset,
  });
  const [membershipForm, setMembershipForm] = useState<{ branchId: string; rolePreset: UserRolePreset }>({
    branchId: "",
    rolePreset: "SALES",
  });

  const selectedUser = useMemo(() => users.find((item) => item.id === selectedUserId) ?? null, [users, selectedUserId]);
  const selectedCreateBranch = useMemo(
    () => branches.find((branch) => branch.id === createForm.branchId) ?? null,
    [branches, createForm.branchId],
  );
  const selectedMembershipBranch = useMemo(
    () => branches.find((branch) => branch.id === membershipForm.branchId) ?? null,
    [branches, membershipForm.branchId],
  );
  const selectedCreatePreset = useMemo(() => getRolePreset(createForm.rolePreset), [createForm.rolePreset]);
  const selectedMembershipPreset = useMemo(() => getRolePreset(membershipForm.rolePreset), [membershipForm.rolePreset]);

  const isRoleAvailable = useCallback((branch: BranchOption | null, role: MembershipRole) => {
    if (!branch?.isActive) return false;
    return branch.roleAvailability?.[role] ?? true;
  }, []);

  const arePresetRolesAvailable = useCallback(
    (branch: BranchOption | null, preset: (typeof USER_ROLE_PRESETS)[number]) =>
      Boolean(branch?.isActive) && preset.roles.every((role) => isRoleAvailable(branch, role)),
    [isRoleAvailable],
  );

  // Filter users by search query + active membership in selected branch (AND lógico)
  const filteredUsers = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return users.filter((u) => {
      if (branchFilterId && !u.userBranchRoles.some((m) => m.branchId === branchFilterId && m.isActive)) {
        return false;
      }
      if (!q) return true;
      return (
        u.username.toLowerCase().includes(q) ||
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
      );
    });
  }, [users, searchQuery, branchFilterId]);

  const hasListFilters = Boolean(searchQuery.trim() || branchFilterId);

  // KPIs derivados de `users` ya cargado — sin llamadas extra a la API
  const kpis = useMemo(
    () => ({
      total: users.length,
      active: users.filter((u) => u.isActive).length,
      withoutMemberships: users.filter((u) => u.userBranchRoles.length === 0 && !u.globalRole).length,
      pendingPasswordChange: users.filter((u) => u.mustChangePassword).length,
    }),
    [users],
  );

  const allFilteredSelected = filteredUsers.length > 0 && filteredUsers.every((u) => selectedIds.has(u.id));

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(allFilteredSelected ? new Set() : new Set(filteredUsers.map((u) => u.id)));
  }, [allFilteredSelected, filteredUsers]);

  async function load() {

    const response = await fetch("/api/master/users", { cache: "no-store" });
    const json = (await response.json()) as {
      data?: { users?: UserRow[]; branches?: BranchOption[] };
      message?: string;
      reason?: string;
      error?: string;
    };

    if (!response.ok) {
      throw new Error(getErrorMessage(json, "No se pudieron cargar los usuarios."));
    }

    const nextUsers = json.data?.users ?? [];
    const nextBranches = json.data?.branches ?? [];
    setUsers(nextUsers);
    setBranches(nextBranches);

    setSelectedUserId((prev) => {
      if (prev && nextUsers.some((user) => user.id === prev)) return prev;
      return nextUsers[0]?.id ?? "";
    });

    setMembershipForm((prev) => ({
      ...prev,
      branchId: prev.branchId && nextBranches.some((branch) => branch.id === prev.branchId)
        ? prev.branchId
        : nextBranches.find((branch) => branch.isActive)?.id ?? nextBranches[0]?.id ?? "",
    }));
    setCreateForm((prev) => ({
      ...prev,
      branchId: prev.branchId && nextBranches.some((branch) => branch.id === prev.branchId)
        ? prev.branchId
        : nextBranches.find((branch) => branch.isActive)?.id ?? nextBranches[0]?.id ?? "",
    }));
  }

  const sortedMemberships = useMemo(() => {
    if (!selectedUser) return [];

    return [...selectedUser.userBranchRoles].sort((a, b) => {
      const branchCompare = a.branch.code.localeCompare(b.branch.code);
      if (branchCompare !== 0) return branchCompare;
      return a.roleCode.localeCompare(b.roleCode);
    });
  }, [selectedUser]);

  useEffect(() => {
    setInitialLoading(true);
    load()
      .catch((error) => toast.error(error instanceof Error ? error.message : "No se pudo inicializar usuarios."))
      .finally(() => setInitialLoading(false));
  }, []);

  // Al cambiar de usuario seleccionado, descartar ediciones/confirmaciones en curso
  useEffect(() => {
    setEditingUsername(false);
    setEditingFullName(false);
    setEditingEmail(false);
    setConfirmGlobalRoleChange(null);
    setConfirmDeactivate(false);
  }, [selectedUserId]);

  /* Feedback now handled by react-hot-toast */

  async function createUser(event: React.FormEvent) {
    event.preventDefault();

    // Client-side validation
    if (createForm.username.trim().length < 3) {
      toast.error("El nombre de usuario debe tener al menos 3 caracteres.");
      return;
    }
    if (createForm.fullName.trim().length < 2) {
      toast.error("El nombre completo es obligatorio.");
      return;
    }
    const isGlobalRoleSel = createForm.globalRole === "MASTER" || createForm.globalRole === "ACCOUNTANT";
    if (!isGlobalRoleSel && !createForm.branchId) {
      toast.error("Selecciona una sucursal para el rol operativo del usuario.");
      return;
    }
    if (!isGlobalRoleSel && !arePresetRolesAvailable(selectedCreateBranch, selectedCreatePreset)) {
      toast.error("Ese perfil tiene roles deshabilitados en la sucursal seleccionada.");
      return;
    }

    setCreatingUser(true);
    toast("Creando usuario...");

    try {
      const response = await apiFetch("/api/master/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: createForm.username.trim().toLowerCase(),
          fullName: createForm.fullName.trim(),
          email: createForm.email.trim() || undefined,
          globalRole: isGlobalRoleSel ? createForm.globalRole : undefined,
          memberships: isGlobalRoleSel
            ? []
            : selectedCreatePreset.roles.map((roleCode) => ({ branchId: createForm.branchId, roleCode })),
        }),
      });
      const json = (await response.json()) as { message?: string; reason?: string; error?: string };

      const data = (json as { data?: { id?: string; tempPassword?: string } }).data;
      if (!response.ok) throw new Error(getErrorMessage(json, "No se pudo crear el usuario."));

      const tempPwd = data?.tempPassword ?? "";
      // Mostrar la contraseña en el modal (NO cerrar)
      setCreateTempPassword(tempPwd);
      setCreateForm((prev) => ({ username: "", fullName: "", email: "", globalRole: "", branchId: prev.branchId, rolePreset: "SALES" }));
      await load();
      if (!tempPwd) {
        toast.success("✅ Usuario creado correctamente.");
      }
      // Si hay tempPassword, se muestra en el modal, no en toast
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo crear el usuario.");
    } finally {
      setCreatingUser(false);
    }
  }

  async function saveUser(user: UserRow, updates: { isActive?: boolean; password?: string }, mode: "toggle" | "password") {
    if (mode === "toggle") setTogglingActiveState(true);
    if (mode === "password") setResettingPassword(true);
    setSavingUser(true);

    try {
      const response = await apiFetch(`/api/master/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const json = (await response.json()) as { message?: string; reason?: string; error?: string };

      if (!response.ok) throw new Error(getErrorMessage(json, "No se pudo actualizar el usuario."));

      await load();
      toast.success(mode === "toggle"
          ? `Usuario ${updates.isActive ? "activado" : "desactivado"} correctamente.`
          : "Contraseña restablecida. El usuario deberá cambiarla en su próximo login.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar el usuario.");
    } finally {
      setSavingUser(false);
      if (mode === "toggle") setTogglingActiveState(false);
      if (mode === "password") setResettingPassword(false);
    }
  }

  // Handle modal-based password reset — genera contraseña temporal única en el servidor
  async function handleModalReset() {
    if (!selectedUser) return;
    setResetModalLoading(true);
    try {
      const response = await apiFetch(`/api/master/users/${selectedUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "reset" }),
      });
      const json = await response.json() as { data?: { tempPassword?: string }; message?: string; reason?: string; error?: string };
      if (!response.ok) throw new Error(getErrorMessage(json, "No se pudo resetear la contraseña."));

      const tempPwd = json.data?.tempPassword ?? null;
      setResetTempPassword(tempPwd);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo resetear la contraseña.");
      setResetModalOpen(false);
    } finally {
      setResetModalLoading(false);
    }
  }

  async function handleSaveUsername() {
    if (!selectedUser || !newUsername.trim()) return;
    const trimmed = newUsername.trim().toLowerCase();
    if (trimmed.length < 3) { toast.error("El nombre de usuario debe tener al menos 3 caracteres."); return; }
    if (!/^[a-z0-9._-]+$/.test(trimmed)) { toast.error("Use solo letras, números, punto, guión o guión bajo."); return; }
    if (trimmed === selectedUser.username) { setEditingUsername(false); return; }
    setSavingUsername(true);
    try {
      const response = await apiFetch(`/api/master/users/${selectedUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmed }),
      });
      const json = (await response.json()) as { message?: string; reason?: string; error?: string };
      if (!response.ok) throw new Error(getErrorMessage(json, "No se pudo cambiar el nombre de usuario."));
      await load();
      toast.success(`Nombre de usuario cambiado a "${trimmed}".`);
      setEditingUsername(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cambiar el nombre de usuario.");
    } finally {
      setSavingUsername(false);
    }
  }

  async function handleSaveFullName() {
    if (!selectedUser) return;
    const trimmed = newFullName.trim();
    if (trimmed.length < 2) { toast.error("El nombre completo debe tener al menos 2 caracteres."); return; }
    if (trimmed === selectedUser.fullName) { setEditingFullName(false); return; }
    setSavingFullName(true);
    try {
      const response = await apiFetch(`/api/master/users/${selectedUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: trimmed }),
      });
      const json = (await response.json()) as { message?: string; reason?: string; error?: string };
      if (!response.ok) throw new Error(getErrorMessage(json, "No se pudo cambiar el nombre completo."));
      await load();
      toast.success("✅ Nombre completo actualizado.");
      setEditingFullName(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cambiar el nombre completo.");
    } finally {
      setSavingFullName(false);
    }
  }

  async function handleSaveEmail() {
    if (!selectedUser) return;
    const trimmed = newEmail.trim().toLowerCase();
    // El backend exige correo único no vacío (updateUserSchema); no se puede vaciar una vez asignado
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) { toast.error("Ingresa un correo con formato válido."); return; }
    if (trimmed === selectedUser.email) { setEditingEmail(false); return; }
    setSavingEmail(true);
    try {
      const response = await apiFetch(`/api/master/users/${selectedUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const json = (await response.json()) as { message?: string; reason?: string; error?: string };
      if (!response.ok) throw new Error(getErrorMessage(json, "No se pudo cambiar el correo."));
      await load();
      toast.success("✅ Correo actualizado.");
      setEditingEmail(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cambiar el correo.");
    } finally {
      setSavingEmail(false);
    }
  }

  async function handleSetGlobalRole(user: UserRow, globalRole: "MASTER" | "ACCOUNTANT" | null) {
    setSavingGlobalRole(true);
    try {
      const response = await apiFetch(`/api/master/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ globalRole }),
      });
      const json = (await response.json()) as { message?: string; reason?: string; error?: string };
      if (!response.ok) throw new Error(getErrorMessage(json, "No se pudo actualizar el rol global."));
      await load();
      toast.success("✅ Rol global actualizado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar el rol global.");
    } finally {
      setSavingGlobalRole(false);
      setConfirmGlobalRoleChange(null);
    }
  }

  async function bulkDeactivate() {
    const targets = users.filter((u) => selectedIds.has(u.id) && u.isActive);
    if (targets.length === 0) {
      toast("No hay usuarios activos en la selección.");
      setBulkConfirm(null);
      return;
    }
    setBulkWorking(true);
    let okCount = 0;
    const failures: string[] = [];
    // Mismo endpoint que la desactivación individual — conserva la auditoría por usuario
    for (const user of targets) {
      try {
        const response = await apiFetchWithRateLimitRetry(`/api/master/users/${user.id}`, { method: "DELETE" });
        const json = (await response.json()) as { message?: string; reason?: string; error?: unknown };
        if (!response.ok) throw new Error(getErrorMessage(json, "No se pudo desactivar."));
        okCount += 1;
      } catch (error) {
        failures.push(`@${user.username}: ${error instanceof Error ? error.message : "error desconocido"}`);
      }
    }
    await load().catch(() => undefined);
    setSelectedIds(new Set());
    setBulkConfirm(null);
    setBulkWorking(false);
    if (okCount > 0) {
      toast.success(`✅ ${okCount} usuario${okCount !== 1 ? "s" : ""} desactivado${okCount !== 1 ? "s" : ""}. Sus roles se conservan.`);
    }
    failures.forEach((message) => toast.error(message));
  }

  async function bulkResetPasswords() {
    const targets = users.filter((u) => selectedIds.has(u.id));
    if (targets.length === 0) {
      setBulkConfirm(null);
      return;
    }
    setBulkWorking(true);
    const results: BulkResetResult[] = [];
    const failures: string[] = [];
    // Mismo endpoint que el reset individual — conserva la auditoría por usuario
    for (const user of targets) {
      try {
        const response = await apiFetchWithRateLimitRetry(`/api/master/users/${user.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: "reset" }),
        });
        const json = (await response.json()) as { data?: { tempPassword?: string }; message?: string; reason?: string; error?: unknown };
        if (!response.ok) throw new Error(getErrorMessage(json, "No se pudo resetear la contraseña."));
        results.push({ username: user.username, fullName: user.fullName, tempPassword: json.data?.tempPassword ?? "—" });
      } catch (error) {
        failures.push(`@${user.username}: ${error instanceof Error ? error.message : "error desconocido"}`);
      }
    }
    await load().catch(() => undefined);
    setSelectedIds(new Set());
    setBulkConfirm(null);
    setBulkWorking(false);
    if (results.length > 0) setBulkResetResults(results);
    failures.forEach((message) => toast.error(message));
  }

  async function deactivateUser(user: UserRow) {
    setDeletingUser(true);
    toast("Desactivando usuario...");

    try {
      const response = await apiFetch(`/api/master/users/${user.id}`, { method: "DELETE" });
      const json = (await response.json()) as { message?: string; reason?: string; error?: string };

      if (!response.ok) throw new Error(getErrorMessage(json, "No se pudo desactivar el usuario."));

      await load();
      toast.success("Usuario desactivado correctamente. Sus roles se conservan para reactivarlo despues.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo desactivar el usuario.");
    } finally {
      setDeletingUser(false);
    }
  }

  async function addMembershipPreset(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedUser) return;
    if (!arePresetRolesAvailable(selectedMembershipBranch, selectedMembershipPreset)) {
      toast.error("Ese perfil tiene roles deshabilitados en la sucursal seleccionada.");
      return;
    }

    setAssigningMembership(true);
    toast("Asignando membresias...");

    try {
      for (const roleCode of selectedMembershipPreset.roles) {
        const response = await apiFetch(`/api/master/users/${selectedUser.id}/memberships`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ branchId: membershipForm.branchId, roleCode }),
        });
        const json = (await response.json()) as { message?: string; reason?: string; error?: string };
        if (!response.ok) throw new Error(getErrorMessage(json, "No se pudo asignar la membresia."));
      }

      await load();
      toast.success("Membresia asignada correctamente.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo asignar la membresia.");
    } finally {
      setAssigningMembership(false);
    }
  }

  async function updateMembershipStatus(membershipId: string, isActive: boolean) {
    setUpdatingMembership((prev) => ({ ...prev, [membershipId]: true }));

    try {
      const response = await apiFetch(`/api/master/users/${selectedUserId}/memberships/${membershipId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      const json = (await response.json()) as { message?: string; reason?: string; error?: string };

      if (!response.ok) throw new Error(getErrorMessage(json, "No se pudo editar la membresía."));

      await load();
      toast.success(`✅ Membresía ${isActive ? "activada" : "desactivada"}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo editar la membresía.");
    } finally {
      setUpdatingMembership((prev) => ({ ...prev, [membershipId]: false }));
    }
  }

  async function removeMembership(membershipId: string) {
    setRemovingMembership((prev) => ({ ...prev, [membershipId]: true }));

    try {
      const response = await apiFetch(`/api/master/users/${selectedUserId}/memberships/${membershipId}`, { method: "DELETE" });
      const json = (await response.json()) as { message?: string; reason?: string; error?: string };

      if (!response.ok) throw new Error(getErrorMessage(json, "No se pudo remover la membresía."));

      await load();
      toast.success("✅ Membresía removida.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo remover la membresía.");
    } finally {
      setRemovingMembership((prev) => ({ ...prev, [membershipId]: false }));
    }
  }

  return (
    <section className="space-y-4" data-testid="users-admin-root">
      {/* ── Resumen + Nuevo usuario ── */}
      <div className="hm-module-card">
        <div className="hm-module-card-header">
          <div className="flex items-center gap-2">
            <UserRoundCheck className="h-3.5 w-3.5 text-[var(--color-info-600)]" />
            <span className="font-semibold text-sm text-[var(--color-text)]">Resumen de personal</span>
          </div>
          <Button
            variant="primary"
            size="sm"
            disabled={initialLoading}
            onClick={() => setCreateModalOpen(true)}
            icon={<UserPlus className="h-4 w-4" />}
          >
            Nuevo usuario
          </Button>
        </div>
        {/* Franja de KPIs — al hacerse clicables, cada chip aplicaría su filtro rápido correspondiente */}
        <div className="flex flex-wrap gap-2 px-4 py-3">
          <div className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm">
            <span className="font-bold text-[var(--color-text)]">{kpis.total}</span>{" "}
            <span className="text-xs text-[var(--color-text-muted)]">usuarios en total</span>
          </div>
          <div className="rounded-lg border border-[var(--color-success-200)] px-3 py-1.5 text-sm">
            <span className="font-bold text-[var(--color-success-700)]">{kpis.active}</span>{" "}
            <span className="text-xs text-[var(--color-text-muted)]">activos</span>
          </div>
          <div className="rounded-lg border border-[var(--color-danger-200)] px-3 py-1.5 text-sm">
            <span className="font-bold text-[var(--color-danger-600)]">{kpis.withoutMemberships}</span>{" "}
            <span className="text-xs text-[var(--color-text-muted)]">sin membresías</span>
          </div>
          <div className="rounded-lg border border-[var(--color-warning-200)] px-3 py-1.5 text-sm">
            <span className="font-bold text-[var(--color-warning-700)]">{kpis.pendingPasswordChange}</span>{" "}
            <span className="text-xs text-[var(--color-text-muted)]">pendientes de cambio de clave</span>
          </div>
        </div>
      </div>

      <CreateUserModal
        open={createModalOpen}
        onClose={() => {
          setCreateModalOpen(false);
          setCreateTempPassword(null);
        }}
        form={createForm}
        setForm={setCreateForm}
        branches={branches}
        creating={creatingUser}
        onSubmit={createUser}
        selectedBranch={selectedCreateBranch}
        selectedPreset={selectedCreatePreset}
        isRoleAvailable={isRoleAvailable}
        arePresetRolesAvailable={arePresetRolesAvailable}
        tempPassword={createTempPassword}
      />

      {bulkResetResults && (
        <BulkResetResultModal results={bulkResetResults} onClose={() => setBulkResetResults(null)} />
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.35fr]">
        {/* ── Users List ── */}
        <div className="hm-module-card">
          <div className="hm-module-card-header">
            <span className="font-semibold text-sm text-[var(--color-text)]">
              Usuarios{!initialLoading && ` (${filteredUsers.length}${hasListFilters ? ` de ${users.length}` : ""})`}
            </span>
          </div>
          <div className="p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[180px] flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-soft)]" />
                <input
                  type="text"
                  placeholder="Buscar por usuario, nombre o correo..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="hm-input w-full rounded-lg pl-8 text-sm"
                />
              </div>
              <select
                className="hm-input rounded-lg text-sm"
                value={branchFilterId}
                onChange={(e) => setBranchFilterId(e.target.value)}
                aria-label="Filtrar por sucursal"
              >
                <option value="">Todas las sucursales</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.code} · {branch.name}{branch.isActive ? "" : " (Inactiva)"}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant={tableView ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setTableView((v) => !v)}
                icon={tableView ? <LayoutList className="h-4 w-4" /> : <Table2 className="h-4 w-4" />}
                title={tableView ? "Cambiar a vista de tarjetas" : "Cambiar a vista de tabla"}
              >
                Tabla
              </Button>
            </div>

            {initialLoading ? (
              <div className="py-8 text-center text-sm text-[var(--color-text-soft)]">
                <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2 text-[var(--color-info-500)]" />
                Cargando usuarios...
              </div>
            ) : tableView ? (
              <div className="space-y-2">
                {selectedIds.size > 0 && (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-info-200)] bg-[var(--color-info-50)] px-3 py-2 text-sm">
                    {bulkConfirm === "deactivate" ? (
                      <>
                        <AlertTriangle className="h-4 w-4 flex-shrink-0 text-[var(--color-danger-700)]" />
                        <span className="text-[var(--color-danger-700)]">
                          ¿Desactivar <strong>{selectedIds.size}</strong> usuario{selectedIds.size !== 1 ? "s" : ""}? Se cierran sus sesiones; sus roles se conservan.
                        </span>
                        <Button variant="danger" size="sm" loading={bulkWorking} onClick={bulkDeactivate}>Confirmar</Button>
                        <Button variant="ghost" size="sm" disabled={bulkWorking} onClick={() => setBulkConfirm(null)}>Cancelar</Button>
                      </>
                    ) : bulkConfirm === "reset" ? (
                      <>
                        <KeyRound className="h-4 w-4 flex-shrink-0 text-[var(--color-warning-700)]" />
                        <span className="text-[var(--color-warning-700)]">
                          ¿Resetear la clave de <strong>{selectedIds.size}</strong> usuario{selectedIds.size !== 1 ? "s" : ""}? Se generarán contraseñas temporales nuevas.
                        </span>
                        <Button variant="secondary" size="sm" loading={bulkWorking} onClick={bulkResetPasswords}>Confirmar</Button>
                        <Button variant="ghost" size="sm" disabled={bulkWorking} onClick={() => setBulkConfirm(null)}>Cancelar</Button>
                      </>
                    ) : (
                      <>
                        <span className="font-semibold text-[var(--color-info-700)]">
                          {selectedIds.size} seleccionado{selectedIds.size !== 1 ? "s" : ""}
                        </span>
                        <Button variant="danger" size="sm" onClick={() => setBulkConfirm("deactivate")}>
                          Desactivar seleccionados ({selectedIds.size})
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => setBulkConfirm("reset")}>
                          Resetear clave a seleccionados ({selectedIds.size})
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Limpiar</Button>
                      </>
                    )}
                  </div>
                )}
                <div className="max-h-[32rem] overflow-auto rounded-xl border border-[var(--color-border)]">
                  <table className="hm-table w-full">
                    <thead>
                      <tr>
                        <th className="w-8">
                          <input
                            type="checkbox"
                            checked={allFilteredSelected}
                            onChange={toggleSelectAll}
                            aria-label="Seleccionar todos los usuarios visibles"
                          />
                        </th>
                        <th className="text-left">Usuario</th>
                        <th className="text-left">Sucursal(es)</th>
                        <th className="text-left">Rol(es)</th>
                        <th className="text-left">Estado</th>
                        <th className="text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">
                            {hasListFilters ? "Sin resultados para ese filtro." : "No hay usuarios registrados."}
                          </td>
                        </tr>
                      ) : (
                        filteredUsers.map((user) => {
                          const branchCodes = Array.from(new Set(user.userBranchRoles.map((m) => m.branch.code)));
                          const roleLabels = Array.from(new Set([
                            ...(user.globalRole ? [user.globalRole] : []),
                            ...user.userBranchRoles.map((m) => ROLE_LABEL[m.roleCode] ?? m.roleCode),
                          ]));
                          return (
                            <tr
                              key={user.id}
                              className={`cursor-pointer ${selectedUserId === user.id ? "bg-[var(--color-info-50)]" : ""}`}
                              onClick={() => setSelectedUserId(user.id)}
                            >
                              <td onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(user.id)}
                                  onChange={() => toggleSelected(user.id)}
                                  aria-label={`Seleccionar a ${user.username}`}
                                />
                              </td>
                              <td>
                                <span className="font-semibold text-[var(--color-text)]">{user.username}</span>
                                <span className="block text-[0.6875rem] text-[var(--color-text-muted)]">{user.fullName}</span>
                              </td>
                              <td className="text-xs">
                                {branchCodes.length === 0
                                  ? "—"
                                  : branchCodes.length === 1
                                    ? branchCodes[0]
                                    : `${branchCodes[0]} · +${branchCodes.length - 1}`}
                              </td>
                              <td className="text-xs">
                                {roleLabels.length === 0
                                  ? "—"
                                  : roleLabels.length === 1
                                    ? roleLabels[0]
                                    : `${roleLabels[0]} · +${roleLabels.length - 1}`}
                              </td>
                              <td>
                                <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[0.5rem] font-bold ${
                                  user.isActive
                                    ? "bg-[var(--color-success-100)] text-[var(--color-success-700)]"
                                    : "bg-[var(--color-warning-100)] text-[var(--color-warning-700)]"
                                }`}>
                                  {user.isActive ? "Activo" : "Inactivo"}
                                </span>
                              </td>
                              <td className="text-right">
                                <Button variant="ghost" size="sm" onClick={() => setSelectedUserId(user.id)}>
                                  Ver
                                </Button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <ul className="max-h-[32rem] space-y-1.5 overflow-y-auto pr-0.5">
                {filteredUsers.length === 0 && (
                  <li className="rounded-lg border border-dashed border-[var(--color-border)] p-4 text-sm text-center text-[var(--color-text-muted)]">
                    {hasListFilters ? "Sin resultados para ese filtro." : "No hay usuarios registrados."}
                  </li>
                )}
                {filteredUsers.map((user) => {
                  const isSelected = selectedUserId === user.id;
                  const initials = user.fullName.split(" ").slice(0, 2).map((n) => n[0] ?? "").join("").toUpperCase();
                  return (
                    <li key={user.id}>
                      <button
                        type="button"
                        className={`w-full rounded-xl border p-3 text-left transition-all duration-150 ${
                          isSelected
                            ? "border-[var(--color-info-300)] bg-[var(--color-info-50)] shadow-sm"
                            : "border-[var(--color-border)] hover:bg-[var(--color-surface-alt)] hover:border-[var(--color-info-200)]"
                        }`}
                        onClick={() => { setSelectedUserId(user.id); setEditingUsername(false); }}
                      >
                        <div className="flex items-center gap-2.5">
                          <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-[0.625rem] font-bold ${
                            user.isActive
                              ? "bg-[var(--color-info-100)] text-[var(--color-info-700)]"
                              : "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]"
                          }`}>
                            {initials}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-sm text-[var(--color-text)]">{user.username}</span>
                              <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[0.5rem] font-bold ${
                                user.isActive
                                  ? "bg-[var(--color-success-100)] text-[var(--color-success-700)]"
                                  : "bg-[var(--color-warning-100)] text-[var(--color-warning-700)]"
                              }`}>
                                {user.isActive ? "Activo" : "Inactivo"}
                              </span>
                              {user.mustChangePassword && (
                                <span className="inline-flex rounded-full px-1.5 py-0.5 text-[0.5rem] font-bold bg-[var(--color-warning-100)] text-[var(--color-warning-700)]">
                                  Cambiar clave
                                </span>
                              )}
                            </div>
                            <p className="text-[0.6875rem] text-[var(--color-text-muted)] mt-0.5 truncate">{user.fullName}</p>
                            <p className="text-[0.625rem] text-[var(--color-text-soft)] truncate">
                              {user.globalRole ? <><strong>{user.globalRole}</strong> · </> : ""}{user.userBranchRoles.length} membresía{user.userBranchRoles.length !== 1 ? "s" : ""}
                            </p>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* ── User Detail Panel ── */}
        <div className="hm-module-card">
          <div className="hm-module-card-header">
            <span className="font-semibold text-sm text-[var(--color-text)]">
              {selectedUser ? `Edición — @${selectedUser.username}` : "Edición operativa"}
            </span>
          </div>

          {selectedUser ? (
            <div className="p-4 space-y-4">
              {/* User info */}
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-sm grid gap-2 sm:grid-cols-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Usuario</span>
                  {editingUsername ? (
                    <div className="flex items-center gap-1 flex-1">
                      <input
                        className="hm-input h-7 text-sm flex-1 max-w-[160px] rounded-lg"
                        value={newUsername}
                        onChange={(e) => setNewUsername(e.target.value.toLowerCase())}
                        placeholder="nuevo usuario..."
                        disabled={savingUsername}
                      />
                      <Button variant="success" size="sm" onClick={handleSaveUsername} loading={savingUsername} disabled={!newUsername.trim()} icon={<Save className="h-3 w-3" />}>
                        Guardar
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditingUsername(false)} disabled={savingUsername} icon={<X className="h-3 w-3" />}>
                        Cancelar
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <span className="font-mono font-medium text-[var(--color-text)]">{selectedUser.username}</span>
                      <button
                        type="button"
                        className="hm-icon-btn h-5 w-5"
                        title="Cambiar nombre de usuario"
                        onClick={() => { setNewUsername(selectedUser.username); setEditingUsername(true); }}
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Nombre</span>
                  {editingFullName ? (
                    <div className="flex items-center gap-1 flex-1">
                      <input
                        className="hm-input h-7 text-sm flex-1 max-w-[200px] rounded-lg"
                        value={newFullName}
                        onChange={(e) => setNewFullName(e.target.value)}
                        placeholder="nombre completo..."
                        disabled={savingFullName}
                      />
                      <Button variant="success" size="sm" onClick={handleSaveFullName} loading={savingFullName} disabled={!newFullName.trim()} icon={<Save className="h-3 w-3" />}>
                        Guardar
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditingFullName(false)} disabled={savingFullName} icon={<X className="h-3 w-3" />}>
                        Cancelar
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <span className="text-[var(--color-text)]">{selectedUser.fullName}</span>
                      <button
                        type="button"
                        className="hm-icon-btn h-5 w-5"
                        title="Cambiar nombre completo"
                        onClick={() => { setNewFullName(selectedUser.fullName); setEditingFullName(true); }}
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap sm:col-span-2">
                  <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Correo</span>
                  {editingEmail ? (
                    <div className="flex items-center gap-1 flex-1">
                      <input
                        className="hm-input h-7 text-sm flex-1 max-w-[240px] rounded-lg"
                        type="email"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value.toLowerCase())}
                        placeholder="correo@ejemplo.com"
                        disabled={savingEmail}
                      />
                      <Button variant="success" size="sm" onClick={handleSaveEmail} loading={savingEmail} disabled={!newEmail.trim()} icon={<Save className="h-3 w-3" />}>
                        Guardar
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditingEmail(false)} disabled={savingEmail} icon={<X className="h-3 w-3" />}>
                        Cancelar
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <span className="text-[var(--color-text)]">{selectedUser.email || "—"}</span>
                      <button
                        type="button"
                        className="hm-icon-btn h-5 w-5"
                        title="Cambiar correo"
                        onClick={() => { setNewEmail(selectedUser.email); setEditingEmail(true); }}
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap sm:col-span-2">
                  <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Rol global</span>
                  {selectedUser.globalRole === "MASTER" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-warning-100)] px-2 py-0.5 text-[0.625rem] font-bold text-[var(--color-warning-700)]">
                      <ShieldCheck className="h-3 w-3" /> MASTER
                    </span>
                  ) : selectedUser.globalRole === "ACCOUNTANT" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accountant-100)] px-2 py-0.5 text-[0.625rem] font-bold text-[var(--color-accountant-700)]">
                      <ShieldCheck className="h-3 w-3" /> CONTADOR
                    </span>
                  ) : (
                    <span className="text-[var(--color-text-muted)]">Sin rol global</span>
                  )}
                  {confirmGlobalRoleChange ? (
                    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-2 py-1 text-xs text-[var(--color-warning-700)]">
                      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                      <span>
                        {confirmGlobalRoleChange === "promote"
                          ? <>¿Dar rol global <strong>MASTER</strong> a @{selectedUser.username}? Tendrá control total del sistema.</>
                          : <>¿Quitar el rol global <strong>{selectedUser.globalRole}</strong> a @{selectedUser.username}?</>}
                      </span>
                      <Button
                        variant="danger"
                        size="sm"
                        loading={savingGlobalRole}
                        onClick={() => handleSetGlobalRole(selectedUser, confirmGlobalRoleChange === "promote" ? "MASTER" : null)}
                      >
                        Confirmar
                      </Button>
                      <Button variant="ghost" size="sm" disabled={savingGlobalRole} onClick={() => setConfirmGlobalRoleChange(null)}>
                        Cancelar
                      </Button>
                    </div>
                  ) : selectedUser.globalRole === "MASTER" || selectedUser.globalRole === "ACCOUNTANT" ? (
                    <Button variant="secondary" size="sm" onClick={() => setConfirmGlobalRoleChange("demote")}>
                      Quitar rol global
                    </Button>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={() => setConfirmGlobalRoleChange("promote")}>
                      Hacer MASTER
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-1.5 sm:col-span-2">
                  <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Clave</span>
                  {selectedUser.mustChangePassword
                    ? <span className="text-[var(--color-warning-700)]">Pendiente de cambio al próximo login</span>
                    : <span className="text-[var(--color-success-700)]">Configurada por el usuario</span>
                  }
                </div>
                {/* TODO: "Último acceso" requiere agregar lastLoginAt al modelo User en hammer-api/prisma/schema.prisma y poblarlo en el login flow */}
                <div className="sm:col-span-2 text-[0.6875rem] text-[var(--color-text-soft)]">
                  Creado el {fmtDate(selectedUser.createdAt)}
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-start gap-2">
                {confirmDeactivate ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                    <span>¿Desactivar a <strong>@{selectedUser.username}</strong>? Se cierran sus sesiones; sus roles se conservan.</span>
                    <Button variant="danger" size="sm" loading={deletingUser} onClick={() => { deactivateUser(selectedUser); setConfirmDeactivate(false); }}>Confirmar</Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDeactivate(false)}>Cancelar</Button>
                  </div>
                ) : selectedUser.isActive ? (
                  <Button type="button" variant="danger" loading={deletingUser} disabled={savingUser} onClick={() => setConfirmDeactivate(true)} icon={<Trash2 className="h-4 w-4" />}>
                    Desactivar
                  </Button>
                ) : (
                  <Button type="button" variant="primary" loading={savingUser} disabled={deletingUser} onClick={() => saveUser(selectedUser, { isActive: true }, "toggle")} icon={<UserRoundCheck className="h-4 w-4" />}>
                    Reactivar
                  </Button>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  disabled={savingUser || resetModalLoading || deletingUser}
                  onClick={() => setResetModalOpen(true)}
                  icon={<KeyRound className="h-4 w-4" />}
                >
                  Resetear contraseña
                </Button>
              </div>

              {/* Membership assignment — oculto para CONTADOR (rol global de solo
                  contabilidad que abarca todas las sucursales; no requiere membresía). */}
              {selectedUser.globalRole === "ACCOUNTANT" ? (
                <div className="rounded-xl border border-[var(--color-accountant-200)] bg-[var(--color-accountant-50)] p-3 text-sm text-[var(--color-accountant-700)] flex items-start gap-2">
                  <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <p>
                    <strong>CONTADOR</strong> es un rol global de solo contabilidad: ve las finanzas de
                    <strong> todas las sucursales</strong>. No requiere ni admite membresías de sucursal.
                  </p>
                </div>
              ) : (
              <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
                <div className="hm-module-card-header">
                  <div className="flex items-center gap-2">
                    <Link2 className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                    <span className="font-semibold text-sm text-[var(--color-text)]">Asignar membresía</span>
                  </div>
                </div>
                <div className="p-3 space-y-2">
                  <form className="grid gap-2 sm:grid-cols-3" onSubmit={addMembershipPreset}>
                    <select
                      className="hm-input rounded-lg text-sm"
                      value={membershipForm.branchId}
                      onChange={(e) => setMembershipForm((prev) => ({ ...prev, branchId: e.target.value }))}
                      required
                    >
                      {branches.map((branch) => (
                        <option key={branch.id} value={branch.id} disabled={!branch.isActive}>
                          {branch.code} · {branch.name}{branch.isActive ? "" : " (Inactiva)"}
                        </option>
                      ))}
                    </select>
                    <select
                      className="hm-input rounded-lg text-sm"
                      value={membershipForm.rolePreset}
                      onChange={(e) => setMembershipForm((prev) => ({ ...prev, rolePreset: e.target.value as UserRolePreset }))}
                    >
                      {USER_ROLE_PRESETS.map((preset) => (
                        <option key={preset.value} value={preset.value} disabled={!arePresetRolesAvailable(selectedMembershipBranch, preset)}>
                          {preset.label}{arePresetRolesAvailable(selectedMembershipBranch, preset) ? "" : " (No disponible)"}
                        </option>
                      ))}
                    </select>
                    <Button type="submit" variant="success" size="sm" loading={assigningMembership} disabled={!membershipForm.branchId || !arePresetRolesAvailable(selectedMembershipBranch, selectedMembershipPreset)}>
                      Asignar perfil
                    </Button>
                  </form>
                  <RolePresetPicker
                    preset={selectedMembershipPreset}
                    branch={selectedMembershipBranch}
                    isRoleAvailable={isRoleAvailable}
                  />
                </div>
              </div>
              )}

              {/* Memberships table — oculta para CONTADOR (no tiene membresías). */}
              {selectedUser.globalRole !== "ACCOUNTANT" && (
              <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
                <div className="hm-card-header-teal px-4 py-3 flex items-center gap-2">
                  <Link2 className="h-4 w-4" />
                  <span className="text-sm font-bold">Membresías asignadas</span>
                  <span className="ml-auto rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-bold">{sortedMemberships.length}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="hm-table w-full">
                    <thead>
                      <tr>
                        <th className="text-left">Sucursal</th>
                        <th className="text-left">Rol</th>
                        <th className="text-left">Estado</th>
                        <th className="text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedMemberships.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">
                            Sin membresías. Asigna una sucursal y perfil arriba.
                          </td>
                        </tr>
                      ) : (
                        sortedMemberships.map((membership) => {
                          const membershipUpdating = updatingMembership[membership.id] ?? false;
                          const membershipRemoving = removingMembership[membership.id] ?? false;
                          const isConfirmingRemove = confirmRemoveMembershipId === membership.id;
                          return (
                            <tr key={membership.id}>
                              <td>{membership.branch.code} · {membership.branch.name}</td>
                              <td>{ROLE_LABEL[membership.roleCode] ?? membership.roleCode}</td>
                              <td>
                                <span className={`inline-flex rounded-full px-2 py-0.5 text-[0.5625rem] font-bold ${
                                  membership.isActive
                                    ? "bg-[var(--color-success-100)] text-[var(--color-success-700)]"
                                    : "bg-[var(--color-warning-100)] text-[var(--color-warning-700)]"
                                }`}>
                                  {membership.isActive ? "Activo" : "Inactivo"}
                                </span>
                              </td>
                              <td className="text-right">
                                {isConfirmingRemove ? (
                                  <div className="flex justify-end items-center gap-1.5">
                                    <span className="text-xs text-[var(--color-danger-700)]">¿Quitar?</span>
                                    <Button variant="danger" size="sm" loading={membershipRemoving} onClick={() => { removeMembership(membership.id); setConfirmRemoveMembershipId(null); }}>
                                      Confirmar
                                    </Button>
                                    <Button variant="ghost" size="sm" onClick={() => setConfirmRemoveMembershipId(null)}>No</Button>
                                  </div>
                                ) : (
                                  <div className="flex justify-end gap-1.5">
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      loading={membershipUpdating}
                                      disabled={membershipRemoving}
                                      type="button"
                                      onClick={() => updateMembershipStatus(membership.id, !membership.isActive)}
                                    >
                                      {membership.isActive ? "Desactivar" : "Activar"}
                                    </Button>
                                    <button
                                      type="button"
                                      className="hm-icon-btn text-[var(--color-danger-600)]"
                                      disabled={membershipRemoving || membershipUpdating}
                                      onClick={() => setConfirmRemoveMembershipId(membership.id)}
                                      title="Quitar membresía"
                                    >
                                      <ShieldAlert className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              )}

              {/* Password Reset Modal */}
              {resetModalOpen && selectedUser && (
                <ResetPasswordModal
                  user={selectedUser}
                  open={resetModalOpen}
                  onClose={() => { setResetModalOpen(false); setResetTempPassword(null); }}
                  onConfirm={handleModalReset}
                  loading={resetModalLoading}
                  tempPassword={resetTempPassword}
                />
              )}
            </div>
          ) : (
            <div className="p-8 flex flex-col items-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)]">
                <UserRoundCheck className="h-5 w-5 text-[var(--color-text-muted)]" />
              </div>
              <p className="text-sm text-[var(--color-text-muted)]">
                Selecciona un usuario para administrar membresías y credenciales.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
