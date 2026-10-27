"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy, PackageSearch, Plus, Save, Trash2 } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money as formatMoney } from "@/lib/format";

type Product = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  standardSalePrice?: number | string;
  category?: { name: string };
  averageCost?: number | string | null;
  globalCost?: number | string | null;
  lastPurchaseCost?: number | string | null;
};

type RecipeInputRow = {
  inputProductId: string;
  quantity: string;
  unit: string;
  notes: string;
};

const emptyInput = (): RecipeInputRow => ({ inputProductId: "", quantity: "", unit: "", notes: "" });
const n = (value: unknown) => typeof value === "number" ? value : Number(value ?? 0);
const money = (value: number | null | undefined) => value == null || Number.isNaN(value) ? "-" : formatMoney(value);

// Misma cadena que el costeo del lote con WAC apagado (resolveCostChain), sin
// el costo de sucursal: la receta es global. Es solo el estimado del form.
const estimatedCost = (product: Product | null | undefined) =>
  n(product?.averageCost ?? product?.globalCost ?? product?.lastPurchaseCost ?? 0);

async function fetchProducts(params: Record<string, string>): Promise<Product[]> {
  const res = await apiFetch(`/api/catalog/products?${new URLSearchParams(params)}`);
  if (!res.ok) throw new Error("No se pudo cargar productos");
  const data = unwrapApiData(await res.json());
  return Array.isArray(data) ? data : (data as { products?: Product[] }).products ?? [];
}

/**
 * Busca en el servidor (no filtra una lista precargada: el catálogo tiene
 * más productos de los que cabe traer de una vez). inStockOnly limita a lo
 * que tiene stock en alguna sucursal — para insumos.
 */
function ProductPicker({
  label,
  selected,
  value,
  onChange,
  placeholder,
  inStockOnly = false,
  disabled = false,
  hint,
}: {
  label: string;
  selected: Product | null | undefined;
  value: string;
  onChange: (product: Product) => void;
  placeholder: string;
  inStockOnly?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);

  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const list = await fetchProducts({ isActive: "true", q: query.trim(), limit: "20", ...(inStockOnly ? { inStockOnly: "true" } : {}) });
        if (!cancelled) { setVisible(list); setSearchError(false); }
      } catch {
        if (!cancelled) setSearchError(true);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, inStockOnly, disabled]);

  return (
    <div className="space-y-2">
      <label className="block text-xs font-semibold uppercase text-[var(--color-text-muted)]">{label}</label>
      <div className="relative">
        <PackageSearch className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--color-text-muted)]" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-9 pr-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-master-500)] focus:ring-2 focus:ring-[var(--color-master-100)] disabled:opacity-60"
        />
      </div>
      {!disabled && <div className="max-h-56 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        {visible.map((product) => (
          <button
            key={product.id}
            type="button"
            onClick={() => {
              onChange(product);
              setQuery(product.name);
            }}
            className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-alt)] ${value === product.id ? "bg-[var(--color-master-50)]" : ""}`}
          >
            <span>
              <span className="block font-semibold text-[var(--color-text)]">{product.name}</span>
              <span className="text-xs text-[var(--color-text-muted)]">{product.sku} · {product.category?.name ?? "Sin categoria"}</span>
            </span>
            <span className="text-xs text-[var(--color-text-muted)]">{product.unit}</span>
          </button>
        ))}
        {visible.length === 0 && (
          <p className="px-3 py-4 text-sm text-[var(--color-text-muted)]">
            {searching ? "Buscando..." : searchError ? "No se pudo buscar. Intenta de nuevo." : inStockOnly ? "Sin resultados con stock disponible." : "Sin resultados."}
          </p>
        )}
      </div>}
      {hint && <p className="text-xs text-[var(--color-text-muted)]">{hint}</p>}
      {selected && (
        <div className="grid gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-sm sm:grid-cols-4">
          <div><p className="text-xs text-[var(--color-text-muted)]">SKU</p><p className="font-semibold text-[var(--color-text)]">{selected.sku}</p></div>
          <div><p className="text-xs text-[var(--color-text-muted)]">Categoria</p><p className="font-semibold text-[var(--color-text)]">{selected.category?.name ?? "-"}</p></div>
          <div><p className="text-xs text-[var(--color-text-muted)]">Unidad</p><p className="font-semibold text-[var(--color-text)]">{selected.unit}</p></div>
          <div><p className="text-xs text-[var(--color-text-muted)]">Precio actual</p><p className="font-semibold text-[var(--color-text)]">{money(n(selected.standardSalePrice))}</p></div>
        </div>
      )}
    </div>
  );
}

type ExistingRecipe = {
  name: string;
  code: string;
  description: string | null;
  finishedProductId: string;
  expectedQuantity: number;
  expectedUnit: string;
  recipeType: string;
  recipeFamily: string;
  targetMarginPct: number | string | null;
  yieldPercent: number | string | null;
  wastePercent: number | string | null;
  laborEnabled: boolean;
  laborCostPerBatch: number | string | null;
  overheadMode: string;
  processingCostPerBatch: number | string | null;
  secondGradeProductId: string | null;
  inputs: Array<{ inputProductId: string; quantity: number; unit: string; notes: string | null }>;
  batches: unknown[];
};

// Fracción guardada (0.07) → texto del input en % ("7"), sin colas de float.
const toPctInput = (value: number | string | null | undefined) => value == null ? "" : String(Number((n(value) * 100).toFixed(4)));
const toInput = (value: number | string | null | undefined) => value == null ? "" : String(n(value));

/** Formulario de receta — crea (sin recipeId) o edita (con recipeId) por PATCH. */
export function RecipeForm({ recipeId }: { recipeId?: string }) {
  const router = useRouter();
  const isEdit = Boolean(recipeId);
  // Productos ya vistos (elegidos en un buscador o de la receta cargada):
  // de aquí salen unidad, costo estimado y la tarjeta del seleccionado.
  const [productById, setProductById] = useState<Map<string, Product>>(new Map());
  const remember = (list: Product[]) => setProductById((prev) => {
    const next = new Map(prev);
    for (const product of list) next.set(product.id, product);
    return next;
  });
  const [loadingRecipe, setLoadingRecipe] = useState(isEdit);
  const [hasBatches, setHasBatches] = useState(false);
  const [recipeMissing, setRecipeMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [finishedProductId, setFinishedProductId] = useState("");
  const [expectedQuantity, setExpectedQuantity] = useState("");
  const [expectedUnit, setExpectedUnit] = useState("unidad");
  const [recipeType, setRecipeType] = useState("MANUFACTURING");
  const [recipeFamily, setRecipeFamily] = useState("GENERAL");
  const [targetMarginPct, setTargetMarginPct] = useState("");
  const [yieldPercent, setYieldPercent] = useState("100");
  const [wastePercent, setWastePercent] = useState("");
  const [processingCostPerBatch, setProcessingCostPerBatch] = useState("");
  const [laborCostPerBatch, setLaborCostPerBatch] = useState("");
  // FIXED = C$ por lote; PCT_MAT = % de los materiales (se guarda como fracción).
  const [overheadMode, setOverheadMode] = useState<"FIXED" | "PCT_MAT">("FIXED");
  const [inputs, setInputs] = useState<RecipeInputRow[]>([emptyInput()]);
  // prompt-produccion-materiales.md Fase 2 — opcional: si se configura, el
  // cierre de lote pregunta cuántas unidades malas sirven como esta segunda.
  const [secondGradeProductId, setSecondGradeProductId] = useState("");

  useEffect(() => {
    if (!recipeId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/master/production/recipes/${recipeId}`);
        if (!res.ok) throw new Error();
        const r = unwrapApiData(await res.json()) as ExistingRecipe;
        if (cancelled) return;
        setName(r.name);
        setCode(r.code);
        setDescription(r.description ?? "");
        setFinishedProductId(r.finishedProductId);
        setExpectedQuantity(toInput(r.expectedQuantity));
        setExpectedUnit(r.expectedUnit);
        setRecipeType(r.recipeType);
        setRecipeFamily(r.recipeFamily);
        setTargetMarginPct(toPctInput(r.targetMarginPct));
        setYieldPercent(toPctInput(r.yieldPercent));
        setWastePercent(toPctInput(r.wastePercent));
        setLaborCostPerBatch(r.laborEnabled ? toInput(r.laborCostPerBatch) : "");
        if (r.overheadMode === "PCT_MAT") {
          setOverheadMode("PCT_MAT");
          setProcessingCostPerBatch(toPctInput(r.processingCostPerBatch));
        } else {
          setProcessingCostPerBatch(r.overheadMode === "FIXED" ? toInput(r.processingCostPerBatch) : "");
        }
        setSecondGradeProductId(r.secondGradeProductId ?? "");
        setInputs(r.inputs.length ? r.inputs.map((i) => ({ inputProductId: i.inputProductId, quantity: toInput(i.quantity), unit: i.unit, notes: i.notes ?? "" })) : [emptyInput()]);
        setHasBatches(r.batches.length > 0);
        // Sin filtro de activo ni de stock: la receta puede apuntar a un
        // producto que hoy está inactivo o sin existencias.
        const ids = [...new Set([r.finishedProductId, r.secondGradeProductId, ...r.inputs.map((i) => i.inputProductId)].filter((id): id is string => Boolean(id)))];
        const list = await fetchProducts({ ids: ids.join(","), limit: String(ids.length) });
        if (!cancelled) remember(list);
      } catch {
        if (!cancelled) { setError("No se pudo cargar la receta."); setRecipeMissing(true); }
      } finally {
        if (!cancelled) setLoadingRecipe(false);
      }
    })();
    return () => { cancelled = true; };
  }, [recipeId]);

  const finishedProduct = finishedProductId ? productById.get(finishedProductId) : null;

  const inputSummary = inputs.map((row) => {
    const product = row.inputProductId ? productById.get(row.inputProductId) : null;
    const qty = Number(row.quantity || 0);
    const unitCost = estimatedCost(product);
    return { ...row, product, qty, unitCost, total: qty * unitCost };
  });
  const totalCost = inputSummary.reduce((sum, row) => sum + row.total, 0);
  const overheadValue = Number(processingCostPerBatch || 0);
  const overheadCost = overheadMode === "PCT_MAT" ? totalCost * overheadValue / 100 : overheadValue;
  const processCost = overheadCost + Number(laborCostPerBatch || 0);
  const expectedQty = Number(expectedQuantity || 0);
  const unitCost = expectedQty > 0 ? (totalCost + processCost) / expectedQty : 0;
  const margin = Number(targetMarginPct || 0) / 100;
  const suggestedPrice = unitCost > 0 && margin > 0 && margin < 1 ? unitCost / (1 - margin) : null;
  const warnings = [
    ...inputSummary.filter((row) => row.product && row.unitCost <= 0).map((row) => `${row.product?.name} no tiene costo efectivo visible.`),
    ...(finishedProduct && suggestedPrice && n(finishedProduct.standardSalePrice) > 0 && n(finishedProduct.standardSalePrice) < suggestedPrice ? ["El precio actual del producto terminado podria quedar bajo costo objetivo."] : []),
  ];

  const updateInput = (idx: number, field: Exclude<keyof RecipeInputRow, "inputProductId">, value: string) => {
    setInputs((prev) => prev.map((row, i) => i === idx ? { ...row, [field]: value } : row));
  };
  const selectInputProduct = (idx: number, product: Product) => {
    remember([product]);
    setInputs((prev) => prev.map((row, i) => i === idx ? { ...row, inputProductId: product.id, unit: product.unit } : row));
  };

  const validate = () => {
    if (!name.trim()) return "Nombre obligatorio.";
    if (!code.trim()) return "Codigo obligatorio.";
    if (!finishedProductId) return "Selecciona el producto terminado.";
    if (!expectedQty || expectedQty <= 0) return "La cantidad esperada debe ser mayor a 0.";
    const cleanInputs = inputs.filter((row) => row.inputProductId || row.quantity);
    if (cleanInputs.length === 0) return "Agrega al menos un insumo.";
    if (cleanInputs.some((row) => !row.inputProductId)) return "No se permite insumo sin producto.";
    if (cleanInputs.some((row) => Number(row.quantity || 0) <= 0)) return "La cantidad de cada insumo debe ser mayor a 0.";
    return null;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        code: code.trim().toUpperCase(),
        description: description.trim() || null,
        finishedProductId,
        expectedQuantity: expectedQty,
        expectedUnit: expectedUnit.trim(),
        recipeType,
        recipeFamily,
        targetMarginPct: targetMarginPct ? Number(targetMarginPct) / 100 : null,
        yieldPercent: yieldPercent ? Number(yieldPercent) / 100 : null,
        wastePercent: wastePercent ? Number(wastePercent) / 100 : null,
        // Antes se mandaban los montos sin laborEnabled/overheadMode y el
        // backend los ignoraba al costear el lote (default false/NONE).
        laborEnabled: Number(laborCostPerBatch || 0) > 0,
        laborCostPerBatch: laborCostPerBatch ? Number(laborCostPerBatch) : null,
        overheadMode: overheadValue > 0 ? overheadMode : "NONE",
        processingCostPerBatch: overheadValue > 0 ? (overheadMode === "PCT_MAT" ? overheadValue / 100 : overheadValue) : null,
        secondGradeProductId: secondGradeProductId || null,
        inputs: inputs.filter((row) => row.inputProductId).map((row) => ({
          inputProductId: row.inputProductId,
          quantity: Number(row.quantity),
          unit: row.unit.trim() || productById.get(row.inputProductId)?.unit || "unidad",
          notes: row.notes.trim() || null,
        })),
      };
      const res = isEdit
        ? await apiFetch(`/api/master/production/recipes/${recipeId}`, { method: "PATCH", body: JSON.stringify(body) })
        : await apiFetch("/api/master/production/recipes", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error?.message ?? errData?.message ?? (isEdit ? "Error al guardar receta" : "Error al crear receta"));
      }
      router.push(isEdit ? `/app/master/production/recipes/${recipeId}` : "/app/master/production/recipes");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSaving(false);
    }
  };

  const backHref = isEdit ? `/app/master/production/recipes/${recipeId}` : "/app/master/production/recipes";

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">{isEdit ? "Editar receta" : "Nueva receta de material"}</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            {isEdit ? "Los lotes ya planificados conservan los insumos con que se crearon; los cambios aplican a lotes nuevos." : "Selecciona producto terminado e insumos reales del catalogo."}
          </p>
        </div>
        <Link href={backHref as never} className="text-sm font-medium text-[var(--color-master-600)] hover:underline">{isEdit ? "Volver a la receta" : "Volver a recetas"}</Link>
      </div>

      {error && <div className="rounded-lg border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] p-3 text-sm text-[var(--color-danger-700)]">{error}</div>}
      {loadingRecipe && <p className="text-sm text-[var(--color-text-muted)]">Cargando...</p>}

      {/* El resumen lateral tiene etiquetas largas ("Precio sugerido estimado")
          — a 1024px se achica a 300px en vez de los 360px de xl+ para no
          robarle demasiado ancho al formulario principal. */}
      {!loadingRecipe && !recipeMissing && <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1fr_300px] xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
            <h2 className="text-base font-semibold text-[var(--color-text)]">Identidad</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--color-text-muted)]">Nombre de receta</label>
                <input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" placeholder="Bloque 10x20x40 estandar" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--color-text-muted)]">Codigo</label>
                <input value={code} onChange={(event) => setCode(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-mono uppercase" placeholder="BLOQUE-10X20X40" />
              </div>
            </div>
            <div className="mt-4">
              <label className="block text-xs font-semibold uppercase text-[var(--color-text-muted)]">Descripcion</label>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
            </div>
          </section>

          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
            <ProductPicker label="Producto terminado" selected={finishedProduct} value={finishedProductId} onChange={(product) => { remember([product]); setFinishedProductId(product.id); }} placeholder="Buscar por nombre, SKU o categoria..." disabled={hasBatches} hint={hasBatches ? "La receta ya tiene lotes: el producto terminado no se puede cambiar. Desactívala y crea una nueva si hace falta." : undefined} />
          </section>

          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
            <h2 className="text-base font-semibold text-[var(--color-text)]">Produccion esperada</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--color-text-muted)]">Cantidad esperada</label>
                <input type="number" min="0.01" step="any" value={expectedQuantity} onChange={(event) => setExpectedQuantity(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--color-text-muted)]">Unidad producida</label>
                <input value={expectedUnit} onChange={(event) => setExpectedUnit(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--color-text-muted)]">Margen objetivo %</label>
                <input type="number" min="0" max="100" step="any" value={targetMarginPct} onChange={(event) => setTargetMarginPct(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--color-text-muted)]">Tipo de receta</label>
                <select value={recipeType} onChange={(event) => setRecipeType(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
                  <option value="MANUFACTURING">Manufactura</option>
                  <option value="CONVERSION">Conversion</option>
                  <option value="CUTTING">Corte</option>
                  <option value="MIXING">Mezcla</option>
                  <option value="PACKAGING">Empaque</option>
                  <option value="REPACKAGING">Reempaque</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--color-text-muted)]">Familia</label>
                <select value={recipeFamily} onChange={(event) => setRecipeFamily(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
                  <option value="WOOD">Madera</option>
                  <option value="CEMENT">Cemento</option>
                  <option value="STONE">Piedra</option>
                  <option value="METAL">Metal</option>
                  <option value="BLOCKS">Bloques</option>
                  <option value="PAINT">Pintura</option>
                  <option value="GENERAL">General</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--color-text-muted)]">Rendimiento %</label>
                <input type="number" min="0" max="100" step="any" value={yieldPercent} onChange={(event) => setYieldPercent(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--color-text-muted)]">Merma %</label>
                <input type="number" min="0" max="100" step="any" value={wastePercent} onChange={(event) => setWastePercent(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--color-text-muted)]">Costo proceso por lote</label>
                <div className="mt-1 flex gap-2">
                  <input type="number" min="0" step="any" value={processingCostPerBatch} onChange={(event) => setProcessingCostPerBatch(event.target.value)} className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
                  <select value={overheadMode} onChange={(event) => setOverheadMode(event.target.value as "FIXED" | "PCT_MAT")} className="rounded-lg border border-[var(--color-border)] px-2 py-2 text-sm">
                    <option value="FIXED">C$</option>
                    <option value="PCT_MAT">% materiales</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--color-text-muted)]">Mano de obra por lote</label>
                <input type="number" min="0" step="any" value={laborCostPerBatch} onChange={(event) => setLaborCostPerBatch(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-[var(--color-text)]">Insumos</h2>
              <button type="button" onClick={() => setInputs((prev) => [...prev, emptyInput()])} className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-alt)]"><Plus className="h-4 w-4" />Agregar</button>
            </div>
            <div className="mt-4 space-y-3">
              {inputs.map((row, idx) => {
                const selected = row.inputProductId ? productById.get(row.inputProductId) : null;
                const summary = inputSummary[idx];
                return (
                  <div key={idx} className="grid gap-3 rounded-lg border border-[var(--color-border)] p-3 lg:grid-cols-[1fr_110px_110px_120px_auto] lg:items-end">
                    <ProductPicker label="Producto" selected={selected} value={row.inputProductId} onChange={(product) => selectInputProduct(idx, product)} placeholder="Buscar insumo con stock..." inStockOnly />
                    <div>
                      <label className="block text-xs font-semibold uppercase text-[var(--color-text-muted)]">Cantidad</label>
                      <input type="number" min="0.01" step="any" value={row.quantity} onChange={(event) => updateInput(idx, "quantity", event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase text-[var(--color-text-muted)]">Unidad</label>
                      <input value={row.unit} onChange={(event) => updateInput(idx, "unit", event.target.value)} placeholder={selected?.unit ?? "unidad"} className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">Costo linea</p>
                      <p className="mt-2 text-sm font-bold text-[var(--color-text)]">{money(summary?.total ?? 0)}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{money(summary?.unitCost)} / unidad</p>
                    </div>
                    <div className="flex gap-1">
                      <button type="button" title="Duplicar" onClick={() => setInputs((prev) => [...prev.slice(0, idx + 1), { ...row }, ...prev.slice(idx + 1)])} className="rounded-md border border-[var(--color-border)] p-2"><Copy className="h-4 w-4" /></button>
                      <button type="button" title="Quitar" onClick={() => setInputs((prev) => prev.length === 1 ? [emptyInput()] : prev.filter((_, i) => i !== idx))} className="rounded-md border border-[var(--color-border)] p-2 text-[var(--color-danger-600)]"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-[var(--color-text)]">Producto de segunda calidad (opcional)</h2>
              {secondGradeProductId && (
                <button type="button" onClick={() => setSecondGradeProductId("")} className="text-xs font-semibold text-[var(--color-danger-600)] hover:underline">Quitar</button>
              )}
            </div>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">Si se configura, al cerrar un lote se puede marcar cuántas unidades malas sirven como esta segunda — entran a stock sin restar del costo de las buenas.</p>
            <div className="mt-4">
              <ProductPicker label="Producto de segunda" selected={secondGradeProductId ? productById.get(secondGradeProductId) : null} value={secondGradeProductId} onChange={(product) => { remember([product]); setSecondGradeProductId(product.id); }} placeholder="Buscar producto de segunda..." />
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <div className="sticky top-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
            <h2 className="text-base font-semibold text-[var(--color-text)]">Resumen</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-[var(--color-text-muted)]">Costo total estimado</dt><dd className="font-bold text-[var(--color-text)]">{money(totalCost)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-[var(--color-text-muted)]">Proceso / mano de obra</dt><dd className="font-bold text-[var(--color-text)]">{money(processCost)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-[var(--color-text-muted)]">Costo unitario esperado</dt><dd className="font-bold text-[var(--color-text)]">{money(unitCost)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-[var(--color-text-muted)]">Margen objetivo</dt><dd className="font-bold text-[var(--color-text)]">{targetMarginPct ? `${Number(targetMarginPct).toFixed(1)}%` : "-"}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-[var(--color-text-muted)]">Precio sugerido estimado</dt><dd className="font-bold text-[var(--color-text)]">{money(suggestedPrice)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-[var(--color-text-muted)]">Insumos requeridos</dt><dd className="font-bold text-[var(--color-text)]">{inputs.filter((row) => row.inputProductId).length}</dd></div>
            </dl>
            {warnings.length > 0 && (
              <div className="mt-4 rounded-lg bg-[var(--color-warning-50)] p-3 text-sm text-[var(--color-warning-800)]">
                {warnings.map((warning) => <p key={warning}>{warning}</p>)}
              </div>
            )}
            <div className="mt-5 flex gap-2">
              <button type="submit" disabled={saving} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--color-master-600)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-master-700)] disabled:opacity-50"><Save className="h-4 w-4" />{saving ? "Guardando..." : "Guardar"}</button>
              <Link href={backHref as never} className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold">Cancelar</Link>
            </div>
          </div>
        </aside>
      </form>}
    </section>
  );
}
