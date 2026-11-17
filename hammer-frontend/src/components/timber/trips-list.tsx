"use client";

import { useEffect, useState } from "react";
import { Plus, Truck, Search, TreePine } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { showToast } from "@/components/ui/toast";
import { numFixed as fmt, fmtDateTimeShort } from "@/lib/format";
import { errorMessage, timberRequest } from "./trip-api";
import { pct, statusLabel, type Branch, type TripDetail, type TripSummary } from "./trip-logic";

/** Lista de viajes + "Nuevo viaje": elegir la sucursal crea el borrador y lo abre. */
export function TripsList({ onOpen }: { onOpen: (id: string) => void }) {
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [nextTripCode, setNextTripCode] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const data = await timberRequest<{ items: TripSummary[]; nextTripCode: string | null }>(`/api/timber/trips?search=${encodeURIComponent(search)}&limit=50`);
        if (cancelled) return;
        setTrips(Array.isArray(data?.items) ? data.items : []);
        setNextTripCode(data?.nextTripCode ?? null);
      } catch (error) {
        if (!cancelled) showToast("error", errorMessage(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, search ? 250 : 0);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="hm-section-icon hm-section-icon-master"><Truck className="h-4 w-4" /></div>
          <p className="text-sm text-[var(--color-text-muted)]">
            {nextTripCode ? <>El próximo viaje que se ingrese será <b className="font-mono text-[var(--color-text)]">{nextTripCode}</b></> : "Viajes de compra de madera"}
          </p>
        </div>
        <span className="hidden flex-1 sm:block" />
        <div className="flex w-full items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-soft)] sm:w-auto">
          <Search className="h-4 w-4 shrink-0" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por número o proveedor…" aria-label="Buscar viaje" className="w-full bg-transparent text-[var(--color-text)] outline-none sm:w-56" />
        </div>
        <Button variant="primary" className="w-full sm:w-auto" icon={<Plus className="h-4 w-4" />} onClick={() => setPicking(true)}>Nuevo viaje</Button>
      </div>

      <Card noPadding>
        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">Cargando…</div>
        ) : trips.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <TreePine className="h-8 w-8 text-[var(--color-text-soft)]" />
            <p className="text-sm text-[var(--color-text-muted)]">{search ? "Ningún viaje coincide con la búsqueda." : "Todavía no hay viajes. Empezá con «Nuevo viaje»."}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="hm-sheet-table">
              <thead>
                <tr><th>Viaje</th><th>Destino</th><th>Estado</th><th className="r">Piezas</th><th className="r">Pies</th><th className="r">Costo total</th><th className="r">Margen</th></tr>
              </thead>
              <tbody>
                {trips.map((t) => {
                  const status = statusLabel(t.status);
                  return (
                    <tr key={t.id} className="cursor-pointer" tabIndex={0} onClick={() => onOpen(t.id)} onKeyDown={(e) => { if (e.key === "Enter") onOpen(t.id); }}>
                      <td>
                        {status.label === "Borrador" ? <b className="text-[12.5px]">Sin número</b> : <b className="whitespace-nowrap font-mono text-[12.5px]">{t.tripCode}</b>}
                        <br /><span className="text-[11px] text-[var(--color-text-muted)]">{[t.supplierName, fmtDateTimeShort(t.createdAt)].filter(Boolean).join(" · ")}</span>
                      </td>
                      <td>{t.destinationBranch.code}</td>
                      <td><Badge variant={status.variant}>{status.label}</Badge></td>
                      <td className="hm-num">{t.totalPieces}</td>
                      <td className="hm-num">{fmt(t.totalFeet)}</td>
                      <td className="hm-num">C$ {fmt(t.totalCost)}</td>
                      <td className="hm-num">{pct(t.marginPercent)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {picking && <NewTripDialog onClose={() => setPicking(false)} onCreated={onOpen} />}
    </div>
  );
}

function NewTripDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [creatingFor, setCreatingFor] = useState<string | null>(null);

  useEffect(() => {
    timberRequest<Branch[]>("/api/branches")
      .then((list) => setBranches(Array.isArray(list) ? list : []))
      .catch((error) => { showToast("error", errorMessage(error)); setBranches([]); });
  }, []);

  async function create(destinationBranchId: string) {
    setCreatingFor(destinationBranchId);
    try {
      const data = await timberRequest<{ trip: TripDetail }>("/api/timber/trips", { method: "POST", body: { destinationBranchId, woodTripTotalCost: 0, lines: [] } });
      onCreated(data.trip.id);
    } catch (error) {
      showToast("error", errorMessage(error));
      setCreatingFor(null);
    }
  }

  return (
    <Dialog size="sm" title="Nuevo viaje" subtitle="¿A qué sucursal llega la madera?" onClose={onClose} busy={creatingFor !== null}>
      <div className="grid gap-2">
        {branches === null && <p className="text-center text-sm text-[var(--color-text-muted)]">Cargando sucursales…</p>}
        {branches?.length === 0 && <p className="text-center text-sm text-[var(--color-text-muted)]">No hay sucursales activas.</p>}
        {branches?.map((b, i) => (
          <Button key={b.id} variant="secondary" size="lg" className="w-full justify-start" loading={creatingFor === b.id} disabled={creatingFor !== null} onClick={() => create(b.id)} {...(i === 0 ? { "data-autofocus": true } : {})}>
            <b className="font-mono">{b.code}</b> — {b.name}
          </Button>
        ))}
      </div>
    </Dialog>
  );
}
