"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { Link2, Plus, Trash2, X, Search } from "lucide-react";

/* ───────────────────────── Tipos ───────────────────────── */

type ProductLite = { id: string; sku: string; name: string; unit: string };

type FusionMember = {
  productId: string;
  sku: string;
  productName: string;
  saleUnit: string;
  conversionFactor: number;
  isCanonical: boolean;
};

type FusionGroup = {
  id: string;
  code: string;
  name: string;
  baseUnit: string;
  isActive: boolean;
  category: { id: string; code: string; name: string } | null;
  members: {
    id: string;
    productId: string;
    sku: string;
    productName: string;
    saleUnit: string;
    conversionFactor: number;
    isCanonical: boolean;
  }[];
};

/* ─────────────── Casos comunes preconfigurados ─────────────── */
/* Sólo precargan nombre/unidades/factores; el usuario asigna los productos. */

type Preset = {
  key: string;
  label: string;
  name: string;
  baseUnit: string;
  derived: { saleUnit: string; conversionFactor: number; hint: string }[];
  description: string;
};

const PRESETS: Preset[] = [
  {
    key: "hierro_3_8",
    label: 'Hierro 3/8"',
    name: 'Hierro 3/8" - stock compartido',
    baseUnit: "VARILLA",
    derived: [{ saleUnit: "QUINTAL", conversionFactor: 14, hint: "1 quintal = 14 varillas" }],
    description: "Principal: varilla. Derivado: quintal (1 quintal = 14 varillas).",
  },
  {
    key: "hierro_1_2",
    label: 'Hierro 1/2"',
    name: 'Hierro 1/2" - stock compartido',
    baseUnit: "VARILLA",
    derived: [{ saleUnit: "QUINTAL", conversionFactor: 8, hint: "1 quintal = 8 varillas" }],
    description: "Principal: varilla. Derivado: quintal (1 quintal = 8 varillas).",
  },
  {
    key: "hierro_1_4",
    label: 'Hierro 1/4"',
    name: 'Hierro 1/4" - stock compartido',
    baseUnit: "VARILLA",
    derived: [{ saleUnit: "QUINTAL", conversionFactor: 30, hint: "1 quintal = 30 varillas" }],
    description: "Principal: varilla. Derivado: quintal (1 quintal = 30 varillas).",
  },
  {
    key: "alambre",
    label: "Alambre",
    name: "Alambre - stock compartido",
    baseUnit: "LIBRA",
    derived: [{ saleUnit: "QUINTAL", conversionFactor: 100, hint: "1 quintal = 100 libras" }],
    description: "Principal: libra. Derivado: quintal (1 quintal = 100 libras).",
  },
  {
    key: "clavos",
    label: "Clavos",
    name: "Clavos - stock compartido",
    baseUnit: "LIBRA",
    derived: [{ saleUnit: "CAJA", conversionFactor: 50, hint: "1 caja = 50 libras" }],
    description: "Principal: libra. Derivado: caja de 50 lb (1 caja = 50 libras).",
  },
];

/* ───────────────────────── Componente ───────────────────────── */

export function InventoryFusionPanel() {
  const [groups, setGroups] = useState<FusionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Formulario
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [baseUnit, setBaseUnit] = useState("");
  const [members, setMembers] = useState<FusionMember[]>([]);

  // Buscador de productos
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ProductLite[]>([]);
  const [searching, setSearching] = useState(false);

  const loadGroups = useCallback(async () => {
    try {
      const res = await fetch("/api/inventory/stock-groups");
      const raw = await res.json();
      const list = unwrapApiData(raw);
      setGroups(Array.isArray(list) ? list : []);
    } catch {
      showToast("error", "No se pudieron cargar las fusiones.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  // Búsqueda de productos con debounce
  useEffect(() => {
    if (!search.trim()) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/catalog/products?isActive=true&limit=20&q=${encodeURIComponent(search.trim())}`);
        const raw = await res.json();
        const list = unwrapApiData(raw);
        setResults(
          Array.isArray(list)
            ? list.map((p: { id: string; sku: string; name: string; unit: string }) => ({ id: p.id, sku: p.sku, name: p.name, unit: p.unit }))
            : [],
        );
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [search]);

  const usedProductIds = useMemo(() => new Set(members.map((m) => m.productId)), [members]);

  function resetForm() {
    setEditingId(null);
    setName("");
    setBaseUnit("");
    setMembers([]);
    setSearch("");
    setResults([]);
  }

  function addProduct(product: ProductLite) {
    if (usedProductIds.has(product.id)) {
      showToast("info", "Ese producto ya está en la fusión.");
      return;
    }
    const isFirst = members.length === 0;
    setMembers((prev) => [
      ...prev,
      {
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        saleUnit: product.unit || (isFirst ? baseUnit : ""),
        conversionFactor: isFirst ? 1 : 1,
        isCanonical: isFirst,
      },
    ]);
    if (isFirst && !baseUnit) setBaseUnit(product.unit || "");
    setSearch("");
    setResults([]);
  }

  function removeMember(productId: string) {
    setMembers((prev) => {
      const next = prev.filter((m) => m.productId !== productId);
      // Si se quitó el principal, asignar el primero restante como principal.
      if (!next.some((m) => m.isCanonical) && next.length > 0) {
        next[0] = { ...next[0], isCanonical: true, conversionFactor: 1 };
      }
      return next;
    });
  }

  function setCanonical(productId: string) {
    setMembers((prev) =>
      prev.map((m) =>
        m.productId === productId
          ? { ...m, isCanonical: true, conversionFactor: 1 }
          : { ...m, isCanonical: false },
      ),
    );
  }

  function updateMember(productId: string, patch: Partial<FusionMember>) {
    setMembers((prev) => prev.map((m) => (m.productId === productId ? { ...m, ...patch } : m)));
  }

  function applyPreset(preset: Preset) {
    if (!name.trim()) setName(preset.name);
    if (!baseUnit.trim()) setBaseUnit(preset.baseUnit);
    showToast(
      "info",
      `Plantilla "${preset.label}": ${preset.description} Ahora seleccione los productos correspondientes.`,
    );
  }

  function startEdit(group: FusionGroup) {
    setEditingId(group.id);
    setName(group.name);
    setBaseUnit(group.baseUnit);
    setMembers(
      group.members.map((m) => ({
        productId: m.productId,
        sku: m.sku,
        productName: m.productName,
        saleUnit: m.saleUnit,
        conversionFactor: m.conversionFactor,
        isCanonical: m.isCanonical,
      })),
    );
    setSearch("");
    setResults([]);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save() {
    if (!name.trim()) {
      showToast("error", "Ingrese un nombre para la fusión.");
      return;
    }
    if (members.length < 2) {
      showToast("error", "Agregue al menos el producto principal y un derivado.");
      return;
    }
    const canonicalCount = members.filter((m) => m.isCanonical).length;
    if (canonicalCount !== 1) {
      showToast("error", "Debe marcar exactamente un producto como principal.");
      return;
    }
    for (const m of members) {
      if (!m.saleUnit.trim()) {
        showToast("error", `Indique la unidad de venta de ${m.sku}.`);
        return;
      }
      if (!(m.conversionFactor > 0)) {
        showToast("error", `El factor de ${m.sku} debe ser mayor que 0.`);
        return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        baseUnit: baseUnit.trim() || members.find((m) => m.isCanonical)?.saleUnit,
        members: members.map((m) => ({
          productId: m.productId,
          saleUnit: m.saleUnit.trim(),
          conversionFactor: Number(m.conversionFactor),
          isCanonical: m.isCanonical,
        })),
      };
      const url = editingId ? `/api/inventory/stock-groups/${editingId}` : "/api/inventory/stock-groups";
      const method = editingId ? "PUT" : "POST";
      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const raw = await res.json();
      if (!res.ok) {
        showToast("error", raw?.error?.message ?? "No se pudo guardar la fusión.");
        return;
      }
      showToast("success", editingId ? "Fusión actualizada." : "Fusión creada correctamente.");
      resetForm();
      await loadGroups();
    } catch {
      showToast("error", "Error de red al guardar la fusión.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(group: FusionGroup) {
    if (typeof window !== "undefined" && !window.confirm(`¿Eliminar la fusión "${group.name}"? Los productos volverán a manejar stock por separado.`)) {
      return;
    }
    setDeletingId(group.id);
    try {
      const res = await apiFetch(`/api/inventory/stock-groups/${group.id}`, { method: "DELETE" });
      const raw = await res.json();
      if (!res.ok) {
        showToast("error", raw?.error?.message ?? "No se pudo eliminar la fusión.");
        return;
      }
      showToast("success", "Fusión eliminada.");
      if (editingId === group.id) resetForm();
      await loadGroups();
    } catch {
      showToast("error", "Error de red al eliminar la fusión.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--color-text)] flex items-center gap-2">
          <Link2 className="h-5 w-5" /> Fusión de Inventario
        </h1>
        <p className="text-sm text-[var(--color-text-muted)] max-w-3xl">
          Une dos o más productos que comparten el mismo inventario físico pero se venden en distintas
          presentaciones. El <strong>producto principal</strong> lleva el stock (unidad base) y cada
          <strong> derivado</strong> descuenta del mismo inventario según su factor de conversión.
          Ej.: vender 1 quintal de hierro 3/8&quot; descuenta 14 varillas del stock.
        </p>
      </div>

      {/* ── Formulario crear / editar ── */}
      <Card className="p-5 space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            {editingId ? "Editar fusión" : "Nueva fusión"}
          </h2>
          {editingId && (
            <Button variant="ghost" size="sm" onClick={resetForm}>
              Cancelar edición
            </Button>
          )}
        </div>

        {/* Plantillas comunes */}
        <div>
          <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-2">Plantillas comunes (precargan nombre y factores):</p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => applyPreset(preset)}
                className="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-muted)] transition-colors"
                title={preset.description}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="block text-sm font-medium text-[var(--color-text-secondary)]">Nombre de la fusión</label>
            <input
              className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-[var(--color-surface)] text-[var(--color-text)]"
              placeholder='Ej. Hierro 3/8" - stock compartido'
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-[var(--color-text-secondary)]">Unidad base (del producto principal)</label>
            <input
              className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-[var(--color-surface)] text-[var(--color-text)]"
              placeholder="Ej. VARILLA, LIBRA"
              value={baseUnit}
              onChange={(e) => setBaseUnit(e.target.value.toUpperCase())}
              disabled={saving}
            />
          </div>
        </div>

        {/* Buscador de productos */}
        <div className="space-y-1">
          <label className="block text-sm font-medium text-[var(--color-text-secondary)]">Agregar producto a la fusión</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-soft)]" />
            <input
              className="w-full rounded-lg border border-[var(--color-border)] pl-9 pr-3 py-2 text-sm bg-[var(--color-surface)] text-[var(--color-text)]"
              placeholder="Buscar por nombre o SKU…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={saving}
            />
            {(results.length > 0 || searching) && (
              <div className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
                {searching && <div className="px-3 py-2 text-xs text-[var(--color-text-soft)]">Buscando…</div>}
                {results.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addProduct(p)}
                    disabled={usedProductIds.has(p.id)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-muted)] disabled:opacity-40"
                  >
                    <span className="truncate">
                      <span className="font-medium text-[var(--color-text)]">{p.name}</span>
                      <span className="ml-2 text-xs text-[var(--color-text-soft)]">{p.sku} · {p.unit}</span>
                    </span>
                    <Plus className="h-4 w-4 flex-shrink-0 text-[var(--color-text-soft)]" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Miembros de la fusión */}
        {members.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-[var(--color-text-secondary)]">Productos en la fusión:</p>
            <div className="space-y-2">
              {members.map((m) => (
                <div key={m.productId} className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border)] px-3 py-2">
                  <div className="min-w-[10rem] flex-1">
                    <div className="text-sm font-medium text-[var(--color-text)] truncate">{m.productName}</div>
                    <div className="text-xs text-[var(--color-text-soft)]">{m.sku}</div>
                  </div>

                  <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
                    <input
                      type="radio"
                      name="canonical"
                      checked={m.isCanonical}
                      onChange={() => setCanonical(m.productId)}
                      disabled={saving}
                    />
                    Principal
                  </label>

                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-[var(--color-text-soft)]">Unidad</span>
                    <input
                      className="w-24 rounded-md border border-[var(--color-border)] px-2 py-1 text-sm bg-[var(--color-surface)] text-[var(--color-text)]"
                      value={m.saleUnit}
                      onChange={(e) => updateMember(m.productId, { saleUnit: e.target.value.toUpperCase() })}
                      placeholder="Unidad"
                      disabled={saving}
                    />
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-[var(--color-text-soft)]">Factor</span>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      className="w-24 rounded-md border border-[var(--color-border)] px-2 py-1 text-sm bg-[var(--color-surface)] text-[var(--color-text)] disabled:opacity-50"
                      value={m.conversionFactor}
                      onChange={(e) => updateMember(m.productId, { conversionFactor: Number(e.target.value) })}
                      disabled={saving || m.isCanonical}
                      title={m.isCanonical ? "El producto principal siempre tiene factor 1" : "Cuántas unidades base equivale 1 de esta presentación"}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => removeMember(m.productId)}
                    className="text-[var(--color-danger-600)] hover:opacity-70"
                    title="Quitar de la fusión"
                    disabled={saving}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <p className="text-xs text-[var(--color-text-soft)]">
              El producto <strong>principal</strong> tiene factor 1 (lleva el stock). En cada derivado, el
              factor indica <strong>cuántas unidades base equivale 1 unidad de esa presentación</strong>.
            </p>
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={save} loading={saving} disabled={saving || members.length < 2}>
            {editingId ? "Guardar cambios" : "Fusionar"}
          </Button>
        </div>
      </Card>

      {/* ── Fusiones existentes ── */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Fusiones existentes</h2>

        {loading && (
          <Card className="p-6 text-center text-sm text-[var(--color-text-muted)]">Cargando fusiones…</Card>
        )}

        {!loading && groups.length === 0 && (
          <Card className="p-6 text-center text-sm text-[var(--color-text-muted)]">
            Aún no hay fusiones configuradas. Cree una arriba.
          </Card>
        )}

        {!loading && groups.map((group) => {
          const canonical = group.members.find((m) => m.isCanonical);
          return (
            <Card key={group.id} className="overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-3 bg-[var(--color-surface-muted)] flex-wrap">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">{group.name}</h3>
                  <p className="text-xs text-[var(--color-text-soft)]">
                    {group.code} · Unidad base: {group.baseUnit}
                    {group.category ? ` · ${group.category.name}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => startEdit(group)}>Editar</Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => remove(group)}
                    loading={deletingId === group.id}
                    disabled={deletingId !== null}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="divide-y divide-[var(--color-border)]">
                {group.members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between px-5 py-2.5">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[var(--color-text)] truncate">{m.productName}</div>
                      <div className="text-xs text-[var(--color-text-soft)]">{m.sku} · {m.saleUnit}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      {m.isCanonical ? (
                        <Badge variant="success">Principal (stock)</Badge>
                      ) : (
                        <span className="text-xs text-[var(--color-text-muted)]">
                          1 {m.saleUnit} = {m.conversionFactor} {canonical?.saleUnit ?? group.baseUnit}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
