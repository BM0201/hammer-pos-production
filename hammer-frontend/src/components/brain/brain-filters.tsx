"use client";

export type BrainFilterState = {
  branchId: string;
  category: string;
  severity: string;
  status: string;
  search: string;
  productId: string;
  targetUserId: string;
  days: string;
  sort: string;
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

export function BrainFilters({ filters, branches, onChange }: BrainFiltersProps) {
  function setValue(key: keyof BrainFilterState, value: string) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <div className="hm-toolbar grid gap-3 md:grid-cols-3 xl:grid-cols-8">
      <label className="space-y-1 text-xs font-semibold text-[var(--color-text-muted)] md:col-span-2">
        Buscar
        <input className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-normal text-[var(--color-text)]" value={filters.search} onChange={(event) => setValue("search", event.target.value)} placeholder="Titulo, evidencia o recomendacion" />
      </label>

      <label className="space-y-1 text-xs font-semibold text-[var(--color-text-muted)]">
        Sucursal
        <select className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-normal text-[var(--color-text)]" value={filters.branchId} onChange={(event) => setValue("branchId", event.target.value)}>
          <option value="">Todas</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>{branch.code} - {branch.name}</option>
          ))}
        </select>
      </label>

      <label className="space-y-1 text-xs font-semibold text-[var(--color-text-muted)]">
        Categoria
        <select className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-normal text-[var(--color-text)]" value={filters.category} onChange={(event) => setValue("category", event.target.value)}>
          <option value="">Todas</option>
          {categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
      </label>

      <label className="space-y-1 text-xs font-semibold text-[var(--color-text-muted)]">
        Severidad
        <select className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-normal text-[var(--color-text)]" value={filters.severity} onChange={(event) => setValue("severity", event.target.value)}>
          <option value="">Todas</option>
          {severities.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
        </select>
      </label>

      <label className="space-y-1 text-xs font-semibold text-[var(--color-text-muted)]">
        Estado
        <select className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-normal text-[var(--color-text)]" value={filters.status} onChange={(event) => setValue("status", event.target.value)}>
          <option value="">Todos</option>
          {statuses.map((status) => <option key={status} value={status}>{statusLabels[status] ?? status}</option>)}
        </select>
      </label>

      <label className="space-y-1 text-xs font-semibold text-[var(--color-text-muted)]">
        Producto ID
        <input className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-normal text-[var(--color-text)]" value={filters.productId} onChange={(event) => setValue("productId", event.target.value)} placeholder="Opcional" />
      </label>

      <label className="space-y-1 text-xs font-semibold text-[var(--color-text-muted)]">
        Usuario ID
        <input className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-normal text-[var(--color-text)]" value={filters.targetUserId} onChange={(event) => setValue("targetUserId", event.target.value)} placeholder="Opcional" />
      </label>

      <label className="space-y-1 text-xs font-semibold text-[var(--color-text-muted)]">
        Periodo
        <select className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-normal text-[var(--color-text)]" value={filters.days} onChange={(event) => setValue("days", event.target.value)}>
          <option value="7">7 dias</option>
          <option value="30">30 dias</option>
          <option value="60">60 dias</option>
          <option value="90">90 dias</option>
        </select>
      </label>

      <label className="space-y-1 text-xs font-semibold text-[var(--color-text-muted)]">
        Orden
        <select className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-normal text-[var(--color-text)]" value={filters.sort} onChange={(event) => setValue("sort", event.target.value)}>
          <option value="priority">Prioridad</option>
          <option value="date">Fecha</option>
          <option value="impact">Impacto</option>
        </select>
      </label>
    </div>
  );
}
