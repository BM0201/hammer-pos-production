"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TimberForm } from "@/components/timber/timber-form";
import { TreePine, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch, unwrapApiData } from "@/lib/client/api";

type Category = { id: string; name: string };

type TimberProductWithProduct = {
  id: string;
  thickness: number | string;
  width: number | string;
  length: number | string;
  product: {
    name: string;
    categoryId: string;
  };
};

type EditTimberPageProps = {
  params: Promise<{ id: string }>;
};

function numFrom(value: number | string): number {
  return typeof value === "string" ? Number(value) : value;
}

export default function EditTimberPage({ params }: EditTimberPageProps) {
  const { id } = use(params);
  const [tp, setTp] = useState<TimberProductWithProduct | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFoundState, setNotFoundState] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [tpRes, categoriesRes] = await Promise.all([
          apiFetch(`/api/timber/${id}`),
          apiFetch("/api/catalog/categories"),
        ]);
        if (cancelled) return;

        if (tpRes.status === 404) {
          setNotFoundState(true);
          setLoading(false);
          return;
        }
        if (tpRes.ok) {
          const data = unwrapApiData(await tpRes.json());
          setTp(data as TimberProductWithProduct);
        }
        if (categoriesRes.ok) {
          const rawCats = unwrapApiData(await categoriesRes.json());
          const list: Category[] = Array.isArray(rawCats) ? rawCats : [];
          setCategories(list.map((c) => ({ id: c.id, name: c.name })));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (notFoundState) {
    notFound();
  }

  if (loading || !tp) {
    return <p className="text-[var(--color-text-muted)] animate-pulse">Cargando…</p>;
  }

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
          <h1 className="text-lg font-bold text-[var(--color-text)]">Editar Producto de Madera</h1>
          <p className="text-xs text-[var(--color-text-muted)]">{tp.product.name}</p>
        </div>
      </div>

      <TimberForm
        categories={categories}
        mode="edit"
        initialData={{
          id: tp.id,
          name: tp.product.name,
          thickness: numFrom(tp.thickness),
          width: numFrom(tp.width),
          length: numFrom(tp.length),
          categoryId: tp.product.categoryId,
        }}
      />
    </section>
  );
}
