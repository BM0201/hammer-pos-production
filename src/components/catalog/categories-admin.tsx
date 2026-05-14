"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client/api";

type Category = { id: string; code: string; name: string; isActive: boolean };

export function CategoriesAdmin() {
  const [items, setItems] = useState<Category[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await apiFetch("/api/catalog/categories");
    const json = (await res.json()) as { data: Category[] };
    setItems(json.data ?? []);
  }

  useEffect(() => {
    load().catch(() => setError("No se pudieron cargar las categorías."));
  }, []);

  async function createCategory(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const res = await apiFetch("/api/catalog/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name }),
    });

    if (!res.ok) {
      setError("No se pudo crear la categoría.");
      return;
    }

    setCode("");
    setName("");
    await load();
  }

  async function toggleActive(item: Category) {
    await apiFetch(`/api/catalog/categories/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !item.isActive }),
    });
    await load();
  }

  return (
    <section className="space-y-4">
      <form className="grid gap-2 md:grid-cols-3" onSubmit={createCategory}>
        <input className="rounded-lg border border-[var(--color-border)] px-3 py-2" placeholder="Código" value={code} onChange={(e) => setCode(e.target.value)} required />
        <input className="rounded-lg border border-[var(--color-border)] px-3 py-2" placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} required />
        <button className="rounded-lg bg-[var(--color-info-700)] hover:bg-[var(--color-info-800)] px-3 py-2 text-white" type="submit">Crear</button>
      </form>
      {error ? <p className="text-[var(--color-danger-600)] text-sm">{error}</p> : null}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">Código</th>
            <th>Nombre</th>
            <th>Estado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b">
              <td className="py-2">{item.code}</td>
              <td>{item.name}</td>
              <td>{item.isActive ? "Activo" : "Inactivo"}</td>
              <td>
                <button className="rounded-lg border border-[var(--color-border)] px-2 py-1" onClick={() => toggleActive(item)}>
                  {item.isActive ? "Archivar" : "Activar"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
