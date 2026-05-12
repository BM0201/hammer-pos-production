"use client";

import { useState, useEffect, useCallback, useMemo, memo } from "react";
import {
  Truck,
  Plus,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  TreePine,
  MapPin,
  Calendar,
  Package,
  AlertCircle,
  Search,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { apiFetch } from "@/lib/client/api";

/* ── Types ── */

interface TripSummary {
  id: string;
  tripCode: string;
  status: string;
  destinationBranch: { code: string; name: string };
  woodTripTotalCost: number | string;
  totalPieces: number;
  totalFeet: number | string;
  totalSale: number | string;
  totalProfit: number | string;
  marginPercent: number | string;
  supplierName: string | null;
  origin: string | null;
  createdAt: string;
  _count: { lines: number };
}

interface TripDetail {
  id: string;
  tripCode: string;
  status: string;
  destinationBranch: { code: string; name: string };
  woodTripTotalCost: number | string;
  computedCostPerFoot: number | string;
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
  createdAt: string;
  confirmedAt: string | null;
  lines: TripLine[];
}

interface TripLine {
  id: string;
  thicknessIn: number;
  widthIn: number;
  lengthIn: number;
  varaLength: number;
  priceGroup: string;
  pieces: number;
  calculatedFeet: number | string;
  calculatedCostFeet: number | string;
  calculatedCostPerPiece: number | string;
  calculatedSalePricePerPiece: number | string;
  calculatedSaleTotal: number | string;
  calculatedProfit: number | string;
  calculatedMarginPct: number | string;
}

interface Branch {
  id: string;
  code: string;
  name: string;
}

/* ── Constants ── */

const VARA_MAP: Record<number, number> = { 16: 6, 14: 5, 11: 4, 8: 3 };

/** All standard measures from FORMULA PARA MADERA.xlsx */
const STANDARD_MEASURES = [
  // TABLA 1×12
  { thickness: 1, width: 12, length: 16, group: "TABLA" },
  { thickness: 1, width: 12, length: 14, group: "TABLA" },
  { thickness: 1, width: 12, length: 11, group: "TABLA" },
  { thickness: 1, width: 12, length: 8, group: "CUADRO" },
  // TABLA 2×12
  { thickness: 2, width: 12, length: 16, group: "TABLA" },
  { thickness: 2, width: 12, length: 14, group: "TABLA" },
  { thickness: 2, width: 12, length: 11, group: "TABLA" },
  // TABLA 2×10
  { thickness: 2, width: 10, length: 16, group: "TABLA" },
  { thickness: 2, width: 10, length: 14, group: "TABLA" },
  { thickness: 2, width: 10, length: 11, group: "TABLA" },
  // TABLA 1×10
  { thickness: 1, width: 10, length: 16, group: "TABLA" },
  { thickness: 1, width: 10, length: 14, group: "TABLA" },
  { thickness: 1, width: 10, length: 11, group: "TABLA" },
  // TABLILLA 1×8
  { thickness: 1, width: 8, length: 16, group: "TABLILLA" },
  { thickness: 1, width: 8, length: 14, group: "TABLILLA" },
  { thickness: 1, width: 8, length: 11, group: "TABLILLA" },
  { thickness: 1, width: 8, length: 8, group: "CUADRO" },
  // TABLILLA 1×6
  { thickness: 1, width: 6, length: 16, group: "TABLILLA" },
  { thickness: 1, width: 6, length: 14, group: "TABLILLA" },
  { thickness: 1, width: 6, length: 11, group: "TABLILLA" },
  { thickness: 1, width: 6, length: 8, group: "CUADRO" },
  // CUADRO 2×8
  { thickness: 2, width: 8, length: 16, group: "CUADRO" },
  { thickness: 2, width: 8, length: 14, group: "CUADRO" },
  // CUADRO 2×6
  { thickness: 2, width: 6, length: 16, group: "CUADRO" },
  { thickness: 2, width: 6, length: 14, group: "CUADRO" },
  { thickness: 2, width: 6, length: 11, group: "CUADRO" },
  // CUADRO 2×4
  { thickness: 2, width: 4, length: 16, group: "CUADRO" },
  { thickness: 2, width: 4, length: 14, group: "CUADRO" },
  { thickness: 2, width: 4, length: 11, group: "CUADRO" },
  { thickness: 2, width: 4, length: 8, group: "CUADRO" },
  // CUADRO 2×3
  { thickness: 2, width: 3, length: 16, group: "CUADRO" },
  { thickness: 2, width: 3, length: 14, group: "CUADRO" },
  { thickness: 2, width: 3, length: 11, group: "CUADRO" },
  // CUADRO 2×2
  { thickness: 2, width: 2, length: 16, group: "CUADRO" },
  { thickness: 2, width: 2, length: 14, group: "CUADRO" },
  { thickness: 2, width: 2, length: 11, group: "CUADRO" },
  { thickness: 2, width: 2, length: 8, group: "CUADRO" },
  // CUADRO 1×4
  { thickness: 1, width: 4, length: 16, group: "CUADRO" },
  { thickness: 1, width: 4, length: 14, group: "CUADRO" },
  { thickness: 1, width: 4, length: 11, group: "CUADRO" },
  // CUADRO 1×3
  { thickness: 1, width: 3, length: 16, group: "CUADRO" },
  { thickness: 1, width: 3, length: 14, group: "CUADRO" },
  { thickness: 1, width: 3, length: 11, group: "CUADRO" },
  { thickness: 1, width: 3, length: 8, group: "CUADRO" },
  // CUADRO 1×2
  { thickness: 1, width: 2, length: 16, group: "CUADRO" },
  { thickness: 1, width: 2, length: 14, group: "CUADRO" },
  { thickness: 1, width: 2, length: 11, group: "CUADRO" },
  { thickness: 1, width: 2, length: 8, group: "CUADRO" },
  // CUADRO 4×4
  { thickness: 4, width: 4, length: 16, group: "CUADRO" },
  { thickness: 4, width: 4, length: 14, group: "CUADRO" },
  { thickness: 4, width: 4, length: 11, group: "CUADRO" },
];

const STATUS_BADGE_MAP: Record<string, { label: string; variant: "neutral" | "info" | "success" | "danger" }> = {
  DRAFT: { label: "Borrador", variant: "neutral" },
  CUBICADO: { label: "Cubicado", variant: "info" },
  CONFIRMED: { label: "Confirmado", variant: "success" },
  TRANSFERRED: { label: "Transferido", variant: "info" },
  CANCELLED: { label: "Cancelado", variant: "danger" },
};

const GROUP_COLORS: Record<string, string> = {
  TABLA: "var(--color-success-600)",
  TABLILLA: "var(--color-info-600)",
  CUADRO: "var(--color-warning-700)",
};

/* ── Helpers ── */

function num(v: number | string): number {
  return typeof v === "string" ? parseFloat(v) : v;
}

function fmtMoney(v: number | string) {
  return `C$${num(v).toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(v: number | string) {
  return `${(num(v) * 100).toFixed(1)}%`;
}

function measureKey(m: { thickness: number; width: number; length: number }) {
  return `${m.thickness}x${m.width}x${m.length}`;
}

/* ══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════ */

export function TimberTrips({ showHeader = true }: { showHeader?: boolean }) {
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedTrip, setExpandedTrip] = useState<string | null>(null);
  const [tripDetail, setTripDetail] = useState<TripDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadTrips = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/timber/trips");
      if (!res.ok) throw new Error("Error al cargar viajes");
      const data = await res.json();
      setTrips(data.items);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTrips(); }, [loadTrips]);

  const loadTripDetail = useCallback(async (id: string) => {
    if (expandedTrip === id) {
      setExpandedTrip(null);
      return;
    }
    setExpandedTrip(id);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/timber/trips/${id}`);
      if (!res.ok) throw new Error("Error al cargar detalle");
      setTripDetail(await res.json());
    } catch {
      setTripDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [expandedTrip]);

  const handleAction = useCallback(async (id: string, action: "confirm" | "cancel") => {
    const labels = { confirm: "confirmar", cancel: "cancelar" };
    if (!confirm(`¿Seguro que desea ${labels[action]} este viaje?`)) return;
    try {
      const res = await apiFetch(`/api/timber/trips/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error");
      }
      loadTrips();
    } catch (err: any) {
      alert(err.message);
    }
  }, [loadTrips]);

  return (
    <div className="space-y-5">
      {/* Header / contextual actions */}
      <div className="flex items-center justify-between">
        {showHeader ? (
          <div className="flex items-center gap-2.5">
            <div className="hm-section-icon hm-section-icon-master">
              <Truck className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Viajes de Madera</h2>
              <p className="text-[0.6875rem] text-[var(--color-text-muted)]">Cubicación, registro y envío a inventario</p>
            </div>
          </div>
        ) : (
          <div className="text-xs text-[var(--color-text-soft)]">Control de viajes y confirmación de costos.</div>
        )}
        <Button variant="primary" size="sm" onClick={() => setShowCreate((v) => !v)} icon={<Plus className="h-3.5 w-3.5" />}>
          Crear Viaje de Madera
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 p-4 rounded-lg border-l-4 border-[var(--color-danger-500)] bg-[var(--color-danger-50)] text-[var(--color-danger-700)] text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Create Form — single unified flow */}
      {showCreate && (
        <CreateTripForm
          onCreated={() => { setShowCreate(false); loadTrips(); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Trips List */}
      {loading ? (
        <div className="text-center py-8 text-[var(--color-text-muted)] flex items-center justify-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin" /> Cargando viajes...
        </div>
      ) : trips.length === 0 ? (
        <Card className="p-8 text-center">
          <TreePine className="h-10 w-10 mx-auto mb-3 text-[var(--color-text-soft)]" />
          <p className="text-sm text-[var(--color-text-muted)]">No hay viajes de madera registrados</p>
          <p className="text-xs text-[var(--color-text-soft)] mt-1">Crea un nuevo viaje para comenzar</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {trips.map((trip) => {
            const statusCfg = STATUS_BADGE_MAP[trip.status] || { label: trip.status, variant: "neutral" as const };
            return (
              <Card key={trip.id} noPadding>
                <div
                  className="px-4 py-3 flex items-center gap-4 cursor-pointer hover:bg-[var(--color-surface-alt)] transition-colors"
                  onClick={() => loadTripDetail(trip.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-[var(--color-text)]">{trip.tripCode}</span>
                      <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-3 text-[0.6875rem] text-[var(--color-text-muted)]">
                      <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{trip.destinationBranch.name}</span>
                      {trip.supplierName && <span>Proveedor: {trip.supplierName}</span>}
                      <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{new Date(trip.createdAt).toLocaleDateString("es-NI")}</span>
                    </div>
                  </div>
                  <div className="hidden md:flex items-center gap-6 text-right">
                    <div>
                      <p className="text-[0.625rem] text-[var(--color-text-muted)]">Piezas</p>
                      <p className="text-sm font-semibold text-[var(--color-text)]">{trip.totalPieces}</p>
                    </div>
                    <div>
                      <p className="text-[0.625rem] text-[var(--color-text-muted)]">Pies</p>
                      <p className="text-sm font-semibold text-[var(--color-text)]">{num(trip.totalFeet).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-[0.625rem] text-[var(--color-text-muted)]">Venta</p>
                      <p className="text-sm font-semibold text-[var(--color-success-700)]">{fmtMoney(trip.totalSale)}</p>
                    </div>
                    <div>
                      <p className="text-[0.625rem] text-[var(--color-text-muted)]">Margen</p>
                      <p className="text-sm font-semibold text-[var(--color-text)]">{fmtPct(trip.marginPercent)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {(trip.status === "DRAFT" || trip.status === "CUBICADO") && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-[var(--color-success-700)]"
                          title="Confirmar e insertar en inventario"
                          onClick={(e) => { e.stopPropagation(); handleAction(trip.id, "confirm"); }}
                        >
                          <CheckCircle className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-[var(--color-danger-600)]"
                          title="Cancelar"
                          onClick={(e) => { e.stopPropagation(); handleAction(trip.id, "cancel"); }}
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    {expandedTrip === trip.id
                      ? <ChevronUp className="h-4 w-4 text-[var(--color-text-muted)]" />
                      : <ChevronDown className="h-4 w-4 text-[var(--color-text-muted)]" />}
                  </div>
                </div>

                {/* Detail Panel */}
                {expandedTrip === trip.id && (
                  <div className="border-t border-[var(--color-border)]">
                    {detailLoading ? (
                      <div className="p-4 text-center text-[var(--color-text-muted)] flex items-center justify-center gap-2">
                        <Loader2 className="h-5 w-5 animate-spin" /> Cargando detalle...
                      </div>
                    ) : tripDetail ? (
                      <TripDetailView trip={tripDetail} />
                    ) : null}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   TRIP DETAIL VIEW
   ══════════════════════════════════════════════════════════ */

const TripDetailView = memo(function TripDetailView({ trip }: { trip: TripDetail }) {
  return (
    <div className="p-4 space-y-4">
      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MiniKpi label="Costo Total Viaje" value={fmtMoney(trip.woodTripTotalCost)} />
        <MiniKpi label="Costo/Pie" value={fmtMoney(trip.computedCostPerFoot)} />
        <MiniKpi label="Total Pies" value={num(trip.totalFeet).toFixed(2)} />
        <MiniKpi label="Total Venta" value={fmtMoney(trip.totalSale)} highlight />
        <MiniKpi label="Ganancia" value={`${fmtMoney(trip.totalProfit)} (${fmtPct(trip.marginPercent)})`} />
      </div>

      {/* Pricing snapshot */}
      <div className="flex flex-wrap gap-3 text-[0.6875rem] text-[var(--color-text-muted)]">
        <span>P/pulg Tabla: C${num(trip.pricePerInchTabla).toFixed(2)}</span>
        <span>P/pulg Tablilla: C${num(trip.pricePerInchTablilla).toFixed(2)}</span>
        <span>P/pulg Cuadro: C${num(trip.pricePerInchCuadro).toFixed(2)}</span>
        {trip.notes && <span className="text-[var(--color-text-secondary)]">Notas: {trip.notes}</span>}
      </div>

      {/* Lines Table */}
      <Table className="text-xs">
        <THead>
          <TR>
            <TH>Medida</TH>
            <TH>Tipo</TH>
            <TH className="text-right">Pzas</TH>
            <TH className="text-right">Pies</TH>
            <TH className="text-right">Costo</TH>
            <TH className="text-right">Costo/Pza</TH>
            <TH className="text-right">PV/Pza</TH>
            <TH className="text-right">Venta Total</TH>
            <TH className="text-right">Ganancia</TH>
            <TH className="text-right">Margen</TH>
          </TR>
        </THead>
        <TBody>
          {trip.lines.map((line) => (
            <TR key={line.id}>
              <TD className="font-mono font-medium text-[var(--color-text)]">{line.thicknessIn}×{line.widthIn}×{VARA_MAP[line.lengthIn] || line.varaLength} pies</TD>
              <TD>
                <span
                  className="text-[0.625rem] font-semibold px-1.5 py-0.5 rounded"
                  style={{
                    background: `color-mix(in srgb, ${GROUP_COLORS[line.priceGroup] || "var(--color-text-soft)"} 12%, transparent)`,
                    color: GROUP_COLORS[line.priceGroup] || "var(--color-text-muted)",
                  }}
                >
                  {line.priceGroup}
                </span>
              </TD>
              <TD className="text-right text-[var(--color-text)]">{line.pieces}</TD>
              <TD className="text-right">{num(line.calculatedFeet).toFixed(2)}</TD>
              <TD className="text-right">{fmtMoney(line.calculatedCostFeet)}</TD>
              <TD className="text-right">{fmtMoney(line.calculatedCostPerPiece)}</TD>
              <TD className="text-right font-semibold text-[var(--color-text)]">{fmtMoney(line.calculatedSalePricePerPiece)}</TD>
              <TD className="text-right font-semibold text-[var(--color-text)]">{fmtMoney(line.calculatedSaleTotal)}</TD>
              <TD className={`text-right ${num(line.calculatedProfit) >= 0 ? "text-[var(--color-success-700)]" : "text-[var(--color-danger-600)]"}`}>
                {fmtMoney(line.calculatedProfit)}
              </TD>
              <TD className="text-right">{fmtPct(line.calculatedMarginPct)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
});

function MiniKpi({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`text-center p-2.5 rounded-lg ${highlight ? "bg-[var(--color-master-50)]" : "bg-[var(--color-surface-alt)]"}`}>
      <p className="text-[0.5625rem] uppercase tracking-wide text-[var(--color-text-muted)] font-medium">{label}</p>
      <p className={`text-xs font-bold mt-0.5 ${highlight ? "text-[var(--color-master-700)]" : "text-[var(--color-text)]"}`}>{value}</p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   CREATE TRIP FORM — Single Unified Flow
   ══════════════════════════════════════════════════════════ */

function CreateTripForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [totalCost, setTotalCost] = useState(0);
  const [supplier, setSupplier] = useState("");
  const [origin, setOrigin] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterGroup, setFilterGroup] = useState<string>("ALL");
  const [searchText, setSearchText] = useState("");

  // Quantities keyed by measureKey
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const m of STANDARD_MEASURES) init[measureKey(m)] = 0;
    return init;
  });

  // Load branches
  useEffect(() => {
    fetch("/api/branches")
      .then((r) => r.ok ? r.json() : [])
      .then((data: Branch[]) => {
        if (Array.isArray(data) && data.length > 0) {
          setBranches(data);
          setBranchId(data[0].id);
        }
      })
      .catch(() => {});
  }, []);

  const setQty = useCallback((key: string, val: number) => {
    setQuantities((prev) => ({ ...prev, [key]: Math.max(0, val) }));
  }, []);

  // Filter measures
  const filteredMeasures = useMemo(() => {
    return STANDARD_MEASURES.filter((m) => {
      if (filterGroup !== "ALL" && m.group !== filterGroup) return false;
      if (searchText) {
        const key = `${m.thickness}x${m.width}x${m.length}`;
        return key.includes(searchText);
      }
      return true;
    });
  }, [filterGroup, searchText]);

  // Group measures by dimension category for better visual grouping
  const groupedMeasures = useMemo(() => {
    const groups: Record<string, typeof STANDARD_MEASURES> = {};
    for (const m of filteredMeasures) {
      const gKey = `${m.thickness}×${m.width}`;
      if (!groups[gKey]) groups[gKey] = [];
      groups[gKey].push(m);
    }
    return groups;
  }, [filteredMeasures]);

  // Auto cubication summary
  const summary = useMemo(() => {
    let totalPieces = 0;
    let totalFeet = 0;
    const activeLines: typeof STANDARD_MEASURES[0][] = [];
    for (const m of STANDARD_MEASURES) {
      const qty = quantities[measureKey(m)] || 0;
      if (qty > 0) {
        totalPieces += qty;
        totalFeet += (m.thickness * m.width * m.length * qty) / 12;
        activeLines.push(m);
      }
    }
    return { totalPieces, totalFeet: Math.round(totalFeet * 100) / 100, activeCount: activeLines.length };
  }, [quantities]);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const lines = STANDARD_MEASURES
        .filter((m) => (quantities[measureKey(m)] || 0) > 0)
        .map((m) => ({
          thickness: m.thickness,
          width: m.width,
          length: m.length,
          pieces: quantities[measureKey(m)],
        }));

      if (lines.length === 0) {
        setError("Debe ingresar cantidad en al menos una medida");
        setSubmitting(false);
        return;
      }

      if (!branchId) {
        setError("Debe seleccionar una sucursal destino");
        setSubmitting(false);
        return;
      }

      const res = await apiFetch("/api/timber/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destinationBranchId: branchId,
          woodTripTotalCost: totalCost,
          supplierName: supplier || undefined,
          origin: origin || undefined,
          notes: notes || undefined,
          lines,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.fieldErrors ? JSON.stringify(data.error.fieldErrors) : data.error || "Error al crear viaje");
      }

      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card noPadding className="border-l-4" style={{ borderLeftColor: "var(--color-success-500)" }}>
      {/* Form Header */}
      <div className="px-5 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
        <h3 className="text-base font-bold text-[var(--color-text)]">Crear Viaje de Madera</h3>
        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
          Selecciona destino, ingresa cantidades por medida y la cubicación se calcula automáticamente.
        </p>
      </div>

      <div className="p-5 space-y-5">
        {error && (
          <div className="flex items-start gap-3 p-3 rounded-lg border-l-4 border-[var(--color-danger-500)] bg-[var(--color-danger-50)] text-[var(--color-danger-700)] text-xs">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Trip metadata */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-[var(--color-text)] mb-1.5">Sucursal Destino</label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="w-full border border-[var(--color-border-strong)] rounded-lg px-3 py-2.5 text-[var(--color-text)] focus:ring-2 focus:ring-[var(--color-info-500)] focus:border-[var(--color-info-500)] transition-colors min-h-[44px] text-sm"
            >
              {branches.length === 0 && <option value="">Sin sucursales</option>}
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
            </select>
          </div>
          <Input
            label="Costo Total Viaje (C$)"
            type="number"
            min={0}
            step="0.01"
            value={totalCost}
            onChange={(e) => setTotalCost(parseFloat(e.target.value) || 0)}
            className="text-sm"
          />
          <Input
            label="Proveedor"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            className="text-sm"
            placeholder="Opcional"
          />
          <Input
            label="Origen"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            className="text-sm"
            placeholder="Ej: Jinotega"
          />
        </div>

        {/* Measures Grid */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-[var(--color-text)]">
              Medidas del Viaje
              {summary.activeCount > 0 && (
                <span className="ml-2 text-xs font-normal text-[var(--color-text-muted)]">
                  ({summary.activeCount} medidas con piezas)
                </span>
              )}
            </h4>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-soft)]" />
              <Input
                type="text"
                placeholder="Buscar medida... (ej: 1x12)"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="text-xs pl-9"
              />
            </div>
            <div className="flex gap-1">
              {["ALL", "TABLA", "TABLILLA", "CUADRO"].map((g) => (
                <button
                  key={g}
                  onClick={() => setFilterGroup(g)}
                  className={`text-[0.6875rem] font-medium px-2.5 py-1 rounded-md transition-colors ${
                    filterGroup === g
                      ? "bg-[var(--color-master-600)] text-white"
                      : "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:bg-[var(--color-border)]"
                  }`}
                >
                  {g === "ALL" ? "Todas" : g}
                </button>
              ))}
            </div>
          </div>

          {/* Grouped measures */}
          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
            {Object.entries(groupedMeasures).map(([groupLabel, measures]) => (
              <div key={groupLabel} className="bg-[var(--color-surface-alt)] rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-[var(--color-text)]">{groupLabel}</span>
                  <span
                    className="text-[0.5625rem] font-semibold px-1.5 py-0.5 rounded"
                    style={{
                      background: `color-mix(in srgb, ${GROUP_COLORS[measures[0].group] || "var(--color-text-soft)"} 12%, transparent)`,
                      color: GROUP_COLORS[measures[0].group] || "var(--color-text-muted)",
                    }}
                  >
                    {measures[0].group}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                  {measures.map((m) => {
                    const key = measureKey(m);
                    const qty = quantities[key] || 0;
                    const varas = VARA_MAP[m.length] || "?";
                    return (
                      <div
                        key={key}
                        className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-colors ${
                          qty > 0
                            ? "bg-[var(--color-success-50)] border border-[var(--color-success-100)]"
                            : "bg-[var(--color-surface)] border border-[var(--color-border)]"
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-[var(--color-text)]">
                            {m.thickness}×{m.width}×{varas} pies
                          </p>
                          <p className="text-[0.5625rem] text-[var(--color-text-muted)]">{m.group}</p>
                        </div>
                        <input
                          type="number"
                          min={0}
                          value={qty || ""}
                          placeholder="0"
                          onChange={(e) => setQty(key, parseInt(e.target.value) || 0)}
                          className="w-16 text-center text-xs font-semibold rounded-md border border-[var(--color-border)] py-1.5 bg-[var(--color-surface)] text-[var(--color-text)] focus:border-[var(--color-info-500)] focus:outline-none focus:ring-1 focus:ring-[var(--color-info-500)]"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Auto cubication summary */}
        {summary.totalPieces > 0 && (
          <Card variant="outlined" className="bg-[var(--color-master-50)] border-[var(--color-master-100)] p-4">
            <h4 className="text-xs font-bold text-[var(--color-master-700)] uppercase tracking-wide mb-2">
              Cubicación Automática
            </h4>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <p className="text-[0.625rem] text-[var(--color-text-muted)]">Total Piezas</p>
                <p className="text-lg font-bold text-[var(--color-text)]">{summary.totalPieces}</p>
              </div>
              <div className="text-center">
                <p className="text-[0.625rem] text-[var(--color-text-muted)]">Total Pies Tablares</p>
                <p className="text-lg font-bold text-[var(--color-text)]">{summary.totalFeet.toLocaleString("es-NI", { minimumFractionDigits: 2 })}</p>
              </div>
              <div className="text-center">
                <p className="text-[0.625rem] text-[var(--color-text-muted)]">Costo por Pie</p>
                <p className="text-lg font-bold text-[var(--color-text)]">
                  {summary.totalFeet > 0 ? `C$${(totalCost / summary.totalFeet).toFixed(2)}` : "—"}
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* Notes */}
        <div>
          <label className="block text-xs font-medium text-[var(--color-text)] mb-1.5">Notas</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full border border-[var(--color-border-strong)] rounded-lg px-3 py-2.5 text-[var(--color-text)] placeholder-[var(--color-text-soft)] focus:ring-2 focus:ring-[var(--color-info-500)] focus:border-[var(--color-info-500)] transition-colors min-h-[44px] text-sm"
            rows={2}
            placeholder="Notas adicionales sobre el viaje..."
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2 border-t border-[var(--color-border)]">
          <Button variant="primary" onClick={handleSubmit} disabled={submitting} loading={submitting} icon={!submitting ? <Package className="h-4 w-4" /> : undefined}>
            {submitting ? "Creando..." : "Confirmar e Insertar en Inventario"}
          </Button>
          <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
        </div>
      </div>
    </Card>
  );
}