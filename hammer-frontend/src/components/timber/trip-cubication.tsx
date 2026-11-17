"use client";

import { useRef, useState } from "react";
import { Plus, Upload, Loader2, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { showToast } from "@/components/ui/toast";
import { numFixed as fmt } from "@/lib/format";
import { parseTimberMeasure, STANDARD_MEASURES } from "./timber-measure";
import { errorMessage, timberRequest } from "./trip-api";
import { addMeasureTo, lineFeet, measureLabel, mergeCubicationImport, type CubicationImportPreview, type TripLineDraft } from "./trip-logic";

/**
 * Cubicación del viaje: entrada rápida con teclado (medida, Enter, piezas, Enter), tabla editable
 * y carga del Excel del aserradero. Todo edita `lines`; el autoguardado del editor lo persiste.
 */
export function TripCubication({ tripId, lines, setLines, isEditable }: {
  tripId: string;
  lines: TripLineDraft[];
  setLines: (update: (prev: TripLineDraft[]) => TripLineDraft[]) => void;
  isEditable: boolean;
}) {
  const totalPieces = lines.reduce((sum, l) => sum + l.pieces, 0);
  const totalFeet = lines.reduce((sum, l) => sum + lineFeet(l), 0);
  const [measureText, setMeasureText] = useState("");
  const [piecesText, setPiecesText] = useState("");
  const [entryError, setEntryError] = useState<string | null>(null);
  const measureInputRef = useRef<HTMLInputElement>(null);
  const piecesInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<CubicationImportPreview | null>(null);

  function submitQuickEntry(e: React.FormEvent) {
    e.preventDefault();
    const measure = parseTimberMeasure(measureText);
    if (!measure) { setEntryError("Medida no reconocida. Escribila así: 1x12x16 (grueso × ancho × largo)."); measureInputRef.current?.focus(); return; }
    if (!piecesText) { setEntryError(null); piecesInputRef.current?.focus(); return; }
    const pieces = Math.trunc(Number(piecesText));
    if (!(pieces > 0)) { setEntryError("Las piezas deben ser un número entero mayor a 0."); piecesInputRef.current?.focus(); return; }
    setLines((prev) => addMeasureTo(prev, measure, pieces));
    setEntryError(null);
    setMeasureText("");
    setPiecesText("");
    measureInputRef.current?.focus();
  }

  async function onFileSelected(file: File | null) {
    if (!file) return;
    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      let binary = "";
      new Uint8Array(buffer).forEach((byte) => { binary += String.fromCharCode(byte); });
      setPreview(await timberRequest<CubicationImportPreview>(`/api/timber/trips/${tripId}/cubication-import`, { method: "POST", body: { fileBase64: btoa(binary) } }));
    } catch (error) {
      showToast("error", errorMessage(error));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function applyImport() {
    if (!preview) return;
    const recognized = preview.recognized;
    setLines((prev) => mergeCubicationImport(prev, recognized));
    showToast("success", `${recognized.length} medida${recognized.length === 1 ? "" : "s"} aplicada${recognized.length === 1 ? "" : "s"}.`);
    setPreview(null);
  }

  const inputClass = "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 font-mono text-sm text-[var(--color-text)]";

  return (
    <Card noPadding>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3.5 py-2.5">
        <b className="text-[12.5px]">Cubicación</b>
        <span className="text-[11px] text-[var(--color-text-muted)]">{lines.length} medida{lines.length === 1 ? "" : "s"}</span>
        <span className="flex-1" />
        {isEditable && (
          <>
            <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => onFileSelected(e.target.files?.[0] ?? null)} />
            <Button type="button" variant="secondary" size="sm" disabled={importing} icon={importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} onClick={() => fileInputRef.current?.click()}>
              Cargar cubicación desde Excel
            </Button>
          </>
        )}
      </div>

      {isEditable && (
        <form onSubmit={submitQuickEntry} className="border-b border-[var(--color-border)] px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[9rem] flex-1">
              <input ref={measureInputRef} value={measureText} onChange={(e) => setMeasureText(e.target.value)} list="timber-standard-measures" aria-label="Medida" placeholder="Medida: 1x12x16" autoComplete="off" className={inputClass} />
              <datalist id="timber-standard-measures">
                {STANDARD_MEASURES.map((m) => <option key={measureLabel(m)} value={`${m.thickness}x${m.width}x${m.length}`} />)}
              </datalist>
            </div>
            <div className="w-24">
              <input ref={piecesInputRef} value={piecesText} onChange={(e) => setPiecesText(e.target.value)} type="number" inputMode="numeric" min={1} step={1} aria-label="Piezas" placeholder="Piezas" className={`${inputClass} text-right`} />
            </div>
            <Button type="submit" variant="secondary" icon={<Plus className="h-4 w-4" />}>Agregar</Button>
          </div>
          {entryError && <p role="alert" className="mt-1.5 text-[12px] text-[var(--color-danger-700)]">{entryError}</p>}
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="hm-sheet-table">
          <thead>
            <tr><th>Medida (pies)</th><th className="r" style={{ width: 96 }}>Piezas</th><th className="r">Pies/pza</th><th className="r">Pies totales</th><th /></tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr><td colSpan={5} className="text-center text-[var(--color-text-muted)]">Todavía no hay medidas. Escribí la primera arriba o cargá el Excel.</td></tr>
            )}
            {lines.map((l, i) => {
              const feetPerPiece = (l.thickness * l.width * l.length) / 12;
              const label = measureLabel(l);
              return (
                <tr key={label}>
                  <td><b>{label}</b></td>
                  <td>
                    {isEditable ? (
                      <input type="number" inputMode="numeric" min={0} step={1} value={l.pieces} onChange={(e) => { const pieces = Math.max(0, Math.trunc(Number(e.target.value) || 0)); setLines((prev) => prev.map((x, j) => (j === i ? { ...x, pieces } : x))); }} aria-label={`Piezas de ${label}`} className="w-20 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-right font-mono text-[12.5px]" />
                    ) : <span className="hm-num">{l.pieces}</span>}
                  </td>
                  <td className="hm-num text-[var(--color-text-muted)]">{fmt(feetPerPiece, 3)}</td>
                  <td className="hm-num">{fmt(feetPerPiece * l.pieces)}</td>
                  <td>
                    {isEditable && (
                      <button type="button" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))} aria-label={`Quitar ${label}`} className="rounded p-1.5 text-[var(--color-text-soft)] hover:text-[var(--color-danger-700)]">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr><td>TOTALES</td><td className="hm-num">{totalPieces}</td><td /><td className="hm-num">{fmt(totalFeet)}</td><td /></tr>
          </tfoot>
        </table>
      </div>

      {preview && (
        <Dialog
          title="Cubicación cargada desde Excel"
          subtitle="Revisá antes de aplicar: nada se guarda todavía."
          onClose={() => setPreview(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setPreview(null)}>Cancelar</Button>
              <Button variant="success" disabled={preview.recognized.length === 0} onClick={applyImport} data-autofocus>Aplicar {preview.recognized.length} medida{preview.recognized.length === 1 ? "" : "s"}</Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="hm-sheet-table">
                <thead><tr><th>Medida</th><th className="r">Piezas</th><th className="r">Pies</th><th>Qué pasa</th></tr></thead>
                <tbody>
                  {preview.recognized.map((r) => (
                    <tr key={measureLabel(r)}>
                      <td><b>{measureLabel(r)}</b></td>
                      <td className="hm-num">{r.pieces}</td>
                      <td className="hm-num">{fmt(r.calculatedFeet, 2)}</td>
                      <td>{r.action === "UPDATE" ? <Badge variant="warning">Reemplaza {r.existingPieces} → {r.pieces}</Badge> : <Badge variant="success">Nueva</Badge>}</td>
                    </tr>
                  ))}
                  {preview.recognized.length === 0 && <tr><td colSpan={4} className="text-center text-[var(--color-text-muted)]">No se reconoció ninguna medida en el archivo.</td></tr>}
                </tbody>
              </table>
            </div>
            {preview.unrecognized.length > 0 && (
              <div className="rounded-lg border border-[var(--color-warning-300)] bg-[var(--color-warning-50)] p-3">
                <b className="text-[12.5px] text-[var(--color-warning-800)]">{preview.unrecognized.length} fila{preview.unrecognized.length === 1 ? "" : "s"} sin reconocer: agregalas a mano si hacen falta</b>
                <ul className="mt-1.5 space-y-1 text-[11.5px] text-[var(--color-warning-800)]">
                  {preview.unrecognized.map((u) => (
                    <li key={u.rowNumber}>Fila {u.rowNumber}: “{u.rawMedida || "(vacío)"}” / “{u.rawPiezas || "(vacío)"}” — {u.reason}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Dialog>
      )}
    </Card>
  );
}
