import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireMaster } from "@/modules/auth/guards";
import { OrdersAdmin } from "@/components/sales/orders-admin";

export default async function MasterSalesOrdersPage({ searchParams }: { searchParams: Promise<{ branchId?: string }> }) {
  await requireMaster();
  const { branchId } = await searchParams;
  const branches = await prisma.branch.findMany({ where: { isActive: true }, orderBy: { code: "asc" } });

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
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Órdenes de Venta</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Supervisión multi-sucursal. Seleccione una sucursal para flujos de creación o vea todas las sucursales.</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link
          className={`rounded-lg border px-3 py-1.5 font-medium transition-colors ${
            !branchId
              ? "bg-[var(--color-master-600)] text-white border-[var(--color-master-600)]"
              : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]"
          }`}
          href="/app/master/sales/orders"
        >
          Todas las sucursales
        </Link>
        {branches.map((branch) => (
          <Link
            key={branch.id}
            className={`rounded-lg border px-3 py-1.5 font-medium transition-colors ${
              branchId === branch.id
                ? "bg-[var(--color-master-600)] text-white border-[var(--color-master-600)]"
                : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]"
            }`}
            href={`/app/master/sales/orders?branchId=${branch.id}`}
          >
            {branch.code}
          </Link>
        ))}
      </div>

      <OrdersAdmin branchId={branchId} isMaster={true} />
    </section>
  );
}
