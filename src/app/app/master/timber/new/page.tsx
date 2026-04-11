import { requireMaster } from "@/modules/auth/guards";
import { prisma } from "@/lib/prisma";
import { TimberForm } from "@/components/timber/timber-form";
import { TreePine, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function NewTimberPage() {
  await requireMaster();

  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <section className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/app/master/timber">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="hm-section-icon hm-section-icon-warehouse">
          <TreePine className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-[var(--color-text)]">Nuevo Producto de Madera</h1>
          <p className="text-xs text-[var(--color-text-muted)]">Complete las dimensiones para calcular precios automáticamente</p>
        </div>
      </div>

      <TimberForm categories={categories} mode="create" />
    </section>
  );
}
