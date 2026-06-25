"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { Link2, PackageOpen, Plus, Trash2, X, Search, Wrench } from "lucide-react";

/* ───────────────────────── Tipos ───────────────────────── */

type ProductLite = { id: string; sku: string; name: string; unit: string };

type FusionMember = {
  productId: string;
  sku: string;
  productName: string;
  saleUnit: string;
  conversionFactor: number;
  isCanonical: boolean;
  isPackagePresentation?: boolean;
  currentTotalStock?: number;
};

type FusionGroup = {
  id: string;
  code: string;
  name: string;
  baseUnit: string;
  packageUnit?: string | null;
  conversionFactorToBase?: number | null;
  tracksPackages?: boolean;
  approximateFactor?: boolean;
  minimumClosedPackageReserve?: number;
  autoOpenForUnitSale?: boolean;
  totalClosedPackageQuantity?: number;
  totalLooseUnitQuantity?: number;
  totalAutoOpenableUnits?: number;
  totalEquivalentBaseQuantity?: number;
  displayConversionFactor?: number | null;
  branchStocks?: Array<{
    branch: { id: string; code: string; name: string };
    closedPackageQuantity: number;
    looseUnitQuantity: number;
    autoOpenablePackages?: number;
    autoOpenableUnitsTotal?: number;
    equivalentBaseQuantity: number;
    unitSaleAutomaticallyEnabled?: boolean;
    onlyClosedReserveRemaining?: boolean;
  }>;
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
    isPackagePresentation?: boolean;
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
  // ── Hierro 3/8" variantes — factor siempre 14 (el calibre lo determina, no el tipo de prensado) ──
  {
    key: "hierro_3_8_std",
    label: 'Hierro 3/8" STD (14 varillas)',
    name: 'Hierro 3/8" STD - stock compartido',
    baseUnit: "VARILLA",
    derived: [{ saleUnit: "QUINTAL", conversionFactor: 14, hint: "1 quintal = 14 varillas" }],
    description: "3/8\" estándar. Principal: varilla. Derivado: quintal (1 Q = 14 varillas).",
  },
  {
    key: "hierro_3_8_9v",
    label: 'Hierro 3/8" 9V (14 varillas)',
    name: 'Hierro 3/8" 9V - stock compartido',
    baseUnit: "VARILLA",
    derived: [{ saleUnit: "QUINTAL", conversionFactor: 14, hint: "1 quintal = 14 varillas (9V es tipo de prensado, no cuenta de varillas)" }],
    description: "3/8\" variante 9V. Factor igual al calibre: 1 Q = 14 varillas.",
  },
  {
    key: "hierro_3_8_8mm",
    label: 'Hierro 3/8" 8MM (14 varillas)',
    name: 'Hierro 3/8" 8MM - stock compartido',
    baseUnit: "VARILLA",
    derived: [{ saleUnit: "QUINTAL", conversionFactor: 14, hint: "1 quintal = 14 varillas" }],
    description: "3/8\" 8mm. Factor igual al calibre: 1 Q = 14 varillas.",
  },
  // ── Hierro 1/2" variantes — factor siempre 8 ─────────────────────────────
  {
    key: "hierro_1_2_std",
    label: 'Hierro 1/2" STD (8 varillas)',
    name: 'Hierro 1/2" STD - stock compartido',
    baseUnit: "VARILLA",
    derived: [{ saleUnit: "QUINTAL", conversionFactor: 8, hint: "1 quintal = 8 varillas" }],
    description: "1/2\" estándar. Principal: varilla. Derivado: quintal (1 Q = 8 varillas).",
  },
  {
    key: "hierro_1_2_12v",
    label: 'Hierro 1/2" 12V (8 varillas)',
    name: 'Hierro 1/2" 12V - stock compartido',
    baseUnit: "VARILLA",
    derived: [{ saleUnit: "QUINTAL", conversionFactor: 8, hint: "1 quintal = 8 varillas (12V es tipo de prensado, no cuenta de varillas)" }],
    description: "1/2\" variante 12V. Factor igual al calibre: 1 Q = 8 varillas.",
  },
  // ── Hierro 1/4" variantes — factor siempre 30 ────────────────────────────
  {
    key: "hierro_1_4_std",
    label: 'Hierro 1/4" STD (30 varillas)',
    name: 'Hierro 1/4" STD - stock compartido',
    baseUnit: "VARILLA",
    derived: [{ saleUnit: "QUINTAL", conversionFactor: 30, hint: "1 quintal = 30 varillas" }],
    description: "1/4\" estándar. Principal: varilla. Derivado: quintal (1 Q = 30 varillas).",
  },
  {
    key: "hierro_1_4_semi",
    label: 'Hierro 1/4" Semi-STD (30 varillas)',
    name: 'Hierro 1/4" Semi-STD - stock compartido',
    baseUnit: "VARILLA",
    derived: [{ saleUnit: "QUINTAL", conversionFactor: 30, hint: "1 quintal = 30 varillas" }],
    description: "1/4\" semi-estándar. Factor igual al calibre: 1 Q = 30 varillas.",
  },
  {
    key: "clavo_4",
    label: 'Clavo acero 4"',
    name: 'Clavo acero 4" - stock compartido / presentaciones',
    baseUnit: "UNIDAD",
    derived: [{ saleUnit: "KILO", conversionFactor: 80, hint: "1 KILO = 80 UNIDADES aprox." }],
    description: "Principal: unidad. Presentacion: kilo/caja de 1kg (aprox. 80 unidades).",
  },
  {
    key: "clavo_3",
    label: 'Clavo acero 3"',
    name: 'Clavo acero 3" - stock compartido / presentaciones',
    baseUnit: "UNIDAD",
    derived: [{ saleUnit: "KILO", conversionFactor: 105, hint: "1 KILO = 105 UNIDADES aprox." }],
    description: "Principal: unidad. Presentacion: kilo/caja de 1kg (aprox. 105 unidades).",
  },
  {
    key: "clavo_2_1_2",
    label: 'Clavo acero 2 1/2"',
    name: 'Clavo acero 2 1/2" - stock compartido / presentaciones',
    baseUnit: "UNIDAD",
    derived: [{ saleUnit: "KILO", conversionFactor: 142, hint: "1 KILO = 142 UNIDADES aprox." }],
    description: "Principal: unidad. Presentacion: kilo/caja de 1kg (aprox. 142 unidades).",
  },
  {
    key: "clavo_2",
    label: 'Clavo acero 2"',
    name: 'Clavo acero 2" - stock compartido / presentaciones',
    baseUnit: "UNIDAD",
    derived: [{ saleUnit: "KILO", conversionFactor: 216, hint: "1 KILO = 216 UNIDADES aprox." }],
    description: "Principal: unidad. Presentacion: kilo/caja de 1kg (aprox. 216 unidades).",
  },
  {
    key: "clavo_1_1_2",
    label: 'Clavo acero 1 1/2"',
    name: 'Clavo acero 1 1/2" - stock compartido / presentaciones',
    baseUnit: "UNIDAD",
    derived: [{ saleUnit: "KILO", conversionFactor: 308, hint: "1 KILO = 308 UNIDADES aprox." }],
    description: "Principal: unidad. Presentacion: kilo/caja de 1kg (aprox. 308 unidades).",
  },
  {
    key: "clavo_1",
    label: 'Clavo acero 1"',
    name: 'Clavo acero 1" - stock compartido / presentaciones',
    baseUnit: "UNIDAD",
    derived: [{ saleUnit: "KILO", conversionFactor: 417, hint: "1 KILO = 417 UNIDADES aprox." }],
    description: "Principal: unidad. Presentacion: kilo/caja de 1kg (aprox. 417 unidades).",
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
  const [tracksPackages, setTracksPackages] = useState(false);
  const [packageUnit, setPackageUnit] = useState("");
  const [conversionFactorToBase, setConversionFactorToBase] = useState<number | "">("");
  const [approximateFactor, setApproximateFactor] = useState(true);
  const [autoOpenForUnitSale, setAutoOpenForUnitSale] = useState(true);
  const [minimumClosedPackageReserve, setMinimumClosedPackageReserve] = useState<number | "">(1);
  const [members, setMembers] = useState<FusionMember[]>([]);
  const [openingGroup, setOpeningGroup] = useState<FusionGroup | null>(null);
  const [openingBranchId, setOpeningBranchId] = useState("");
  const [openingActualUnits, setOpeningActualUnits] = useState<number | "">("");
  const [openingReason, setOpeningReason] = useState("Apertura para venta unitaria");
  const [opening, setOpening] = useState(false);
  const [normalizingNails, setNormalizingNails] = useState(false);

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

  // Cargar stock actual de los productos en la fusión (sin branchId = suma total)
  const memberIds = members.map((m) => m.productId).join(",");
  useEffect(() => {
    if (!memberIds) return;
    fetch(`/api/inventory/product-stocks?productIds=${memberIds}`)
      .then((r) => r.json())
      .then((raw) => {
        const list: { productId: string; totalQty: number }[] = unwrapApiData(raw) ?? [];
        setMembers((prev) =>
          prev.map((m) => {
            const found = list.find((r) => r.productId === m.productId);
            return found !== undefined ? { ...m, currentTotalStock: found.totalQty } : m;
          }),
        );
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberIds]);

  const usedProductIds = useMemo(() => new Set(members.map((m) => m.productId)), [members]);

  function resetForm() {
    setEditingId(null);
    setName("");
    setBaseUnit("");
    setTracksPackages(false);
    setPackageUnit("");
    setConversionFactorToBase("");
    setApproximateFactor(true);
    setAutoOpenForUnitSale(true);
    setMinimumClosedPackageReserve(1);
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
    const productUnit = (product.unit || "").toUpperCase();
    const normalizedBaseUnit = baseUnit.trim().toUpperCase();
    const normalizedPackageUnit = packageUnit.trim().toUpperCase();
    const isBaseLooseUnit = tracksPackages && normalizedBaseUnit && productUnit === normalizedBaseUnit;
    const isClosedPackage = tracksPackages && normalizedPackageUnit && (
      productUnit === normalizedPackageUnit
      || product.name.toUpperCase().includes(normalizedPackageUnit)
    );
    const shouldBeCanonical = tracksPackages
      ? Boolean(isBaseLooseUnit && !members.some((member) => member.isCanonical))
      : isFirst;
    setMembers((prev) => [
      ...prev,
      {
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        saleUnit: product.unit || (shouldBeCanonical ? baseUnit : ""),
        conversionFactor: shouldBeCanonical ? 1 : Number(conversionFactorToBase || 1),
        isCanonical: shouldBeCanonical,
        isPackagePresentation: Boolean(isClosedPackage || (!shouldBeCanonical && tracksPackages)),
      },
    ]);
    if (isFirst && !baseUnit && !tracksPackages) setBaseUnit(product.unit || "");
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
    const firstDerived = preset.derived[0];
    if (preset.baseUnit === "UNIDAD" && firstDerived?.saleUnit === "KILO") {
      setTracksPackages(true);
      setPackageUnit("KILO");
      setConversionFactorToBase(firstDerived.conversionFactor);
      setApproximateFactor(true);
      setAutoOpenForUnitSale(true);
      setMinimumClosedPackageReserve(1);
    }
    showToast(
      "info",
      `Plantilla "${preset.label}": ${preset.description} Ahora seleccione los productos correspondientes.`,
    );
  }

  function startEdit(group: FusionGroup) {
    setEditingId(group.id);
    setName(group.name);
    setBaseUnit(group.baseUnit);
    setTracksPackages(Boolean(group.tracksPackages));
    setPackageUnit(group.packageUnit ?? "");
    setConversionFactorToBase(group.conversionFactorToBase ?? "");
    setApproximateFactor(Boolean(group.approximateFactor));
    setAutoOpenForUnitSale(group.autoOpenForUnitSale ?? true);
    setMinimumClosedPackageReserve(group.minimumClosedPackageReserve ?? 1);
    setMembers(
      group.members.map((m) => ({
        productId: m.productId,
        sku: m.sku,
        productName: m.productName,
        saleUnit: m.saleUnit,
        conversionFactor: m.conversionFactor,
        isCanonical: m.isCanonical,
        isPackagePresentation: m.isPackagePresentation,
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
    if (tracksPackages && (!packageUnit.trim() || !(Number(conversionFactorToBase) > 0))) {
      showToast("error", "Para empaques indique unidad de empaque y factor mayor que 0.");
      return;
    }
    if (tracksPackages && Number(minimumClosedPackageReserve) < 0) {
      showToast("error", "La reserva minima no puede ser negativa.");
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
        packageUnit: tracksPackages ? packageUnit.trim() : null,
        conversionFactorToBase: tracksPackages ? Number(conversionFactorToBase) : null,
        tracksPackages,
        approximateFactor: tracksPackages ? approximateFactor : false,
        autoOpenForUnitSale: tracksPackages ? autoOpenForUnitSale : false,
        minimumClosedPackageReserve: tracksPackages ? Number(minimumClosedPackageReserve) : 1,
        members: members.map((m) => ({
          productId: m.productId,
          saleUnit: m.saleUnit.trim(),
          conversionFactor: Number(m.conversionFactor),
          isCanonical: m.isCanonical,
          isPackagePresentation: Boolean(m.isPackagePresentation || (!m.isCanonical && tracksPackages)),
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

  function startOpenPackage(group: FusionGroup) {
    const firstBranch = group.branchStocks?.find((row) => row.closedPackageQuantity > 0)?.branch.id
      ?? group.branchStocks?.[0]?.branch.id
      ?? "";
    setOpeningGroup(group);
    setOpeningBranchId(firstBranch);
    setOpeningActualUnits(group.conversionFactorToBase ?? group.displayConversionFactor ?? "");
    setOpeningReason("Apertura para venta unitaria");
  }

  async function confirmOpenPackage() {
    if (!openingGroup || !openingBranchId || !(Number(openingActualUnits) > 0)) {
      showToast("error", "Seleccione sucursal y unidades reales mayores que 0.");
      return;
    }
    const packageMember = openingGroup.members.find((member) => member.isPackagePresentation) ?? openingGroup.members.find((member) => !member.isCanonical);
    setOpening(true);
    try {
      const res = await apiFetch(`/api/inventory/stock-groups/${openingGroup.id}/open-package`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: openingBranchId,
          packageProductId: packageMember?.productId ?? null,
          actualUnits: Number(openingActualUnits),
          reason: openingReason.trim() || "Apertura para venta unitaria",
        }),
      });
      const raw = await res.json();
      if (!res.ok) {
        showToast("error", raw?.error?.message ?? "No se pudo abrir el kilo/caja.");
        return;
      }
      showToast("success", "Kilo/caja abierto para venta unitaria.");
      setOpeningGroup(null);
      await loadGroups();
    } catch {
      showToast("error", "Error de red al abrir el kilo/caja.");
    } finally {
      setOpening(false);
    }
  }

  async function normalizeNails() {
    setNormalizingNails(true);
    try {
      const res = await apiFetch("/api/inventory/stock-groups/normalize-nails", { method: "POST" });
      const raw = await res.json();
      if (!res.ok) {
        showToast("error", raw?.error?.message ?? "Error al normalizar clavos.");
        return;
      }
      const results: Array<{ preset: string; status: string; reason?: string }> = raw?.data?.results ?? [];
      const normalized = results.filter((r) => r.status === "NORMALIZED").length;
      const skipped = results.filter((r) => r.status === "SKIPPED").length;
      if (normalized === 0 && skipped === results.length) {
        showToast("info", "No se encontraron pares de clavos KILO/UNIDAD para normalizar.");
      } else {
        showToast("success", `Normalización completada: ${normalized} grupo(s) normalizados, ${skipped} omitidos.`);
      }
      await loadGroups();
    } catch {
      showToast("error", "Error de red al normalizar clavos.");
    } finally {
      setNormalizingNails(false);
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text)] flex items-center gap-2">
            <Link2 className="h-5 w-5" /> Fusión de Inventario
          </h1>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            Stock compartido / Presentaciones
          </p>
          <p className="text-sm text-[var(--color-text-muted)] max-w-3xl">
            Une dos o más productos que comparten el mismo inventario físico pero se venden en distintas
            presentaciones. El <strong>producto principal</strong> lleva el stock (unidad base) y cada
            <strong> derivado</strong> descuenta del mismo inventario según su factor de conversión.
            Ej.: vender 1 quintal de hierro 3/8&quot; descuenta 14 varillas del stock.
          </p>
        </div>
        <div className="flex-shrink-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={normalizeNails}
            loading={normalizingNails}
            disabled={normalizingNails}
            title="Crea o repara fusiones KILO/UNIDAD para cada medida de clavo acero, usando los factores precalculados. Idempotente: se puede ejecutar más de una vez."
          >
            <Wrench className="h-4 w-4" />
            Normalizar clavos KILO/UNIDAD
          </Button>
        </div>
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
        <div className="space-y-2">
          <p className="text-xs font-medium text-[var(--color-text-secondary)]">
            Plantillas (precargan nombre y factor — siempre puede editarlo antes de guardar):
          </p>
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
          <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed">
            <strong>Hierro:</strong> el factor depende solo del calibre (3/8&quot; = 14 varillas, 1/2&quot; = 8 varillas, 1/4&quot; = 30 varillas).
            Los sufijos del nombre (9V, 12V, STD, 8MM) son identificadores de variante &mdash; no cambian el factor.
            El factor configurado aquí se usa <em>siempre</em> en ventas e inventario.
          </p>
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

        <div className="rounded-lg border border-[var(--color-border)] p-3 space-y-3">
          <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
            <input type="checkbox" checked={tracksPackages} onChange={(e) => setTracksPackages(e.target.checked)} disabled={saving} />
            Manejar presentacion cerrada y unidades sueltas
          </label>
          {tracksPackages && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <label className="block text-sm font-medium text-[var(--color-text-secondary)]">Unidad empaque</label>
                <input
                  className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-[var(--color-surface)] text-[var(--color-text)]"
                  placeholder="KILO, CAJA 1KG"
                  value={packageUnit}
                  onChange={(e) => setPackageUnit(e.target.value.toUpperCase())}
                  disabled={saving}
                />
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium text-[var(--color-text-secondary)]">Factor a base</label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-[var(--color-surface)] text-[var(--color-text)]"
                  placeholder="105"
                  value={conversionFactorToBase}
                  onChange={(e) => setConversionFactorToBase(e.target.value === "" ? "" : Number(e.target.value))}
                  disabled={saving}
                />
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm text-[var(--color-text-secondary)]">
                <input type="checkbox" checked={approximateFactor} onChange={(e) => setApproximateFactor(e.target.checked)} disabled={saving} />
                Factor aproximado
              </label>
              <label className="flex items-end gap-2 pb-2 text-sm text-[var(--color-text-secondary)]">
                <input type="checkbox" checked={autoOpenForUnitSale} onChange={(e) => setAutoOpenForUnitSale(e.target.checked)} disabled={saving} />
                Abrir automaticamente para venta unitaria
              </label>
              <div className="space-y-1 sm:col-span-2">
                <label className="block text-sm font-medium text-[var(--color-text-secondary)]">Reserva minima de kilos/cajas cerradas</label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-[var(--color-surface)] text-[var(--color-text)]"
                  value={minimumClosedPackageReserve}
                  onChange={(e) => setMinimumClosedPackageReserve(e.target.value === "" ? "" : Number(e.target.value))}
                  disabled={saving}
                />
                <p className="text-xs text-[var(--color-text-muted)]">
                  Si hay mas de 1 kilo/caja cerrada, Hammer abrira automaticamente una para vender unidades sueltas.
                </p>
              </div>
            </div>
          )}
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
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-[var(--color-text-soft)]">{m.sku}</span>
                      {m.currentTotalStock !== undefined && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${m.currentTotalStock > 0 ? "bg-[var(--color-success-100)] text-[var(--color-success-700)]" : "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]"}`}>
                          {m.currentTotalStock > 0 ? `${m.currentTotalStock} en stock` : "sin stock"}
                        </span>
                      )}
                    </div>
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

                  {tracksPackages && !m.isCanonical && (
                    <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
                      <input
                        type="checkbox"
                        checked={Boolean(m.isPackagePresentation)}
                        onChange={(e) => updateMember(m.productId, { isPackagePresentation: e.target.checked })}
                        disabled={saving}
                      />
                      Presentacion cerrada
                    </label>
                  )}

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

            {/* Vista previa de migración de balances */}
            {!editingId && members.length >= 2 && members.some((m) => m.currentTotalStock !== undefined) && (() => {
              const canonical = members.find((m) => m.isCanonical);
              if (!canonical) return null;
              const totalBaseQty = members.reduce((sum, m) => {
                const qty = m.currentTotalStock ?? 0;
                return sum + qty * m.conversionFactor;
              }, 0);
              const nonCanonicalWithStock = members.filter((m) => !m.isCanonical && (m.currentTotalStock ?? 0) > 0);
              return (
                <div className="mt-2 rounded-lg border border-[var(--color-warning-300)] bg-[var(--color-warning-50)] p-3 space-y-1.5">
                  <p className="text-xs font-semibold text-[var(--color-warning-800)]">Vista previa — migración de stock al guardar</p>
                  <div className="space-y-1">
                    {members.map((m) => {
                      const qty = m.currentTotalStock ?? 0;
                      const baseQty = qty * m.conversionFactor;
                      return (
                        <div key={m.productId} className="flex items-center gap-2 text-xs text-[var(--color-warning-700)]">
                          <span className="font-medium truncate max-w-[10rem]">{m.productName}</span>
                          <span className="text-[var(--color-warning-500)]">
                            {qty} {m.saleUnit || "ud"}
                            {!m.isCanonical && m.conversionFactor > 1 && ` × ${m.conversionFactor} = ${baseQty} ${canonical.saleUnit || "base"}`}
                          </span>
                          {!m.isCanonical && <span className="ml-auto text-[var(--color-warning-500)]">→ quedará en 0</span>}
                        </div>
                      );
                    })}
                  </div>
                  <div className="border-t border-[var(--color-warning-200)] pt-1.5 flex items-center gap-2 text-xs font-bold text-[var(--color-warning-900)]">
                    <span>Total en {canonical.productName}:</span>
                    <span>{totalBaseQty.toFixed(2)} {canonical.saleUnit || baseUnit}</span>
                    {nonCanonicalWithStock.length === 0 && <span className="font-normal text-[var(--color-warning-600)]">(sin cambios — derivados sin stock)</span>}
                  </div>
                </div>
              );
            })()}
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
                  {group.tracksPackages && (
                    <Button variant="secondary" size="sm" onClick={() => startOpenPackage(group)}>
                      <PackageOpen className="h-4 w-4" /> Abrir kilo/caja
                    </Button>
                  )}
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
              {group.tracksPackages && (
                <div className="grid gap-2 border-b border-[var(--color-border)] px-5 py-3 text-xs sm:grid-cols-4">
                  <div>
                    <span className="text-[var(--color-text-soft)]">Cerrados agregados</span>
                    <div className="font-semibold text-[var(--color-text)]">{group.totalClosedPackageQuantity ?? 0} {(group.packageUnit ?? "KILO").toLowerCase()}</div>
                  </div>
                  <div>
                    <span className="text-[var(--color-text-soft)]">Sueltos fisicos agregados</span>
                    <div className="font-semibold text-[var(--color-text)]">{group.totalLooseUnitQuantity ?? 0} {group.baseUnit.toLowerCase()}</div>
                  </div>
                  <div>
                    <span className="text-[var(--color-text-soft)]">Abrible automatico agregado</span>
                    <div className="font-semibold text-[var(--color-text)]">hasta {group.totalAutoOpenableUnits ?? 0} {group.baseUnit.toLowerCase()}</div>
                  </div>
                  <div>
                    <span className="text-[var(--color-text-soft)]">Equivalente total</span>
                    <div className="font-semibold text-[var(--color-text)]">{group.totalEquivalentBaseQuantity ?? 0} {group.baseUnit.toLowerCase()}</div>
                  </div>
                  <div className="sm:col-span-4 flex flex-wrap gap-2">
                    <Badge variant="warning">Total agregado informativo</Badge>
                    {group.autoOpenForUnitSale && (group.totalAutoOpenableUnits ?? 0) > 0 ? (
                      <Badge variant="success">Venta unitaria automatica</Badge>
                    ) : null}
                    {(group.branchStocks ?? []).some((row) => row.onlyClosedReserveRemaining) ? (
                      <Badge variant="warning">Solo queda reserva cerrada</Badge>
                    ) : null}
                  </div>
                  <div className="sm:col-span-4 overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead className="text-[var(--color-text-soft)]">
                        <tr className="border-t border-[var(--color-border)]">
                          <th className="py-2 pr-3 text-left font-medium">Sucursal</th>
                          <th className="py-2 pr-3 text-right font-medium">Cerrados</th>
                          <th className="py-2 pr-3 text-right font-medium">Sueltos fisicos</th>
                          <th className="py-2 pr-3 text-right font-medium">Abrible automatico</th>
                          <th className="py-2 pr-3 text-right font-medium">Equivalente total</th>
                          <th className="py-2 text-left font-medium">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-border)]">
                        {(group.branchStocks ?? []).map((row) => (
                          <tr key={row.branch.id}>
                            <td className="py-2 pr-3 font-medium text-[var(--color-text)]">{row.branch.code}</td>
                            <td className="py-2 pr-3 text-right">{row.closedPackageQuantity} {group.packageUnit ?? "KILO"}</td>
                            <td className="py-2 pr-3 text-right">{row.looseUnitQuantity} {group.baseUnit}</td>
                            <td className="py-2 pr-3 text-right">{row.autoOpenablePackages ?? 0} {group.packageUnit ?? "KILO"}</td>
                            <td className="py-2 pr-3 text-right">{row.equivalentBaseQuantity} {group.baseUnit}</td>
                            <td className="py-2">
                              {row.unitSaleAutomaticallyEnabled ? "Unidad vendible" : row.onlyClosedReserveRemaining ? "Reserva cerrada" : "Sin apertura"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <div className="divide-y divide-[var(--color-border)]">
                {group.members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between px-5 py-2.5">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[var(--color-text)] truncate">{m.productName}</div>
                      <div className="text-xs text-[var(--color-text-soft)]">{m.sku} · {m.saleUnit}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      {m.isCanonical ? (
                        <Badge variant="success">{group.tracksPackages ? "Unidad base / venta suelta" : "Principal (stock)"}</Badge>
                      ) : m.isPackagePresentation && group.tracksPackages ? (
                        <div className="flex flex-col items-end gap-1">
                          <Badge variant="info">Principal comercial / empaque cerrado</Badge>
                          <span className="text-xs text-[var(--color-text-muted)]">
                            1 {group.packageUnit ?? m.saleUnit} = {group.conversionFactorToBase ?? m.conversionFactor} {group.baseUnit}{group.approximateFactor ? " aprox." : ""}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--color-text-muted)]">
                          1 {m.saleUnit} = {m.conversionFactor} {canonical?.saleUnit ?? group.baseUnit}{group.approximateFactor ? " aprox." : ""}
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
      {openingGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg bg-[var(--color-surface)] shadow-xl border border-[var(--color-border)]">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Abrir kilo/caja</h2>
              <button type="button" onClick={() => setOpeningGroup(null)} className="text-[var(--color-text-soft)] hover:text-[var(--color-text)]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-5">
              <div className="text-sm text-[var(--color-text)]">
                <div className="font-medium">{openingGroup.name}</div>
                <div className="text-xs text-[var(--color-text-muted)]">
                  Estimado: {openingGroup.conversionFactorToBase ?? openingGroup.displayConversionFactor ?? 0} {openingGroup.baseUnit.toLowerCase()}
                </div>
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium text-[var(--color-text-secondary)]">Sucursal</label>
                  <select
                  className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-[var(--color-surface)] text-[var(--color-text)]"
                  value={openingBranchId}
                  onChange={(e) => setOpeningBranchId(e.target.value)}
                >
                  {(openingGroup.branchStocks ?? []).map((row) => (
                    <option key={row.branch.id} value={row.branch.id}>
                      {row.branch.code} - {row.branch.name} | Cerrados: {row.closedPackageQuantity} | Sueltos: {row.looseUnitQuantity} | Abrible: {row.autoOpenableUnitsTotal ?? 0}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium text-[var(--color-text-secondary)]">Unidades reales al abrir</label>
                <input
                  type="number"
                  min={1}
                  step="any"
                  className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-[var(--color-surface)] text-[var(--color-text)]"
                  value={openingActualUnits}
                  onChange={(e) => setOpeningActualUnits(e.target.value === "" ? "" : Number(e.target.value))}
                />
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium text-[var(--color-text-secondary)]">Motivo</label>
                <input
                  className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-[var(--color-surface)] text-[var(--color-text)]"
                  value={openingReason}
                  onChange={(e) => setOpeningReason(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
              <Button variant="ghost" onClick={() => setOpeningGroup(null)} disabled={opening}>Cancelar</Button>
              <Button onClick={confirmOpenPackage} loading={opening} disabled={opening}>Confirmar</Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
