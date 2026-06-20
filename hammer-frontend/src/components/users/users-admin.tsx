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
} from "lucide-react";
import { apiFetch } from "@/lib/client/api";
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
  globalRole: "MASTER" | null;
  mustChangePassword?: boolean;
  userBranchRoles: MembershipRow[];
};

const ROLE_LABEL: Record<string, string> = {
  BRANCH_ADMIN: "Administrador sucursal",
  SALES: "Ventas",
  CASHIER: "Caja",
  WAREHOUSE: "Despacho / Bodega",
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

function getErrorMessage(payload?: { message?: string; reason?: string; error?: string }, fallback?: string) {
  return payload?.message ?? payload?.reason ?? payload?.error ?? fallback ?? "No se pudo completar la operación.";
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
  const [showPassword, setShowPassword] = useState(true);

  const copyToClipboard = useCallback(async (pwd: string) => {
    try {
      await navigator.clipboard.writeText(pwd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = pwd;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
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

      <style>{`
        @keyframes fade-in {
          from { opacity: 0; transform: scale(0.95) translateY(10px); }
          to   { opacity: 1; transform: scale(1)    translateY(0); }
        }
        .animate-fade-in { animation: fade-in 0.2s ease-out; }
      `}</style>
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

  // Inline confirmations (replaces confirm() dialogs)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [confirmRemoveMembershipId, setConfirmRemoveMembershipId] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState({
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

  // Filter users by search query
  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return users;
    const q = searchQuery.toLowerCase().trim();
    return users.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
    );
  }, [users, searchQuery]);

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
    if (createForm.globalRole !== "MASTER" && !createForm.branchId) {
      toast.error("Selecciona una sucursal para el rol operativo del usuario.");
      return;
    }
    if (createForm.globalRole !== "MASTER" && !arePresetRolesAvailable(selectedCreateBranch, selectedCreatePreset)) {
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
          globalRole: createForm.globalRole === "MASTER" ? "MASTER" : undefined,
          memberships: createForm.globalRole === "MASTER"
            ? []
            : selectedCreatePreset.roles.map((roleCode) => ({ branchId: createForm.branchId, roleCode })),
        }),
      });
      const json = (await response.json()) as { message?: string; reason?: string; error?: string };

      const data = (json as { data?: { id?: string; tempPassword?: string } }).data;
      if (!response.ok) throw new Error(getErrorMessage(json, "No se pudo crear el usuario."));

      const tempPwd = data?.tempPassword ?? "";
      setCreateForm((prev) => ({ username: "", fullName: "", email: "", globalRole: "", branchId: prev.branchId, rolePreset: "SALES" }));
      await load();
      toast.success(
        tempPwd
          ? `✅ Usuario creado. Contraseña temporal: ${tempPwd} — Deberá cambiarla en su primer login.`
          : "✅ Usuario creado correctamente.",
        { duration: 12000 },
      );
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

  async function addMembership(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedUser) return;

    setAssigningMembership(true);
    toast("Asignando membresía...");

    try {
      const response = await apiFetch(`/api/master/users/${selectedUser.id}/memberships`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(membershipForm),
      });
      const json = (await response.json()) as { message?: string; reason?: string; error?: string };

      if (!response.ok) throw new Error(getErrorMessage(json, "No se pudo asignar la membresía."));

      await load();
      toast.success("✅ Membresía asignada correctamente.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo asignar la membresía.");
    } finally {
      setAssigningMembership(false);
    }
  }

  void addMembership;

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
      {/* ── Create User Card ── */}
      <div className="hm-module-card">
        <div className="hm-module-card-header">
          <div className="flex items-center gap-2">
            <UserPlus className="h-3.5 w-3.5 text-[var(--color-info-600)]" />
            <span className="font-semibold text-sm text-[var(--color-text)]">Crear usuario</span>
          </div>
          <span className="text-xs text-[var(--color-text-muted)] hidden sm:block">
            La contraseña temporal se genera automáticamente y se mostrará al crear.
          </span>
        </div>
        <div className="p-4">
          <form className="space-y-3" onSubmit={createUser}>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <label className="grid gap-1">
                <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Usuario *</span>
                <input
                  className="hm-input rounded-lg text-sm"
                  placeholder="ej. jperez"
                  value={createForm.username}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, username: e.target.value }))}
                  required minLength={3} autoComplete="off"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Nombre completo *</span>
                <input
                  className="hm-input rounded-lg text-sm"
                  placeholder="Juan Pérez"
                  value={createForm.fullName}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, fullName: e.target.value }))}
                  required minLength={2}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Correo</span>
                <input
                  className="hm-input rounded-lg text-sm"
                  placeholder="opcional"
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, email: e.target.value }))}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Rol global</span>
                <select
                  className="hm-input rounded-lg text-sm"
                  value={createForm.globalRole}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, globalRole: e.target.value }))}
                >
                  <option value="">Sin rol global</option>
                  <option value="MASTER">MASTER</option>
                </select>
              </label>
            </div>

            {createForm.globalRole !== "MASTER" ? (
              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Sucursal inicial *</span>
                    <select
                      className="hm-input rounded-lg text-sm"
                      value={createForm.branchId}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, branchId: e.target.value }))}
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
                      value={createForm.rolePreset}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, rolePreset: e.target.value as UserRolePreset }))}
                    >
                      {USER_ROLE_PRESETS.map((preset) => (
                        <option key={preset.value} value={preset.value} disabled={!arePresetRolesAvailable(selectedCreateBranch, preset)}>
                          {preset.label}{arePresetRolesAvailable(selectedCreateBranch, preset) ? "" : " (No disponible)"}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-2.5 text-xs text-[var(--color-text-secondary)]">
                  {selectedCreatePreset.description}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {selectedCreatePreset.roles.map((role) => (
                      <span
                        key={role}
                        className={`inline-flex rounded-full px-2 py-0.5 text-[0.5625rem] font-semibold border ${
                          isRoleAvailable(selectedCreateBranch, role)
                            ? "bg-[var(--color-info-50)] text-[var(--color-info-700)] border-[var(--color-info-200)]"
                            : "bg-[var(--color-warning-50)] text-[var(--color-warning-700)] border-[var(--color-warning-200)]"
                        }`}
                      >
                        {ROLE_LABEL[role]}{isRoleAvailable(selectedCreateBranch, role) ? "" : " · deshabilitado"}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] p-3 text-sm text-[var(--color-warning-700)]">
                MASTER es un rol global. Si también necesita operar en una sucursal concreta, podrás agregarle membresías desde el panel de edición.
              </div>
            )}

            <div className="flex items-center justify-end">
              <Button
                type="submit"
                loading={creatingUser}
                disabled={initialLoading || (createForm.globalRole !== "MASTER" && !arePresetRolesAvailable(selectedCreateBranch, selectedCreatePreset))}
                icon={<UserPlus className="h-4 w-4" />}
              >
                Crear usuario
              </Button>
            </div>
          </form>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.35fr]">
        {/* ── Users List ── */}
        <div className="hm-module-card">
          <div className="hm-module-card-header">
            <span className="font-semibold text-sm text-[var(--color-text)]">
              Usuarios{!initialLoading && ` (${filteredUsers.length}${searchQuery ? ` de ${users.length}` : ""})`}
            </span>
          </div>
          <div className="p-3 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-soft)]" />
              <input
                type="text"
                placeholder="Buscar por usuario, nombre o correo..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="hm-input w-full rounded-lg pl-8 text-sm"
              />
            </div>

            {initialLoading ? (
              <div className="py-8 text-center text-sm text-[var(--color-text-soft)]">
                <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2 text-[var(--color-info-500)]" />
                Cargando usuarios...
              </div>
            ) : (
              <ul className="max-h-[32rem] space-y-1.5 overflow-y-auto pr-0.5">
                {filteredUsers.length === 0 && (
                  <li className="rounded-lg border border-dashed border-[var(--color-border)] p-4 text-sm text-center text-[var(--color-text-muted)]">
                    {searchQuery ? "Sin resultados para ese filtro." : "No hay usuarios registrados."}
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
                <div className="flex items-center gap-1.5">
                  <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Nombre</span>
                  <span className="text-[var(--color-text)]">{selectedUser.fullName}</span>
                </div>
                <div className="flex items-center gap-1.5 sm:col-span-2">
                  <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Correo</span>
                  <span className="text-[var(--color-text)]">{selectedUser.email || "—"}</span>
                </div>
                <div className="flex items-center gap-1.5 sm:col-span-2">
                  <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Clave</span>
                  {selectedUser.mustChangePassword
                    ? <span className="text-[var(--color-warning-700)]">Pendiente de cambio al próximo login</span>
                    : <span className="text-[var(--color-success-700)]">Configurada por el usuario</span>
                  }
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

              {/* Membership assignment */}
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
                  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-2.5 text-xs text-[var(--color-text-secondary)]">
                    {selectedMembershipPreset.description}
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {selectedMembershipPreset.roles.map((role) => (
                        <span
                          key={role}
                          className={`inline-flex rounded-full px-2 py-0.5 text-[0.5625rem] font-semibold border ${
                            isRoleAvailable(selectedMembershipBranch, role)
                              ? "bg-[var(--color-info-50)] text-[var(--color-info-700)] border-[var(--color-info-200)]"
                              : "bg-[var(--color-warning-50)] text-[var(--color-warning-700)] border-[var(--color-warning-200)]"
                          }`}
                        >
                          {ROLE_LABEL[role]}{isRoleAvailable(selectedMembershipBranch, role) ? "" : " · deshabilitado"}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Memberships table */}
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
