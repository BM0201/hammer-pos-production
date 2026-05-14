"use client";

import { ExpenseManager } from "@/components/expenses/expense-manager";

export default function MasterExpensesPage() {
  return (
    <section className="space-y-6">
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
              Gastos Operativos & Precios
            </h1>
            <p className="text-sm text-[var(--color-text-muted)]">
              Gestión de gastos, configuración de márgenes y cálculo de precios sugeridos por sucursal
            </p>
          </div>
        </div>
      </div>

      <div className="hm-alert hm-alert-info">
        <div>
          Módulo operativo para registrar gastos fijos mensuales por sucursal, configurar márgenes de
          utilidad y calcular automáticamente el precio de venta sugerido de cada producto.
        </div>
      </div>

      <ExpenseManager />
    </section>
  );
}
