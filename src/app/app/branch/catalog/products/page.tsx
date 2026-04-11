import { requireCapabilityInAnyAssignedBranch, requireSession } from "@/modules/auth/guards";
import { ProductsViewer } from "@/components/catalog/products-viewer";
import { CAPABILITIES } from "@/modules/rbac/policies";

export default async function BranchProductsPage() {
  await requireCapabilityInAnyAssignedBranch(CAPABILITIES.BRANCH_CATALOG_VIEW);
  await requireSession();

  return (
    <section className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div
            className="h-8 w-1 rounded-full"
            style={{
              background: "linear-gradient(to bottom, var(--color-branch-admin-400), var(--color-branch-admin-600))",
            }}
          />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Catálogo de Productos</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Consulta y búsqueda de productos disponibles en sucursal</p>
          </div>
        </div>
      </div>
      <ProductsViewer />
    </section>
  );
}
