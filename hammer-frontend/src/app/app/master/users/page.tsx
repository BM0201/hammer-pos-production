"use client";

import { useState } from "react";
import { UsersAdmin } from "@/components/users/users-admin";
import { EmployeeManager } from "@/components/payroll/employee-manager";
import { Users, UserCheck } from "lucide-react";

type Tab = "users" | "employees";

export default function MasterUsersPage() {
  const [tab, setTab] = useState<Tab>("users");

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <div
          className="h-8 w-1 rounded-full flex-shrink-0"
          style={{ background: "linear-gradient(to bottom, var(--color-master-400), var(--color-master-600))" }}
        />
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Personal & Roles</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Gestión integral de usuarios, roles por sucursal, empleados y nómina
          </p>
        </div>
      </div>

      <div className="erp-tabs-pill">
        <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>
          <Users className="h-3.5 w-3.5" />
          Usuarios & Roles
        </button>
        <button className={tab === "employees" ? "active" : ""} onClick={() => setTab("employees")}>
          <UserCheck className="h-3.5 w-3.5" />
          Personal & Nómina
        </button>
      </div>

      {tab === "users" && <UsersAdmin />}
      {tab === "employees" && <EmployeeManager />}
    </section>
  );
}
