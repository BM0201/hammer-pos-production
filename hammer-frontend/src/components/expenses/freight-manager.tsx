"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { showToast } from "@/components/ui/toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money } from "@/lib/format";
import {
  type Branch,
  type InternalFreightRoute,
  type Truck,
  type TransferOption,
  type InternalFreightTrip,
  FREIGHT_STATUS_LABELS,
} from "@/components/expenses/expense-manager.types";

/**
 * Finanzas › Fletes / costos internos: rutas, camiones y viajes de flete
 * interno que se suman al costo del producto en la sucursal destino.
 * Antes era el tab "freight" de ExpenseManager; los gastos operativos (y su
 * presupuesto) viven ahora solo en el libro por período (ExpensesPeriodPanel).
 */
export function FreightManager() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [freightRoutes, setFreightRoutes] = useState<InternalFreightRoute[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [freightTrips, setFreightTrips] = useState<InternalFreightTrip[]>([]);
  const [transfers, setTransfers] = useState<TransferOption[]>([]);
  const [routeForm, setRouteForm] = useState({ originBranchId: "", destinationBranchId: "", name: "", roundTripKm: "", defaultAllocationMethod: "BY_VALUE" });
  const [truckForm, setTruckForm] = useState({ name: "", plate: "", fuelEfficiencyKmPerGallon: "", maintenanceCostPerKm: "0" });
  const [tripForm, setTripForm] = useState({ routeId: "", transferId: "", truckId: "", fuelPricePerGallon: "", fuelCost: "", driverCost: "0", helperCost: "0", otherCost: "0", allocationMethod: "BY_VALUE" });

  useEffect(() => {
    fetch("/api/branches")
      .then((r) => r.json())
      .then((raw) => {
        const data = unwrapApiData(raw);
        setBranches(Array.isArray(data) ? data : []);
      })
      .catch(console.error);
  }, []);

  const loadFreightData = useCallback(async () => {
    try {
      const [routesRes, trucksRes, tripsRes, transfersRes] = await Promise.all([
        fetch("/api/internal-freight/routes"),
        fetch("/api/internal-freight/trucks"),
        fetch("/api/internal-freight/trips"),
        fetch("/api/master/transfers"),
      ]);
      const routesData = unwrapApiData(await routesRes.json());
      const trucksData = unwrapApiData(await trucksRes.json());
      const tripsData = unwrapApiData(await tripsRes.json());
      const transfersData = unwrapApiData(await transfersRes.json());
      setFreightRoutes(Array.isArray(routesData) ? routesData : []);
      setTrucks(Array.isArray(trucksData) ? trucksData : []);
      setFreightTrips(Array.isArray(tripsData) ? tripsData : []);
      setTransfers(Array.isArray(transfersData) ? transfersData : []);
    } catch {
      showToast("error", "Error al cargar flete interno");
    }
  }, []);

  useEffect(() => {
    loadFreightData();
  }, [loadFreightData]);

  const handleCreateRoute = async () => {
    const res = await apiFetch("/api/internal-freight/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...routeForm, roundTripKm: Number(routeForm.roundTripKm) }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      showToast("error", body?.error?.message ?? "No se pudo crear la ruta");
      return;
    }
    setRouteForm({ originBranchId: "", destinationBranchId: "", name: "", roundTripKm: "", defaultAllocationMethod: "BY_VALUE" });
    showToast("success", "Ruta de flete creada");
    loadFreightData();
  };

  const handleCreateTruck = async () => {
    const res = await apiFetch("/api/internal-freight/trucks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: truckForm.name,
        plate: truckForm.plate || null,
        fuelEfficiencyKmPerGallon: truckForm.fuelEfficiencyKmPerGallon ? Number(truckForm.fuelEfficiencyKmPerGallon) : null,
        maintenanceCostPerKm: Number(truckForm.maintenanceCostPerKm || 0),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      showToast("error", body?.error?.message ?? "No se pudo crear el camion");
      return;
    }
    setTruckForm({ name: "", plate: "", fuelEfficiencyKmPerGallon: "", maintenanceCostPerKm: "0" });
    showToast("success", "Camion creado");
    loadFreightData();
  };

  const handleCreateTrip = async () => {
    const res = await apiFetch("/api/internal-freight/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routeId: tripForm.routeId,
        transferId: tripForm.transferId || null,
        truckId: tripForm.truckId || null,
        fuelPricePerGallon: Number(tripForm.fuelPricePerGallon || 0),
        fuelCost: tripForm.fuelCost ? Number(tripForm.fuelCost) : null,
        driverCost: Number(tripForm.driverCost || 0),
        helperCost: Number(tripForm.helperCost || 0),
        otherCost: Number(tripForm.otherCost || 0),
        allocationMethod: tripForm.allocationMethod,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      showToast("error", body?.error?.message ?? "No se pudo calcular el viaje");
      return;
    }
    showToast("success", "Viaje de flete calculado");
    loadFreightData();
  };

  const handleApplyTrip = async (id: string) => {
    if (!confirm("Aplicar este flete al costo por sucursal? No movera inventario ni cambiara precios automaticamente.")) return;
    const res = await apiFetch(`/api/internal-freight/trips/${id}/apply`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      showToast("error", body?.error?.message ?? "No se pudo aplicar el flete");
      return;
    }
    showToast("success", "Flete aplicado al costo de sucursal");
    loadFreightData();
  };

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <p className="text-sm text-[var(--color-text-secondary)]">
          El flete interno Managua - sucursal se suma al costo del producto en la sucursal destino. El transporte al cliente se cobra aparte en la venta.
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5 space-y-3">
          <h4 className="text-sm font-semibold text-[var(--color-text)]">Configurar ruta</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            <select className="rounded-lg border px-3 py-2 text-sm" value={routeForm.originBranchId} onChange={(e) => setRouteForm({ ...routeForm, originBranchId: e.target.value })}>
              <option value="">Origen</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} - {b.name}</option>)}
            </select>
            <select className="rounded-lg border px-3 py-2 text-sm" value={routeForm.destinationBranchId} onChange={(e) => setRouteForm({ ...routeForm, destinationBranchId: e.target.value })}>
              <option value="">Destino</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} - {b.name}</option>)}
            </select>
            <Input placeholder="Nombre de ruta" value={routeForm.name} onChange={(e) => setRouteForm({ ...routeForm, name: e.target.value })} />
            <Input type="number" min="0" step="0.01" placeholder="Km ida/vuelta" value={routeForm.roundTripKm} onChange={(e) => setRouteForm({ ...routeForm, roundTripKm: e.target.value })} />
            <select className="rounded-lg border px-3 py-2 text-sm" value={routeForm.defaultAllocationMethod} onChange={(e) => setRouteForm({ ...routeForm, defaultAllocationMethod: e.target.value })}>
              <option value="BY_VALUE">Reparto por valor</option>
              <option value="BY_QUANTITY">Reparto por cantidad</option>
              <option value="MANUAL">Manual</option>
            </select>
            <Button onClick={handleCreateRoute} disabled={!routeForm.originBranchId || !routeForm.destinationBranchId || !routeForm.name || !routeForm.roundTripKm}>Crear ruta</Button>
          </div>
        </Card>

        <Card className="p-5 space-y-3">
          <h4 className="text-sm font-semibold text-[var(--color-text)]">Configurar camion</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder="Nombre" value={truckForm.name} onChange={(e) => setTruckForm({ ...truckForm, name: e.target.value })} />
            <Input placeholder="Placa" value={truckForm.plate} onChange={(e) => setTruckForm({ ...truckForm, plate: e.target.value })} />
            <Input type="number" min="0" step="0.01" placeholder="Km/galon" value={truckForm.fuelEfficiencyKmPerGallon} onChange={(e) => setTruckForm({ ...truckForm, fuelEfficiencyKmPerGallon: e.target.value })} />
            <Input type="number" min="0" step="0.01" placeholder="Mantenimiento por km" value={truckForm.maintenanceCostPerKm} onChange={(e) => setTruckForm({ ...truckForm, maintenanceCostPerKm: e.target.value })} />
            <Button onClick={handleCreateTruck} disabled={!truckForm.name}>Crear camion</Button>
          </div>
        </Card>
      </div>

      <Card className="p-5 space-y-3">
        <h4 className="text-sm font-semibold text-[var(--color-text)]">Crear viaje de flete interno</h4>
        <div className="grid gap-2 md:grid-cols-4">
          <select className="rounded-lg border px-3 py-2 text-sm" value={tripForm.routeId} onChange={(e) => setTripForm({ ...tripForm, routeId: e.target.value })}>
            <option value="">Ruta</option>
            {freightRoutes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select className="rounded-lg border px-3 py-2 text-sm" value={tripForm.transferId} onChange={(e) => setTripForm({ ...tripForm, transferId: e.target.value })}>
            <option value="">Transferencia (requerida)</option>
            {transfers.map((t) => <option key={t.id} value={t.id}>{t.transferNumber}</option>)}
          </select>
          <select className="rounded-lg border px-3 py-2 text-sm" value={tripForm.truckId} onChange={(e) => setTripForm({ ...tripForm, truckId: e.target.value })}>
            <option value="">Camion opcional</option>
            {trucks.map((t) => <option key={t.id} value={t.id}>{t.name}{t.plate ? ` - ${t.plate}` : ""}</option>)}
          </select>
          <select className="rounded-lg border px-3 py-2 text-sm" value={tripForm.allocationMethod} onChange={(e) => setTripForm({ ...tripForm, allocationMethod: e.target.value })}>
            <option value="BY_VALUE">Por valor</option>
            <option value="BY_QUANTITY">Por cantidad</option>
          </select>
          <Input type="number" min="0" step="0.01" placeholder="Precio combustible/galon" value={tripForm.fuelPricePerGallon} onChange={(e) => setTripForm({ ...tripForm, fuelPricePerGallon: e.target.value })} />
          <Input type="number" min="0" step="0.01" placeholder="Combustible manual si no hay camion" value={tripForm.fuelCost} onChange={(e) => setTripForm({ ...tripForm, fuelCost: e.target.value })} />
          <Input type="number" min="0" step="0.01" placeholder="Conductor" value={tripForm.driverCost} onChange={(e) => setTripForm({ ...tripForm, driverCost: e.target.value })} />
          <Input type="number" min="0" step="0.01" placeholder="Ayudante" value={tripForm.helperCost} onChange={(e) => setTripForm({ ...tripForm, helperCost: e.target.value })} />
          <Input type="number" min="0" step="0.01" placeholder="Otros costos" value={tripForm.otherCost} onChange={(e) => setTripForm({ ...tripForm, otherCost: e.target.value })} />
          <Button onClick={handleCreateTrip} disabled={!tripForm.routeId || !tripForm.transferId || !tripForm.fuelPricePerGallon}>Calcular viaje</Button>
        </div>
      </Card>

      <Card className="p-5">
        <h4 className="text-sm font-semibold text-[var(--color-text)] mb-3">Viajes calculados</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b text-left"><th>Ruta</th><th>Camion</th><th>Total</th><th>Estado</th><th>Lineas</th><th>Accion</th></tr></thead>
            <tbody>
              {freightTrips.map((trip) => (
                <tr key={trip.id} className="border-b align-top">
                  <td className="py-2">{trip.route.name}</td>
                  <td>{trip.truck?.name ?? "Manual"}</td>
                  <td>{money(Number(trip.totalTripCost))}</td>
                  <td>{FREIGHT_STATUS_LABELS[trip.status] ?? trip.status}</td>
                  <td>
                    <div className="space-y-1">
                      {trip.lines.slice(0, 5).map((line) => (
                        <div key={line.id}>{line.product.sku}: {money(Number(line.allocatedFreightPerUnit))}/u</div>
                      ))}
                    </div>
                  </td>
                  <td>
                    {trip.status !== "APPLIED" && (
                      <button className="text-[var(--color-info-700)] hover:underline" onClick={() => handleApplyTrip(trip.id)}>Aplicar a costo sucursal</button>
                    )}
                  </td>
                </tr>
              ))}
              {!freightTrips.length && <tr><td colSpan={6} className="py-6 text-center text-[var(--color-text-muted)]">Sin viajes de flete interno.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
