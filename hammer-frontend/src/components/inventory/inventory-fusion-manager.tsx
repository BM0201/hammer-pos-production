"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { showToast } from "@/components/ui/toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { Boxes, PackageCheck, PackageOpen, Plus, Search, Split, Wrench, X } from "lucide-react";

/* ─────────────────────────── Tipos ─────────────────────────── */

type ProductLite = { id: string; sku: string; name: string; unit: string };

type HealthIssue = { branchId: string; kind: "DERIVED_NONZERO" | "INVARIANT"; detail: string; expected: string; actual: string; diff: string };
type GroupHealth = { stockGroupId: string; stockGroupCode: string; healthy: boolean; issues: HealthIssue[] };

type BranchStockRow = {
  branch: { id: string; code: string; name: string };
  closedPackageQuantity: number;
  looseUnitQuantity: number;
  equivalentBaseQuantity: number;
  equivalentDerivedQuantity?: number;
  autoOpenablePackages: number;
};

type FusionMember = {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  saleUnit: string;
  conversionFactor: number;
  isCanonical: boolean;
  isPackagePresentation?: boolean;
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
  displayConversionFactor?: number | null;
  branchStocks: BranchStockRow[];
  isActive: boolean;
  health: GroupHealth;
  members: FusionMember[];
};

type FusionPreset = {
  key: string;
  label: string;
  baseUnit: string;
  packageUnit: string;
  factor: number;
  approximateFactor: boolean;
  namePatterns: string[];
};

type MigrationResolution = "USE_DERIVED_ONLY" | "USE_CANONICAL_ONLY" | "SUM_BOTH" | "MANUAL_BASE_QTY";

type WizardBranchPreview = {
  branchId: string;
  branchCode: string;
  canonicalQty: number;
  derivedAsBaseQty: number;
  resultIfUseDerivedOnly: number;
  resultIfUseCanonicalOnly: number;
  resultIfSumBoth: number;
  hasConflict: boolean;
  recommendedResolution: MigrationResolution;
  warning: string | null;
};

type RepairPreviewBranch = {
  branchId: string;
  branchCode: string;
  before: { quantityOnHand: string; closedPackageQuantity: string; looseUnitQuantity: string; weightedAverageCost: string };
  after: { quantityOnHand: string; closedPackageQuantity: string; looseUnitQuantity: string; weightedAverageCost: string };
  changed: boolean;
  warnings: string[];
};
type RepairPreview = { stockGroupId: string; stockGroupCode: string; branches: RepairPreviewBranch[]; anyChange: boolean; hash: string };

type UnmergePreviewBranch = { branchId: string; branchCode: string; targetNewQty: string; otherMemberIdsZeroed: string[] };
type UnmergePreview = { stockGroupId: string; stockGroupCode: string; totalStock: string; targetProductId: string; branches: UnmergePreviewBranch[] };

/* ─────────────────────────── Helpers ─────────────────────────── */

function fmt(n: number) {
  return n.toLocaleString("es-NI", { maximumFractionDigits: 2 });
}

function dualStockLabel(row: BranchStockRow, group: FusionGroup): { primary: string; secondary: string } {
  if (group.tracksPackages) {
    const packageUnit = group.packageUnit ?? "PAQ";
    return {
      primary: `${fmt(row.closedPackageQuantity)} ${packageUnit} + ${fmt(row.looseUnitQuantity)} ${group.baseUnit}`,
      secondary: `= ${fmt(row.equivalentBaseQuantity)} ${group.baseUnit}`,
    };
  }
  const derivedUnit = group.members.find((m) => !m.isCanonical)?.saleUnit ?? "";
  return {
    primary: `${fmt(row.looseUnitQuantity)} ${group.baseUnit}`,
    secondary: row.equivalentDerivedQuantity !== undefined ? `= ${fmt(row.equivalentDerivedQuantity)} ${derivedUnit}` : "",
  };
}

async function readJson(res: Response) {
  return res.json().catch(() => ({}));
}

/* ─────────────────────────── Componente principal ─────────────────────────── */

export function InventoryFusionManager() {
  const [groups, setGroups] = useState<FusionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [wizardOpen, setWizardOpen] = useState(false);
  const [openingGroup, setOpeningGroup] = useState<FusionGroup | null>(null);
  const [closingGroup, setClosingGroup] = useState<FusionGroup | null>(null);
  const [unmergingGroup, setUnmergingGroup] = useState<FusionGroup | null>(null);
  const [repairingGroup, setRepairingGroup] = useState<FusionGroup | null>(null);

  const loadGroups = useCallback(async () => {
    try {
      const res = await fetch("/api/inventory/stock-groups");
      const raw = await readJson(res);
      const list = unwrapApiData(raw);
      setGroups(Array.isArray(list) ? list : []);
    } catch {
      showToast("error", "No se pudieron cargar las fusiones.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) => g.name.toLowerCase().includes(q) || g.code.toLowerCase().includes(q) || g.members.some((m) => m.sku.toLowerCase().includes(q) || m.productName.toLowerCase().includes(q)),
    );
  }, [groups, search]);

  const unhealthyCount = groups.filter((g) => !g.health.healthy).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-[var(--color-text)]">Fusión de Inventario</h1>
          <p className="text-sm text-[var(--color-text-muted)]">Productos que se venden en varias presentaciones pero son una sola existencia física</p>
        </div>
        <span className="flex-1" />
        <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-soft)]">
          <Search className="h-4 w-4" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar fusión…"
            className="w-48 bg-transparent outline-none placeholder:text-[var(--color-text-soft)]"
          />
        </div>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setWizardOpen(true)}>
          Nueva fusión
        </Button>
      </div>

      <Card noPadding>
        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">Cargando…</div>
        ) : filteredGroups.length === 0 ? (
          <EmptyState
            icon={<Boxes />}
            title={groups.length === 0 ? "Sin fusiones todavía" : "Ninguna fusión coincide con la búsqueda"}
            description={groups.length === 0 ? "Creá la primera fusión para productos que comparten la misma existencia física en varias presentaciones." : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="hm-sheet-table">
              <thead>
                <tr>
                  <th>Fusión</th>
                  <th>Presentaciones</th>
                  <th className="r">Stock por sucursal</th>
                  <th>Salud</th>
                  <th style={{ textAlign: "center" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredGroups.map((group) => (
                  <tr key={group.id}>
                    <td>
                      <b className="text-[13px]">{group.name}</b>
                      <br />
                      <span className="font-mono text-[10.5px] text-[var(--color-text-muted)]">
                        base: {group.baseUnit.toLowerCase()}
                        {group.tracksPackages ? ` · ${group.packageUnit?.toLowerCase()} de ${group.displayConversionFactor}` : ""}
                      </span>
                    </td>
                    <td>
                      {group.members.map((m) => (
                        <span key={m.id} className="chip mute mr-1 inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-text-muted)]">
                          {m.saleUnit}
                        </span>
                      ))}
                      {group.approximateFactor && (
                        <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-warning-700)]" title="El factor es aproximado: cada apertura registra las unidades reales">
                          factor aprox.
                        </span>
                      )}
                    </td>
                    <td className="r">
                      <div className="flex flex-col gap-1">
                        {group.branchStocks.map((row) => {
                          const { primary, secondary } = dualStockLabel(row, group);
                          return (
                            <div key={row.branch.id} className="hm-num">
                              <span className="mr-1 text-[10px] font-semibold text-[var(--color-text-soft)]">{row.branch.code}</span>
                              <b>{primary}</b>
                              {secondary && <span className="ml-1 text-[10.5px] text-[var(--color-text-soft)]">{secondary}</span>}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                    <td>
                      {group.health.healthy ? (
                        <Badge variant="success">✓ Consistente</Badge>
                      ) : (
                        <Badge variant="warning" title={group.health.issues.map((i) => i.detail).join("; ")}>
                          ⚠ Descuadre
                        </Badge>
                      )}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <div className="flex flex-wrap items-center justify-center gap-1.5">
                        {group.tracksPackages && (
                          <Button variant="ghost" size="sm" icon={<PackageOpen className="h-3.5 w-3.5" />} onClick={() => setOpeningGroup(group)}>
                            Abrir caja
                          </Button>
                        )}
                        {group.tracksPackages && (
                          <Button variant="ghost" size="sm" icon={<PackageCheck className="h-3.5 w-3.5" />} onClick={() => setClosingGroup(group)}>
                            Empacar
                          </Button>
                        )}
                        {!group.health.healthy && (
                          <Button variant="ghost" size="sm" icon={<Wrench className="h-3.5 w-3.5" />} onClick={() => setRepairingGroup(group)}>
                            Reparar
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" icon={<Split className="h-3.5 w-3.5" />} onClick={() => setUnmergingGroup(group)}>
                          Desfusionar
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] px-3.5 py-2.5 text-[11.5px] text-[var(--color-text-soft)]">
              <span>La salud se verifica sola tras cada venta, compra o ajuste que toca una fusión</span>
              <span>{groups.length} fusion{groups.length === 1 ? "" : "es"}{unhealthyCount > 0 ? ` · ${unhealthyCount} con aviso` : ""}</span>
            </div>
          </div>
        )}
      </Card>

      {wizardOpen && (
        <FusionCreateWizard
          onClose={() => setWizardOpen(false)}
          onCreated={async () => {
            setWizardOpen(false);
            await loadGroups();
          }}
        />
      )}
      {openingGroup && (
        <OpenPackageModal
          group={openingGroup}
          onClose={() => setOpeningGroup(null)}
          onDone={async () => {
            setOpeningGroup(null);
            await loadGroups();
          }}
        />
      )}
      {closingGroup && (
        <ClosePackageModal
          group={closingGroup}
          onClose={() => setClosingGroup(null)}
          onDone={async () => {
            setClosingGroup(null);
            await loadGroups();
          }}
        />
      )}
      {unmergingGroup && (
        <UnmergeModal
          group={unmergingGroup}
          onClose={() => setUnmergingGroup(null)}
          onDone={async () => {
            setUnmergingGroup(null);
            await loadGroups();
          }}
        />
      )}
      {repairingGroup && (
        <RepairModal
          group={repairingGroup}
          onClose={() => setRepairingGroup(null)}
          onDone={async () => {
            setRepairingGroup(null);
            await loadGroups();
          }}
        />
      )}
    </div>
  );
}

/* ─────────────────────────── Modal shell ─────────────────────────── */

function ModalShell({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgb(28_25_23/0.45)] px-4 py-8">
      <div className={`w-full ${wide ? "max-w-2xl" : "max-w-lg"} rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-2xl`}>
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3.5">
          <h2 className="text-[15px] font-bold text-[var(--color-text)]">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Asistente de creación (3 pasos) ─────────────────────────── */

type WizardMemberDraft = { productId: string; sku: string; name: string; saleUnit: string; conversionFactor: number; isCanonical: boolean; isPackagePresentation: boolean };

function FusionCreateWizard({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [presets, setPresets] = useState<FusionPreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<FusionPreset | null>(null);

  const [name, setName] = useState("");
  const [members, setMembers] = useState<WizardMemberDraft[]>([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ProductLite[]>([]);

  const [tracksPackages, setTracksPackages] = useState(false);
  const [packageUnit, setPackageUnit] = useState("");
  const [factor, setFactor] = useState<number | "">("");
  const [approximateFactor, setApproximateFactor] = useState(false);
  const [autoOpenForUnitSale, setAutoOpenForUnitSale] = useState(true);

  const [preview, setPreview] = useState<{ hasAnyConflict: boolean; branches: WizardBranchPreview[] } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [resolutionByBranch, setResolutionByBranch] = useState<Record<string, MigrationResolution>>({});
  const [manualByBranch, setManualByBranch] = useState<Record<string, { closed?: number; loose?: number; base?: number }>>({});
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/inventory/stock-groups/fusion-presets")
      .then((r) => r.json())
      .then((raw) => setPresets(unwrapApiData(raw) ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!search.trim()) { setResults([]); return; }
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/catalog/products?isActive=true&limit=20&q=${encodeURIComponent(search.trim())}`);
        const raw = await readJson(res);
        const list = unwrapApiData(raw);
        setResults(Array.isArray(list) ? list.map((p: ProductLite) => ({ id: p.id, sku: p.sku, name: p.name, unit: p.unit })) : []);
      } catch {
        setResults([]);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [search]);

  const usedIds = useMemo(() => new Set(members.map((m) => m.productId)), [members]);
  const canonical = members.find((m) => m.isCanonical) ?? null;

  function applyPreset(preset: FusionPreset) {
    setSelectedPreset(preset);
    if (!name.trim()) setName(preset.label);
    setTracksPackages(preset.packageUnit === "KILO" || preset.approximateFactor);
    setPackageUnit(preset.packageUnit);
    setFactor(preset.factor);
    setApproximateFactor(preset.approximateFactor);
  }

  function addProduct(product: ProductLite) {
    if (usedIds.has(product.id)) {
      showToast("info", "Ese producto ya está en la fusión.");
      return;
    }
    const isFirst = members.length === 0;
    // No todas las fusiones tienen un empaque cerrado real (ej. Arena
    // vendida por Lata y por Metro — son solo dos unidades de venta, no hay
    // "caja" que abrir). Antes se asumía automáticamente que el 2do producto
    // agregado era el empaque, sin poder desmarcarlo — el usuario decide
    // explícitamente con el botón de cada fila, y solo importa si más
    // adelante activa "maneja empaques cerrados/sueltos" en el paso 2.
    setMembers((prev) => [
      ...prev,
      {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        saleUnit: product.unit,
        conversionFactor: isFirst ? 1 : Number(factor || 1),
        isCanonical: isFirst,
        isPackagePresentation: false,
      },
    ]);
    setSearch("");
    setResults([]);
  }

  function removeMember(productId: string) {
    setMembers((prev) => {
      const next = prev.filter((m) => m.productId !== productId);
      if (!next.some((m) => m.isCanonical) && next.length > 0) next[0] = { ...next[0], isCanonical: true, conversionFactor: 1 };
      return next;
    });
  }

  function markAsBase(productId: string) {
    // Al cambiar cuál producto es la base, los factores de los DEMÁS
    // miembros quedan como estaban — recalcularlos automáticamente no es
    // posible sin más info (dependen de la relación con el canónico
    // anterior), así que se deja al usuario ajustarlos si hace falta, en vez
    // de pisarlos en silencio con un valor compartido.
    setMembers((prev) => prev.map((m) => (m.productId === productId ? { ...m, isCanonical: true, conversionFactor: 1 } : { ...m, isCanonical: false })));
  }

  function updateMemberFactor(productId: string, value: number) {
    setMembers((prev) => prev.map((m) => (m.productId === productId ? { ...m, conversionFactor: value } : m)));
  }

  // Solo puede haber UN empaque cerrado a la vez — marcar uno desmarca
  // cualquier otro (las demás presentaciones no-canónicas quedan como
  // "sueltas alternativas"). Volver a hacer click sobre el que ya está
  // marcado lo desmarca por completo — no todas las fusiones tienen un
  // empaque real (ver comentario en addProduct), tiene que poder quedar
  // ninguno marcado.
  function setPackageMember(productId: string) {
    setMembers((prev) => {
      const alreadyMarked = prev.find((m) => m.productId === productId)?.isPackagePresentation;
      return prev.map((m) => (m.isCanonical ? m : { ...m, isPackagePresentation: !alreadyMarked && m.productId === productId }));
    });
  }

  const packageMember = members.find((m) => !m.isCanonical && m.isPackagePresentation) ?? null;

  function goToStep3() {
    if (!name.trim()) { showToast("error", "Ingresá un nombre para la fusión."); return; }
    if (members.length < 2) { showToast("error", "Agregá al menos 2 productos."); return; }
    if (!canonical) { showToast("error", "Marcá cuál producto es la unidad suelta (base)."); return; }
    if (members.some((m) => !m.isCanonical && !(m.conversionFactor > 0))) {
      showToast("error", "Cada presentación necesita un factor de conversión mayor que 0.");
      return;
    }
    if (tracksPackages && (!packageUnit.trim() || !packageMember)) {
      showToast("error", "Marcá cuál presentación es el empaque cerrado e indicá su unidad.");
      return;
    }
    setStep(3);
    void loadPreview();
  }

  async function loadPreview() {
    setPreviewLoading(true);
    try {
      const res = await apiFetch("/api/inventory/stock-groups/preview-creation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ members: members.map((m) => ({ productId: m.productId, conversionFactor: m.conversionFactor, isCanonical: m.isCanonical, isPackagePresentation: m.isPackagePresentation })) }),
      });
      const raw = await readJson(res);
      if (!res.ok) { showToast("error", raw?.error?.message ?? "No se pudo calcular el preview."); return; }
      const data: { hasAnyConflict: boolean; branches: WizardBranchPreview[] } = unwrapApiData(raw);
      setPreview(data);
      const initial: Record<string, MigrationResolution> = {};
      for (const b of data.branches) if (!b.hasConflict) initial[b.branchId] = b.recommendedResolution;
      setResolutionByBranch(initial);
    } catch {
      showToast("error", "Error de red al calcular el preview.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function create() {
    if (!preview) return;
    const unresolved = preview.branches.filter((b) => b.hasConflict && !resolutionByBranch[b.branchId]);
    if (unresolved.length > 0) {
      showToast("error", `Elegí una opción para: ${unresolved.map((b) => b.branchCode).join(", ")}.`);
      return;
    }
    setCreating(true);
    try {
      const branchResolutions: Record<string, { resolution: MigrationResolution | "RECOMMENDED"; manualBaseQty?: number; manualClosedQty?: number; manualLooseQty?: number }> = {};
      for (const b of preview.branches) {
        const resolution = resolutionByBranch[b.branchId] ?? "RECOMMENDED";
        const manual = manualByBranch[b.branchId];
        branchResolutions[b.branchId] = {
          resolution,
          manualBaseQty: resolution === "MANUAL_BASE_QTY" && !tracksPackages ? manual?.base : undefined,
          manualClosedQty: resolution === "MANUAL_BASE_QTY" && tracksPackages ? manual?.closed : undefined,
          manualLooseQty: resolution === "MANUAL_BASE_QTY" && tracksPackages ? manual?.loose : undefined,
        };
      }
      const res = await apiFetch("/api/inventory/stock-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          baseUnit: canonical?.saleUnit,
          packageUnit: tracksPackages ? (packageUnit.trim() || packageMember?.saleUnit || null) : null,
          conversionFactorToBase: tracksPackages ? (packageMember?.conversionFactor ?? null) : null,
          tracksPackages,
          approximateFactor: tracksPackages ? approximateFactor : false,
          autoOpenForUnitSale: tracksPackages ? autoOpenForUnitSale : false,
          minimumClosedPackageReserve: 1,
          members: members.map((m) => ({
            productId: m.productId,
            saleUnit: m.saleUnit,
            conversionFactor: m.conversionFactor,
            isCanonical: m.isCanonical,
            // Sin "maneja empaques cerrados/sueltos" activo, la marca de
            // empaque no significa nada — se fuerza a false aunque haya
            // quedado marcada de un paso anterior.
            isPackagePresentation: tracksPackages && m.isPackagePresentation,
          })),
          branchResolutions,
        }),
      });
      const raw = await readJson(res);
      if (!res.ok) { showToast("error", raw?.error?.message ?? "No se pudo crear la fusión."); return; }
      showToast("success", "Fusión creada correctamente.");
      onCreated();
    } catch {
      showToast("error", "Error de red al crear la fusión.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <ModalShell title="Nueva fusión" onClose={onClose} wide>
      <div className="mb-4 flex items-center gap-2 text-xs font-semibold text-[var(--color-text-soft)]">
        <span className={step >= 1 ? "text-[var(--color-master-700)]" : ""}>1 · Productos</span>
        <span className="h-px flex-1 bg-[var(--color-border-strong)]" />
        <span className={step >= 2 ? "text-[var(--color-master-700)]" : ""}>2 · Equivalencia</span>
        <span className="h-px flex-1 bg-[var(--color-border-strong)]" />
        <span className={step >= 3 ? "text-[var(--color-master-700)]" : ""}>3 · Existencias</span>
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <Input label="Nombre de la fusión" value={name} onChange={(e) => setName(e.target.value)} placeholder='Ej: Clavo acero 2"' />

          {presets.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-[var(--color-text-muted)]">Presets de familia (opcional — solo precargan el factor)</p>
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => applyPreset(p)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${selectedPreset?.key === p.key ? "border-[var(--color-master-500)] bg-[var(--color-master-50)] text-[var(--color-master-700)]" : "border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]"}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.productId} className="flex flex-wrap items-center gap-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2">
                <b className="flex-1 text-[12.5px]">{m.sku} — {m.name}</b>
                {m.isCanonical ? (
                  <Badge variant="info">unidad suelta (base)</Badge>
                ) : (
                  <>
                    <span className="flex items-center gap-1 text-[11.5px] text-[var(--color-text-muted)]">
                      1 {m.saleUnit || "und"} =
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={m.conversionFactor}
                        onChange={(e) => updateMemberFactor(m.productId, Number(e.target.value) || 0)}
                        className="w-20 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-right font-mono"
                      />
                      {canonical?.saleUnit ?? "base"}
                    </span>
                    {/* Fusión triple: con 3+ productos, cuál es "el empaque"
                        (Caja) ya no se puede inferir del orden en que se
                        agregaron — el usuario lo elige acá. Las demás
                        presentaciones no-canónicas quedan como sueltas
                        alternativas (ej. Libra, Unidad). */}
                    <button
                      type="button"
                      onClick={() => setPackageMember(m.productId)}
                      className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${m.isPackagePresentation ? "border-[var(--color-master-500)] bg-[var(--color-master-50)] text-[var(--color-master-700)]" : "border-[var(--color-border)] text-[var(--color-text-soft)]"}`}
                      title="Marcar esta presentación como el empaque cerrado (caja) — solo puede haber una"
                    >
                      {m.isPackagePresentation ? "✓ empaque cerrado" : "marcar como empaque"}
                    </button>
                    <button type="button" onClick={() => markAsBase(m.productId)} className="text-[11px] font-semibold text-[var(--color-master-700)] hover:underline">
                      marcar como base
                    </button>
                  </>
                )}
                <button type="button" onClick={() => removeMember(m.productId)} className="rounded p-1 text-[var(--color-text-soft)] hover:bg-[var(--color-surface-alt)]">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <div className="relative">
              <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-soft)]">
                <Search className="h-4 w-4" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Agregar producto…" className="w-full bg-transparent outline-none" />
              </div>
              {results.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-lg">
                  {results.map((p) => (
                    <button key={p.id} type="button" onClick={() => addProduct(p)} className="block w-full px-3 py-2 text-left text-[12.5px] hover:bg-[var(--color-surface-alt)]">
                      <b>{p.sku}</b> — {p.name} <span className="text-[var(--color-text-soft)]">({p.unit})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <Button variant="primary" onClick={() => setStep(2)} disabled={members.length < 2 || !canonical}>
              Continuar →
            </Button>
          </div>
        </div>
      )}

      {step === 2 && canonical && (
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-[12.5px]">
            <p className="mb-1.5 font-semibold text-[var(--color-text-secondary)]">Equivalencias (definidas en el paso anterior):</p>
            <ul className="space-y-0.5 text-[var(--color-text-muted)]">
              {members.filter((m) => !m.isCanonical).map((m) => (
                <li key={m.productId}>
                  1 {m.saleUnit || "und"} = <b className="font-mono text-[var(--color-text)]">{m.conversionFactor}</b> {canonical.saleUnit}
                  {m.isPackagePresentation && <span className="ml-1 text-[var(--color-master-700)]">(empaque cerrado)</span>}
                </li>
              ))}
            </ul>
          </div>

          <label className="flex items-center gap-2 text-[12.5px] text-[var(--color-text-secondary)]">
            <input type="checkbox" checked={tracksPackages} onChange={(e) => setTracksPackages(e.target.checked)} />
            Maneja empaques cerrados/sueltos (el sistema controla cajas cerradas + unidades sueltas por separado)
          </label>

          {tracksPackages && (
            <>
              <Input
                label="Unidad de empaque (nombre a mostrar, ej. KILO, CAJA)"
                value={packageUnit || packageMember?.saleUnit || ""}
                onChange={(e) => setPackageUnit(e.target.value)}
                placeholder="Ej: KILO, CAJA"
              />
              {!packageMember && (
                <p className="text-[11.5px] text-[var(--color-warning-700)]">
                  ⚠ Volvé al paso anterior y marcá cuál presentación es el empaque cerrado.
                </p>
              )}
              <label className="flex items-center gap-2 text-[12.5px] text-[var(--color-text-secondary)]">
                <input type="checkbox" checked={approximateFactor} onChange={(e) => setApproximateFactor(e.target.checked)} />
                Algún factor es aproximado (ej. peso promedio por unidad) — al abrir cada empaque se registran las unidades reales
              </label>
              <label className="flex items-center gap-2 text-[12.5px] text-[var(--color-text-secondary)]">
                <input type="checkbox" checked={autoOpenForUnitSale} onChange={(e) => setAutoOpenForUnitSale(e.target.checked)} />
                Abrir empaque automáticamente cuando el POS venda sueltas y no haya suficientes
              </label>
            </>
          )}

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(1)}>‹ Atrás</Button>
            <Button variant="primary" onClick={goToStep3}>Revisar existencias →</Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          {previewLoading || !preview ? (
            <div className="py-8 text-center text-sm text-[var(--color-text-muted)]">Calculando…</div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
                <table className="hm-sheet-table">
                  <thead>
                    <tr>
                      <th>Sucursal</th>
                      <th className="r">Otras presentaciones tienen (en {canonical?.saleUnit})</th>
                      <th className="r">{canonical?.saleUnit} tiene</th>
                      <th>Situación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.branches.map((b) => (
                      <tr key={b.branchId}>
                        <td><b>{b.branchCode}</b></td>
                        <td className="hm-num">{fmt(b.derivedAsBaseQty)}</td>
                        <td className="hm-num">{fmt(b.canonicalQty)}</td>
                        <td>
                          {b.hasConflict ? <Badge variant="warning">⚠ Ambas tienen stock — decidí abajo</Badge> : <Badge variant="success">Sin conflicto</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {preview.branches.filter((b) => b.hasConflict).map((b) => (
                <div key={b.branchId} className="rounded-lg border border-[var(--color-border)] p-3.5">
                  <p className="mb-2.5 text-[12.5px] font-bold">{b.branchCode} tiene stock en las dos presentaciones. ¿Qué representa?</p>
                  <div className="space-y-2">
                    {([
                      ["SUM_BOTH", "Son montones separados — sumalos", `Resultado: ${fmt(b.resultIfSumBoth)}`],
                      ["USE_DERIVED_ONLY", "Misma mercadería contada dos veces — usá solo los empaques", `Resultado: ${fmt(b.resultIfUseDerivedOnly)}`],
                      ["USE_CANONICAL_ONLY", "Usá solo las sueltas", `Resultado: ${fmt(b.resultIfUseCanonicalOnly)}`],
                      ["MANUAL_BASE_QTY", "Yo pongo el número — conteo físico", ""],
                    ] as const).map(([value, label, hint]) => (
                      <label key={value} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 ${resolutionByBranch[b.branchId] === value ? "border-[var(--color-master-500)] bg-[var(--color-master-50)]" : "border-[var(--color-border)]"}`}>
                        <input type="radio" className="mt-0.5" checked={resolutionByBranch[b.branchId] === value} onChange={() => setResolutionByBranch((prev) => ({ ...prev, [b.branchId]: value }))} />
                        <span>
                          <b className="block text-[12.5px]">{label}</b>
                          {hint && <span className="text-[11.5px] text-[var(--color-text-muted)]">{hint}</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                  {resolutionByBranch[b.branchId] === "MANUAL_BASE_QTY" && (
                    <div className="mt-2 flex gap-2">
                      {tracksPackages ? (
                        <>
                          <input type="number" placeholder="cajas cerradas" onChange={(e) => setManualByBranch((prev) => ({ ...prev, [b.branchId]: { ...prev[b.branchId], closed: Number(e.target.value) } }))} className="w-32 rounded-lg border border-[var(--color-border)] px-2 py-1 text-sm" />
                          <input type="number" placeholder="sueltas" onChange={(e) => setManualByBranch((prev) => ({ ...prev, [b.branchId]: { ...prev[b.branchId], loose: Number(e.target.value) } }))} className="w-32 rounded-lg border border-[var(--color-border)] px-2 py-1 text-sm" />
                        </>
                      ) : (
                        <input type="number" placeholder="cantidad base" onChange={(e) => setManualByBranch((prev) => ({ ...prev, [b.branchId]: { ...prev[b.branchId], base: Number(e.target.value) } }))} className="w-40 rounded-lg border border-[var(--color-border)] px-2 py-1 text-sm" />
                      )}
                    </div>
                  )}
                  <p className="mt-2 text-[11px] text-[var(--color-text-soft)]">💡 Recomendación: {b.recommendedResolution}</p>
                </div>
              ))}

              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep(2)}>‹ Atrás</Button>
                <Button variant="primary" loading={creating} onClick={create}>✓ Crear fusión con estos números</Button>
              </div>
            </>
          )}
        </div>
      )}
    </ModalShell>
  );
}

/* ─────────────────────────── Abrir caja ─────────────────────────── */

function OpenPackageModal({ group, onClose, onDone }: { group: FusionGroup; onClose: () => void; onDone: () => void }) {
  const branchesWithPackages = group.branchStocks.filter((b) => b.closedPackageQuantity > 0);
  const [branchId, setBranchId] = useState(branchesWithPackages[0]?.branch.id ?? group.branchStocks[0]?.branch.id ?? "");
  const [actualUnits, setActualUnits] = useState<number | "">(group.conversionFactorToBase ?? group.displayConversionFactor ?? "");
  const [reason, setReason] = useState("Apertura para venta unitaria");
  const [saving, setSaving] = useState(false);

  // Sin fallback al primer no-canónico: con fusión triple (3+ miembros) eso
  // podría agarrar una presentación suelta alternativa (ej. Libra) en vez del
  // empaque real. El backend ya garantiza exactamente un isPackagePresentation.
  const packageMember = group.members.find((m) => m.isPackagePresentation);

  async function confirm() {
    if (!branchId || !(Number(actualUnits) > 0)) { showToast("error", "Seleccioná sucursal y unidades reales mayores que 0."); return; }
    setSaving(true);
    try {
      const res = await apiFetch(`/api/inventory/stock-groups/${group.id}/open-package`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, packageProductId: packageMember?.productId ?? null, actualUnits: Number(actualUnits), reason: reason.trim() || undefined }),
      });
      const raw = await readJson(res);
      if (!res.ok) { showToast("error", raw?.error?.message ?? "No se pudo abrir el empaque."); return; }
      showToast("success", "Empaque abierto para venta unitaria.");
      onDone();
    } catch {
      showToast("error", "Error de red al abrir el empaque.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title={`Abrir ${group.packageUnit?.toLowerCase() ?? "empaque"} — ${group.name}`} onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-[11.5px] font-semibold text-[var(--color-text-muted)]">
          Sucursal
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
            {group.branchStocks.map((b) => (
              <option key={b.branch.id} value={b.branch.id}>{b.branch.code} — {b.branch.name} ({fmt(b.closedPackageQuantity)} cerrados)</option>
            ))}
          </select>
        </label>
        <label className="block text-[11.5px] font-semibold text-[var(--color-text-muted)]">
          Unidades reales que salieron <span className="font-normal text-[var(--color-text-soft)]">(factor {group.displayConversionFactor} de referencia)</span>
          <input type="number" value={actualUnits} onChange={(e) => setActualUnits(e.target.value === "" ? "" : Number(e.target.value))} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-right font-mono text-sm" />
        </label>
        <Input label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button variant="primary" className="w-full" loading={saving} onClick={confirm}>Abrir y registrar</Button>
      </div>
    </ModalShell>
  );
}

/* ─────────────────────────── Empacar (reverso de abrir caja) ─────────────────────────── */

function ClosePackageModal({ group, onClose, onDone }: { group: FusionGroup; onClose: () => void; onDone: () => void }) {
  const factor = group.displayConversionFactor ?? group.conversionFactorToBase ?? 1;
  const branchesWithLoose = group.branchStocks.filter((b) => b.looseUnitQuantity >= factor);
  const [branchId, setBranchId] = useState(branchesWithLoose[0]?.branch.id ?? group.branchStocks[0]?.branch.id ?? "");
  const [packagesToClose, setPackagesToClose] = useState<number | "">(1);
  // Sueltas realmente consumidas — precargado con el estimado (factor ×
  // cajas), editable para factores aproximados (ej. peso real al pesar).
  const [actualUnitsConsumed, setActualUnitsConsumed] = useState<number | "">(factor);
  const [reason, setReason] = useState("Reempaque de sueltas a empaque cerrado");
  const [saving, setSaving] = useState(false);

  const packageMember = group.members.find((m) => m.isPackagePresentation);
  const selectedBranch = group.branchStocks.find((b) => b.branch.id === branchId);

  function onPackagesChange(value: string) {
    const parsed = value === "" ? "" : Number(value);
    setPackagesToClose(parsed);
    // Sincroniza el estimado de sueltas consumidas salvo que el usuario ya
    // lo haya editado a mano para reflejar un peso real distinto.
    setActualUnitsConsumed(parsed === "" ? "" : Number(parsed) * factor);
  }

  async function confirm() {
    if (!branchId || !(Number(packagesToClose) > 0) || !Number.isInteger(Number(packagesToClose))) {
      showToast("error", "Seleccioná sucursal y una cantidad entera de empaques mayor que 0.");
      return;
    }
    if (!(Number(actualUnitsConsumed) > 0)) {
      showToast("error", "Las unidades sueltas consumidas deben ser mayores que 0.");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch(`/api/inventory/stock-groups/${group.id}/close-package`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          packageProductId: packageMember?.productId ?? null,
          packagesToClose: Number(packagesToClose),
          actualUnitsConsumed: Number(actualUnitsConsumed),
          reason: reason.trim() || undefined,
        }),
      });
      const raw = await readJson(res);
      if (!res.ok) { showToast("error", raw?.error?.message ?? "No se pudo reempacar."); return; }
      showToast("success", "Sueltas reempacadas a empaque cerrado.");
      onDone();
    } catch {
      showToast("error", "Error de red al reempacar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title={`Empacar a ${group.packageUnit?.toLowerCase() ?? "empaque"} — ${group.name}`} onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-[11.5px] font-semibold text-[var(--color-text-muted)]">
          Sucursal
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
            {group.branchStocks.map((b) => (
              <option key={b.branch.id} value={b.branch.id}>{b.branch.code} — {b.branch.name} ({fmt(b.looseUnitQuantity)} sueltos)</option>
            ))}
          </select>
        </label>
        {selectedBranch && (
          <p className="text-[11px] text-[var(--color-text-soft)]">Sueltos disponibles: {fmt(selectedBranch.looseUnitQuantity)} {group.baseUnit.toLowerCase()}</p>
        )}
        <label className="block text-[11.5px] font-semibold text-[var(--color-text-muted)]">
          Empaques a armar
          <input type="number" min={1} step={1} value={packagesToClose} onChange={(e) => onPackagesChange(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-right font-mono text-sm" />
        </label>
        <label className="block text-[11.5px] font-semibold text-[var(--color-text-muted)]">
          Sueltas realmente consumidas <span className="font-normal text-[var(--color-text-soft)]">(factor {factor} de referencia)</span>
          <input type="number" value={actualUnitsConsumed} onChange={(e) => setActualUnitsConsumed(e.target.value === "" ? "" : Number(e.target.value))} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-right font-mono text-sm" />
        </label>
        <Input label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button variant="primary" className="w-full" loading={saving} onClick={confirm}>Empacar y registrar</Button>
      </div>
    </ModalShell>
  );
}

/* ─────────────────────────── Desfusionar ─────────────────────────── */

function UnmergeModal({ group, onClose, onDone }: { group: FusionGroup; onClose: () => void; onDone: () => void }) {
  const canonical = group.members.find((m) => m.isCanonical) ?? group.members[0];
  const [targetProductId, setTargetProductId] = useState(canonical?.productId ?? "");
  const [preview, setPreview] = useState<UnmergePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  const loadPreview = useCallback(async (target: string) => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/inventory/stock-groups/${group.id}/unmerge-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetProductId: target }),
      });
      const raw = await readJson(res);
      if (!res.ok) { showToast("error", raw?.error?.message ?? "No se pudo calcular el preview."); return; }
      setPreview(unwrapApiData(raw));
    } catch {
      showToast("error", "Error de red al calcular el preview.");
    } finally {
      setLoading(false);
    }
  }, [group.id]);

  useEffect(() => { if (targetProductId) void loadPreview(targetProductId); }, [targetProductId, loadPreview]);

  async function confirmUnmerge() {
    setApplying(true);
    try {
      const res = await apiFetch(`/api/inventory/stock-groups/${group.id}?targetProductId=${encodeURIComponent(targetProductId)}`, { method: "DELETE" });
      const raw = await readJson(res);
      if (!res.ok) { showToast("error", raw?.error?.message ?? "No se pudo desfusionar."); return; }
      showToast("success", "Fusión desactivada — el stock quedó reasignado.");
      onDone();
    } catch {
      showToast("error", "Error de red al desfusionar.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <ModalShell title={`Desfusionar — ${group.name}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-[12.5px] text-[var(--color-text-muted)]">
          El stock consolidado se reasigna a UNA presentación; las demás quedan en cero.
        </p>
        <label className="block text-[11.5px] font-semibold text-[var(--color-text-muted)]">
          Reasignar todo el stock a
          <select value={targetProductId} onChange={(e) => setTargetProductId(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
            {group.members.map((m) => (
              <option key={m.productId} value={m.productId}>{m.sku} — {m.saleUnit}{m.isCanonical ? " (recomendado: unidad base)" : ""}</option>
            ))}
          </select>
        </label>

        {loading || !preview ? (
          <div className="py-4 text-center text-sm text-[var(--color-text-muted)]">Calculando…</div>
        ) : (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-[12.5px]">
            {preview.branches.map((b) => (
              <div key={b.branchId} className="flex justify-between py-0.5">
                <span className="text-[var(--color-text-muted)]">{b.branchCode} quedará</span>
                <b className="font-mono">{fmt(Number(b.targetNewQty))}</b>
              </div>
            ))}
            <div className="flex justify-between py-0.5">
              <span className="text-[var(--color-text-muted)]">Movimientos auditados</span>
              <b>{preview.branches.length} · reversibles re-fusionando</b>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" className="flex-1" loading={applying} onClick={confirmUnmerge}>Desfusionar</Button>
        </div>
      </div>
    </ModalShell>
  );
}

/* ─────────────────────────── Reparar ─────────────────────────── */

function RepairModal({ group, onClose, onDone }: { group: FusionGroup; onClose: () => void; onDone: () => void }) {
  const [preview, setPreview] = useState<RepairPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/inventory/stock-groups/${group.id}/repair`);
      const raw = await readJson(res);
      if (!res.ok) { showToast("error", raw?.error?.message ?? "No se pudo calcular el preview de reparación."); return; }
      setPreview(unwrapApiData(raw));
    } catch {
      showToast("error", "Error de red al calcular el preview.");
    } finally {
      setLoading(false);
    }
  }, [group.id]);

  useEffect(() => { void loadPreview(); }, [loadPreview]);

  async function confirmRepair() {
    if (!preview) return;
    setApplying(true);
    try {
      const res = await apiFetch(`/api/inventory/stock-groups/${group.id}/repair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedHash: preview.hash, reason: "Reparación guiada desde Fusión de Inventario" }),
      });
      const raw = await readJson(res);
      if (!res.ok) {
        if (raw?.error?.code === "REPAIR_PREVIEW_STALE") {
          showToast("warning", "El inventario cambió desde este preview. Recalculando…");
          await loadPreview();
          return;
        }
        showToast("error", raw?.error?.message ?? "No se pudo reparar.");
        return;
      }
      showToast("success", "Fusión reparada correctamente.");
      onDone();
    } catch {
      showToast("error", "Error de red al reparar.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <ModalShell title={`Reparar — ${group.name}`} onClose={onClose} wide>
      {loading || !preview ? (
        <div className="py-8 text-center text-sm text-[var(--color-text-muted)]">Calculando…</div>
      ) : (
        <div className="space-y-3">
          <p className="text-[12.5px] text-[var(--color-text-muted)]">
            Antes de tocar nada: qué números tiene cada presentación hoy, qué números quedarían, y la diferencia.
          </p>
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <table className="hm-sheet-table">
              <thead>
                <tr>
                  <th>Sucursal</th>
                  <th className="r">Antes</th>
                  <th className="r">Después</th>
                  <th>¿Cambia?</th>
                </tr>
              </thead>
              <tbody>
                {preview.branches.map((b) => (
                  <tr key={b.branchId}>
                    <td><b>{b.branchCode}</b></td>
                    <td className="hm-num">{fmt(Number(b.before.quantityOnHand))}</td>
                    <td className="hm-num">{fmt(Number(b.after.quantityOnHand))}</td>
                    <td>{b.changed ? <Badge variant="warning">Sí</Badge> : <Badge variant="success">No</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!preview.anyChange && <p className="text-[12.5px] text-[var(--color-text-muted)]">No hay cambios pendientes — esta fusión ya está sana.</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button variant="primary" loading={applying} disabled={!preview.anyChange} onClick={confirmRepair}>Confirmar reparación</Button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
