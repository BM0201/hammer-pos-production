"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Settings,
  Shield,
  Loader2,
  Plus,
  Save,
  X,
  Edit2,
  Trash2,
} from "lucide-react";
import { apiFetch } from "@/lib/client/api";

type SystemSetting = {
  id: string;
  key: string;
  value: string;
  updatedAt: string;
  updatedByUserId: string | null;
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [editKey, setEditKey] = useState("");
  const [editValue, setEditValue] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/system-admin/settings");
      const json = await res.json();
      if (res.ok) setSettings(json.data ?? []);
      else setNotice(json.message || "Error al cargar");
    } catch {
      setNotice("Error de conexión");
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  async function handleSave(key: string, value: string) {
    setBusy(true);
    try {
      const res = await apiFetch("/api/system-admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      if (res.ok) {
        setNotice(`Configuración '${key}' guardada`);
        setEditKey("");
        loadSettings();
      } else {
        const json = await res.json();
        setNotice(json.message || "Error al guardar");
      }
    } catch {
      setNotice("Error de conexión");
    }
    setBusy(false);
  }

  async function handleAddNew() {
    if (!newKey || !newValue) {
      setNotice("Clave y valor son requeridos");
      return;
    }
    await handleSave(newKey, newValue);
    setNewKey("");
    setNewValue("");
    setShowAdd(false);
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
            <Settings className="h-7 w-7 text-white/90" />
            <h1 className="text-2xl font-bold text-white">Configuraciones del Sistema</h1>
          </div>
          <p className="text-white/80 text-sm">
            Parámetros globales del sistema — solo modificables por System Admin
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

        {/* Add new */}
        <div className="flex items-center justify-end">
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white"
            style={{ background: "var(--color-system-admin-600)" }}
          >
            <Plus className="h-4 w-4" /> Nueva Configuración
          </button>
        </div>

        {showAdd && (
          <div className="bg-white rounded-xl border border-[var(--color-border)] p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Clave</label>
                <input
                  type="text"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm"
                  placeholder="ej: system.maintenance_mode"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Valor</label>
                <input
                  type="text"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm"
                  placeholder="ej: false"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAddNew}
                  disabled={busy}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white"
                  style={{ background: "var(--color-system-admin-600)" }}
                >
                  <Save className="h-4 w-4" /> Guardar
                </button>
                <button
                  onClick={() => setShowAdd(false)}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Settings table */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--color-system-admin-500)]" />
            <span className="ml-2 text-sm text-gray-500">Cargando configuraciones...</span>
          </div>
        ) : settings.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <Settings className="h-12 w-12 mx-auto mb-3 text-gray-300" />
            <p className="font-semibold">No hay configuraciones</p>
            <p className="text-sm mt-1">Agrega una usando el botón superior</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-[var(--color-border)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-[var(--color-border)]">
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Clave</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Valor</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Última Actualización</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-700">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {settings.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs font-medium text-gray-900">{s.key}</td>
                    <td className="px-4 py-3">
                      {editKey === s.key ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="px-2 py-1 rounded border border-[var(--color-border)] text-sm flex-1"
                            autoFocus
                          />
                          <button
                            onClick={() => handleSave(s.key, editValue)}
                            disabled={busy}
                            className="p-1 rounded text-green-600 hover:bg-green-50"
                          >
                            <Save className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setEditKey("")}
                            className="p-1 rounded text-gray-400 hover:bg-gray-100"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-gray-700">{s.value}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(s.updatedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editKey !== s.key && (
                        <button
                          onClick={() => { setEditKey(s.key); setEditValue(s.value); }}
                          className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600"
                          title="Editar"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Security notice */}
        <div className="rounded-xl border-l-4 p-4" style={{ borderColor: "var(--color-system-admin-500)", background: "var(--color-system-admin-50)" }}>
          <div className="flex items-start gap-3">
            <Shield className="h-5 w-5 mt-0.5 flex-shrink-0" style={{ color: "var(--color-system-admin-600)" }} />
            <div>
              <p className="font-semibold text-sm" style={{ color: "var(--color-system-admin-800)" }}>Precaución</p>
              <p className="text-sm mt-1" style={{ color: "var(--color-system-admin-700)" }}>
                Los cambios en las configuraciones del sistema afectan a todas las sucursales y usuarios.
                Todos los cambios se registran en la auditoría del sistema.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
