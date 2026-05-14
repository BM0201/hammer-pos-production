"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Calculator, TreePine, DollarSign, Ruler, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { showToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/client/api";

type PriceGroup = "TABLA" | "TABLILLA" | "CUADRO";
interface Pricing {
  costPerFoot: number;
  pricePerInchTabla: number;
  pricePerInchTablilla: number;
  pricePerInchCuadro: number;
}

interface CalcResult {
  priceGroup: PriceGroup;
  boardFeet: number;
  baseCost: number;
  varaLength: number;
  pricePerInch: number;
  sellingPrice: number;
  marginPercent: number;
  profitPerPiece: number;
}

const VARA_MAP: Record<number, number> = { 16: 6, 14: 5, 11: 4, 8: 3 };
const LENGTHS = [8, 11, 14, 16];

function classify(t: number, w: number, l: number): PriceGroup {
  if (l === 8) return "CUADRO";
  if (t === 1 && (w === 6 || w === 8)) return "TABLILLA";
  if ((t === 1 || t === 2) && (w === 10 || w === 12)) return "TABLA";
  return "CUADRO";
}

function calcPiece(t: number, w: number, l: number, pricing: Pricing): CalcResult {
  const priceGroup = classify(t, w, l);
  const boardFeet = (t * w * l) / 12;
  const baseCost = boardFeet * pricing.costPerFoot;
  const varaLength = VARA_MAP[l] ?? Math.round((l * 12) / 33.87);
  const pricePerInch =
    priceGroup === "TABLA" ? pricing.pricePerInchTabla :
    priceGroup === "TABLILLA" ? pricing.pricePerInchTablilla :
    pricing.pricePerInchCuadro;
  const sellingPrice = t * w * varaLength * pricePerInch;
  const profitPerPiece = sellingPrice - baseCost;
  const marginPercent = sellingPrice > 0 ? profitPerPiece / sellingPrice : 0;

  return {
    priceGroup,
    boardFeet: Math.round(boardFeet * 10000) / 10000,
    baseCost: Math.round(baseCost * 100) / 100,
    varaLength,
    pricePerInch,
    sellingPrice: Math.round(sellingPrice * 100) / 100,
    marginPercent: Math.round(marginPercent * 10000) / 10000,
    profitPerPiece: Math.round(profitPerPiece * 100) / 100,
  };
}

const GROUP_COLORS: Record<PriceGroup, string> = {
  TABLA: "var(--color-success-600)",
  TABLILLA: "var(--color-info-600)",
  CUADRO: "var(--color-warning-600)",
};

const GROUP_BADGE_VARIANT: Record<PriceGroup, "success" | "info" | "warning"> = {
  TABLA: "success",
  TABLILLA: "info",
  CUADRO: "warning",
};

export function TimberCalculator({ showHeader = true }: { showHeader?: boolean }) {
  const [thickness, setThickness] = useState(1);
  const [width, setWidth] = useState(12);
  const [length, setLength] = useState(16);
  const [quantity, setQuantity] = useState(1);
  const [showPricing, setShowPricing] = useState(false);

  const [pricing, setPricing] = useState<Pricing>({
    costPerFoot: 20,
    pricePerInchTabla: 8.9,
    pricePerInchTablilla: 6.9,
    pricePerInchCuadro: 6.9,
  });

  // Load pricing config from API
  useEffect(() => {
    fetch("/api/timber/pricing")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) setPricing(data);
      })
      .catch(() => { /* use defaults */ });
  }, []);

  const calc = useMemo(() => calcPiece(thickness, width, length, pricing), [thickness, width, length, pricing]);

  const savePricing = useCallback(async () => {
    try {
      const res = await apiFetch("/api/timber/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pricing),
      });
      if (res.ok) {
        showToast("success", "Precios actualizados correctamente");
      }
    } catch {
      showToast("error", "Error al guardar precios");
    }
  }, [pricing]);

  return (
    <div className="space-y-5">
      {/* Header / contextual actions */}
      <div className="flex items-center justify-between">
        {showHeader ? (
          <div className="flex items-center gap-2.5">
            <div className="hm-section-icon hm-section-icon-master">
              <Calculator className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Calculadora de Madera</h2>
              <p className="text-[0.6875rem] text-[var(--color-text-muted)]">Cubicación y precios en tiempo real</p>
            </div>
          </div>
        ) : (
          <div className="text-xs text-[var(--color-text-soft)]">Configura precios y cubicación en tiempo real.</div>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowPricing((v) => !v)}
          icon={<Settings2 className="h-4 w-4" />}
        >
          Precios
        </Button>
      </div>

      {/* Pricing Config (collapsible) */}
      {showPricing && (
        <Card className="p-4 space-y-3 border-l-4" style={{ borderLeftColor: "var(--color-info-500)" }}>
          <h3 className="text-xs font-semibold text-[var(--color-text)] uppercase tracking-wide">
            Configuración de Precios
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Input
              label="Costo/Pie (C$)"
              type="number"
              step="0.01"
              value={pricing.costPerFoot}
              onChange={(e) => setPricing((p) => ({ ...p, costPerFoot: parseFloat(e.target.value) || 0 }))}
              className="text-sm"
            />
            <Input
              label="P/Pulgada Tabla (C$)"
              type="number"
              step="0.01"
              value={pricing.pricePerInchTabla}
              onChange={(e) => setPricing((p) => ({ ...p, pricePerInchTabla: parseFloat(e.target.value) || 0 }))}
              className="text-sm"
            />
            <Input
              label="P/Pulgada Tablilla (C$)"
              type="number"
              step="0.01"
              value={pricing.pricePerInchTablilla}
              onChange={(e) => setPricing((p) => ({ ...p, pricePerInchTablilla: parseFloat(e.target.value) || 0 }))}
              className="text-sm"
            />
            <Input
              label="P/Pulgada Cuadro (C$)"
              type="number"
              step="0.01"
              value={pricing.pricePerInchCuadro}
              onChange={(e) => setPricing((p) => ({ ...p, pricePerInchCuadro: parseFloat(e.target.value) || 0 }))}
              className="text-sm"
            />
          </div>
          <Button variant="primary" size="sm" onClick={savePricing} icon={<DollarSign className="h-3.5 w-3.5" />}>
            Guardar Precios Globales
          </Button>
        </Card>
      )}

      {/* Dimension Inputs */}
      <Card className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-[var(--color-text)] mb-1.5">
              <Ruler className="inline h-3.5 w-3.5 mr-1" />Grosor (pulg)
            </label>
            <Input
              type="number"
              min={1}
              max={24}
              value={thickness}
              onChange={(e) => setThickness(parseInt(e.target.value) || 1)}
              className="text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text)] mb-1.5">Ancho (pulg)</label>
            <Input
              type="number"
              min={1}
              max={48}
              value={width}
              onChange={(e) => setWidth(parseInt(e.target.value) || 1)}
              className="text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text)] mb-1.5">Largo (pies)</label>
            <select
              value={length}
              onChange={(e) => setLength(parseInt(e.target.value))}
              className="w-full border border-[var(--color-border-strong)] rounded-lg px-3 py-2.5 text-[var(--color-text)] placeholder-[var(--color-text-soft)] focus:ring-2 focus:ring-[var(--color-info-500)] focus:border-[var(--color-info-500)] transition-colors min-h-[44px] text-sm"
            >
              {LENGTHS.map((l) => (
                <option key={l} value={l}>{VARA_MAP[l]} pies</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text)] mb-1.5">Cantidad</label>
            <Input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
              className="text-sm"
            />
          </div>
        </div>
      </Card>

      {/* Results */}
      <Card noPadding>
        <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TreePine className="h-4 w-4" style={{ color: GROUP_COLORS[calc.priceGroup] }} />
            <span className="text-sm font-semibold text-[var(--color-text)]">
              {thickness}″ × {width}″ × {VARA_MAP[length] || length} pies
            </span>
          </div>
          <Badge variant={GROUP_BADGE_VARIANT[calc.priceGroup]}>
            {calc.priceGroup}
          </Badge>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <ResultCell label="Pies Tablares" value={`${(calc.boardFeet * quantity).toFixed(2)}`} sublabel="por pieza" subvalue={calc.boardFeet.toFixed(4)} />
            <ResultCell label="Costo" value={`C$${(calc.baseCost * quantity).toFixed(2)}`} sublabel="por pieza" subvalue={`C$${calc.baseCost.toFixed(2)}`} />
            <ResultCell label="Precio Venta" value={`C$${(calc.sellingPrice * quantity).toFixed(2)}`} sublabel="por pieza" subvalue={`C$${calc.sellingPrice.toFixed(2)}`} highlight />
            <ResultCell
              label="Ganancia"
              value={`C$${(calc.profitPerPiece * quantity).toFixed(2)}`}
              sublabel="margen"
              subvalue={`${(calc.marginPercent * 100).toFixed(1)}%`}
              marginColor={calc.marginPercent >= 0.4 ? "var(--color-success-600)" : calc.marginPercent >= 0.3 ? "var(--color-warning-600)" : "var(--color-danger-600)"}
            />
          </div>
          <div className="mt-3 pt-3 border-t border-[var(--color-border)] flex flex-wrap gap-4 text-[0.6875rem] text-[var(--color-text-muted)]">
            <span>Largo: {calc.varaLength} pies</span>
            <span>P/Pulgada: C${calc.pricePerInch.toFixed(2)}</span>
            <span>Costo/Pie: C${pricing.costPerFoot.toFixed(2)}</span>
            <span>Piezas: {quantity}</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

function ResultCell({
  label,
  value,
  sublabel,
  subvalue,
  highlight,
  marginColor,
}: {
  label: string;
  value: string;
  sublabel?: string;
  subvalue?: string;
  highlight?: boolean;
  marginColor?: string;
}) {
  return (
    <div className={`text-center p-2.5 rounded-lg ${highlight ? "bg-[var(--color-master-50)]" : "bg-[var(--color-surface-raised)]"}`}>
      <p className="text-[0.625rem] uppercase tracking-wide text-[var(--color-text-muted)] mb-1">{label}</p>
      <p className={`text-base font-bold ${highlight ? "text-[var(--color-master-700)]" : "text-[var(--color-text)]"}`}>{value}</p>
      {sublabel && subvalue && (
        <p className="text-[0.625rem] mt-0.5" style={marginColor ? { color: marginColor, fontWeight: 600 } : { color: "var(--color-text-soft)" }}>
          {sublabel}: {subvalue}
        </p>
      )}
    </div>
  );
}
