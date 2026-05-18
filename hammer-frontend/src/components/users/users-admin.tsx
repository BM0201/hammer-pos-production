"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  RefreshCw,
  Eye,
  EyeOff,
  Search,
  AlertTriangle,
} from "lucide-react";
import { apiFetch } from "@/lib/client/api";

type BranchOption = { id: string; code: string; name: string; isActive: boolean };
type MembershipRole = "BRANCH_ADMIN" | "SALES" | "CASHIER" | "WAREHOUSE";
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
  userBranchRoles: MembershipRow[];
};

type FeedbackTone = "success" | "error" | "info";

const BRANCH_ROLE_OPTIONS = [
  { value: "BRANCH_ADMIN", label: "Administrador sucursal" },
  { value: "SALES", label: "Ventas" },
  { value: "CASHIER", label: "Caja" },
  { value: "WAREHOUSE", label: "Bodega" },
] as const;

const ROLE_LABEL: Record<string, string> = {
  BRANCH_ADMIN: "Administrador sucursal",
  SALES: "Ventas",
  CASHIER: "Caja",
  WAREHOUSE: "Bodega",
};

function getErrorMessage(payload?: { message?: string; reason?: string; error?: string }, fallback?: string) {
  return payload?.message ?? payload?.reason ?? payload?.error ?? fallback ?? "No se pudo completar la operación.";
}

/** Generate a random secure password (12 chars: uppercase + lowercase + digits + symbols) */
function generateSecurePassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%&*_+-=";
  const all = upper + lower + digits + symbols;

  // Ensure at least one of each
  let pwd = "";
  pwd += upper[Math.floor(Math.random() * upper.length)];
  pwd += lower[Math.floor(Math.random() * lower.length)];
  pwd += digits[Math.floor(Math.random() * digits.length)];
  pwd += symbols[Math.floor(Math.random() * symbols.length)];

  // Fill remaining characters
  for (let i = pwd.length; i < 12; i++) {
    pwd += all[Math.floor(Math.random() * all.length)];
  }

  // Shuffle
  return pwd
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// Password Reset Modal
// ─────────────────────────────────────────────────────────────────────────────
function ResetPasswordModal({
  user,
  open,
  onClose,
  onConfirm,
  loading,
}: {
  user: UserRow;
  open: boolean;
  onClose: () => void;
  onConfirm: (password: string) => Promise<void>;
  loading: boolean;
}) {
  const [generatedPassword, setGeneratedPassword] = useState(() => generateSecurePassword());
  const [copied, setCopied] = useState(false);
  const [showPassword, setShowPassword] = useState(true);

  const regenerate = useCallback(() => {
    setGeneratedPassword(generateSecurePassword());
    setCopied(false);
  }, []);

  const copyToClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(generatedPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = generatedPassword;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }, [generatedPassword]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-md bg-white rounded-xl shadow-2xl border border-gray-200 animate-fade-in overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100">
              <KeyRound className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">Resetear Contraseña</h3>
              <p className="text-xs text-gray-500">Usuario: {user.username}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <p>Se generará una nueva contraseña temporal. El usuario deberá cambiarla en su próximo inicio de sesión.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Contraseña generada
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type={showPassword ? "text" : "password"}
                  value={generatedPassword}
                  readOnly
                  className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2.5 pr-10 text-sm font-mono tracking-wider select-all focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors p-1"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {/* Copy button */}
              <button
                type="button"
                onClick={copyToClipboard}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                  copied
                    ? "bg-green-100 text-green-700 border border-green-300"
                    : "bg-indigo-600 text-white hover:bg-indigo-700"
                }`}
                title="Copiar al portapapeles"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" />
                    <span>¡Copiado!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    <span>Copiar</span>
                  </>
                )}
              </button>

              {/* Regenerate button */}
              <button
                type="button"
                onClick={regenerate}
                className="rounded-lg border border-gray-300 p-2.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                title="Generar nueva contraseña"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirm(generatedPassword)}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Reseteando...
              </>
            ) : (
              <>
                <KeyRound className="h-4 w-4" />
                Confirmar Reset
              </>
            )}
          </button>
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
  const [feedback, setFeedback] = useState<{ tone: FeedbackTone; text: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [initialLoading, setInitialLoading] = useState(true);
  const [creatingUser, setCreatingUser] = useState(false);
  const [savingUser, setSavingUser] = useState(false);
  const [assigningMembership, setAssigningMembership] = useState(false);
  const [updatingMembership, setUpdatingMembership] = useState<Record<string, boolean>>({});
  const [removingMembership, setRemovingMembership] = useState<Record<string, boolean>>({});
  const [resettingPassword, setResettingPassword] = useState(false);
  const [togglingActiveState, setTogglingActiveState] = useState(false);

  // Password reset modal
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetModalLoading, setResetModalLoading] = useState(false);

  // Manual password reset
  const [resetPassword, setResetPassword] = useState("");

  const [createForm, setCreateForm] = useState({
    username: "",
    fullName: "",
    email: "",
    password: "",
    globalRole: "",
  });
  const [membershipForm, setMembershipForm] = useState<{ branchId: string; roleCode: MembershipRole }>({
    branchId: "",
    roleCode: "SALES",
  });

  const selectedUser = useMemo(() => users.find((item) => item.id === selectedUserId) ?? null, [users, selectedUserId]);

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

  async function load(keepFeedback = true) {
    if (!keepFeedback) setFeedback(null);

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
      .catch((error) => setFeedback({ tone: "error", text: error instanceof Error ? error.message : "No se pudo inicializar usuarios." }))
      .finally(() => setInitialLoading(false));
  }, []);

  // Auto-dismiss feedback after 5 seconds
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 5000);
    return () => clearTimeout(timer);
  }, [feedback]);

  async function createUser(event: React.FormEvent) {
    event.preventDefault();

    // Client-side validation
    if (createForm.username.trim().length < 3) {
      setFeedback({ tone: "error", text: "El nombre de usuario debe tener al menos 3 caracteres." });
      return;
    }
    if (createForm.fullName.trim().length < 2) {
      setFeedback({ tone: "error", text: "El nombre completo es obligatorio." });
      return;
    }
    if (createForm.password.length < 8) {
      setFeedback({ tone: "error", text: "La contraseña debe tener al menos 8 caracteres." });
      return;
    }

    setCreatingUser(true);
    setFeedback({ tone: "info", text: "Creando usuario..." });

    try {
      const response = await apiFetch("/api/master/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: createForm.username.trim(),
          fullName: createForm.fullName.trim(),
          email: createForm.email.trim() || undefined,
          password: createForm.password,
          globalRole: createForm.globalRole === "MASTER" ? "MASTER" : undefined,
          memberships: [],
        }),
      });
      const json = (await response.json()) as { message?: string; reason?: string; error?: string };

      if (!response.ok) throw new Error(getErrorMessage(json, "No se pudo crear el usuario."));

      setCreateForm({ username: "", fullName: "", email: "", password: "", globalRole: "" });
      await load(false);
      setFeedback({ tone: "success", text: "✅ Usuario creado correctamente. Deberá cambiar su contraseña en el primer login." });
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "No se pudo crear el usuario." });
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

      await load(false);
      setFeedback({
        tone: "success",
        text: mode === "toggle"
          ? `✅ Usuario ${updates.isActive ? "activado" : "desactivado"} correctamente.`
          : "✅ Contraseña actualizada. El usuario deberá cambiarla en su próximo login.",
      });
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "No se pudo actualizar el usuario." });
    } finally {
      setSavingUser(false);
      if (mode === "toggle") setTogglingActiveState(false);
      if (mode === "password") setResettingPassword(false);
    }
  }

  // Handle modal-based password reset
  async function handleModalReset(password: string) {
    if (!selectedUser) return;
    setResetModalLoading(true);
    try {
      const response = await apiFetch(`/api/master/users/${selectedUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = (await response.json()) as { message?: string; reason?: string; error?: string };
      if (!response.ok) throw new Error(getErrorMessage(json, "No se pudo resetear la contraseña."));

      await load(false);
      setFeedback({
        tone: "success",
        text: "✅ Contraseña reseteada correctamente. El usuario deberá cambiarla en su próximo login.",
      });
      setResetModalOpen(false);
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "No se pudo resetear la contraseña." });
    } finally {
      setResetModalLoading(false);
    }
  }

  async function addMembership(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedUser) return;

    setAssigningMembership(true);
    setFeedback({ tone: "info", text: "Asignando membresía..." });

    try {
      const response = await apiFetch(`/api/master/users/${selectedUser.id}/memberships`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(membershipForm),
      });
      const json = (await response.json()) as { message?: string; reason?: string; error?: string };

      if (!response.ok) throw new Error(getErrorMessage(json, "No se pudo asignar la membresía."));

      await load(false);
      setFeedback({ tone: "success", text: "✅ Membresía asignada correctamente." });
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "No se pudo asignar la membresía." });
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

      await load(false);
      setFeedback({ tone: "success", text: `✅ Membresía ${isActive ? "activada" : "desactivada"}.` });
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "No se pudo editar la membresía." });
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

      await load(false);
      setFeedback({ tone: "success", text: "✅ Membresía removida." });
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "No se pudo remover la membresía." });
    } finally {
      setRemovingMembership((prev) => ({ ...prev, [membershipId]: false }));
    }
  }

  return (
    <section className="space-y-4" data-testid="users-admin-root">
      <Card className="p-3 text-sm text-[var(--color-text-secondary)]">
        Módulo operativo para crear usuarios, activar/desactivar, resetear contraseña y gestionar membresías por sucursal.
        Los nuevos usuarios deberán cambiar su contraseña en el primer inicio de sesión.
      </Card>

      {/* Create User Form */}
      <Card className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-[var(--color-info-700)]" />
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Crear usuario</h2>
        </div>

        <form className="grid gap-2 md:grid-cols-5" onSubmit={createUser}>
          <Input
            placeholder="Usuario *"
            value={createForm.username}
            onChange={(e) => setCreateForm((prev) => ({ ...prev, username: e.target.value }))}
            required
            minLength={3}
            autoComplete="off"
          />
          <Input
            placeholder="Nombre completo *"
            value={createForm.fullName}
            onChange={(e) => setCreateForm((prev) => ({ ...prev, fullName: e.target.value }))}
            required
            minLength={2}
          />
          <Input
            placeholder="Correo (opcional)"
            type="email"
            value={createForm.email}
            onChange={(e) => setCreateForm((prev) => ({ ...prev, email: e.target.value }))}
          />
          <Input
            placeholder="Contraseña inicial *"
            type="password"
            value={createForm.password}
            onChange={(e) => setCreateForm((prev) => ({ ...prev, password: e.target.value }))}
            required
            minLength={8}
            autoComplete="new-password"
          />
          <select
            className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
            value={createForm.globalRole}
            onChange={(e) => setCreateForm((prev) => ({ ...prev, globalRole: e.target.value }))}
          >
            <option value="">Sin rol global</option>
            <option value="MASTER">MASTER</option>
          </select>
          <Button className="md:col-span-5" type="submit" loading={creatingUser} disabled={initialLoading}>
            <UserPlus className="h-4 w-4" />
            Crear usuario
          </Button>
        </form>
      </Card>

      {/* Feedback */}
      {feedback ? (
        <Card
          className={`p-3 text-sm flex items-center justify-between ${
            feedback.tone === "error"
              ? "border-[var(--color-danger-300)] bg-[var(--color-danger-50)] text-[var(--color-danger-700)]"
              : ""
          } ${
            feedback.tone === "success"
              ? "border-[var(--color-success-300)] bg-[var(--color-success-50)] text-[var(--color-success-700)]"
              : ""
          } ${
            feedback.tone === "info"
              ? "border-[var(--color-info-300)] bg-[var(--color-info-50)] text-[var(--color-info-700)]"
              : ""
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="ml-2 text-current opacity-60 hover:opacity-100 transition-opacity"
          >
            <X className="h-4 w-4" />
          </button>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        {/* Users list */}
        <Card className="p-3">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-[var(--color-text)]">Usuarios ({users.length})</h2>
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-soft)]" />
            <input
              type="text"
              placeholder="Buscar usuario..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-border)] pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-info-500)] focus:border-[var(--color-info-500)] outline-none transition-colors"
            />
          </div>

          {initialLoading ? (
            <div className="py-6 text-center text-sm text-[var(--color-text-soft)]">
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Cargando usuarios...
              </span>
            </div>
          ) : (
            <ul className="max-h-[34rem] space-y-2 overflow-y-auto">
              {filteredUsers.length === 0 ? (
                <li className="rounded-lg border border-dashed border-[var(--color-border)] p-3 text-sm text-[var(--color-text-soft)]">
                  {searchQuery ? "No se encontraron usuarios con ese filtro." : "No hay usuarios registrados."}
                </li>
              ) : null}
              {filteredUsers.map((user) => (
                <li key={user.id}>
                  <button
                    className={`w-full rounded-lg border p-3 text-left transition-all duration-150 ${
                      selectedUserId === user.id
                        ? "border-[var(--color-success-600)] bg-[var(--color-success-50)] shadow-sm"
                        : "border-[var(--color-border)] hover:bg-[var(--color-surface-alt)] hover:shadow-sm"
                    }`}
                    onClick={() => setSelectedUserId(user.id)}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-[var(--color-text)]">{user.username}</div>
                      <Badge variant={user.isActive ? "success" : "warning"}>
                        {user.isActive ? "Activo" : "Inactivo"}
                      </Badge>
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)]">{user.fullName}</div>
                    <div className="text-xs text-[var(--color-text-soft)]">
                      {user.globalRole ?? "Sin rol global"}
                      {user.userBranchRoles.length > 0 && ` · ${user.userBranchRoles.length} membresía(s)`}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* User detail / edit panel */}
        <Card className="space-y-4 p-3 lg:p-4">
          <h2 className="font-semibold text-[var(--color-text)]">Edición operativa</h2>

          {selectedUser ? (
            <>
              {/* User info card */}
              <Card className="border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-sm">
                <div className="grid gap-1 sm:grid-cols-2">
                  <div>
                    <strong>Usuario:</strong> {selectedUser.username}
                  </div>
                  <div>
                    <strong>Nombre:</strong> {selectedUser.fullName}
                  </div>
                  <div className="sm:col-span-2">
                    <strong>Correo:</strong> {selectedUser.email}
                  </div>
                </div>
              </Card>

              {/* Actions: toggle active + password reset */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant={selectedUser.isActive ? "secondary" : "success"}
                    loading={togglingActiveState}
                    disabled={savingUser || resettingPassword || assigningMembership}
                    onClick={() => {
                      if (selectedUser.isActive && !confirm("¿Desactivar este usuario? Se cerrarán todas sus sesiones activas.")) return;
                      saveUser(selectedUser, { isActive: !selectedUser.isActive }, "toggle");
                    }}
                  >
                    {selectedUser.isActive ? "Desactivar usuario" : "Activar usuario"}
                  </Button>

                  {/* Modal-based reset (generates random password) */}
                  <Button
                    type="button"
                    variant="primary"
                    disabled={savingUser || resettingPassword || assigningMembership || resetModalLoading}
                    onClick={() => setResetModalOpen(true)}
                  >
                    <KeyRound className="h-4 w-4" />
                    Resetear Contraseña
                  </Button>
                </div>

                {/* Manual password input (alternative) */}
                <div className="flex items-center gap-2">
                  <Input
                    type="password"
                    placeholder="O escribe una nueva contraseña manual..."
                    value={resetPassword}
                    onChange={(event) => setResetPassword(event.target.value)}
                    disabled={resettingPassword}
                    className="flex-1"
                    autoComplete="new-password"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    loading={resettingPassword}
                    disabled={!resetPassword.trim() || resetPassword.trim().length < 8}
                    onClick={() => {
                      if (resetPassword.trim().length < 8) {
                        setFeedback({ tone: "error", text: "La nueva contraseña debe tener al menos 8 caracteres." });
                        return;
                      }

                      saveUser(selectedUser, { password: resetPassword.trim() }, "password")
                        .then(() => setResetPassword(""))
                        .catch(() => setFeedback({ tone: "error", text: "No se pudo resetear contraseña." }));
                    }}
                  >
                    Guardar
                  </Button>
                </div>
              </div>

              {/* Membership assignment */}
              <Card className="space-y-3 border-[var(--color-border)] p-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                  <Link2 className="h-4 w-4" /> Asignar membresía
                </div>
                <form className="grid gap-2 md:grid-cols-3" onSubmit={addMembership}>
                  <select
                    className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
                    value={membershipForm.branchId}
                    onChange={(e) => setMembershipForm((prev) => ({ ...prev, branchId: e.target.value }))}
                    required
                  >
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id} disabled={!branch.isActive}>
                        {branch.code} · {branch.name}
                        {branch.isActive ? "" : " (Inactiva)"}
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
                    value={membershipForm.roleCode}
                    onChange={(e) => setMembershipForm((prev) => ({ ...prev, roleCode: e.target.value as MembershipRole }))}
                  >
                    {BRANCH_ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" variant="success" loading={assigningMembership} disabled={!membershipForm.branchId}>
                    Asignar membresía
                  </Button>
                </form>
              </Card>

              {/* Memberships table */}
              <Card noPadding>
                <div className="overflow-x-auto">
                  <table className="min-w-[720px] w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-text-soft)]">
                        <th className="px-3 py-3">Sucursal</th>
                        <th className="px-3 py-3">Rol</th>
                        <th className="px-3 py-3">Estado</th>
                        <th className="px-3 py-3 text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedMemberships.length === 0 ? (
                        <tr>
                          <td className="px-3 py-8 text-center text-[var(--color-text-soft)]" colSpan={4}>
                            Sin membresías asignadas. Asigna una sucursal y rol arriba.
                          </td>
                        </tr>
                      ) : (
                        sortedMemberships.map((membership) => {
                          const membershipUpdating = updatingMembership[membership.id] ?? false;
                          const membershipRemoving = removingMembership[membership.id] ?? false;
                          return (
                            <tr key={membership.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-alt)] transition-colors">
                              <td className="px-3 py-3">
                                {membership.branch.code} · {membership.branch.name}
                              </td>
                              <td className="px-3 py-3">{ROLE_LABEL[membership.roleCode] ?? membership.roleCode}</td>
                              <td className="px-3 py-3">
                                <Badge variant={membership.isActive ? "success" : "warning"}>
                                  {membership.isActive ? "Activo" : "Inactivo"}
                                </Badge>
                              </td>
                              <td className="px-3 py-3 text-right">
                                <div className="flex justify-end gap-2">
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
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    loading={membershipRemoving}
                                    disabled={membershipUpdating}
                                    type="button"
                                    onClick={() => {
                                      if (!confirm("¿Quitar esta membresía del usuario? Esta acción no se puede deshacer.")) return;
                                      removeMembership(membership.id);
                                    }}
                                  >
                                    <ShieldAlert className="h-4 w-4" />
                                    Quitar
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Password Reset Modal */}
              {resetModalOpen && selectedUser && (
                <ResetPasswordModal
                  user={selectedUser}
                  open={resetModalOpen}
                  onClose={() => setResetModalOpen(false)}
                  onConfirm={handleModalReset}
                  loading={resetModalLoading}
                />
              )}
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-[var(--color-border)] p-5 text-sm text-[var(--color-text-muted)]">
              <span className="inline-flex items-center gap-2">
                <UserRoundCheck className="h-4 w-4" /> Selecciona un usuario para administrar membresías y credenciales.
              </span>
            </div>
          )}
        </Card>
      </div>
    </section>
  );
}
