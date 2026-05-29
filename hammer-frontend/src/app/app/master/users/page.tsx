"use client";

import { UsersAdmin } from "@/components/users/users-admin";
import { EmployeeManager } from "@/components/payroll/employee-manager";
import { Users, UserCheck } from "lucide-react";

export default function MasterUsersPage() {
  return (
    <section className="space-y-8">
      {/* ── Header ── */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div
            className="h-8 w-1 rounded-full"
            style={{
              background: "linear-gradient(to bottom, var(--color-master-400), var(--color-master-600))",
            }}
          />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">
              Personal & Roles
            </h1>
            <p className="text-sm text-[var(--color-text-muted)]">
              Gestión integral de usuarios, roles por sucursal, empleados y nómina
            </p>
          </div>
        </div>
      </div>

      <div className="hm-alert hm-alert-info">
        <div>
          <strong>Flujo integrado:</strong> Administre usuarios del sistema con sus roles y membresías,
          y gestione empleados con cálculo de nómina prorrateada. Al crear personal puede asignar rol
          opcional (ej: encargado de bodega) y designar su forma de pago.
        </div>
      </div>

      {/* ── Usuarios & Roles ── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="hm-section-icon hm-section-icon-master">
            <Users className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">Usuarios & Roles</h2>
            <p className="text-xs text-[var(--color-text-muted)]">Administración de usuarios, membresías por sucursal y permisos</p>
          </div>
        </div>
        <UsersAdmin />
      </div>

      {/* ── Nómina & Empleados ── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="hm-section-icon hm-section-icon-master">
            <UserCheck className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">Personal & Nómina</h2>
            <p className="text-xs text-[var(--color-text-muted)]">Registro de empleados, salarios prorrateados y sincronización con gastos operativos</p>
          </div>
        </div>
        <EmployeeManager />
      </div>
    </section>
  );
}
