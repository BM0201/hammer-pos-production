"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CreditCard, RefreshCw, Users } from "lucide-react";
import { apiFetch, unwrapApiData, type ApiResponse } from "@/lib/client/api";
import { Button } from "@/components/ui/button";

type ActivityUser = {
  userId: string;
  username: string;
  globalRole: string | null;
  isActive: boolean;
  status: "ONLINE" | "IDLE" | "OFFLINE";
  currentPath: string | null;
  currentModule: string | null;
  lastSeenAt: string | null;
  branch: { id: string; name: string; code: string | null } | null;
  branchRoles: Array<{ branchId: string; branchName: string; branchCode: string | null; roleCode: string }>;
  activeCashSessions: Array<{
    id: string;
    status: string;
    openedAt: string;
    openingAmount: number;
    physicalCashBoxName: string;
    branchName: string;
    branchCode: string | null;
  }>;
  cashAccessWarning: boolean;
};

type ActivitySnapshot = {
  generatedAt: string;
  summary: { online: number; idle: number; offline: number; openCashSessions: number };
  users: ActivityUser[];
};

const statusStyle: Record<ActivityUser["status"], string> = {
  ONLINE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  IDLE: "bg-amber-50 text-amber-700 border-amber-200",
  OFFLINE: "bg-slate-100 text-slate-600 border-slate-200",
};

function formatDate(value: string | null) {
  if (!value) return "Sin actividad";
  return new Intl.DateTimeFormat("es-NI", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function UserActivityPage() {
  const [snapshot, setSnapshot] = useState<ActivitySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadActivity = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch("/api/master/admin/user-activity");
      if (!response.ok) throw new Error("No fue posible cargar la actividad.");
      const payload = await response.json();
      setSnapshot(unwrapApiData(payload as ApiResponse<ActivitySnapshot>));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar la actividad.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadActivity();
  }, []);

  const users = useMemo(() => snapshot?.users ?? [], [snapshot]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[var(--color-text)]">Usuarios conectados</h2>
          <p className="text-sm text-[var(--color-text-muted)]">Presencia operativa, sucursal actual y cajas abiertas.</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={loadActivity}
          disabled={loading}
          icon={<RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />}
        >
          Actualizar
        </Button>
      </div>

      {snapshot && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]"><Activity className="h-4 w-4" /> En linea</div>
            <p className="mt-2 text-2xl font-semibold text-[var(--color-text)]">{snapshot.summary.online}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]"><Users className="h-4 w-4" /> Inactivos</div>
            <p className="mt-2 text-2xl font-semibold text-[var(--color-text)]">{snapshot.summary.idle}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]"><Users className="h-4 w-4" /> Fuera</div>
            <p className="mt-2 text-2xl font-semibold text-[var(--color-text)]">{snapshot.summary.offline}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]"><CreditCard className="h-4 w-4" /> Cajas abiertas</div>
            <p className="mt-2 text-2xl font-semibold text-[var(--color-text)]">{snapshot.summary.openCashSessions}</p>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--color-border)] text-sm">
            <thead className="bg-[var(--color-surface-alt)] text-left text-xs uppercase text-[var(--color-text-muted)]">
              <tr>
                <th className="px-4 py-3">Usuario</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Ubicacion</th>
                <th className="px-4 py-3">Caja</th>
                <th className="px-4 py-3">Ultima actividad</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {users.map((user) => (
                <tr key={user.userId} className="align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[var(--color-text)]">{user.username}</div>
                    <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                      {user.globalRole ?? (user.branchRoles.map((role) => role.roleCode).join(", ") || "Sin rol activo")}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${statusStyle[user.status]}`}>
                      {user.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)]">
                    <div>{user.branch?.name ?? "Sin sucursal activa"}</div>
                    <div className="mt-1 max-w-[18rem] truncate text-xs">{user.currentPath ?? user.currentModule ?? "Sin ruta"}</div>
                  </td>
                  <td className="px-4 py-3">
                    {user.activeCashSessions.length ? (
                      <div className="space-y-2">
                        {user.activeCashSessions.map((cashSession) => (
                          <div key={cashSession.id} className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2">
                            <div className="font-medium text-[var(--color-text)]">{cashSession.physicalCashBoxName}</div>
                            <div className="text-xs text-[var(--color-text-muted)]">{cashSession.branchName} - {cashSession.status}</div>
                          </div>
                        ))}
                        {user.cashAccessWarning && (
                          <div className="flex items-center gap-1 text-xs text-amber-700">
                            <AlertTriangle className="h-3.5 w-3.5" /> Rol de caja no activo
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-[var(--color-text-muted)]">Sin caja abierta</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)]">{formatDate(user.lastSeenAt)}</td>
                </tr>
              ))}
              {!loading && users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[var(--color-text-muted)]">
                    No hay usuarios para mostrar.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[var(--color-text-muted)]">
                    Cargando actividad...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
