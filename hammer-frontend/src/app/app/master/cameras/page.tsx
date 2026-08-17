"use client";

import { useCallback, useEffect, useState } from "react";
import { Camera as CameraIcon, RefreshCcw, Plus, KeyRound, Eye, X, Check } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import toast from "react-hot-toast";

type Branch = { id: string; code: string; name: string };

type CameraLocation = "CAJA" | "DESPACHO" | "PATIO" | "PASILLO" | "OTRO";
type CameraHealthState = "OFFLINE" | "NO_STREAM" | "NO_FRAMES" | "FROZEN" | "BLACK" | "BLURRY" | "MOVED" | "DEGRADED" | "OK" | "UNKNOWN";

type CameraRow = {
  id: string;
  name: string;
  location: CameraLocation;
  ipAddress: string;
  networkSegment: string | null;
  manufacturer: string | null;
  model: string | null;
  currentStatus: CameraHealthState;
  statusSince: string | null;
};

const LOCATION_LABEL: Record<CameraLocation, string> = {
  CAJA: "Caja", DESPACHO: "Despacho", PATIO: "Patio", PASILLO: "Pasillo", OTRO: "Otro",
};

const STATUS_VARIANT: Record<CameraHealthState, "success" | "warning" | "danger" | "neutral"> = {
  OK: "success",
  UNKNOWN: "neutral",
  OFFLINE: "danger", NO_STREAM: "danger", NO_FRAMES: "danger", FROZEN: "danger", BLACK: "danger",
  BLURRY: "warning", MOVED: "warning", DEGRADED: "warning",
};

const STATUS_LABEL: Record<CameraHealthState, string> = {
  OK: "OK", UNKNOWN: "Sin información", OFFLINE: "Fuera de línea", NO_STREAM: "Sin stream",
  NO_FRAMES: "Sin cuadros", FROZEN: "Congelada", BLACK: "Pantalla negra", BLURRY: "Desenfocada",
  MOVED: "Movida", DEGRADED: "Degradada",
};

function fmtSince(iso: string | null) {
  if (!iso) return "sin datos";
  return new Date(iso).toLocaleString("es-NI", { dateStyle: "short", timeStyle: "short" });
}

export default function MasterCamerasPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<string>("");
  const [cameras, setCameras] = useState<CameraRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [provisionedToken, setProvisionedToken] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/branches")
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => {
        if (!raw) return;
        const list = unwrapApiData(raw) as Branch[];
        setBranches(Array.isArray(list) ? list : []);
        if (Array.isArray(list) && list.length > 0) setBranchId((prev) => prev || list[0].id);
      })
      .catch(() => {});
  }, []);

  const loadCameras = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/master/cameras?branchId=${branchId}`);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudieron cargar las cámaras.");
      setCameras(unwrapApiData(raw) as CameraRow[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron cargar las cámaras.");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => { void loadCameras(); }, [loadCameras]);

  async function provisionAgent() {
    if (!branchId) return;
    try {
      const res = await apiFetch("/api/master/cameras/provision-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId }),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo generar el token del agente.");
      setProvisionedToken(unwrapApiData(raw).token);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo generar el token del agente.");
    }
  }

  async function openLiveView(cameraId: string) {
    try {
      const res = await apiFetch(`/api/master/cameras/${cameraId}/live-view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId }),
      });
      if (!res.ok) {
        const raw = await res.json();
        throw new Error(raw?.error?.message ?? "No se pudo abrir la cámara.");
      }
      toast("La conexión en vivo con el agente de la sucursal todavía no está conectada desde acá — esta acción ya quedó registrada en Auditoría.", { icon: "ℹ️" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo abrir la cámara.");
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-1 rounded-full" style={{ background: "var(--color-master-600)" }} />
          <div>
            <h1 className="text-lg font-semibold text-[var(--color-text)]">Cámaras</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Ver en vivo y avisar cuando una cámara está mal — no graba ni almacena video.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select className="hm-input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.code} - {b.name}</option>)}
          </select>
          <Button variant="ghost" size="sm" loading={loading} onClick={() => void loadCameras()} icon={<RefreshCcw className="h-3.5 w-3.5" />}>Actualizar</Button>
          <Button variant="secondary" size="sm" onClick={() => void provisionAgent()} icon={<KeyRound className="h-3.5 w-3.5" />}>Aprovisionar agente</Button>
          <Button variant="success" size="sm" onClick={() => setShowAddForm(true)} icon={<Plus className="h-3.5 w-3.5" />}>Agregar cámara</Button>
        </div>
      </div>

      {provisionedToken && (
        <Card className="border-[var(--color-warning-300)] bg-[var(--color-warning-50)] p-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-[var(--color-warning-800)]">Token del agente — copialo ahora, no se vuelve a mostrar</p>
              <code className="mt-1 block break-all rounded bg-[var(--color-surface)] px-2 py-1 font-mono text-xs">{provisionedToken}</code>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">Pegalo en agent.config de la sucursal. Volver a generar un token invalida este de inmediato.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setProvisionedToken(null)} icon={<X className="h-3.5 w-3.5" />}>Cerrar</Button>
          </div>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cameras.length === 0 ? (
          <Card className="col-span-full border-dashed p-8 text-center">
            <CameraIcon className="mx-auto mb-2 text-[var(--color-text-muted)]" style={{ width: "1.5rem", height: "1.5rem" }} />
            <p className="text-sm text-[var(--color-text-muted)]">Sin cámaras registradas en esta sucursal todavía.</p>
          </Card>
        ) : cameras.map((camera) => (
          <Card key={camera.id} className="p-4 space-y-2">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold text-[var(--color-text)]">{camera.name}</div>
                <div className="text-xs text-[var(--color-text-muted)]">{LOCATION_LABEL[camera.location]} · {camera.ipAddress}</div>
              </div>
              <Badge variant={STATUS_VARIANT[camera.currentStatus]}>{STATUS_LABEL[camera.currentStatus]}</Badge>
            </div>
            <div className="text-xs text-[var(--color-text-muted)]">Desde {fmtSince(camera.statusSince)}</div>
            {camera.manufacturer && <div className="text-xs text-[var(--color-text-muted)]">{camera.manufacturer} {camera.model ?? ""}</div>}
            <Button variant="secondary" size="sm" className="w-full" onClick={() => void openLiveView(camera.id)} icon={<Eye className="h-3.5 w-3.5" />}>Ver en vivo</Button>
          </Card>
        ))}
      </div>

      {showAddForm && (
        <AddCameraModal branchId={branchId} onClose={() => setShowAddForm(false)} onSaved={() => { setShowAddForm(false); void loadCameras(); }} />
      )}
    </section>
  );
}

function AddCameraModal({ branchId, onClose, onSaved }: { branchId: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState<CameraLocation>("OTRO");
  const [ipAddress, setIpAddress] = useState("");
  const [networkSegment, setNetworkSegment] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch("/api/master/cameras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId, name, location,
          ipAddress, networkSegment: networkSegment || null,
          credentials: { username, password },
        }),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo registrar la cámara.");
      toast.success("Cámara registrada.");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo registrar la cámara.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="w-full max-w-md space-y-3 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Agregar cámara</h3>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} icon={<X className="h-4 w-4" />}>Cerrar</Button>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Nombre</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Ubicación</label>
          <select className="hm-input w-full" value={location} onChange={(e) => setLocation(e.target.value as CameraLocation)}>
            {Object.entries(LOCATION_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">IP</label>
          <Input value={ipAddress} onChange={(e) => setIpAddress(e.target.value)} placeholder="192.168.1.10" required />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Segmento de red (opcional)</label>
          <Input value={networkSegment} onChange={(e) => setNetworkSegment(e.target.value)} placeholder="ej. switch-patio" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Usuario ONVIF</label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Contraseña</label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
        </div>
        <Button type="submit" variant="success" loading={saving} className="w-full" icon={<Check className="h-4 w-4" />}>Guardar</Button>
      </form>
    </div>
  );
}
