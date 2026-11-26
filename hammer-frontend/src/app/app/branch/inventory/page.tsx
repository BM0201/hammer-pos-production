"use client";

import { useContext, useEffect, useState } from "react";
import { InventoryAdmin } from "@/components/inventory/inventory-admin";
import { CAPABILITIES, canInBranch } from "@/modules/rbac/policies";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { SessionContext } from "@/lib/client/session";
import { getActiveBranchId } from "@/lib/client/active-branch";

type Branch = { id: string; code: string; name: string };

export default function BranchInventoryPage() {
  // La sesión ya la trajo el layout de /app.
  const session = useContext(SessionContext);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!session) throw new Error("No session");

        const branchId = getActiveBranchId(session.branchIds, session.primaryBranchId);
        if (!branchId) {
          if (!cancelled) {
            setError("No tienes una sucursal asignada.");
            setLoading(false);
          }
          return;
        }

        const branchesRes = await apiFetch("/api/branches");
        if (!branchesRes.ok) {
          throw new Error("Failed to fetch branches");
        }
        const branchesRaw = unwrapApiData(await branchesRes.json());
        const branches: Branch[] = Array.isArray(branchesRaw) ? branchesRaw : [];
        const matched = branches.find((b) => b.id === branchId) ?? null;
        if (!matched) {
          if (!cancelled) {
            setError("Tu sucursal asignada no existe o fue deshabilitada.");
            setLoading(false);
          }
          return;
        }
        if (!cancelled) {
          setBranch(matched);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError("No se pudo cargar la sesión.");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (loading) {
    return <p className="text-[var(--color-text-muted)] animate-pulse">Cargando…</p>;
  }
  if (error) {
    return <p className="text-[var(--color-danger-600)]">{error}</p>;
  }
  if (!session || !branch) {
    return <p className="text-[var(--color-danger-600)]">No tienes una sucursal asignada.</p>;
  }

  // El sidebar ya oculta este link a roles bajos (SALES/CASHIER), pero la
  // página no lo exigía — entrando directo por la URL igual se veía el
  // inventario completo, incluido stock cero. Mismo permiso que decide si
  // el link aparece en el menú.
  if (!canInBranch(session, branch.id, CAPABILITIES.BRANCH_INVENTORY_VIEW)) {
    return <p className="text-[var(--color-danger-600)]">No tienes permiso para ver el inventario de esta sucursal.</p>;
  }

  const canPostManualMovements = canInBranch(session, branch.id, CAPABILITIES.INVENTORY_MOVEMENT_POST);

  return (
    <section className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div
            className="h-8 w-1 rounded-full"
            style={{
              background: "linear-gradient(to bottom, var(--color-warehouse-400), var(--color-warehouse-600))",
            }}
          />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Inventario de Sucursal</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Operaciones restringidas a tu sucursal autorizada</p>
          </div>
        </div>
      </div>
      <InventoryAdmin branchId={branch.id} branchCode={branch.code} branchName={branch.name} canPostManualMovements={canPostManualMovements} />
    </section>
  );
}
