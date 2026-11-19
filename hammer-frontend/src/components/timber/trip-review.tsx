"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, AlertTriangle, PackageCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast";
import { numFixed as fmt, fmtDateTimeShort } from "@/lib/format";
import { errorCode, errorMessage, timberRequest } from "./trip-api";
import { marginOf, measureLabel, n, pct, PRICE_POLICIES, tripReadiness, type InjectionPreview, type TripDetail } from "./trip-logic";

/**
 * Paso 2 — una sola tabla con lo que de verdad va a pasar (precio según la política elegida),
 * lo que falta para poder ingresar y el botón. Un viaje ya ingresado se ve como resumen.
 */
export function TripReview({ trip, onPolicyChange, onConfirmed }: {
  trip: TripDetail;
  /** Guarda la política en el borrador; false si no se pudo guardar. */
  onPolicyChange: (policy: string) => Promise<boolean>;
  onConfirmed: () => void;
}) {
  if (trip.status !== "DRAFT" && trip.status !== "CUBICADO") return <TripSummaryView trip={trip} />;
  return <DraftReview trip={trip} onPolicyChange={onPolicyChange} onConfirmed={onConfirmed} />;
}

function DraftReview({ trip, onPolicyChange, onConfirmed }: { trip: TripDetail; onPolicyChange: (policy: string) => Promise<boolean>; onConfirmed: () => void }) {
  const [preview, setPreview] = useState<InjectionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [policy, setPolicy] = useState(trip.pricePolicy);
  const [reconciliationAcknowledged, setReconciliationAcknowledged] = useState(false);
  const [marginOverrideReason, setMarginOverrideReason] = useState("");

  const loadPreview = useCallback(async () => {
    setLoading(true);
    try {
      setPreview(await timberRequest<InjectionPreview>(`/api/timber/trips/${trip.id}/injection-preview`));
    } catch (error) {
      showToast("error", errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [trip.id]);
  useEffect(() => { void loadPreview(); }, [loadPreview]);

  async function changePolicy(next: string) {
    const previous = policy;
    setPolicy(next);
    if (await onPolicyChange(next)) await loadPreview();
    else setPolicy(previous);
  }

  const readiness = tripReadiness({ trip, preview, reconciliationAcknowledged, marginOverrideReason });

  async function confirm() {
    if (!preview || !readiness.canConfirm) return;
    setConfirming(true);
    try {
      const done = await timberRequest<{ tripCode: string }>(`/api/timber/trips/${trip.id}`, {
        method: "PATCH",
        body: {
          action: "confirm",
          expectedHash: preview.hash,
          acknowledgeReconciliation: reconciliationAcknowledged,
          marginOverrideReason: readiness.negativeMarginLines > 0 ? marginOverrideReason.trim() : undefined,
        },
      });
      showToast("success", `Viaje ${done.tripCode} ingresado al inventario.`);
      onConfirmed();
    } catch (error) {
      const code = errorCode(error);
      if (code === "INJECTION_PREVIEW_STALE") { showToast("warning", errorMessage(error)); await loadPreview(); }
      else if (code === "TRIP_ALREADY_CONFIRMED" || code === "TRIP_CANNOT_BE_CONFIRMED") { showToast("info", errorMessage(error)); onConfirmed(); }
      else showToast("error", errorMessage(error));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card noPadding>
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3.5 py-2.5">
          <b className="text-[12.5px]">Qué entra a {trip.destinationBranch.name}</b>
          <span className="text-[12px] text-[var(--color-text-muted)]">{trip.totalPieces} piezas · {fmt(trip.totalFeet)} pies · costo final C$ {fmt(trip.landedCostPerFoot, 4)}/pie</span>
        </div>
        {loading || !preview ? (
          <div className="py-8 text-center text-sm text-[var(--color-text-muted)]">Calculando…</div>
        ) : preview.lines.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--color-text-muted)]">No hay medidas con piezas. Volvé al paso 1.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="hm-sheet-table">
              <thead><tr><th className="min-w-[11rem]">Producto</th><th className="r">Piezas</th><th className="r">Costo/pza</th><th className="r">Precio venta</th><th className="r">Margen</th></tr></thead>
              <tbody>
                {preview.lines.map((l) => {
                  const margin = marginOf(l);
                  const negative = l.sellingPrice.after < l.costPerPiece.after;
                  const drops = l.sellingPrice.before !== null && l.sellingPrice.after < l.sellingPrice.before;
                  return (
                    <tr key={l.lineId}>
                      <td>
                        <b>{l.productName}</b>{l.isNewProduct && <Badge variant="info" className="ml-1.5">se crea</Badge>}
                        <br /><span className="text-[11px] text-[var(--color-text-muted)]">{measureLabel(l.dimensions)} pies{l.sku && ` · ${l.sku}`}</span>
                      </td>
                      <td className="hm-num">+{l.piecesToAdd}</td>
                      <td className="hm-num">
                        {l.costPerPiece.before !== null && l.costPerPiece.before !== l.costPerPiece.after && <span className="text-[var(--color-text-soft)]">{fmt(l.costPerPiece.before)} → </span>}
                        <b>{fmt(l.costPerPiece.after)}</b>
                      </td>
                      <td className="hm-num">
                        {l.sellingPrice.before !== null && l.sellingPrice.before !== l.sellingPrice.after && <span className="text-[var(--color-text-soft)]">{fmt(l.sellingPrice.before)} → </span>}
                        <b className={drops ? "text-[var(--color-warning-700)]" : undefined}>{fmt(l.sellingPrice.after)}</b>
                      </td>
                      <td className={`hm-num font-semibold ${negative ? "text-[var(--color-danger-700)]" : ""}`}>{pct(margin)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="hm-section-rule">Precio de venta</div>
          <div role="radiogroup" aria-label="Política de precio" className="space-y-1.5 text-[12.5px]">
            {PRICE_POLICIES.map(([value, label, hint]) => (
              <label key={value} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 ${policy === value ? "border-[var(--color-master-500)] bg-[var(--color-surface-alt)]" : "border-[var(--color-border)]"}`}>
                <input type="radio" name="price-policy" className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-master-500)]" checked={policy === value} disabled={loading || confirming} onChange={() => void changePolicy(value)} />
                <span><b className="block">{label}</b><span className="text-[12px] text-[var(--color-text-muted)]">{hint}</span></span>
              </label>
            ))}
          </div>
          {readiness.priceDrops > 0 && policy !== "COST_ONLY" && (
            <p className="mt-2.5 flex gap-1.5 text-[12px] text-[var(--color-warning-700)]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {readiness.priceDrops} medida{readiness.priceDrops === 1 ? "" : "s"} bajaría{readiness.priceDrops === 1 ? "" : "n"} de precio. Si los precios actuales están bien, elegí «Solo actualizar costos».
            </p>
          )}
        </Card>

        <Card>
          <div className="hm-section-rule">Antes de ingresar</div>
          <ul aria-live="polite" className="space-y-2 text-[13px]">
            {readiness.items.map((item) => (
              <li key={item.key} className={`flex items-start gap-2 ${item.ok ? "text-[var(--color-text-muted)]" : "font-semibold text-[var(--color-text)]"}`}>
                {item.ok ? <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-success-700)]" /> : <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning-700)]" />}
                <span><span className="sr-only">{item.ok ? "Listo: " : "Falta: "}</span>{item.label}</span>
              </li>
            ))}
          </ul>

          {trip.reconciliation.status === "REVIEW" && (
            <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] p-2.5 text-[12.5px] text-[var(--color-warning-700)]">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-warning-700)]" checked={reconciliationAcknowledged} onChange={(e) => setReconciliationAcknowledged(e.target.checked)} />
              <span>Revisé la diferencia con la factura: cubicado {fmt(trip.totalFeet)} pies, factura {fmt(trip.reconciliation.invoicedFeet)} pies ({fmt(trip.reconciliation.differenceFeet)} pies). Ingresar igual.</span>
            </label>
          )}
          {readiness.negativeMarginLines > 0 && (
            <label className="mt-3 block text-[12px] font-semibold text-[var(--color-danger-700)]">
              Motivo para vender bajo costo
              <input value={marginOverrideReason} onChange={(e) => setMarginOverrideReason(e.target.value)} placeholder="Ej: precio de lanzamiento, madera de segunda…" className="mt-1 min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm font-normal text-[var(--color-text)]" />
            </label>
          )}

          <Button variant="primary" size="lg" className="mt-4 w-full" icon={<PackageCheck className="h-4 w-4" />} loading={confirming} disabled={!readiness.canConfirm || loading} onClick={confirm}>
            Ingresar al inventario
          </Button>
          <p className="mt-2 text-center text-[12px] text-[var(--color-text-muted)]">Suma las piezas al inventario de {trip.destinationBranch.name} y le asigna el número al viaje. No se puede deshacer.</p>
        </Card>
      </div>
    </div>
  );
}

/** Viaje ingresado o cancelado: solo lectura, con lo que quedó guardado. */
function TripSummaryView({ trip }: { trip: TripDetail }) {
  const cancelled = trip.status === "CANCELLED";
  return (
    <div className="space-y-4">
      <div className={`rounded-xl border p-3.5 text-[12.5px] ${cancelled ? "border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]" : "border-[var(--color-success-200)] bg-[var(--color-success-50)] text-[var(--color-success-700)]"}`}>
        {cancelled
          ? "Este viaje se canceló: nunca tocó el inventario."
          : <>Ingresado al inventario de <b>{trip.destinationBranch.name}</b>{trip.confirmedAt && <> el {fmtDateTimeShort(trip.confirmedAt)}</>}.{trip.marginOverrideReason && <> Motivo de margen negativo: «{trip.marginOverrideReason}».</>}</>}
      </div>
      <Card noPadding>
        <div className="overflow-x-auto">
          <table className="hm-sheet-table">
            <thead><tr><th>Medida (pies)</th><th className="r">Piezas</th><th className="r">Pies</th><th className="r">Costo/pza</th><th className="r">Costo total</th></tr></thead>
            <tbody>
              {trip.lines.map((l) => (
                <tr key={l.id}>
                  <td><b>{measureLabel({ thickness: l.thicknessIn, width: l.widthIn, length: l.lengthIn })}</b></td>
                  <td className="hm-num">{l.pieces}</td>
                  <td className="hm-num">{fmt(l.calculatedFeet)}</td>
                  <td className="hm-num">{fmt(l.calculatedCostPerPiece)}</td>
                  <td className="hm-num">{fmt(l.calculatedCostFeet)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td>TOTALES</td><td className="hm-num">{trip.totalPieces}</td><td className="hm-num">{fmt(trip.totalFeet)}</td><td /><td className="hm-num">{fmt(trip.totalCost)}</td></tr>
            </tfoot>
          </table>
        </div>
        <div className="grid gap-x-6 gap-y-1 border-t border-[var(--color-border)] px-3.5 py-2.5 text-[12.5px] sm:grid-cols-3">
          <span><span className="text-[var(--color-text-muted)]">Madera </span><b className="font-mono">C$ {fmt(trip.woodTripTotalCost)}</b></span>
          <span><span className="text-[var(--color-text-muted)]">Aserrado </span><b className="font-mono">C$ {fmt(n(trip.sawingAmount))}</b></span>
          <span><span className="text-[var(--color-text-muted)]">Otros gastos </span><b className="font-mono">C$ {fmt(n(trip.tripExpensesTotal) - n(trip.sawingAmount))}</b></span>
        </div>
      </Card>
    </div>
  );
}
