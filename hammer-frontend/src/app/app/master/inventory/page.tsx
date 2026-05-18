"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { InventoryAdmin } from "@/components/inventory/inventory-admin";
import { InventoryImportAdmin } from "@/components/inventory/inventory-import-admin";
import { apiFetch } from "@/lib/client/api";

type Branch = { id: string; code: string; name: string };
type Category = { id: string; name: string };

export default function MasterInventoryPage() {
  const searchParams = useSearchParams();
  const branchId = searchParams.get("branchId") ?? undefined;
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [branchesRes, categoriesRes] = await Promise.all([
          apiFetch("/api/branches"),
          apiFetch("/api/catalog/categories"),
        ]);
        if (cancelled) return;
        if (branchesRes.ok) {
          const rawBranches = await branchesRes.json();
          const list: Branch[] = Array.isArray(rawBranches) ? rawBranches : rawBranches.data ?? [];
          setBranches(list);
        }
        if (categoriesRes.ok) {
          const rawCategories = await categoriesRes.json();
          const list: Category[] = Array.isArray(rawCategories) ? rawCategories : rawCategories.data ?? [];
          setCategories(list.map((c: Category) => ({ id: c.id, name: c.name })));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedBranch = branchId ? branches.find((branch) => branch.id === branchId) ?? null : null;
  const hasInvalidBranchSelection = Boolean(branchId) && !loading && !selectedBranch;

  return (
    <section className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div
            className="h-8 w-1 rounded-full"
            style={{
              background: "linear-gradient(to bottom, var(--color-master-400), var(--color-master-600))",
            }}
          />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Inventario Global</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Operación de inventario multi-sucursal. Seleccione una sucursal para operar movimientos.</p>
          </div>
        </div>
      </div>

      <InventoryImportAdmin
        branches={branches.map((branch) => ({ id: branch.id, code: branch.code, name: branch.name }))}
        categories={categories}
      />

      <div className="flex flex-wrap gap-2 text-sm">
        {branches.map((branch) => (
          <Link
            key={branch.id}
            className={`rounded-lg border px-3 py-1.5 font-medium transition-colors ${
              branchId === branch.id
                ? "bg-[var(--color-master-600)] text-white border-[var(--color-master-600)]"
                : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]"
            }`}
            href={`/app/master/inventory?branchId=${branch.id}`}
          >
            {branch.code}
          </Link>
        ))}
      </div>

      {hasInvalidBranchSelection ? (
        <div className="hm-alert hm-alert-error">
          <div>La sucursal seleccionada no está disponible. Seleccione una sucursal activa.</div>
        </div>
      ) : selectedBranch ? (
        <InventoryAdmin branchId={selectedBranch.id} branchCode={selectedBranch.code} branchName={selectedBranch.name} />
      ) : loading ? (
        <p className="text-[var(--color-text-muted)] animate-pulse">Cargando sucursales…</p>
      ) : (
        <div className="hm-alert hm-alert-info">
          <div>Seleccione una sucursal para ver balances y registrar movimientos.</div>
        </div>
      )}
    </section>
  );
}
