"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, Filter, Search, X } from "lucide-react";

export type BrainFilterState = {
  branchId: string;
  category: string;
  severity: string;
  status: string;
  search: string;
  productId: string;
  targetUserId: string;
  actionType: string;
  days: string;
  sort: string;
  onlyCritical: string;
  onlyActionable: string;
  onlyWithImpact: string;
  onlyPendingApproval: string;
  onlyPricing: string;
  onlyInventory: string;
  onlyCash: string;
  onlyPurchasing: string;
  onlyTransfers: string;
  onlyConfiguration: string;
  onlyPricingMisconfiguration: string;
};

type BranchOption = {
  id: string;
  code: string;
  name: string;
};

type BrainFiltersProps = {
  filters: BrainFilterState;
  branches: BranchOption[];
  onChange: (filters: BrainFilterState) => void;
  onReset?: () => void;
};

const categories = ["INVENTORY", "REORDER", "PRICING", "CASH", "SALES", "DISPATCH", "PURCHASING", "PRODUCTION", "SECURITY", "AUDIT", "SYSTEM"];
const severities = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
const statuses = ["OPEN", "APPROVED", "MANUAL_REVIEW", "EXECUTING", "EXECUTED", "DISMISSED", "SNOOZED", "EXPIRED", "FAILED"];

const statusLabels: Record<string, string> = {
  OPEN: "Abiertas",
  APPROVED: "Aprobadas",
  MANUAL_REVIEW: "Revision manual",
  EXECUTING: "Ejecutando",
  EXECUTED: "Ejecutadas",
  DISMISSED: "Descartadas",
  SNOOZED: "Pospuestas",
  EXPIRED: "Expiradas",
  FAILED: "Fallidas",
};

const advancedFilters: Array<{ key: keyof BrainFilterState; label: string }> = [
  { key: "onlyCritical", label: "Solo criticas" },
  { key: "onlyActionable", label: "Solo accionables" },
  { key: "onlyWithImpact", label: "Con impacto economico" },
  { key: "onlyPendingApproval", label: "Pendientes de aprobacion" },
  { key: "onlyPricing", label: "Solo pricing" },
  { key: "onlyInventory", label: "Solo inventario" },
  { key: "onlyCash", label: "Solo caja" },
  { key: "onlyPurchasing", label: "Solo compras" },
  { key: "onlyTransfers", label: "Solo traslados" },
  { key: "onlyConfiguration", label: "Solo configuracion" },
  { key: "onlyPricingMisconfiguration", label: "Mala configuracion de pricing" },
];

export function BrainFilters({ filters, branches, onChange, onReset }: BrainFiltersProps) {
  const [showMore, setShowMore] = useState(false);

  function setValue(key: keyof BrainFilterState, value: string) {
    onChange({ ...filters, [key]: value });
  }

  function toggle(key: keyof BrainFilterState) {
    setValue(key, filters[key] === "true" ? "" : "true");
  }

  const activeAdvanced = advancedFilters.filter((filter) => filters[filter.key] === "true").length;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200/60">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="rounded-xl bg-slate-100 p-2 text-slate-600">
            <Filter className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-extrabold text-slate-950">Filtros del Brain</h2>
            <p className="text-xs text-slate-500">Combina busqueda, estado operativo y categoria.</p>
          </div>
        </div>
        <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50" onClick={onReset}>
          <X className="h-3.5 w-3.5" />
          Limpiar
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-12">
        <label className="space-y-1 text-xs font-bold text-slate-500 md:col-span-3 xl:col-span-4">
          Busqueda
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm font-normal text-slate-900 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100" value={filters.search} onChange={(event) => setValue("search", event.target.value)} placeholder="Titulo, SKU, producto, evidencia, sucursal..." />
          </div>
        </label>

        <Select label="Sucursal" value={filters.branchId} onChange={(value) => setValue("branchId", value)} span="xl:col-span-2">
          <option value="">Todas</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>{branch.code} - {branch.name}</option>
          ))}
        </Select>

        <Select label="Categoria" value={filters.category} onChange={(value) => setValue("category", value)} span="xl:col-span-2">
          <option value="">Todas</option>
          {categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </Select>

        <Select label="Severidad" value={filters.severity} onChange={(value) => setValue("severity", value)} span="xl:col-span-2">
          <option value="">Todas</option>
          {severities.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
        </Select>

        <Select label="Estado" value={filters.status} onChange={(value) => setValue("status", value)} span="xl:col-span-2">
          <option value="">Todos</option>
          {statuses.map((status) => <option key={status} value={status}>{statusLabels[status] ?? status}</option>)}
        </Select>

        <label className="space-y-1 text-xs font-bold text-slate-500 xl:col-span-2">
          Tipo de decision
          <input className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-900 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100" value={filters.actionType} onChange={(event) => setValue("actionType", event.target.value)} placeholder="Ej. REVIEW_PRICE" />
        </label>

        <label className="space-y-1 text-xs font-bold text-slate-500 xl:col-span-2">
          Producto/SKU
          <input className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-900 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100" value={filters.productId} onChange={(event) => setValue("productId", event.target.value)} placeholder="ID producto" />
        </label>

        <label className="space-y-1 text-xs font-bold text-slate-500 xl:col-span-2">
          Usuario
          <input className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-900 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100" value={filters.targetUserId} onChange={(event) => setValue("targetUserId", event.target.value)} placeholder="ID usuario" />
        </label>

        <Select label="Periodo" value={filters.days} onChange={(value) => setValue("days", value)} span="xl:col-span-2">
          <option value="7">7 dias</option>
          <option value="30">30 dias</option>
          <option value="60">60 dias</option>
          <option value="90">90 dias</option>
        </Select>

        <Select label="Orden" value={filters.sort} onChange={(value) => setValue("sort", value)} span="xl:col-span-2">
          <option value="priority">Prioridad</option>
          <option value="severity">Severidad</option>
          <option value="impact">Impacto economico</option>
          <option value="newest">Fecha mas reciente</option>
          <option value="oldest">Fecha mas antigua</option>
          <option value="branch">Sucursal</option>
          <option value="category">Categoria</option>
        </Select>
      </div>

      <button type="button" className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-100" onClick={() => setShowMore((value) => !value)}>
        <ChevronDown className={`h-3.5 w-3.5 transition ${showMore ? "rotate-180" : ""}`} />
        Mas filtros {activeAdvanced ? `(${activeAdvanced})` : ""}
      </button>

      {showMore ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          {advancedFilters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${filters[filter.key] === "true" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
              onClick={() => toggle(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Select({ label, value, onChange, children, span }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode; span?: string }) {
  return (
    <label className={`space-y-1 text-xs font-bold text-slate-500 ${span ?? ""}`}>
      {label}
      <select className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-900 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100" value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}
