"use client";

import { useState } from "react";
import { UsersAdmin } from "@/components/users/users-admin";
import { EmployeeManager } from "@/components/payroll/employee-manager";
import { Users, UserCheck } from "lucide-react";

type Tab = "users" | "employees";

export default function MasterUsersPage() {
  const [tab, setTab] = useState<Tab>("users");

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[1.1875rem] font-bold tracking-[-0.02em] text-[var(--color-text)]">
          RRHH
        </h1>
        <div className="erp-tabs-pill">
          <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>
            <Users className="h-3.5 w-3.5" />
            Usuarios & Roles
          </button>
          <button className={tab === "employees" ? "active" : ""} onClick={() => setTab("employees")}>
            <UserCheck className="h-3.5 w-3.5" />
            Trabajadores
          </button>
        </div>
      </div>
      <p className="-mt-2 text-[0.78125rem] text-[var(--color-text-muted)]">
        Usuarios, roles, trabajadores y asistencia por sucursal
      </p>

      {tab === "users" && <UsersAdmin />}
      {tab === "employees" && <EmployeeManager />}
    </section>
  );
}
