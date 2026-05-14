"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
import { apiFetch } from "@/lib/client/api";
  Shield,
  Settings,
  Users,
  Building2,
  Activity,
  ChevronRight,
  Loader2,
} from "lucide-react";

type Stats = {
  branches: number;
  users: number;
  activeDiscounts: number;
  roleConfigs: number;
};

export default function SystemAdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [branchRes, roleRes] = await Promise.all([
          apiFetch("/api/branches"),
          apiFetch("/api/system-admin/role-config"),
        ]);
        const branchJson = await branchRes.json();
        const roleJson = await roleRes.json();
        setStats({
          branches: branchJson.data?.length ?? 0,
          users: 0,
          activeDiscounts: 0,
          roleConfigs: roleJson.data?.reduce((sum: number, b: { roles: unknown[] }) => sum + b.roles.length, 0) ?? 0,
        });
      } catch { /* ignore */ }
      setLoading(false);
    }
    load();
  }, []);

  const cards = [
    {
      title: "Configuración de Roles",
      description: "Habilitar/deshabilitar roles por sucursal",
      href: "/app/system-admin/role-config",
      icon: Users,
      color: "var(--color-system-admin-500)",
      bgColor: "var(--color-system-admin-50)",
    },
    {
      title: "Configuraciones del Sistema",
      description: "Parámetros globales y ajustes sensibles",
      href: "/app/system-admin/settings",
      icon: Settings,
      color: "var(--color-system-admin-500)",
      bgColor: "var(--color-system-admin-50)",
    },
    {
      title: "Gestión Master",
      description: "Acceder al panel Master completo",
      href: "/app/master",
      icon: Building2,
      color: "var(--color-master-500)",
      bgColor: "var(--color-master-50)",
    },
  ];

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
            <Shield className="h-7 w-7 text-white/90" />
            <h1 className="text-2xl font-bold text-white">System Admin</h1>
          </div>
          <p className="text-white/80 text-sm">
            Panel de administración del sistema — configuraciones sensibles y control de roles
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Stats */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--color-system-admin-500)]" />
          </div>
        ) : stats && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-[var(--color-border)] p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg" style={{ background: "var(--color-system-admin-50)" }}>
                  <Building2 className="h-5 w-5" style={{ color: "var(--color-system-admin-600)" }} />
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Sucursales</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.branches}</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-[var(--color-border)] p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg" style={{ background: "var(--color-system-admin-50)" }}>
                  <Settings className="h-5 w-5" style={{ color: "var(--color-system-admin-600)" }} />
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Configs de Rol</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.roleConfigs}</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-[var(--color-border)] p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg" style={{ background: "var(--color-system-admin-50)" }}>
                  <Activity className="h-5 w-5" style={{ color: "var(--color-system-admin-600)" }} />
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Estado</p>
                  <p className="text-sm font-semibold text-green-600">Operativo</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-[var(--color-border)] p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg" style={{ background: "var(--color-system-admin-50)" }}>
                  <Shield className="h-5 w-5" style={{ color: "var(--color-system-admin-600)" }} />
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Versión</p>
                  <p className="text-sm font-semibold text-gray-900">v3.0 · FASE 2</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Navigation Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.href}
                href={card.href as any}
                className="group bg-white rounded-xl border border-[var(--color-border)] p-6 hover:shadow-md transition-all"
              >
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-xl" style={{ background: card.bgColor }}>
                    <Icon className="h-6 w-6" style={{ color: card.color }} />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 group-hover:text-[var(--color-system-admin-600)] transition-colors">
                      {card.title}
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">{card.description}</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-gray-300 group-hover:text-[var(--color-system-admin-500)] transition-colors mt-1" />
                </div>
              </Link>
            );
          })}
        </div>

        {/* Security Notice */}
        <div className="rounded-xl border-l-4 p-4" style={{ borderColor: "var(--color-system-admin-500)", background: "var(--color-system-admin-50)" }}>
          <div className="flex items-start gap-3">
            <Shield className="h-5 w-5 mt-0.5 flex-shrink-0" style={{ color: "var(--color-system-admin-600)" }} />
            <div>
              <p className="font-semibold text-sm" style={{ color: "var(--color-system-admin-800)" }}>Acceso Restringido</p>
              <p className="text-sm mt-1" style={{ color: "var(--color-system-admin-700)" }}>
                Este panel es exclusivo para administradores del sistema. Todas las acciones se registran en la auditoría.
                Se recomienda habilitar autenticación de dos factores (MFA) en futuras versiones.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
