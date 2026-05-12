"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/client/api";

type CashBoxRow = {
  id: string;
  code: string;
  description: string | null;
  isActive: boolean;
  branchId: string;
  branch: { id: string; code: string; name: string };
  _count: { sessions: number };
};

export function MasterCashBoxes() {
  const [cashBoxes, setCashBoxes] = useState<CashBoxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/master/cash-boxes");
      const json = (await response.json()) as { data: CashBoxRow[] };
      setCashBoxes(json.data ?? []);
    } catch {
      showToast("error", "No se pudo cargar la lista de cajas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggle(id: string) {
    setToggling(id);
    try {
      const response = await apiFetch(`/api/master/cash-boxes/${id}/toggle`, { method: "PATCH" });
      const json = (await response.json()) as { data: CashBoxRow };
      if (!response.ok) {
        showToast("error", "No se pudo cambiar el estado de la caja.");
        return;
      }
      showToast("success", `Caja ${json.data.code} ${json.data.isActive ? "activada" : "desactivada"}.`);
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
        <p className="text-sm text-[var(--color-text-muted)]">Activa o desactiva cajas por sucursal. Las cajas desactivadas no estarán disponibles para abrir sesión.</p>
      </div>

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
