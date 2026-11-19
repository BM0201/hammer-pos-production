"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CloudOff, Loader2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { showToast } from "@/components/ui/toast";
import { errorCode, errorMessage, timberRequest } from "./trip-api";
import { EMPTY_EXPENSES, n, statusLabel, type TripDetail, type TripLineDraft } from "./trip-logic";
import { TripCubication } from "./trip-cubication";
import { TripCostPanel, type TripCostForm } from "./trip-cost-panel";
import { TripReview } from "./trip-review";

type SaveState = "idle" | "saving" | "saved" | "error";

function formFromTrip(t: TripDetail): TripCostForm {
  return {
    supplierName: t.supplierName ?? "",
    origin: t.origin ?? "",
    // Un total que no sale de pies × precio se escribió a mano. Sin costo todavía: por pie.
    costMode: n(t.woodTripTotalCost) > 0 && Math.abs(n(t.woodTripTotalCost) - n(t.computedCostPerFoot) * n(t.totalFeet)) > 0.01 ? "TOTAL" : "PER_FOOT",
    costPerFoot: n(t.computedCostPerFoot) || "",
    woodTripTotalCost: n(t.woodTripTotalCost) || "",
    expenses: {
      ...EMPTY_EXPENSES,
      freightAmount: n(t.freightAmount), fuelAmount: n(t.fuelAmount), perDiemAmount: n(t.perDiemAmount),
      permitsAmount: n(t.permitsAmount), otherExpensesAmount: n(t.otherExpensesAmount), sawingAmount: n(t.sawingAmount),
    },
    invoicedFeet: t.invoicedFeet != null ? n(t.invoicedFeet) : "",
  };
}

/** Un viaje: paso 1 cubicación y costos (autoguardado), paso 2 revisar e ingresar. */
export function TripEditor({ tripId, onBack }: { tripId: string; onBack: () => void }) {
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [nextTripCode, setNextTripCode] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [lines, setLinesState] = useState<TripLineDraft[]>([]);
  const [form, setFormState] = useState<TripCostForm | null>(null);
  const [pricePolicy, setPricePolicy] = useState("RECALC_FROM_PRICE_PER_INCH");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [askCancel, setAskCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const dirty = useRef(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const t = await timberRequest<TripDetail & { nextTripCode: string | null }>(`/api/timber/trips/${tripId}`);
      dirty.current = false;
      setTrip(t);
      setNextTripCode(t.nextTripCode);
      setLinesState(t.lines.map((l) => ({ thickness: l.thicknessIn, width: l.widthIn, length: l.lengthIn, pieces: l.pieces })));
      setFormState(formFromTrip(t));
      setPricePolicy(t.pricePolicy);
      setLoadError(null);
      if (t.status !== "DRAFT" && t.status !== "CUBICADO") setStep(2);
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, [tripId]);
  useEffect(() => { void load(); }, [load]);

  const isEditable = trip?.status === "DRAFT";

  const save = useCallback(async (policy = pricePolicy): Promise<boolean> => {
    if (!isEditable || !form) return true;
    clearTimeout(autosaveTimer.current);
    dirty.current = false;
    setSaveState("saving");
    try {
      const data = await timberRequest<{ trip: TripDetail }>(`/api/timber/trips/${tripId}`, {
        method: "PUT",
        body: {
          lines: lines.filter((l) => l.pieces > 0),
          woodTripTotalCost: form.costMode === "TOTAL" ? Number(form.woodTripTotalCost || 0) : 0,
          costPerFoot: form.costMode === "PER_FOOT" && Number(form.costPerFoot) > 0 ? Number(form.costPerFoot) : undefined,
          expenses: form.expenses,
          invoicedFeet: form.invoicedFeet === "" || Number(form.invoicedFeet) <= 0 ? null : Number(form.invoicedFeet),
          pricePolicy: policy,
          supplierName: form.supplierName.trim() || null,
          origin: form.origin.trim() || null,
        },
      });
      setTrip(data.trip);
      setSaveState("saved");
      return true;
    } catch (error) {
      setSaveState("error");
      showToast("error", errorMessage(error));
      if (errorCode(error) === "TRIP_NOT_EDITABLE") await load();
      return false;
    }
  }, [isEditable, form, lines, pricePolicy, tripId, load]);

  // Autoguardado: solo después de una edición, no al cargar.
  useEffect(() => {
    if (!dirty.current || !isEditable) return;
    autosaveTimer.current = setTimeout(() => { void save(); }, 700);
    return () => clearTimeout(autosaveTimer.current);
  }, [lines, form, isEditable, save]);

  const setLines = (update: (prev: TripLineDraft[]) => TripLineDraft[]) => { dirty.current = true; setLinesState(update); };
  const setForm = (patch: Partial<TripCostForm>) => { dirty.current = true; setFormState((prev) => (prev ? { ...prev, ...patch } : prev)); };

  // El paso 2 lee lo guardado: guardar antes de entrar.
  async function goToStep(next: 1 | 2) {
    if (next === 2 && isEditable && !(await save())) return;
    setStep(next);
  }

  async function changePolicy(policy: string) {
    setPricePolicy(policy);
    return save(policy);
  }

  async function cancelTrip() {
    setCancelling(true);
    try {
      clearTimeout(autosaveTimer.current);
      await timberRequest(`/api/timber/trips/${tripId}`, { method: "PATCH", body: { action: "cancel" } });
      showToast("success", "Borrador cancelado.");
      onBack();
    } catch (error) {
      showToast("error", errorMessage(error));
      setCancelling(false);
      setAskCancel(false);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-3 p-8 text-center">
        <p className="text-sm text-[var(--color-danger-700)]">{loadError}</p>
        <div className="flex justify-center gap-2">
          <Button variant="ghost" onClick={onBack}>Volver a la lista</Button>
          <Button variant="secondary" onClick={() => void load()}>Reintentar</Button>
        </div>
      </div>
    );
  }
  if (!trip || !form) return <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">Cargando…</div>;

  const status = statusLabel(trip.status);
  const hasPieces = lines.some((l) => l.pieces > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" aria-label="Volver a la lista de viajes" onClick={onBack} className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)]">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </button>
        <div className="min-w-0">
          <h2 className="text-lg font-bold tracking-tight text-[var(--color-text)]">
            {isEditable ? "Viaje en borrador" : <>Viaje <span className="font-mono">{trip.tripCode}</span></>}
          </h2>
          <p className="text-sm text-[var(--color-text-muted)]">
            {trip.destinationBranch.code} — {trip.destinationBranch.name}
            {isEditable && nextTripCode && <> · al ingresarlo será <b className="font-mono">{nextTripCode}</b></>}
          </p>
        </div>
        <Badge variant={status.variant}>{status.label}</Badge>
        <span className="flex-1" />
        {isEditable && <SaveIndicator state={saveState} onRetry={() => void save()} />}
        {isEditable && (
          // Destructivo: color de peligro propio, separado del botón principal (ghost pisaba el color del texto).
          <button type="button" onClick={() => setAskCancel(true)} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--color-danger-200)] px-3 text-sm font-semibold text-[var(--color-danger-700)] transition-colors hover:bg-[var(--color-danger-50)]">
            <Trash2 className="h-4 w-4" aria-hidden />Cancelar borrador
          </button>
        )}
      </div>

      {isEditable && (
        <div role="tablist" aria-label="Pasos del viaje" className="flex items-center gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-1">
          {([[1, "Cubicación y costos"], [2, "Revisar e ingresar"]] as const).map(([value, label]) => {
            const current = step === value;
            const done = value === 1 && step === 2;
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={current}
                disabled={value === 2 && !hasPieces}
                onClick={() => void goToStep(value)}
                className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-2 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${current ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}
              >
                <span aria-hidden className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${current ? "bg-[var(--color-text)] text-[var(--color-surface)]" : done ? "bg-[var(--color-success-50)] text-[var(--color-success-700)]" : "border border-[var(--color-border-strong)]"}`}>
                  {done ? <Check className="h-3.5 w-3.5" /> : value}
                </span>
                <span className="sr-only">Paso {value}: </span>{label}
              </button>
            );
          })}
        </div>
      )}

      {step === 1 ? (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr] [&>*]:min-w-0">
            <TripCubication tripId={trip.id} lines={lines} setLines={setLines} isEditable={isEditable} />
            <TripCostPanel form={form} setForm={setForm} lines={lines} reconciliation={trip.reconciliation} isEditable={isEditable} />
          </div>
          {isEditable && (
            <div className="flex justify-end">
              <Button variant="primary" size="lg" className="w-full sm:w-auto" disabled={!hasPieces || saveState === "saving"} icon={<ArrowRight className="h-4 w-4" />} onClick={() => void goToStep(2)}>
                Revisar e ingresar
              </Button>
            </div>
          )}
        </div>
      ) : (
        <TripReview key={trip.status} trip={trip} onPolicyChange={changePolicy} onConfirmed={() => void load()} />
      )}

      {askCancel && (
        <ConfirmDialog
          title="¿Cancelar este borrador?"
          message="El viaje queda como cancelado y sale de la lista. Nunca tocó el inventario. No se puede deshacer."
          confirmLabel="Sí, cancelar borrador"
          cancelLabel="Seguir editando"
          busy={cancelling}
          onConfirm={() => void cancelTrip()}
          onCancel={() => setAskCancel(false)}
        />
      )}
    </div>
  );
}

/** En una región role="status": el lector de pantalla anuncia "Guardado" sin mover el foco. */
function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  return (
    <span role="status" className="inline-flex min-h-11 items-center text-[12px]">
      {state === "saving" && <span className="inline-flex items-center gap-1 text-[var(--color-text-muted)]"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />Guardando…</span>}
      {state === "saved" && <span className="inline-flex items-center gap-1 text-[var(--color-success-700)]"><Check className="h-3.5 w-3.5" aria-hidden />Guardado</span>}
      {state === "error" && (
        <button type="button" onClick={onRetry} className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2.5 font-semibold text-[var(--color-danger-700)] hover:bg-[var(--color-danger-50)]">
          <CloudOff className="h-3.5 w-3.5" aria-hidden />No se guardó — reintentar
        </button>
      )}
    </span>
  );
}
