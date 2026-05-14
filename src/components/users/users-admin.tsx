"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, ShieldAlert, UserPlus, KeyRound, Link2, UserRoundCheck } from "lucide-react";
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

export function UsersAdmin() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [feedback, setFeedback] = useState<{ tone: FeedbackTone; text: string } | null>(null);

  const [initialLoading, setInitialLoading] = useState(true);
  const [creatingUser, setCreatingUser] = useState(false);
  const [savingUser, setSavingUser] = useState(false);
  const [assigningMembership, setAssigningMembership] = useState(false);
  const [updatingMembership, setUpdatingMembership] = useState<Record<string, boolean>>({});
  const [removingMembership, setRemovingMembership] = useState<Record<string, boolean>>({});
  const [resettingPassword, setResettingPassword] = useState(false);
  const [togglingActiveState, setTogglingActiveState] = useState(false);

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
  const [resetPassword, setResetPassword] = useState("");

  const selectedUser = useMemo(() => users.find((item) => item.id === selectedUserId) ?? null, [users, selectedUserId]);

  async function load(keepFeedback = true) {
    if (!keepFeedback) setFeedback(null);

    const response = await apiFetch("/api/master/users", { cache: "no-store" });
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

  async function createUser(event: React.FormEvent) {
    event.preventDefault();
    setCreatingUser(true);
    setFeedback({ tone: "info", text: "Creando usuario..." });

    try {
      const response = await apiFetch("/api/master/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: createForm.username.trim(),
          fullName: createForm.fullName.trim(),
          email: createForm.email.trim(),
          password: createForm.password,
          globalRole: createForm.globalRole === "MASTER" ? "MASTER" : undefined,
          memberships: [],
        }),
      });
      const json = (await response.json()) as { message?: string; reason?: string; error?: string };

      if (!response.ok) throw new Error(getErrorMessage(json, "No se pudo crear el usuario."));

      setCreateForm({ username: "", fullName: "", email: "", password: "", globalRole: "" });
      await load(false);
      setFeedback({ tone: "success", text: "Usuario creado correctamente." });
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
          ? `Usuario ${updates.isActive ? "activado" : "desactivado"} correctamente.`
          : "Contraseña actualizada correctamente.",
      });
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "No se pudo actualizar el usuario." });
    } finally {
      setSavingUser(false);
      if (mode === "toggle") setTogglingActiveState(false);
      if (mode === "password") setResettingPassword(false);
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
      setFeedback({ tone: "success", text: "Membresía asignada correctamente." });
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
      setFeedback({ tone: "success", text: `Membresía ${isActive ? "activada" : "desactivada"}.` });
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
      setFeedback({ tone: "success", text: "Membresía removida." });
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
      </Card>

      <Card className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-[var(--color-info-700)]" />
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Crear usuario</h2>
        </div>

        <form className="grid gap-2 md:grid-cols-5" onSubmit={createUser}>
          <Input placeholder="Usuario" value={createForm.username} onChange={(e) => setCreateForm((prev) => ({ ...prev, username: e.target.value }))} required />
          <Input placeholder="Nombre completo" value={createForm.fullName} onChange={(e) => setCreateForm((prev) => ({ ...prev, fullName: e.target.value }))} required />
          <Input placeholder="Correo" type="email" value={createForm.email} onChange={(e) => setCreateForm((prev) => ({ ...prev, email: e.target.value }))} required />
          <Input placeholder="Contraseña inicial" type="password" value={createForm.password} onChange={(e) => setCreateForm((prev) => ({ ...prev, password: e.target.value }))} required />
          <select className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" value={createForm.globalRole} onChange={(e) => setCreateForm((prev) => ({ ...prev, globalRole: e.target.value }))}>
            <option value="">Sin rol global</option>
            <option value="MASTER">MASTER</option>
          </select>
          <Button className="md:col-span-5" type="submit" loading={creatingUser} disabled={initialLoading}>
            Crear usuario
          </Button>
        </form>
      </Card>

      {feedback ? (
        <Card
          className={`p-3 text-sm ${feedback.tone === "error" ? "border-[var(--color-danger-300)] bg-[var(--color-danger-50)] text-[var(--color-danger-700)]" : ""}
          ${feedback.tone === "success" ? "border-[var(--color-success-300)] bg-[var(--color-success-50)] text-[var(--color-success-700)]" : ""}
          ${feedback.tone === "info" ? "border-[var(--color-info-300)] bg-[var(--color-info-50)] text-[var(--color-info-700)]" : ""}`}
        >
          {feedback.text}
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card className="p-3">
          <h2 className="mb-3 font-semibold text-[var(--color-text)]">Usuarios</h2>
          {initialLoading ? (
            <div className="py-6 text-center text-sm text-[var(--color-text-soft)]">
              <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Cargando usuarios...</span>
            </div>
          ) : (
            <ul className="max-h-[34rem] space-y-2 overflow-y-auto">
              {users.length === 0 ? (
                <li className="rounded-lg border border-dashed border-[var(--color-border)] p-3 text-sm text-[var(--color-text-soft)]">No hay usuarios registrados.</li>
              ) : null}
              {users.map((user) => (
                <li key={user.id}>
                  <button
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${selectedUserId === user.id ? "border-[var(--color-success-600)] bg-[var(--color-success-50)]" : "border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]"}`}
                    onClick={() => setSelectedUserId(user.id)}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-[var(--color-text)]">{user.username}</div>
                      <Badge variant={user.isActive ? "success" : "warning"}>{user.isActive ? "Activo" : "Inactivo"}</Badge>
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)]">{user.fullName}</div>
                    <div className="text-xs text-[var(--color-text-soft)]">{user.globalRole ?? "Sin rol global"}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-4 p-3 lg:p-4">
          <h2 className="font-semibold text-[var(--color-text)]">Edición operativa</h2>

          {selectedUser ? (
            <>
              <Card className="border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-sm">
                <div className="grid gap-1 sm:grid-cols-2">
                  <div><strong>Usuario:</strong> {selectedUser.username}</div>
                  <div><strong>Nombre:</strong> {selectedUser.fullName}</div>
                  <div className="sm:col-span-2"><strong>Correo:</strong> {selectedUser.email}</div>
                </div>
              </Card>

              <div className="grid gap-2 md:grid-cols-[auto_1fr_auto]">
                <Button
                  type="button"
                  variant={selectedUser.isActive ? "secondary" : "success"}
                  loading={togglingActiveState}
                  disabled={savingUser || resettingPassword || assigningMembership}
                  onClick={() => {
                    if (selectedUser.isActive && !confirm("¿Desactivar este usuario?")) return;
                    saveUser(selectedUser, { isActive: !selectedUser.isActive }, "toggle");
                  }}
                >
                  {selectedUser.isActive ? "Desactivar usuario" : "Activar usuario"}
                </Button>
                <Input
                  type="password"
                  placeholder="Nueva contraseña"
                  value={resetPassword}
                  onChange={(event) => setResetPassword(event.target.value)}
                  disabled={resettingPassword}
                />
                <Button
                  type="button"
                  variant="primary"
                  loading={resettingPassword}
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
                  <KeyRound className="h-4 w-4" />
                  Guardar contraseña
                </Button>
              </div>

              <Card className="space-y-3 border-[var(--color-border)] p-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                  <Link2 className="h-4 w-4" /> Asignar membresía
                </div>
                <form className="grid gap-2 md:grid-cols-3" onSubmit={addMembership}>
                  <select className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" value={membershipForm.branchId} onChange={(e) => setMembershipForm((prev) => ({ ...prev, branchId: e.target.value }))} required>
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id} disabled={!branch.isActive}>
                        {branch.code} · {branch.name}{branch.isActive ? "" : " (Inactiva)"}
                      </option>
                    ))}
                  </select>
                  <select className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" value={membershipForm.roleCode} onChange={(e) => setMembershipForm((prev) => ({ ...prev, roleCode: e.target.value as MembershipRole }))}>
                    {BRANCH_ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <Button type="submit" variant="success" loading={assigningMembership} disabled={!membershipForm.branchId}>
                    Asignar membresía
                  </Button>
                </form>
              </Card>

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
                          <td className="px-3 py-8 text-center text-[var(--color-text-soft)]" colSpan={4}>Sin membresías asignadas.</td>
                        </tr>
                      ) : (
                        sortedMemberships.map((membership) => {
                          const membershipUpdating = updatingMembership[membership.id] ?? false;
                          const membershipRemoving = removingMembership[membership.id] ?? false;
                          return (
                            <tr key={membership.id} className="border-b border-[var(--color-border)]">
                              <td className="px-3 py-3">{membership.branch.code} · {membership.branch.name}</td>
                              <td className="px-3 py-3">{ROLE_LABEL[membership.roleCode] ?? membership.roleCode}</td>
                              <td className="px-3 py-3">
                                <Badge variant={membership.isActive ? "success" : "warning"}>{membership.isActive ? "Activo" : "Inactivo"}</Badge>
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
                                      if (!confirm("¿Quitar esta membresía del usuario?")) return;
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
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-[var(--color-border)] p-5 text-sm text-[var(--color-text-muted)]">
              <span className="inline-flex items-center gap-2"><UserRoundCheck className="h-4 w-4" /> Selecciona un usuario para administrar membresías y credenciales.</span>
            </div>
          )}
        </Card>
      </div>
    </section>
  );
}
