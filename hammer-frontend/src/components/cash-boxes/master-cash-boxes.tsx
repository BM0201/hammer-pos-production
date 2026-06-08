"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";

type CashBoxRow = {
  id: string;
  code: string;
  description: string | null;
  isActive: boolean;
  branchId: string;
  branch: { id: string; code: string; name: string };
  _count: { sessions: number };
};

type BranchOption = { id: string; code: string; name: string };

export function MasterCashBoxes() {
  const [cashBoxes, setCashBoxes] = useState<CashBoxRow[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  // Formulario de creación manual
  const [formBranchId, setFormBranchId] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [consolidating, setConsolidating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [boxesRes, branchesRes] = await Promise.all([
        fetch("/api/master/cash-boxes"),
        fetch("/api/master/branches"),
      ]);
      const boxesRaw = await boxesRes.json();
      const list = unwrapApiData(boxesRaw);
      setCashBoxes(Array.isArray(list) ? list : []);

      const branchesRaw = await branchesRes.json();
      const branchList = unwrapApiData(branchesRaw);
      if (Array.isArray(branchList)) {
        setBranches(
          branchList
            .filter((b: { isActive?: boolean }) => b.isActive !== false)
            .map((b: { id: string; code: string; name: string }) => ({ id: b.id, code: b.code, name: b.name })),
        );
      }
    } catch {
      showToast("error", "No se pudo cargar la lista de cajas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createCashBox() {
    if (!formBranchId) {
      showToast("error", "Seleccione una sucursal.");
      return;
    }
    setCreating(true);
    try {
      const response = await apiFetch("/api/master/cash-boxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: formBranchId, description: formDescription.trim() || undefined }),
      });
      const raw = await response.json();
      if (!response.ok) {
        showToast("error", raw?.error?.message ?? "No se pudo crear la caja.");
        return;
      }
      const box = unwrapApiData(raw) as CashBoxRow;
      showToast("success", `Caja ${box.code} creada correctamente.`);
      setFormBranchId("");
      setFormDescription("");
      await load();
    } catch {
      showToast("error", "Error de red al crear la caja.");
    } finally {
      setCreating(false);
    }
  }

  async function backfill() {
    setBackfilling(true);
    try {
      const response = await apiFetch("/api/master/cash-boxes/backfill", { method: "POST" });
      const raw = await response.json();
      if (!response.ok) {
        showToast("error", raw?.error?.message ?? "No se pudo ejecutar la creación automática.");
        return;
      }
      const result = unwrapApiData(raw) as { createdCount: number; message: string };
      showToast(result.createdCount > 0 ? "success" : "info", result.message);
      await load();
    } catch {
      showToast("error", "Error de red al crear cajas faltantes.");
    } finally {
      setBackfilling(false);
    }
  }

  async function consolidate() {
    if (!window.confirm(
      "Esto dejará UNA sola caja física por sucursal. Las cajas duplicadas se eliminarán y sus sesiones se moverán a la caja que se conserva. ¿Deseas continuar?",
    )) {
      return;
    }
    setConsolidating(true);
    try {
      const response = await apiFetch("/api/master/cash-boxes/consolidate", { method: "POST" });
      const raw = await response.json();
      if (!response.ok) {
        showToast("error", raw?.error?.message ?? "No se pudo consolidar las cajas duplicadas.");
        return;
      }
      const result = unwrapApiData(raw) as { consolidatedBranches: number; message: string };
      showToast(result.consolidatedBranches > 0 ? "success" : "info", result.message);
      await load();
    } catch {
      showToast("error", "Error de red al consolidar cajas.");
    } finally {
      setConsolidating(false);
    }
  }

  // Sucursales que aún no tienen ninguna caja física activa
  const branchIdsWithActiveBox = new Set(cashBoxes.filter((box) => box.isActive).map((box) => box.branchId));
  const branchIdsWithBox = new Set(cashBoxes.map((box) => box.branchId));
  const branchesWithoutBox = branches.filter((b) => !branchIdsWithBox.has(b.id));
  // Solo se puede crear caja en sucursales sin caja activa (regla: 1 caja por sucursal).
  const branchesAvailableForCreate = branches.filter((b) => !branchIdsWithActiveBox.has(b.id));
  // Sucursales con más de una caja (duplicadas) — requieren consolidación.
  const branchBoxCounts = cashBoxes.reduce<Record<string, number>>((acc, box) => {
    acc[box.branchId] = (acc[box.branchId] ?? 0) + 1;
    return acc;
  }, {});
  const branchesWithDuplicates = Object.values(
    cashBoxes.reduce<Record<string, { code: string; name: string }>>((acc, box) => {
      if (branchBoxCounts[box.branchId] > 1) acc[box.branchId] = { code: box.branch.code, name: box.branch.name };
      return acc;
    }, {}),
  );

  async function toggle(id: string) {
    setToggling(id);
    try {
      const response = await apiFetch(`/api/master/cash-boxes/${id}/toggle`, { method: "PATCH" });
      const raw = await response.json();
      if (!response.ok) {
        showToast("error", "No se pudo cambiar el estado de la caja.");
        return;
      }
      const box = unwrapApiData(raw) as CashBoxRow;
      showToast("success", `Caja ${box.code} ${box.isActive ? "activada" : "desactivada"}.`);
      await load();
    } catch {
      showToast("error", "Error de red al cambiar estado.");
    } finally {
      setToggling(null);
    }
  }

  // Group by branch
  const grouped = cashBoxes.reduce<Record<string, { branch: { code: string; name: string }; boxes: CashBoxRow[] }>>((acc, box) => {
    if (!acc[box.branchId]) {
      acc[box.branchId] = { branch: box.branch, boxes: [] };
    }
    acc[box.branchId].boxes.push(box);
    return acc;
  }, {});

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--color-text)]">Gestión de Cajas Físicas</h1>
        <p className="text-sm text-[var(--color-text-muted)]">Cada sucursal tiene UNA sola caja física (varios vendedores la comparten). Una sucursal necesita su caja activa para poder cobrar.</p>
      </div>

      {/* ── Crear caja manual ── */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Crear nueva caja</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="secondary"
              size="sm"
              onClick={backfill}
              loading={backfilling}
              disabled={creating || backfilling || consolidating}
              title="Crea automáticamente la caja principal de cada sucursal que aún no tenga ninguna"
            >
              Crear cajas faltantes
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={consolidate}
              loading={consolidating}
              disabled={creating || backfilling || consolidating}
              title="Deja una sola caja física por sucursal y elimina las duplicadas"
            >
              Consolidar duplicadas
            </Button>
          </div>
        </div>

        {branchesWithDuplicates.length > 0 && (
          <div className="rounded-md border border-[var(--color-danger-300)] bg-[var(--color-danger-50)] px-3 py-2 text-xs text-[var(--color-danger-700)]">
            {branchesWithDuplicates.length === 1
              ? `La sucursal ${branchesWithDuplicates[0].code} — ${branchesWithDuplicates[0].name} tiene más de una caja física. Solo debe haber una por sucursal. Use "Consolidar duplicadas".`
              : `${branchesWithDuplicates.length} sucursales tienen cajas duplicadas: ${branchesWithDuplicates.map((b) => b.code).join(", ")}. Use "Consolidar duplicadas".`}
          </div>
        )}

        {branchesWithoutBox.length > 0 && (
          <div className="rounded-md border border-[var(--color-warning-300)] bg-[var(--color-warning-50)] px-3 py-2 text-xs text-[var(--color-warning-700)]">
            {branchesWithoutBox.length === 1
              ? `La sucursal ${branchesWithoutBox[0].code} — ${branchesWithoutBox[0].name} no tiene ninguna caja física y no podrá cobrar.`
              : `${branchesWithoutBox.length} sucursales no tienen caja física: ${branchesWithoutBox.map((b) => b.code).join(", ")}. Use "Crear cajas faltantes".`}
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1">
            <label className="block text-sm font-medium text-[var(--color-text-secondary)]">Sucursal</label>
            <select
              className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-[var(--color-surface)] text-[var(--color-text)]"
              value={formBranchId}
              onChange={(e) => setFormBranchId(e.target.value)}
              disabled={creating}
            >
              <option value="">Seleccione una sucursal…</option>
              {branchesAvailableForCreate.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
            </select>
            {branchesAvailableForCreate.length === 0 && (
              <p className="text-xs text-[var(--color-text-soft)]">Todas las sucursales ya tienen una caja activa.</p>
            )}
          </div>
          <div className="flex-1 space-y-1">
            <label className="block text-sm font-medium text-[var(--color-text-secondary)]">Descripción (opcional)</label>
            <input
              className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-[var(--color-surface)] text-[var(--color-text)]"
              placeholder="Ej. Caja principal"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              disabled={creating}
            />
          </div>
          <Button onClick={createCashBox} loading={creating} disabled={creating || backfilling || !formBranchId}>
            Crear caja
          </Button>
        </div>
        <p className="text-xs text-[var(--color-text-soft)]">El código se genera automáticamente (CASH-SUCURSAL-01, -02, …).</p>
      </Card>

      {loading && (
        <Card className="p-6 text-center text-sm text-[var(--color-text-muted)]">Cargando cajas…</Card>
      )}

      {!loading && Object.entries(grouped).map(([branchId, { branch, boxes }]) => (
        <Card key={branchId} className="overflow-hidden">
          <div className="border-b border-[var(--color-border)] px-5 py-3 bg-[var(--color-surface-muted)]">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">
              {branch.code} — {branch.name}
            </h2>
          </div>
          <div className="divide-y divide-[var(--color-border)]">
            {boxes.map((box) => (
              <div key={box.id} className="flex items-center justify-between px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <div className={`h-3 w-3 rounded-full ${box.isActive ? "bg-[var(--color-success-500)]" : "bg-[var(--color-text-soft)]"}`} />
                  <div>
                    <div className="font-medium text-sm text-[var(--color-text)]">{box.code}</div>
                    {box.description && (
                      <div className="text-xs text-[var(--color-text-muted)]">{box.description}</div>
                    )}
                    <div className="text-xs text-[var(--color-text-soft)]">{box._count.sessions} sesiones registradas</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={box.isActive ? "success" : "neutral"}>
                    {box.isActive ? "Activa" : "Inactiva"}
                  </Badge>
                  <Button
                    variant={box.isActive ? "secondary" : "success"}
                    size="sm"
                    onClick={() => toggle(box.id)}
                    loading={toggling === box.id}
                    disabled={toggling !== null}
                  >
                    {box.isActive ? "Desactivar" : "Activar"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}

      {!loading && cashBoxes.length === 0 && (
        <Card className="p-6 text-center text-sm text-[var(--color-text-muted)]">No hay cajas físicas registradas.</Card>
      )}
    </section>
  );
}
