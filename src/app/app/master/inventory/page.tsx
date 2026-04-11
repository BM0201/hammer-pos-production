import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireMaster } from "@/modules/auth/guards";
import { InventoryAdmin } from "@/components/inventory/inventory-admin";
import { InventoryImportAdmin } from "@/components/inventory/inventory-import-admin";

export default async function MasterInventoryPage({ searchParams }: { searchParams: Promise<{ branchId?: string }> }) {
  await requireMaster();
  const { branchId } = await searchParams;
  const branches = await prisma.branch.findMany({ where: { isActive: true }, orderBy: { code: "asc" } });
  const categories = await prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const selectedBranch = branchId ? branches.find((branch) => branch.id === branchId) ?? null : null;
  const hasInvalidBranchSelection = Boolean(branchId) && !selectedBranch;

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
      ) : (
        <div className="hm-alert hm-alert-info">
          <div>Seleccione una sucursal para ver balances y registrar movimientos.</div>
        </div>
      )}
    </section>
  );
}
