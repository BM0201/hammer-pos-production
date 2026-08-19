"use client";

import { TimberList } from "@/components/timber/timber-list";
import { Package } from "lucide-react";

export default function TimberCatalogPage() {
  return (
    <section className="space-y-4">
      <header className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 lg:p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-warehouse-50)] text-[var(--color-warehouse-700)]">
            <Package className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Catálogo de Madera</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Listado, edición y control de productos de madera.</p>
          </div>
        </div>
      </header>

      <TimberList />
    </section>
  );
}
