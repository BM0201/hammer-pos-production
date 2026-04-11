"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Shield,
  Building2,
  Loader2,
  ToggleLeft,
  ToggleRight,
  Save,
  X,
  Users,
} from "lucide-react";

type RoleConfig = {
  id: string;
  branchId: string;
  role: string;
  enabled: boolean;
  updatedAt: string;
  updatedBy: { id: string; username: string } | null;
};

type BranchConfig = {
  branch: { id: string; code: string; name: string };
  roles: RoleConfig[];
};

const CONFIGURABLE_ROLES = [
  { code: "CASHIER", label: "Cajero", description: "Operaciones de caja y cobro" },
  { code: "WAREHOUSE", label: "Bodega", description: "Despacho e inventario" },
];

export default function RoleConfigPage() {
  const [configs, setConfigs] = useState<BranchConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const loadConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/system-admin/role-config");
      const json = await res.json();
      if (res.ok) setConfigs(json.data ?? []);
      else setNotice(json.message || "Error al cargar configuración");
    } catch {
      setNotice("Error de conexión");
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadConfigs(); }, [loadConfigs]);

  function getRoleEnabled(branchId: string, roleCode: string): boolean {
    const bc = configs.find(c => c.branch.id === branchId);
    const rc = bc?.roles.find(r => r.role === roleCode);
    return rc?.enabled ?? true; // Default to enabled if no config exists
  }

  function getRoleConfig(branchId: string, roleCode: string): RoleConfig | undefined {
    const bc = configs.find(c => c.branch.id === branchId);
    return bc?.roles.find(r => r.role === roleCode);
  }

  async function toggleRole(branchId: string, roleCode: string) {
    const current = getRoleEnabled(branchId, roleCode);
    setBusy(true);
    try {
      const res = await fetch("/api/system-admin/role-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, role: roleCode, enabled: !current }),
      });
      if (res.ok) {
        setNotice(`Rol ${roleCode} ${!current ? "habilitado" : "deshabilitado"} correctamente`);
        loadConfigs();
      } else {
        const json = await res.json();
        setNotice(json.message || "Error al actualizar");
      }
    } catch {
      setNotice("Error de conexión");
    }
    setBusy(false);
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      {/* Header */}
      <div
        className="w-full py-8 px-6"
        style={{
          background: "linear-gradient(135deg, var(--color-system-admin-500), var(--color-system-admin-700))",
        }}
      >
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3 mb-1">
            <Users className="h-7 w-7 text-white/90" />
            <h1 className="text-2xl font-bold text-white">Configuración de Roles</h1>
          </div>
          <p className="text-white/80 text-sm">
            Habilitar o deshabilitar roles específicos por sucursal
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Notice */}
        {notice && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800 flex items-center justify-between">
            <span>{notice}</span>
            <button onClick={() => setNotice("")} className="text-blue-600 hover:text-blue-800">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--color-system-admin-500)]" />
            <span className="ml-2 text-sm text-gray-500">Cargando configuración...</span>
          </div>
        ) : configs.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <Building2 className="h-12 w-12 mx-auto mb-3 text-gray-300" />
            <p className="font-semibold">No hay sucursales configuradas</p>
          </div>
        ) : (
          <div className="space-y-4">
            {configs.map(({ branch }) => (
              <div
                key={branch.id}
                className="bg-white rounded-xl shadow-sm border border-[var(--color-border)] overflow-hidden"
              >
                <div className="px-6 py-4 bg-gray-50 border-b border-[var(--color-border)]">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-[var(--color-system-admin-50)]">
                      <Building2 className="h-5 w-5" style={{ color: "var(--color-system-admin-600)" }} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{branch.name}</h3>
                      <p className="text-xs text-gray-500">Código: {branch.code}</p>
                    </div>
                  </div>
                </div>
                <div className="divide-y divide-[var(--color-border)]">
                  {CONFIGURABLE_ROLES.map((role) => {
                    const enabled = getRoleEnabled(branch.id, role.code);
                    const config = getRoleConfig(branch.id, role.code);
                    return (
                      <div key={role.code} className="px-6 py-4 flex items-center justify-between">
                        <div>
                          <p className="font-medium text-gray-900">{role.label}</p>
                          <p className="text-sm text-gray-500">{role.description}</p>
                          {config && (
                            <p className="text-xs text-gray-400 mt-1">
                              Última actualización: {new Date(config.updatedAt).toLocaleString()}
                              {config.updatedBy && ` por ${config.updatedBy.username}`}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => toggleRole(branch.id, role.code)}
                          disabled={busy}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors hover:bg-gray-50"
                        >
                          {enabled ? (
                            <>
                              <ToggleRight className="h-7 w-7 text-green-600" />
                              <span className="text-sm font-semibold text-green-700">Habilitado</span>
                            </>
                          ) : (
                            <>
                              <ToggleLeft className="h-7 w-7 text-gray-400" />
                              <span className="text-sm font-semibold text-gray-500">Deshabilitado</span>
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Info */}
        <div className="rounded-xl border-l-4 p-4" style={{ borderColor: "var(--color-system-admin-500)", background: "var(--color-system-admin-50)" }}>
          <div className="flex items-start gap-3">
            <Shield className="h-5 w-5 mt-0.5 flex-shrink-0" style={{ color: "var(--color-system-admin-600)" }} />
            <div>
              <p className="font-semibold text-sm" style={{ color: "var(--color-system-admin-800)" }}>Sobre la configuración de roles</p>
              <p className="text-sm mt-1" style={{ color: "var(--color-system-admin-700)" }}>
                Deshabilitar un rol impide que se asignen nuevos usuarios con ese rol en la sucursal.
                Los usuarios existentes mantienen su acceso hasta que se les reasigne.
                Esta configuración solo puede ser modificada por SYSTEM_ADMIN.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
