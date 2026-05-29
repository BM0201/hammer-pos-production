"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Boxes, CreditCard, Loader2, Plus, ReceiptText, Settings2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch, unwrapApiData } from "@/lib/client/api";

type RoleCode = "BRANCH_ADMIN" | "SALES" | "CASHIER" | "WAREHOUSE";

type BranchRow = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  moduleConfig: { enableCashier: boolean; enableDispatch: boolean } | null;
  printSettings: { id: string; printerMode: string; paperWidth: string; autoPrint: boolean } | null;
  physicalCashBoxes: Array<{
    id: string;
    code: string;
    description: string | null;
    isActive: boolean;
    _count: { sessions: number };
  }>;
  userBranchRoles: Array<{
    id: string;
    roleCode: RoleCode;
    user: { id: string; username: string; fullName: string; email: string; isActive: boolean };
  }>;
  _count: { saleOrders: number; inventoryBalances: number };
};

type Feedback = { tone: "success" | "error" | "info"; text: string } | null;

const ROLE_LABEL: Record<RoleCode, string> = {
  BRANCH_ADMIN: "Administrador",
  SALES: "Ventas",
  CASHIER: "Caja",
  WAREHOUSE: "Despacho / Bodega",
};

function getMessage(payload: unknown, fallback: string) {
  if (typeof payload === "object" && payload && "error" in payload) {
    const error = (payload as { error?: { message?: string } }).error;
    if (error?.message) return error.message;
  }
  if (typeof payload === "object" && payload && "message" in payload) {
    const message = (payload as { message?: string }).message;
    if (message) return message;
  }
  return fallback;
}

export function BranchesAdmin() {
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyBranchId, setBusyBranchId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [form, setForm] = useState({
    code: "",
    name: "",
    enableCashier: true,
    enableDispatch: true,
    createDefaultCashBox: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/master/branches", { cache: "no-store" });
      const raw = await response.json();
      if (!response.ok) throw new Error(getMessage(raw, "No se pudieron cargar las sucursales."));
      const data = unwrapApiData<BranchRow[]>(raw);
      setBranches(Array.isArray(data) ? data : []);
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "No se pudieron cargar las sucursales." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => ({
    active: branches.filter((branch) => branch.isActive).length,
    boxes: branches.reduce((sum, branch) => sum + branch.physicalCashBoxes.length, 0),
    users: branches.reduce((sum, branch) => sum + branch.userBranchRoles.length, 0),
  }), [branches]);

  async function createBranch(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFeedback({ tone: "info", text: "Creando sucursal..." });

    try {
      const response = await apiFetch("/api/master/branches", {
        method: "POST",
        body: JSON.stringify(form),
      });
      const raw = await response.json();
      if (!response.ok) throw new Error(getMessage(raw, "No se pudo crear la sucursal."));

      setForm({ code: "", name: "", enableCashier: true, enableDispatch: true, createDefaultCashBox: true });
      await load();
      setFeedback({ tone: "success", text: "Sucursal creada correctamente." });
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "No se pudo crear la sucursal." });
    } finally {
      setSaving(false);
    }
  }

  async function patchBranch(branch: BranchRow, payload: Partial<{ name: string; isActive: boolean; enableCashier: boolean; enableDispatch: boolean }>) {
    setBusyBranchId(branch.id);
    try {
      const response = await apiFetch(`/api/master/branches/${branch.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      const raw = await response.json();
      if (!response.ok) throw new Error(getMessage(raw, "No se pudo actualizar la sucursal."));

      await load();
      setFeedback({ tone: "success", text: "Sucursal actualizada." });
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "No se pudo actualizar la sucursal." });
    } finally {
      setBusyBranchId(null);
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="hm-section-icon hm-section-icon-master">
              <Building2 className="h-4 w-4" />
            </div>
            <h1 className="text-xl font-bold text-[var(--color-text)]">Sucursales</h1>
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Gestiona sucursales, flujo operativo, cajas fisicas y usuarios asignados.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2">
            <div className="font-semibold text-[var(--color-text)]">{branches.length}</div>
            <div className="text-[var(--color-text-muted)]">Total</div>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2">
            <div className="font-semibold text-[var(--color-text)]">{totals.active}</div>
            <div className="text-[var(--color-text-muted)]">Activas</div>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2">
            <div className="font-semibold text-[var(--color-text)]">{totals.users}</div>
            <div className="text-[var(--color-text-muted)]">Usuarios</div>
          </div>
        </div>
      </div>

      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-[var(--color-master-600)]" />
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Crear sucursal</h2>
        </div>
        <form className="grid gap-3 lg:grid-cols-[0.8fr_1.4fr_auto]" onSubmit={createBranch}>
          <Input
            placeholder="Codigo *"
            value={form.code}
            onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))}
            required
            minLength={2}
            maxLength={24}
          />
          <Input
            placeholder="Nombre de sucursal *"
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            required
            minLength={2}
          />
          <Button type="submit" loading={saving} disabled={loading}>
            Crear sucursal
          </Button>
          <label className="inline-flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <input type="checkbox" checked={form.enableCashier} onChange={(event) => setForm((prev) => ({ ...prev, enableCashier: event.target.checked }))} />
            Caja
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <input type="checkbox" checked={form.enableDispatch} onChange={(event) => setForm((prev) => ({ ...prev, enableDispatch: event.target.checked }))} />
            Despacho
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <input type="checkbox" checked={form.createDefaultCashBox} onChange={(event) => setForm((prev) => ({ ...prev, createDefaultCashBox: event.target.checked }))} />
            Crear caja principal
          </label>
        </form>
      </Card>

      {feedback ? (
        <Card className={`p-3 text-sm ${
          feedback.tone === "error" ? "border-[var(--color-danger-300)] bg-[var(--color-danger-50)] text-[var(--color-danger-700)]" : ""
        } ${
          feedback.tone === "success" ? "border-[var(--color-success-300)] bg-[var(--color-success-50)] text-[var(--color-success-700)]" : ""
        } ${
          feedback.tone === "info" ? "border-[var(--color-info-300)] bg-[var(--color-info-50)] text-[var(--color-info-700)]" : ""
        }`}>
          {feedback.text}
        </Card>
      ) : null}

      {loading ? (
        <Card className="p-8 text-center text-sm text-[var(--color-text-muted)]">
          <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Cargando sucursales...</span>
        </Card>
      ) : null}

      {!loading && branches.length === 0 ? (
        <Card className="p-8 text-center text-sm text-[var(--color-text-muted)]">No hay sucursales registradas.</Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {branches.map((branch) => {
          const moduleConfig = branch.moduleConfig ?? { enableCashier: true, enableDispatch: true };
          const usersByRole = branch.userBranchRoles.reduce<Record<RoleCode, typeof branch.userBranchRoles>>((acc, item) => {
            acc[item.roleCode] = [...(acc[item.roleCode] ?? []), item];
            return acc;
          }, { BRANCH_ADMIN: [], SALES: [], CASHIER: [], WAREHOUSE: [] });
          const busy = busyBranchId === branch.id;

          return (
            <Card key={branch.id} className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-[var(--color-text)]">{branch.code}</h2>
                    <Badge variant={branch.isActive ? "success" : "warning"}>{branch.isActive ? "Activa" : "Inactiva"}</Badge>
                  </div>
                  <p className="text-sm text-[var(--color-text-muted)]">{branch.name}</p>
                </div>
                <Button
                  variant={branch.isActive ? "secondary" : "success"}
                  size="sm"
                  loading={busy}
                  disabled={busyBranchId !== null}
                  onClick={() => patchBranch(branch, { isActive: !branch.isActive })}
                >
                  {branch.isActive ? "Desactivar" : "Activar"}
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <div className="rounded-lg border border-[var(--color-border)] p-3">
                  <ReceiptText className="mb-1 h-4 w-4 text-[var(--color-text-muted)]" />
                  <div className="text-lg font-semibold text-[var(--color-text)]">{branch._count.saleOrders}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">Ordenes</div>
                </div>
                <div className="rounded-lg border border-[var(--color-border)] p-3">
                  <Boxes className="mb-1 h-4 w-4 text-[var(--color-text-muted)]" />
                  <div className="text-lg font-semibold text-[var(--color-text)]">{branch._count.inventoryBalances}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">Inventario</div>
                </div>
                <div className="rounded-lg border border-[var(--color-border)] p-3">
                  <CreditCard className="mb-1 h-4 w-4 text-[var(--color-text-muted)]" />
                  <div className="text-lg font-semibold text-[var(--color-text)]">{branch.physicalCashBoxes.length}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">Cajas</div>
                </div>
                <div className="rounded-lg border border-[var(--color-border)] p-3">
                  <Users className="mb-1 h-4 w-4 text-[var(--color-text-muted)]" />
                  <div className="text-lg font-semibold text-[var(--color-text)]">{branch.userBranchRoles.length}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">Roles</div>
                </div>
              </div>

              <div className="rounded-lg border border-[var(--color-border)] p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                  <Settings2 className="h-4 w-4" /> Flujo operativo
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={moduleConfig.enableCashier ? "success" : "secondary"}
                    loading={busy}
                    disabled={busyBranchId !== null}
                    onClick={() => patchBranch(branch, { enableCashier: !moduleConfig.enableCashier })}
                  >
                    Caja {moduleConfig.enableCashier ? "activa" : "inactiva"}
                  </Button>
                  <Button
                    size="sm"
                    variant={moduleConfig.enableDispatch ? "success" : "secondary"}
                    loading={busy}
                    disabled={busyBranchId !== null}
                    onClick={() => patchBranch(branch, { enableDispatch: !moduleConfig.enableDispatch })}
                  >
                    Despacho {moduleConfig.enableDispatch ? "activo" : "inactivo"}
                  </Button>
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Cajas fisicas</h3>
                <div className="space-y-2">
                  {branch.physicalCashBoxes.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-[var(--color-border)] p-3 text-sm text-[var(--color-text-muted)]">Sin cajas registradas.</div>
                  ) : branch.physicalCashBoxes.map((box) => (
                    <div key={box.id} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] px-3 py-2">
                      <div>
                        <div className="text-sm font-medium text-[var(--color-text)]">{box.code}</div>
                        <div className="text-xs text-[var(--color-text-muted)]">{box.description ?? "Sin descripcion"} · {box._count.sessions} sesiones</div>
                      </div>
                      <Badge variant={box.isActive ? "success" : "neutral"}>{box.isActive ? "Activa" : "Inactiva"}</Badge>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Usuarios ligados</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {Object.entries(usersByRole).map(([role, memberships]) => (
                    <div key={role} className="rounded-lg border border-[var(--color-border)] p-3">
                      <div className="mb-2 text-xs font-semibold uppercase text-[var(--color-text-muted)]">{ROLE_LABEL[role as RoleCode]}</div>
                      {memberships.length === 0 ? (
                        <div className="text-xs text-[var(--color-text-soft)]">Sin usuarios</div>
                      ) : (
                        <div className="space-y-1">
                          {memberships.map((membership) => (
                            <div key={membership.id} className="truncate text-sm text-[var(--color-text)]">
                              {membership.user.fullName || membership.user.username}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
