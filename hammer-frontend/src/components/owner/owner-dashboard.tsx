"use client";

import { useEffect, useState } from "react";
import { unwrapApiData } from "@/lib/client/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Building2,
  Settings2,
  ShoppingCart,
  CreditCard,
  Package,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import Link from "next/link";

type BranchConfig = {
  branchId: string;
  enableCashier: boolean;
  enableDispatch: boolean;
  branch: { id: string; code: string; name: string; isActive: boolean };
};

function describeWorkflow(enableCashier: boolean, enableDispatch: boolean): string {
  if (enableCashier && enableDispatch) return "Completo: Venta \u2192 Caja \u2192 Despacho";
  if (enableCashier && !enableDispatch) return "Sin despacho: Venta \u2192 Caja \u2192 Entregado";
  if (!enableCashier && enableDispatch) return "Sin caja: Venta+Cobro \u2192 Despacho";
  return "Directo: Venta+Cobro+Entrega";
}

export function OwnerDashboard() {
  const [configs, setConfigs] = useState<BranchConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/branch-config")
      .then((r) => r.json())
      .then((raw: unknown) => {
        const data = unwrapApiData(raw);
        setConfigs(Array.isArray(data) ? data : []);
      })
      .catch(() => setConfigs([]))
      .finally(() => setLoading(false));
  }, []);

  const totalBranches = configs?.length ?? 0;
  const customFlows = (configs ?? []).filter((c: BranchConfig) => !c?.enableCashier || !c?.enableDispatch)?.length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--color-text)]">Panel de Propietario</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          Administre la configuracion de modulos y flujos de trabajo de cada sucursal.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[var(--color-owner-100)]">
              <Building2 className="h-5 w-5" style={{ color: "var(--color-owner-600)" }} />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--color-text)]">{totalBranches}</p>
              <p className="text-xs text-[var(--color-text-muted)]">Sucursales activas</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[var(--color-owner-100)]">
              <Settings2 className="h-5 w-5" style={{ color: "var(--color-owner-600)" }} />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--color-text)]">{customFlows}</p>
              <p className="text-xs text-[var(--color-text-muted)]">Flujos personalizados</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-100">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--color-text)]">{totalBranches - customFlows}</p>
              <p className="text-xs text-[var(--color-text-muted)]">Flujo completo</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Branch Overview */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-[var(--color-text)]">Sucursales y Modulos</h2>
          <Link href="/app/owner/module-config">
            <Button variant="primary" size="sm" icon={<Settings2 className="h-4 w-4" />}>
              Configurar modulos
            </Button>
          </Link>
        </div>

        {loading ? (
          <p className="text-sm text-[var(--color-text-muted)] py-8 text-center">Cargando...</p>
        ) : (configs?.length ?? 0) === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)] py-8 text-center">No hay sucursales configuradas.</p>
        ) : (
          <div className="space-y-3">
            {(configs ?? []).map((cfg: BranchConfig) => (
              <div
                key={cfg?.branchId ?? ""}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-[var(--color-surface-alt)] hover:shadow-sm transition-shadow"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-[var(--color-owner-100)]">
                    <Building2 className="h-4 w-4" style={{ color: "var(--color-owner-600)" }} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-text)]">{cfg?.branch?.name ?? ""}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">{describeWorkflow(cfg?.enableCashier ?? true, cfg?.enableDispatch ?? true)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={cfg?.enableCashier ? "success" : "warning"}>
                    <CreditCard className="h-3 w-3 mr-1" />
                    Caja: {cfg?.enableCashier ? "Activa" : "Desactivada"}
                  </Badge>
                  <Badge variant={cfg?.enableDispatch ? "success" : "warning"}>
                    <Package className="h-3 w-3 mr-1" />
                    Despacho: {cfg?.enableDispatch ? "Activo" : "Desactivado"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Quick Links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link href="/app/master">
          <Card className="p-4 hover:shadow-md transition-shadow cursor-pointer">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ShoppingCart className="h-5 w-5 text-[var(--color-master-600)]" />
                <div>
                  <p className="text-sm font-semibold text-[var(--color-text)]">Panel Master</p>
                  <p className="text-xs text-[var(--color-text-muted)]">Operaciones, inventario, ventas</p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-[var(--color-text-muted)]" />
            </div>
          </Card>
        </Link>
        <Link href="/app/owner/module-config">
          <Card className="p-4 hover:shadow-md transition-shadow cursor-pointer">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Settings2 className="h-5 w-5" style={{ color: "var(--color-owner-600)" }} />
                <div>
                  <p className="text-sm font-semibold text-[var(--color-text)]">Config. de Modulos</p>
                  <p className="text-xs text-[var(--color-text-muted)]">Activar/desactivar caja y despacho</p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-[var(--color-text-muted)]" />
            </div>
          </Card>
        </Link>
      </div>
    </div>
  );
}
