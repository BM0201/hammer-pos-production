"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { Plus, Truck, Search, TreePine, X, Settings2 } from "lucide-react";

/* ─────────────────────────── Tipos ─────────────────────────── */

type Branch = { id: string; code: string; name: string };

type TripLineDraft = { thickness: number; width: number; length: number; pieces: number };

type Expenses = { freightAmount: number; fuelAmount: number; perDiemAmount: number; permitsAmount: number; otherExpensesAmount: number };

type TripSummary = {
  id: string;
  tripCode: string;
  status: string;
  destinationBranch: { code: string; name: string };
  totalPieces: number;
  totalFeet: number | string;
  totalCost: number | string;
  marginPercent: number | string;
  supplierName: string | null;
  createdAt: string;
};

type TripDetail = {
  id: string;
  tripCode: string;
  status: string;
  destinationBranchId: string;
  destinationBranch: { code: string; name: string };
  woodTripTotalCost: number | string;
  computedCostPerFoot: number | string;
  landedCostPerFoot: number | string;
  tripExpensesTotal: number | string;
  freightAmount: number | string;
  fuelAmount: number | string;
  perDiemAmount: number | string;
  permitsAmount: number | string;
  otherExpensesAmount: number | string;
  invoicedFeet: number | string | null;
  pricePolicy: string;
  totalPieces: number;
  totalFeet: number | string;
  totalCost: number | string;
  totalSale: number | string;
  totalProfit: number | string;
  marginPercent: number | string;
  pricePerInchTabla: number | string;
  pricePerInchTablilla: number | string;
  pricePerInchCuadro: number | string;
  supplierName: string | null;
  origin: string | null;
  notes: string | null;
  reconciliation: { invoicedFeet: number | null; differenceFeet: number; differencePercent: number; tolerancePercent: number; status: "OK" | "REVIEW" | "NOT_APPLICABLE" };
  lines: Array<{ id: string; thicknessIn: number; widthIn: number; lengthIn: number; varaLength: number; priceGroup: string; pieces: number; calculatedFeet: number | string; calculatedCostFeet: number | string; calculatedCostPerPiece: number | string; calculatedSalePricePerPiece: number | string; calculatedSaleTotal: number | string; calculatedProfit: number | string; calculatedMarginPct: number | string }>;
};

type InjectionPreviewLine = {
  lineId: string;
  dimensions: { thickness: number; width: number; length: number };
  isNewProduct: boolean;
  piecesToAdd: number;
  costPerPiece: { before: number | null; after: number };
  wac: { before: number | null; after: number };
  branchCost: { before: number | null; after: number };
  sellingPrice: { before: number | null; after: number };
};
type InjectionPreview = { tripId: string; tripCode: string; pricePolicy: string; lines: InjectionPreviewLine[]; hash: string };

/* ─────────────────────────── Helpers ─────────────────────────── */

function n(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : Number(v);
}
function fmt(v: number | string | null | undefined, decimals = 2): string {
  return n(v).toLocaleString("es-NI", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function pct(v: number | string | null | undefined): string {
  return `${(n(v) * 100).toFixed(2)}%`;
}
async function readJson(res: Response) {
  return res.json().catch(() => ({}));
}

// prompt-timber-cubicacion-carga.md, Parte A — las 54 medidas reales de
// la columna MEDIDA del Excel de cubicación del usuario (antes solo 10,
// todas de 1"). Hardcodeada a propósito, no movida a TimberPricingConfig:
// son medidas de aserradero estándar, prácticamente fijas — el atajo de
// selección rápida no necesita ser editable sin redeploy; cualquier
// medida fuera de esta lista siempre se puede agregar a mano en el
// formulario de líneas, que no depende de esta constante.
const STANDARD_MEASURES: TripLineDraft[] = [
  { thickness: 1, width: 12, length: 16, pieces: 0 },
  { thickness: 1, width: 12, length: 14, pieces: 0 },
  { thickness: 1, width: 12, length: 11, pieces: 0 },
  { thickness: 1, width: 12, length: 8, pieces: 0 },
  { thickness: 2, width: 12, length: 16, pieces: 0 },
  { thickness: 2, width: 12, length: 14, pieces: 0 },
  { thickness: 2, width: 12, length: 11, pieces: 0 },
  { thickness: 2, width: 10, length: 16, pieces: 0 },
  { thickness: 2, width: 10, length: 14, pieces: 0 },
  { thickness: 2, width: 10, length: 11, pieces: 0 },
  { thickness: 1, width: 10, length: 16, pieces: 0 },
  { thickness: 1, width: 10, length: 14, pieces: 0 },
  { thickness: 1, width: 10, length: 11, pieces: 0 },
  { thickness: 1, width: 10, length: 8, pieces: 0 },
  { thickness: 1, width: 8, length: 16, pieces: 0 },
  { thickness: 1, width: 8, length: 14, pieces: 0 },
  { thickness: 1, width: 8, length: 11, pieces: 0 },
  { thickness: 1, width: 8, length: 8, pieces: 0 },
  { thickness: 1, width: 6, length: 16, pieces: 0 },
  { thickness: 1, width: 6, length: 14, pieces: 0 },
  { thickness: 1, width: 6, length: 11, pieces: 0 },
  { thickness: 1, width: 6, length: 8, pieces: 0 },
  { thickness: 2, width: 8, length: 16, pieces: 0 },
  { thickness: 2, width: 8, length: 15, pieces: 0 },
  { thickness: 2, width: 8, length: 14, pieces: 0 },
  { thickness: 2, width: 6, length: 16, pieces: 0 },
  { thickness: 2, width: 6, length: 14, pieces: 0 },
  { thickness: 2, width: 6, length: 11, pieces: 0 },
  { thickness: 2, width: 4, length: 16, pieces: 0 },
  { thickness: 2, width: 4, length: 14, pieces: 0 },
  { thickness: 2, width: 4, length: 11, pieces: 0 },
  { thickness: 2, width: 4, length: 8, pieces: 0 },
  { thickness: 2, width: 3, length: 16, pieces: 0 },
  { thickness: 2, width: 3, length: 14, pieces: 0 },
  { thickness: 2, width: 3, length: 11, pieces: 0 },
  { thickness: 2, width: 3, length: 8, pieces: 0 },
  { thickness: 2, width: 2, length: 16, pieces: 0 },
  { thickness: 2, width: 2, length: 14, pieces: 0 },
  { thickness: 2, width: 2, length: 11, pieces: 0 },
  { thickness: 2, width: 2, length: 8, pieces: 0 },
  { thickness: 1, width: 3, length: 16, pieces: 0 },
  { thickness: 1, width: 3, length: 14, pieces: 0 },
  { thickness: 1, width: 3, length: 11, pieces: 0 },
  { thickness: 1, width: 3, length: 8, pieces: 0 },
  { thickness: 1, width: 2, length: 16, pieces: 0 },
  { thickness: 1, width: 2, length: 14, pieces: 0 },
  { thickness: 1, width: 2, length: 11, pieces: 0 },
  { thickness: 1, width: 2, length: 8, pieces: 0 },
  { thickness: 1, width: 4, length: 16, pieces: 0 },
  { thickness: 1, width: 4, length: 14, pieces: 0 },
  { thickness: 1, width: 4, length: 11, pieces: 0 },
  { thickness: 4, width: 4, length: 16, pieces: 0 },
  { thickness: 4, width: 4, length: 14, pieces: 0 },
  { thickness: 4, width: 4, length: 11, pieces: 0 },
];

/* ─────────────────────────── Componente principal ─────────────────────────── */

export function TimberWorkspace() {
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);

  if (selectedTripId) {
    return <TripWorkspace tripId={selectedTripId} onBack={() => setSelectedTripId(null)} />;
  }
  if (creatingNew) {
    return <NewTripForm onCreated={(id) => { setCreatingNew(false); setSelectedTripId(id); }} onCancel={() => setCreatingNew(false)} />;
  }
  return <TripsList onSelect={setSelectedTripId} onCreateNew={() => setCreatingNew(true)} />;
}

/* ─────────────────────────── Lista de viajes ─────────────────────────── */

function TripsList({ onSelect, onCreateNew }: { onSelect: (id: string) => void; onCreateNew: () => void }) {
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/timber/trips?search=${encodeURIComponent(search)}&limit=50`);
      const raw = await readJson(res);
      const data = unwrapApiData(raw);
      setTrips(Array.isArray(data?.items) ? data.items : []);
    } catch {
      showToast("error", "No se pudieron cargar los viajes.");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="hm-section-icon hm-section-icon-master"><Truck className="h-4 w-4" /></div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-[var(--color-text)]">Viajes de Madera</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Del viaje al costo inyectado en cada medida</p>
          </div>
        </div>
        <span className="flex-1" />
        <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-soft)]">
          <Search className="h-4 w-4" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar viaje…" className="w-48 bg-transparent outline-none" />
        </div>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={onCreateNew}>Nuevo viaje</Button>
      </div>

      <Card noPadding>
        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">Cargando…</div>
        ) : trips.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <TreePine className="h-8 w-8 text-[var(--color-text-soft)]" />
            <p className="text-sm text-[var(--color-text-muted)]">No hay viajes registrados todavía.</p>
          </div>
        ) : (
          <table className="hm-sheet-table">
            <thead>
              <tr>
                <th>Viaje</th>
                <th>Destino</th>
                <th>Estado</th>
                <th className="r">Piezas</th>
                <th className="r">Pies</th>
                <th className="r">Costo total</th>
                <th className="r">Margen</th>
              </tr>
            </thead>
            <tbody>
              {trips.map((t) => (
                <tr key={t.id} className="cursor-pointer" onClick={() => onSelect(t.id)}>
                  <td><b className="font-mono text-[12.5px]">{t.tripCode}</b>{t.supplierName && <><br /><span className="text-[11px] text-[var(--color-text-muted)]">{t.supplierName}</span></>}</td>
                  <td>{t.destinationBranch.code}</td>
                  <td>
                    {t.status === "DRAFT" && <Badge variant="warning">Borrador</Badge>}
                    {t.status === "TRANSFERRED" && <Badge variant="success">Confirmado</Badge>}
                    {t.status === "CANCELLED" && <Badge variant="neutral">Cancelado</Badge>}
                  </td>
                  <td className="hm-num">{t.totalPieces}</td>
                  <td className="hm-num">{fmt(t.totalFeet)}</td>
                  <td className="hm-num">C$ {fmt(t.totalCost)}</td>
                  <td className="hm-num">{pct(t.marginPercent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/* ─────────────────────────── Crear viaje (paso inicial) ─────────────────────────── */

function NewTripForm({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [origin, setOrigin] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/branches").then((r) => r.json()).then((raw) => setBranches(unwrapApiData(raw) ?? [])).catch(() => {});
  }, []);

  async function create() {
    if (!branchId) { showToast("error", "Seleccioná la sucursal destino."); return; }
    setCreating(true);
    try {
      const res = await apiFetch("/api/timber/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destinationBranchId: branchId,
          supplierName: supplierName.trim() || undefined,
          origin: origin.trim() || undefined,
          woodTripTotalCost: 0,
          lines: [{ thickness: 1, width: 12, length: 16, pieces: 1 }],
        }),
      });
      const raw = await readJson(res);
      if (!res.ok) { showToast("error", raw?.error?.message ?? "No se pudo crear el viaje."); return; }
      const created = unwrapApiData(raw);
      showToast("success", `Viaje ${created.trip.tripCode} creado.`);
      onCreated(created.trip.id);
    } catch {
      showToast("error", "Error de red al crear el viaje.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-lg font-bold text-[var(--color-text)]">Nuevo viaje de madera</h1>
      <Card className="space-y-3">
        <label className="block text-[11.5px] font-semibold text-[var(--color-text-muted)]">
          Sucursal destino
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
            <option value="">Seleccionar…</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
          </select>
        </label>
        <label className="block text-[11.5px] font-semibold text-[var(--color-text-muted)]">
          Aserradero / proveedor
          <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm" />
        </label>
        <label className="block text-[11.5px] font-semibold text-[var(--color-text-muted)]">
          Origen
          <input value={origin} onChange={(e) => setOrigin(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm" />
        </label>
        <div className="flex gap-2 pt-2">
          <Button variant="ghost" className="flex-1" onClick={onCancel}>Cancelar</Button>
          <Button variant="primary" className="flex-1" loading={creating} onClick={create}>Crear y cubicar →</Button>
        </div>
      </Card>
    </div>
  );
}

/* ─────────────────────────── Workspace de un viaje (3 pasos) ─────────────────────────── */

type CostMode = "PER_FOOT" | "TOTAL";

function TripWorkspace({ tripId, onBack }: { tripId: string; onBack: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [lines, setLines] = useState<TripLineDraft[]>([]);
  const [costMode, setCostMode] = useState<CostMode>("PER_FOOT");
  const [costPerFoot, setCostPerFoot] = useState<number | "">("");
  const [woodTripTotalCost, setWoodTripTotalCost] = useState<number | "">("");
  const [expenses, setExpenses] = useState<Expenses>({ freightAmount: 0, fuelAmount: 0, perDiemAmount: 0, permitsAmount: 0, otherExpensesAmount: 0 });
  const [invoicedFeet, setInvoicedFeet] = useState<number | "">("");
  const [pricePolicy, setPricePolicy] = useState("RECALC_FROM_PRICE_PER_INCH");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/timber/trips/${tripId}`);
      const raw = await readJson(res);
      if (!res.ok) { showToast("error", "No se pudo cargar el viaje."); return; }
      const t: TripDetail = unwrapApiData(raw);
      setTrip(t);
      setLines(t.lines.map((l) => ({ thickness: l.thicknessIn, width: l.widthIn, length: l.lengthIn, pieces: l.pieces })));
      setCostMode(n(t.computedCostPerFoot) > 0 && n(t.woodTripTotalCost) === n(t.computedCostPerFoot) * n(t.totalFeet) ? "PER_FOOT" : "TOTAL");
      setCostPerFoot(n(t.computedCostPerFoot) || "");
      setWoodTripTotalCost(n(t.woodTripTotalCost) || "");
      setExpenses({
        freightAmount: n(t.freightAmount), fuelAmount: n(t.fuelAmount), perDiemAmount: n(t.perDiemAmount),
        permitsAmount: n(t.permitsAmount), otherExpensesAmount: n(t.otherExpensesAmount),
      });
      setInvoicedFeet(t.invoicedFeet != null ? n(t.invoicedFeet) : "");
      setPricePolicy(t.pricePolicy);
    } catch {
      showToast("error", "Error de red al cargar el viaje.");
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => { load(); }, [load]);

  const isEditable = trip?.status === "DRAFT";

  async function save(showSuccessToast = false) {
    if (!isEditable) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/timber/trips/${tripId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: lines.filter((l) => l.pieces > 0),
          woodTripTotalCost: costMode === "TOTAL" ? Number(woodTripTotalCost || 0) : 0,
          costPerFoot: costMode === "PER_FOOT" && Number(costPerFoot) > 0 ? Number(costPerFoot) : undefined,
          expenses,
          invoicedFeet: invoicedFeet === "" ? null : Number(invoicedFeet),
          pricePolicy,
        }),
      });
      const raw = await readJson(res);
      if (!res.ok) { showToast("error", raw?.error?.message ?? "No se pudo guardar."); return; }
      setTrip(unwrapApiData(raw).trip);
      if (showSuccessToast) showToast("success", "Viaje actualizado.");
    } catch {
      showToast("error", "Error de red al guardar.");
    } finally {
      setSaving(false);
    }
  }

  // Autosave con debounce cuando cambian los campos del paso 1.
  useEffect(() => {
    if (!isEditable || loading) return;
    const handle = setTimeout(() => { void save(false); }, 700);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, costMode, costPerFoot, woodTripTotalCost, expenses, invoicedFeet, pricePolicy]);

  function updateLinePieces(idx: number, pieces: number) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, pieces } : l)));
  }
  function addMeasure(measure: TripLineDraft) {
    if (lines.some((l) => l.thickness === measure.thickness && l.width === measure.width && l.length === measure.length)) return;
    setLines((prev) => [...prev, { ...measure, pieces: 1 }]);
  }
  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  if (loading || !trip) {
    return <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">Cargando…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]">←</button>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-[var(--color-text)]">Viaje <span className="font-mono">{trip.tripCode}</span></h1>
          <p className="text-sm text-[var(--color-text-muted)]">{trip.destinationBranch.code} — {trip.destinationBranch.name}</p>
        </div>
        {trip.status === "DRAFT" && <Badge variant="warning">Borrador</Badge>}
        {trip.status === "TRANSFERRED" && <Badge variant="success">Confirmado</Badge>}
        {trip.status === "CANCELLED" && <Badge variant="neutral">Cancelado</Badge>}
        <span className="flex-1" />
        {saving && <span className="text-xs text-[var(--color-text-soft)]">Guardando…</span>}
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-1">
        {(["1 · Viaje y cubicación", "2 · Costos por medida", "3 · Confirmar e inyectar"] as const).map((label, i) => (
          <button
            key={label}
            onClick={() => setStep((i + 1) as 1 | 2 | 3)}
            className={`flex-1 rounded-lg px-3 py-2 text-[12.5px] font-semibold ${step === i + 1 ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm" : "text-[var(--color-text-muted)]"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {step === 1 && (
        <StepViajeYCubicacion
          lines={lines} isEditable={isEditable} costMode={costMode} setCostMode={setCostMode}
          costPerFoot={costPerFoot} setCostPerFoot={setCostPerFoot}
          woodTripTotalCost={woodTripTotalCost} setWoodTripTotalCost={setWoodTripTotalCost}
          expenses={expenses} setExpenses={setExpenses}
          invoicedFeet={invoicedFeet} setInvoicedFeet={setInvoicedFeet}
          trip={trip} updateLinePieces={updateLinePieces} addMeasure={addMeasure} removeLine={removeLine}
        />
      )}
      {step === 2 && <StepCostosPorMedida trip={trip} />}
      {step === 3 && <StepConfirmar trip={trip} pricePolicy={pricePolicy} setPricePolicy={setPricePolicy} onSaveFirst={() => save(false)} onConfirmed={load} />}
    </div>
  );
}

/* ── Paso 1: Viaje y cubicación ── */

function StepViajeYCubicacion(props: {
  lines: TripLineDraft[];
  isEditable: boolean;
  costMode: CostMode; setCostMode: (m: CostMode) => void;
  costPerFoot: number | ""; setCostPerFoot: (v: number | "") => void;
  woodTripTotalCost: number | ""; setWoodTripTotalCost: (v: number | "") => void;
  expenses: Expenses; setExpenses: (e: Expenses) => void;
  invoicedFeet: number | ""; setInvoicedFeet: (v: number | "") => void;
  trip: TripDetail;
  updateLinePieces: (idx: number, pieces: number) => void;
  addMeasure: (m: TripLineDraft) => void;
  removeLine: (idx: number) => void;
}) {
  const { lines, isEditable, costMode, setCostMode, costPerFoot, setCostPerFoot, woodTripTotalCost, setWoodTripTotalCost, expenses, setExpenses, invoicedFeet, setInvoicedFeet, trip, updateLinePieces, addMeasure, removeLine } = props;
  const totalFeet = n(trip.totalFeet);
  const reconciliation = trip.reconciliation;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
      <Card noPadding>
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3.5 py-2.5">
          <b className="text-[12.5px]">Cubicación</b>
          <span className="text-[11px] text-[var(--color-text-muted)]">{lines.length} medidas</span>
          <span className="flex-1" />
          {isEditable && (
            <select onChange={(e) => { const m = STANDARD_MEASURES[Number(e.target.value)]; if (m) addMeasure(m); e.target.value = ""; }} value="" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[11.5px]">
              <option value="">+ Agregar medida</option>
              {STANDARD_MEASURES.map((m, i) => <option key={i} value={i}>{m.thickness}×{m.width}×{m.length}</option>)}
            </select>
          )}
        </div>
        <table className="hm-sheet-table">
          <thead>
            <tr><th>Medida</th><th className="r" style={{ width: 90 }}>Piezas</th><th className="r">Pies/pza</th><th className="r">Pies totales</th><th /></tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const feetPerPiece = (l.thickness * l.width * l.length) / 12;
              return (
                <tr key={i}>
                  <td><b>{l.thickness}×{l.width}×{l.length}</b></td>
                  <td>
                    {isEditable ? (
                      <input type="number" value={l.pieces} onChange={(e) => updateLinePieces(i, Number(e.target.value))} className="w-20 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-right font-mono text-[12.5px]" />
                    ) : <span className="hm-num">{l.pieces}</span>}
                  </td>
                  <td className="hm-num text-[var(--color-text-muted)]">{fmt(feetPerPiece, 3)}</td>
                  <td className="hm-num">{fmt(feetPerPiece * l.pieces)}</td>
                  <td>{isEditable && <button onClick={() => removeLine(i)} className="text-[var(--color-text-soft)] hover:text-[var(--color-danger-700)]"><X className="h-3.5 w-3.5" /></button>}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr><td>TOTALES</td><td className="hm-num">{trip.totalPieces}</td><td /><td className="hm-num">{fmt(totalFeet)}</td><td /></tr>
          </tfoot>
        </table>
      </Card>

      <div className="flex flex-col gap-3.5">
        <Card>
          <div className="hm-section-rule">Costo de la madera</div>
          <div className="mb-2.5 flex gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-0.5">
            <button disabled={!isEditable} onClick={() => setCostMode("PER_FOOT")} className={`flex-1 rounded-md py-1.5 text-[12px] font-semibold ${costMode === "PER_FOOT" ? "bg-[var(--color-surface)] text-[var(--color-master-700)] shadow-sm" : "text-[var(--color-text-muted)]"}`}>Precio por pie</button>
            <button disabled={!isEditable} onClick={() => setCostMode("TOTAL")} className={`flex-1 rounded-md py-1.5 text-[12px] font-semibold ${costMode === "TOTAL" ? "bg-[var(--color-surface)] text-[var(--color-master-700)] shadow-sm" : "text-[var(--color-text-muted)]"}`}>Total del viaje</button>
          </div>
          {costMode === "PER_FOOT" ? (
            <label className="block text-[11.5px] font-semibold text-[var(--color-text-muted)]">
              Precio por pie tablar (C$)
              <input disabled={!isEditable} type="number" value={costPerFoot} onChange={(e) => setCostPerFoot(e.target.value === "" ? "" : Number(e.target.value))} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-right font-mono text-sm" />
            </label>
          ) : (
            <label className="block text-[11.5px] font-semibold text-[var(--color-text-muted)]">
              Costo total del viaje (C$)
              <input disabled={!isEditable} type="number" value={woodTripTotalCost} onChange={(e) => setWoodTripTotalCost(e.target.value === "" ? "" : Number(e.target.value))} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-right font-mono text-sm" />
            </label>
          )}
          <div className="mt-2.5 flex justify-between text-[12.5px]"><span className="text-[var(--color-text-muted)]">Madera ({fmt(totalFeet)} × {fmt(n(trip.computedCostPerFoot))})</span><b>C$ {fmt(n(trip.computedCostPerFoot) * totalFeet)}</b></div>
        </Card>

        <Card>
          <div className="hm-section-rule">Gastos del viaje</div>
          <div className="grid grid-cols-2 gap-2.5">
            {([["Flete", "freightAmount"], ["Combustible", "fuelAmount"], ["Viáticos", "perDiemAmount"], ["Permisos / INAFOR", "permitsAmount"], ["Otros", "otherExpensesAmount"]] as const).map(([label, key]) => (
              <label key={key} className="block text-[11px] font-semibold text-[var(--color-text-muted)]">
                {label}
                <input disabled={!isEditable} type="number" value={expenses[key]} onChange={(e) => setExpenses({ ...expenses, [key]: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-right font-mono text-[12.5px]" />
              </label>
            ))}
          </div>
          <div className="mt-2.5 flex justify-between border-t border-[var(--color-border)] pt-2 text-[12.5px]"><span className="text-[var(--color-text-muted)]">Total gastos</span><b>C$ {fmt(n(trip.tripExpensesTotal))}</b></div>
          <div className="flex justify-between text-[12.5px]"><span className="text-[var(--color-text-muted)]">Costo aterrizado por pie</span><b className="font-mono">C$ {fmt(n(trip.landedCostPerFoot), 4)}</b></div>
        </Card>

        <Card>
          <div className="hm-section-rule">Conciliación con factura</div>
          <label className="block text-[11.5px] font-semibold text-[var(--color-text-muted)]">
            Pies según factura del aserradero
            <input disabled={!isEditable} type="number" value={invoicedFeet} onChange={(e) => setInvoicedFeet(e.target.value === "" ? "" : Number(e.target.value))} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-right font-mono text-sm" />
          </label>
          {reconciliation.status !== "NOT_APPLICABLE" && (
            <>
              <div className="mt-2 flex justify-between text-[12.5px]"><span className="text-[var(--color-text-muted)]">Diferencia</span><b>{fmt(reconciliation.differenceFeet)} pies ({pct(reconciliation.differencePercent)})</b></div>
              <div className="mt-1.5">{reconciliation.status === "OK" ? <Badge variant="success">✓ Dentro de tolerancia</Badge> : <Badge variant="warning">⚠ Fuera de tolerancia — requiere confirmación al inyectar</Badge>}</div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ── Paso 2: Costos por medida ── */

function StepCostosPorMedida({ trip }: { trip: TripDetail }) {
  const lines = trip.lines;
  const hasNegative = lines.some((l) => n(l.calculatedMarginPct) < 0);

  const distribution = useMemo(() => {
    const totalFeet = n(trip.totalFeet) || 1;
    const feetOf12 = lines.filter((l) => l.priceGroup === "TABLA" && l.widthIn === 12).reduce((s, l) => s + n(l.calculatedFeet), 0);
    const feetOf10 = lines.filter((l) => l.priceGroup === "TABLA" && l.widthIn === 10).reduce((s, l) => s + n(l.calculatedFeet), 0);
    return { pct12: feetOf12 / totalFeet, pct10: feetOf10 / totalFeet, feetOf12, feetOf10 };
  }, [lines, trip.totalFeet]);

  return (
    <div className="space-y-4">
      {hasNegative && (
        <div className="rounded-xl border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] p-3.5 text-[12.5px] text-[var(--color-danger-700)]">
          <b className="block text-[13px]">⚠ Con este costo, al menos una medida deja margen negativo</b>
          Revisá el precio por pulgada vigente o ajustalo desde Configuración antes de confirmar el viaje.
        </div>
      )}
      <Card noPadding>
        <table className="hm-sheet-table">
          <thead>
            <tr><th>Medida</th><th className="r">Piezas</th><th className="r">Pies</th><th className="r">Costo pies</th><th className="r">Costo × pieza</th><th className="r">Venta × pieza</th><th className="r">Ganancia</th><th className="r">% Margen</th></tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const negative = n(l.calculatedMarginPct) < 0;
              return (
                <tr key={l.id}>
                  <td><b>{l.thicknessIn}×{l.widthIn}×{l.lengthIn}</b></td>
                  <td className="hm-num">{l.pieces}</td>
                  <td className="hm-num">{fmt(l.calculatedFeet)}</td>
                  <td className="hm-num">{fmt(l.calculatedCostFeet)}</td>
                  <td className="hm-num" style={{ fontWeight: 600 }}>{fmt(l.calculatedCostPerPiece)}</td>
                  <td className="hm-num">{fmt(l.calculatedSalePricePerPiece)}</td>
                  <td className="hm-num" style={negative ? { color: "var(--color-danger-700)" } : undefined}>{fmt(l.calculatedProfit)}</td>
                  <td className="hm-num" style={negative ? { color: "var(--color-danger-700)", fontWeight: 600 } : { fontWeight: 600 }}>{pct(l.calculatedMarginPct)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>TOTALES</td><td className="hm-num">{trip.totalPieces}</td><td className="hm-num">{fmt(trip.totalFeet)}</td><td className="hm-num">{fmt(trip.totalCost)}</td><td />
              <td className="hm-num">{fmt(trip.totalSale)}</td><td className="hm-num">{fmt(trip.totalProfit)}</td><td className="hm-num">{pct(trip.marginPercent)}</td>
            </tr>
          </tfoot>
        </table>
      </Card>
      <Card>
        <div className="hm-section-rule">Distribución de la compra</div>
        <div className="space-y-2.5">
          <div>
            <div className="mb-1 flex justify-between text-[12px]"><span>Ancho 12&quot; · tabla</span><b className="font-mono">{fmt(distribution.feetOf12)} pies · {pct(distribution.pct12)}</b></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-alt)]"><div className="h-full rounded-full bg-[var(--color-master-500)]" style={{ width: `${distribution.pct12 * 100}%` }} /></div>
          </div>
          <div>
            <div className="mb-1 flex justify-between text-[12px]"><span>Ancho 10&quot; · tabla</span><b className="font-mono">{fmt(distribution.feetOf10)} pies · {pct(distribution.pct10)}</b></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-alt)]"><div className="h-full rounded-full bg-[var(--color-info-500)]" style={{ width: `${distribution.pct10 * 100}%` }} /></div>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ── Paso 3: Confirmar e inyectar ── */

function StepConfirmar({ trip, pricePolicy, setPricePolicy, onSaveFirst, onConfirmed }: {
  trip: TripDetail; pricePolicy: string; setPricePolicy: (p: string) => void; onSaveFirst: () => Promise<void>; onConfirmed: () => void;
}) {
  const [preview, setPreview] = useState<InjectionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [marginOverrideReason, setMarginOverrideReason] = useState("");

  const loadPreview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/timber/trips/${trip.id}/injection-preview`);
      const raw = await readJson(res);
      if (!res.ok) { showToast("error", raw?.error?.message ?? "No se pudo calcular el preview."); return; }
      setPreview(unwrapApiData(raw));
    } catch {
      showToast("error", "Error de red al calcular el preview.");
    } finally {
      setLoading(false);
    }
  }, [trip.id]);

  useEffect(() => { void loadPreview(); }, [loadPreview]);

  const hasNegativeMargin = trip.lines.some((l) => n(l.calculatedMarginPct) < 0);
  const reconciliationNeedsAck = trip.reconciliation.status === "REVIEW";

  async function confirm() {
    if (!preview) return;
    setConfirming(true);
    try {
      await onSaveFirst();
      const res = await apiFetch(`/api/timber/trips/${trip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "confirm",
          expectedHash: preview.hash,
          acknowledgeReconciliation: reconciliationNeedsAck,
          marginOverrideReason: hasNegativeMargin ? marginOverrideReason.trim() : undefined,
        }),
      });
      const raw = await readJson(res);
      if (!res.ok) {
        if (raw?.error?.code === "CONFLICT") { showToast("warning", "El inventario cambió — recalculando el preview…"); await loadPreview(); return; }
        showToast("error", raw?.error?.message ?? "No se pudo confirmar el viaje.");
        return;
      }
      showToast("success", "Viaje confirmado e inyectado al inventario.");
      onConfirmed();
    } catch {
      showToast("error", "Error de red al confirmar.");
    } finally {
      setConfirming(false);
    }
  }

  if (trip.status !== "DRAFT") {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm text-[var(--color-text-muted)]">{trip.status === "TRANSFERRED" ? "Este viaje ya fue confirmado e inyectado al inventario." : "Este viaje fue cancelado."}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {loading || !preview ? (
        <div className="py-8 text-center text-sm text-[var(--color-text-muted)]">Calculando preview…</div>
      ) : (
        <>
          <Card noPadding>
            <table className="hm-sheet-table">
              <thead><tr><th>Producto</th><th className="r">Piezas</th><th className="r">Costo unitario</th><th className="r">WAC</th><th className="r">Costo sucursal</th><th className="r">Precio venta</th></tr></thead>
              <tbody>
                {preview.lines.map((l) => (
                  <tr key={l.lineId}>
                    <td><b>{l.dimensions.thickness}×{l.dimensions.width}×{l.dimensions.length}</b>{l.isNewProduct && <Badge variant="info" className="ml-1.5">nuevo</Badge>}</td>
                    <td className="hm-num">+{l.piecesToAdd}</td>
                    <td className="hm-num"><span className="text-[var(--color-text-soft)]">{l.costPerPiece.before !== null ? fmt(l.costPerPiece.before) : "—"}</span> → <b>{fmt(l.costPerPiece.after)}</b></td>
                    <td className="hm-num"><span className="text-[var(--color-text-soft)]">{l.wac.before !== null ? fmt(l.wac.before) : "—"}</span> → <b>{fmt(l.wac.after)}</b></td>
                    <td className="hm-num"><span className="text-[var(--color-text-soft)]">{l.branchCost.before !== null ? fmt(l.branchCost.before) : "—"}</span> → <b>{fmt(l.branchCost.after)}</b></td>
                    <td className="hm-num"><span className="text-[var(--color-text-soft)]">{l.sellingPrice.before !== null ? fmt(l.sellingPrice.before) : "—"}</span> → <b style={{ color: "var(--color-success-700)" }}>{fmt(l.sellingPrice.after)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card>
            <div className="hm-section-rule">Política de precio del viaje</div>
            <div className="space-y-2 text-[12.5px]">
              {([
                ["RECALC_FROM_PRICE_PER_INCH", "Recalcular precio con el precio por pulgada", "Sube/ajusta los precios de todas las medidas"],
                ["COST_ONLY", "Solo actualizar costos", "Los precios de venta quedan como están"],
                ["TARGET_MARGIN", "Precio por margen objetivo", "Calcula el precio para alcanzar el margen configurado"],
              ] as const).map(([value, label, hint]) => (
                <label key={value} className="flex cursor-pointer items-start gap-2.5">
                  <input type="radio" className="mt-0.5" checked={pricePolicy === value} onChange={() => setPricePolicy(value)} />
                  <span><b className="block">{label}</b><span className="text-[11.5px] text-[var(--color-text-muted)]">{hint}</span></span>
                </label>
              ))}
            </div>
          </Card>

          {hasNegativeMargin && (
            <Card className="border-[var(--color-danger-200)]">
              <div className="hm-section-rule">Motivo — al menos una medida queda con margen negativo</div>
              <input value={marginOverrideReason} onChange={(e) => setMarginOverrideReason(e.target.value)} placeholder="Ej: precio de lanzamiento, cliente especial…" className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm" />
            </Card>
          )}

          <div className="flex justify-end">
            <Button variant="primary" loading={confirming} disabled={hasNegativeMargin && !marginOverrideReason.trim()} onClick={confirm}>
              ✓ Confirmar viaje e inyectar
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────── Configuración (Fase 4/5) ─────────────────────────── */

type CubicationRow = { lengthFeet: number; varas: number; forceCuadro: boolean };
type FullConfig = {
  costPerFoot: number; pricePerInchTabla: number; pricePerInchTablilla: number; pricePerInchCuadro: number;
  classification: { cubicationTable: CubicationRow[]; tablaWidths: number[]; tablillaWidths: number[] };
  targetMarginPercent: number; targetMarginRoundingMultiple: number;
  reconciliationTolerancePercent: number; warnBelowTargetMargin: boolean; blockNegativeMargin: boolean;
};

export function TimberConfigPanel() {
  const [config, setConfig] = useState<FullConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/timber/pricing");
      const raw = await readJson(res);
      setConfig(unwrapApiData(raw));
    } catch {
      showToast("error", "No se pudo cargar la configuración.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!config) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/timber/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          costPerFoot: config.costPerFoot,
          pricePerInchTabla: config.pricePerInchTabla,
          pricePerInchTablilla: config.pricePerInchTablilla,
          pricePerInchCuadro: config.pricePerInchCuadro,
          cubicationTable: config.classification.cubicationTable,
          tablaWidths: config.classification.tablaWidths,
          tablillaWidths: config.classification.tablillaWidths,
          targetMarginPercent: config.targetMarginPercent,
          targetMarginRoundingMultiple: config.targetMarginRoundingMultiple,
          reconciliationTolerancePercent: config.reconciliationTolerancePercent,
          warnBelowTargetMargin: config.warnBelowTargetMargin,
          blockNegativeMargin: config.blockNegativeMargin,
        }),
      });
      const raw = await readJson(res);
      if (!res.ok) { showToast("error", raw?.error?.message ?? "No se pudo guardar la configuración."); return; }
      showToast("success", "Configuración guardada.");
      setConfig(unwrapApiData(raw));
    } catch {
      showToast("error", "Error de red al guardar.");
    } finally {
      setSaving(false);
    }
  }

  function updateCubicationRow(idx: number, patch: Partial<CubicationRow>) {
    if (!config) return;
    const rows = config.classification.cubicationTable.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    setConfig({ ...config, classification: { ...config.classification, cubicationTable: rows } });
  }

  if (loading || !config) {
    return <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">Cargando configuración…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="hm-section-icon hm-section-icon-warehouse"><Settings2 className="h-4 w-4" /></div>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-[var(--color-text)]">Configuración de Madera</h1>
          <p className="text-sm text-[var(--color-text-muted)]">Tabla de cubicación, precios por pulgada, margen objetivo y alertas — todo editable, sin código.</p>
        </div>
        <span className="flex-1" />
        <Button variant="primary" loading={saving} onClick={save}>Guardar cambios</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card noPadding>
          <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3.5 py-2.5"><b className="text-[12.5px]">Tabla de cubicación</b></div>
          <table className="hm-sheet-table">
            <thead><tr><th>Largo comercial</th><th className="r">Varas</th><th>Grupo forzado</th></tr></thead>
            <tbody>
              {config.classification.cubicationTable.map((row, i) => (
                <tr key={i}>
                  <td><b>{row.lengthFeet} pies</b></td>
                  <td><input type="number" value={row.varas} onChange={(e) => updateCubicationRow(i, { varas: Number(e.target.value) })} className="w-20 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-right font-mono text-[12.5px]" /></td>
                  <td>
                    <label className="flex items-center gap-1.5 text-[11.5px]">
                      <input type="checkbox" checked={row.forceCuadro} onChange={(e) => updateCubicationRow(i, { forceCuadro: e.target.checked })} />
                      CUADRO
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-[var(--color-border)] px-3.5 py-2 text-[11px] text-[var(--color-text-soft)]">Pies tablares = grueso × ancho × largo ÷ 12 · las varas solo se usan para el precio de venta</div>
        </Card>

        <div className="flex flex-col gap-3.5">
          <Card>
            <div className="hm-section-rule">Precio por pulgada</div>
            <div className="space-y-2">
              {([["TABLA", "pricePerInchTabla"], ["TABLILLA", "pricePerInchTablilla"], ["CUADRO", "pricePerInchCuadro"]] as const).map(([label, key]) => (
                <div key={key} className="flex items-center gap-2.5 text-[12.5px]">
                  <span className="w-24 font-bold">{label}</span>
                  <input type="number" value={config[key]} onChange={(e) => setConfig({ ...config, [key]: Number(e.target.value) })} className="w-24 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-right font-mono" />
                </div>
              ))}
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2.5">
              <label className="block text-[11px] font-semibold text-[var(--color-text-muted)]">
                Anchos TABLA
                <input value={config.classification.tablaWidths.join(",")} onChange={(e) => setConfig({ ...config, classification: { ...config.classification, tablaWidths: e.target.value.split(",").map((s) => Number(s.trim())).filter((v) => !Number.isNaN(v)) } })} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-[12px]" />
              </label>
              <label className="block text-[11px] font-semibold text-[var(--color-text-muted)]">
                Anchos TABLILLA
                <input value={config.classification.tablillaWidths.join(",")} onChange={(e) => setConfig({ ...config, classification: { ...config.classification, tablillaWidths: e.target.value.split(",").map((s) => Number(s.trim())).filter((v) => !Number.isNaN(v)) } })} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-[12px]" />
              </label>
            </div>
          </Card>

          <Card>
            <div className="hm-section-rule">Margen objetivo y alertas</div>
            <div className="grid grid-cols-2 gap-2.5">
              <label className="block text-[11.5px] font-semibold text-[var(--color-text-muted)]">
                Margen objetivo (%)
                <input type="number" value={config.targetMarginPercent * 100} onChange={(e) => setConfig({ ...config, targetMarginPercent: Number(e.target.value) / 100 })} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-right font-mono text-[12.5px]" />
              </label>
              <label className="block text-[11.5px] font-semibold text-[var(--color-text-muted)]">
                Tolerancia conciliación (%)
                <input type="number" value={config.reconciliationTolerancePercent * 100} onChange={(e) => setConfig({ ...config, reconciliationTolerancePercent: Number(e.target.value) / 100 })} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-right font-mono text-[12.5px]" />
              </label>
            </div>
            <div className="mt-2.5 flex flex-col gap-2 text-[12.5px]">
              <label className="flex items-center gap-2"><input type="checkbox" checked={config.warnBelowTargetMargin} onChange={(e) => setConfig({ ...config, warnBelowTargetMargin: e.target.checked })} /> Avisar si un viaje deja margen bajo el objetivo</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={config.blockNegativeMargin} onChange={(e) => setConfig({ ...config, blockNegativeMargin: e.target.checked })} /> Bloquear confirmación con margen negativo sin autorización</label>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
