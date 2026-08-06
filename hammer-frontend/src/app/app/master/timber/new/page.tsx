"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TimberForm } from "@/components/timber/timber-form";
import { TreePine, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch, unwrapApiData } from "@/lib/client/api";

type Category = { id: string; name: string };

export default function NewTimberPage() {
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/catalog/categories")
      .then(async (r) => (r.ok ? r.json() : null))
      .then((raw) => {
        if (cancelled || !raw) return;
        const unwrapped = unwrapApiData(raw);
        const list: Category[] = Array.isArray(unwrapped) ? unwrapped : [];
        setCategories(list.map((c) => ({ id: c.id, name: c.name })));
      })
      .catch(() => {
        /* swallow */
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
