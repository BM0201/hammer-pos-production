import { requireMaster } from "@/modules/auth/guards";
import { ProductsAdmin } from "@/components/catalog/products-admin";

export default async function MasterProductsPage() {
  await requireMaster();

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
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Catálogo de Productos</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Administración global de productos, precios y configuración</p>
          </div>
        </div>
      </div>
      <ProductsAdmin />
    </section>
  );
}
