"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Package,
  Warehouse,
  ArrowLeftRight,
  DollarSign,
  Brain,
  ClipboardList,
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart3,
  Calendar,
  Building2,
  Tag,
  Activity,
  Filter,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { money, qty, fmtDateTime } from "@/lib/format";

/* ── Types ── */
type Branch = { id: string; code: string; name: string };
type ProductDetail = {
  product: {
    id: string;
    sku: string;
    name: string;
    unit: string;
    isActive: boolean;
    standardSalePrice: string;
    category?: { name: string };
    inventoryBalances: Array<{
      id: string;
      quantityOnHand: string;
      weightedAverageCost: string;
      inventoryValue: string;
      branch: Branch;
    }>;
    inventoryMovements: Array<{
      id: string;
      createdAt: string;
      movementType: string;
      quantity: string;
      unitCost: string;
      referenceType: string;
      referenceId: string;
      branch: Branch;
    }>;
    branchProductSettings: Array<{
      id: string;
      isAvailable: boolean;
      branchCost?: string | null;
      branchPrice?: string | null;
      branch: Branch;
    }>;
    reorderPolicies: Array<{
      id: string;
      minQuantity: string;
      reorderPoint: string;
      targetQuantity: string;
      branch: Branch;
    }>;
    brainDecisions: Array<{
      id: string;
      createdAt: string;
      status: string;
      severity: string;
      category: string;
      title: string;
      branch?: Branch | null;
    }>;
  };
  auditLogs: Array<{
    id: string;
    occurredAt: string;
    module: string;
    action: string;
    entityType: string;
    actor?: { username: string; fullName?: string | null } | null;
    branch?: Branch | null;
  }>;
};
type KardexMovement = ProductDetail["product"]["inventoryMovements"][number] & {
  notes?: string | null;
  product?: { id: string; sku: string; name: string };
};
type MovementPagination = { page: number; limit: number; total: number; totalPages: number };

type Tab = "general" | "stock" | "movements" | "pricing" | "brain" | "audit";

/* ── Movement type label + color ── */
function movementLabel(type: string) {
  const map: Record<string, { label: string; color: "success" | "danger" | "warning" | "info" | "neutral" }> = {
    PURCHASE_IN: { label: "Compra / entrada", color: "success" },
    SALE_OUT: { label: "Venta / salida", color: "danger" },
    ADJUSTMENT_IN: { label: "Ajuste entrada", color: "success" },
    ADJUSTMENT_OUT: { label: "Ajuste salida", color: "danger" },
    RETURN_IN: { label: "Devolucion entrada", color: "success" },
    RETURN_OUT: { label: "Devolucion salida", color: "danger" },
    TRANSFER_IN: { label: "Transfer. Entrada", color: "success" },
    TRANSFER_OUT: { label: "Transfer. Salida", color: "warning" },
    TIMBER_INTAKE_IN: { label: "Entrada madera", color: "info" },
    PURCHASE: { label: "Compra", color: "success" },
    SALE: { label: "Venta", color: "danger" },
    ADJUSTMENT_ADD: { label: "Ajuste (+)", color: "success" },
    ADJUSTMENT_SUBTRACT: { label: "Ajuste (−)", color: "danger" },
    IMPORT: { label: "Importación", color: "info" },
    PRODUCTION: { label: "Producción", color: "info" },
    INITIAL_STOCK: { label: "Stock Inicial", color: "info" },
    PHYSICAL_COUNT: { label: "Conteo Físico", color: "warning" },
  };
  return map[type] ?? { label: type, color: "neutral" as const };
}

function MovementIcon({ type }: { type: string }) {
  if (isOutboundMovement(type))
    return <TrendingDown className="h-4 w-4 text-red-500" />;
  if (isInboundMovement(type))
    return <TrendingUp className="h-4 w-4 text-emerald-500" />;
  return <Minus className="h-4 w-4 text-slate-400" />;
}

function isInboundMovement(type: string) {
  return (
    type.endsWith("_IN") ||
    type.includes("ADD") ||
    type === "PURCHASE" ||
    type === "INITIAL_STOCK" ||
    type === "IMPORT" ||
    type === "PRODUCTION"
  );
}

function isOutboundMovement(type: string) {
  return type.endsWith("_OUT") || type.includes("SUBTRACT") || type === "SALE";
}

/* ── Tab config ── */
const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "general", label: "Resumen", icon: Package },
  { id: "stock", label: "Existencias", icon: Warehouse },
  { id: "movements", label: "Kardex / Movimientos", icon: ArrowLeftRight },
  { id: "pricing", label: "Precios y Costos", icon: DollarSign },
  { id: "brain", label: "Brain", icon: Brain },
  { id: "audit", label: "Auditoría", icon: ClipboardList },
];

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ── Main Component ── */
/* ═══════════════════════════════════════════════════════════════════════════ */
export function Product360({ productId }: { productId: string }) {
  const [data, setData] = useState<ProductDetail | null>(null);
  const [tab, setTab] = useState<Tab>("general");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/master/catalog-inventory/products/${productId}`, { cache: "no-store" })
      .then(async (response) => {
        const raw = await response.json();
        if (!response.ok) throw new Error(raw.message ?? "No se pudo cargar el producto.");
        setData(raw.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo cargar el producto."));
  }, [productId]);

  /* ── Loading / Error states ── */
  if (error) {
    return (
      <Card className="p-8 text-center">
        <AlertTriangle className="h-10 w-10 mx-auto text-red-500 mb-3" />
        <p className="text-sm font-semibold text-[var(--color-danger-700)]">{error}</p>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card className="p-8 text-center">
        <div className="h-8 w-8 mx-auto mb-3 animate-spin rounded-full border-4 border-[var(--color-border)] border-t-[var(--color-info-600)]" />
        <p className="text-sm text-[var(--color-text-muted)]">Cargando Producto 360…</p>
      </Card>
    );
  }

  const product = data.product;
  const totalStock = product.inventoryBalances.reduce((s, i) => s + Number(i.quantityOnHand), 0);
  const totalValue = product.inventoryBalances.reduce((s, i) => s + Number(i.inventoryValue), 0);

  return (
    <section className="space-y-6 animate-fade-in-up">
      {/* ── Breadcrumb + Header ── */}
      <div>
        <Link
          href={"/app/master/catalog-inventory" as Route}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-info-600)] hover:text-[var(--color-info-700)] transition-colors mb-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Volver al Catálogo
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text)] flex items-center gap-2">
              <Package className="h-6 w-6 text-[var(--color-master-600)]" />
              {product.sku} · {product.name}
            </h1>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1 flex items-center gap-2">
              <Tag className="h-3.5 w-3.5" />
              {product.category?.name ?? "Sin categoría"} · {product.unit}
            </p>
          </div>
          <Badge variant={product.isActive ? "success" : "warning"}>
            {product.isActive ? "Activo" : "Inactivo"}
          </Badge>
        </div>
      </div>

      {/* ── Tab Bar ── */}
      <div className="flex gap-1 overflow-x-auto border-b-2 border-[var(--color-border)] pb-0">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`
              inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold whitespace-nowrap
              border-b-2 -mb-[2px] transition-all
              ${
                tab === id
                  ? "border-[var(--color-master-600)] text-[var(--color-master-700)] bg-[var(--color-master-50)]"
                  : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-alt)]"
              }
              rounded-t-lg
            `}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ═══ GENERAL TAB ═══ */}
      {tab === "general" && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiMini icon={Warehouse} label="Stock Total" value={qty(totalStock)} accent="emerald" />
            <KpiMini icon={DollarSign} label="Precio Base" value={money(product.standardSalePrice)} accent="blue" />
            <KpiMini icon={Building2} label="Sucursales con stock" value={String(product.inventoryBalances.length)} accent="indigo" />
            <KpiMini icon={Activity} label="Movimientos recientes" value={String(product.inventoryMovements.length)} accent="amber" />
          </div>
          {totalValue > 0 && (
            <Card className="p-4 bg-gradient-to-r from-slate-50 to-white dark:from-slate-900/50 dark:to-[var(--color-surface)]">
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1">
                <BarChart3 className="h-3.5 w-3.5 inline mr-1" />
                Valor Total en Inventario
              </p>
              <p className="text-3xl font-extrabold text-[var(--color-text)]">{money(totalValue)}</p>
            </Card>
          )}
        </div>
      )}

      {/* ═══ STOCK TAB ═══ */}
      {tab === "stock" && (
        <div className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden shadow-sm">
          <div className="hm-card-header-blue px-5 py-3 flex items-center gap-2">
            <Warehouse className="h-5 w-5" />
            <h2 className="font-semibold">Existencias por Sucursal</h2>
          </div>
          {product.inventoryBalances.length === 0 ? (
            <div className="p-8 text-center">
              <Warehouse className="h-10 w-10 mx-auto mb-3 text-[var(--color-text-muted)]" />
              <p className="text-sm font-medium text-[var(--color-text-secondary)]">Sin existencias registradas</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="hm-table">
                <thead>
                  <tr>
                    <th>Sucursal</th>
                    <th className="text-right">Cantidad</th>
                    <th className="text-right">Costo Promedio</th>
                    <th className="text-right">Valor Inventario</th>
                  </tr>
                </thead>
                <tbody>
                  {product.inventoryBalances.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <span className="inline-flex items-center gap-2">
                          <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-[var(--color-master-50)] text-[var(--color-master-700)] text-xs font-bold">
                            {b.branch.code}
                          </span>
                          <span className="font-medium text-[var(--color-text)]">{b.branch.name}</span>
                        </span>
                      </td>
                      <td className="text-right font-mono font-semibold">{qty(b.quantityOnHand)}</td>
                      <td className="text-right font-mono">{money(b.weightedAverageCost)}</td>
                      <td className="text-right font-mono font-semibold text-[var(--color-text)]">{money(b.inventoryValue)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--color-border-strong)] bg-[var(--color-surface-alt)]">
                    <td className="font-bold text-[var(--color-text)]">Total</td>
                    <td className="text-right font-mono font-bold text-[var(--color-text)]">{qty(totalStock)}</td>
                    <td></td>
                    <td className="text-right font-mono font-bold text-[var(--color-text)]">{money(totalValue)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ MOVEMENTS / KARDEX TAB ═══ */}
      {tab === "movements" && <KardexTab productId={product.id} fallbackMovements={product.inventoryMovements} />}

      {/* ═══ PRICING TAB ═══ */}
      {tab === "pricing" && (
        <div className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden shadow-sm">
          <div className="hm-card-header-amber px-5 py-3 flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            <h2 className="font-semibold">Precios y Costos por Sucursal</h2>
          </div>
          {product.branchProductSettings.length === 0 ? (
            <div className="p-8 text-center">
              <DollarSign className="h-10 w-10 mx-auto mb-3 text-[var(--color-text-muted)]" />
              <p className="text-sm font-medium text-[var(--color-text-secondary)]">Sin configuración de precios por sucursal</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="hm-table">
                <thead>
                  <tr>
                    <th>Sucursal</th>
                    <th className="text-center">Disponible</th>
                    <th className="text-right">Costo Sucursal</th>
                    <th className="text-right">Precio Sucursal</th>
                  </tr>
                </thead>
                <tbody>
                  {product.branchProductSettings.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <span className="inline-flex items-center gap-2">
                          <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-[var(--color-master-50)] text-[var(--color-master-700)] text-xs font-bold">
                            {s.branch.code}
                          </span>
                          <span className="font-medium text-[var(--color-text)]">{s.branch.name}</span>
                        </span>
                      </td>
                      <td className="text-center">
                        {s.isAvailable ? (
                          <Badge variant="success">Sí</Badge>
                        ) : (
                          <Badge variant="danger">No</Badge>
                        )}
                      </td>
                      <td className="text-right font-mono">{s.branchCost ? money(s.branchCost) : <span className="text-[var(--color-text-muted)]">Base</span>}</td>
                      <td className="text-right font-mono">{s.branchPrice ? money(s.branchPrice) : <span className="text-[var(--color-text-muted)]">Base</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ BRAIN TAB ═══ */}
      {tab === "brain" && (
        <div className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden shadow-sm">
          <div className="hm-card-header-purple px-5 py-3 flex items-center gap-2">
            <Brain className="h-5 w-5" />
            <h2 className="font-semibold">Decisiones Brain</h2>
          </div>
          {product.brainDecisions.length === 0 ? (
            <div className="p-8 text-center">
              <Brain className="h-10 w-10 mx-auto mb-3 text-[var(--color-text-muted)]" />
              <p className="text-sm font-medium text-[var(--color-text-secondary)]">Sin decisiones del Brain para este producto</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="hm-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Estado</th>
                    <th>Severidad</th>
                    <th>Categoría</th>
                    <th>Decisión</th>
                    <th>Sucursal</th>
                  </tr>
                </thead>
                <tbody>
                  {product.brainDecisions.map((d) => (
                    <tr key={d.id}>
                      <td className="whitespace-nowrap">{fmtDateTime(d.createdAt)}</td>
                      <td><Badge variant={d.status === "APPLIED" ? "success" : d.status === "PENDING" ? "warning" : "neutral"}>{d.status}</Badge></td>
                      <td><Badge variant={d.severity === "HIGH" ? "danger" : d.severity === "MEDIUM" ? "warning" : "info"}>{d.severity}</Badge></td>
                      <td className="text-[var(--color-text-secondary)]">{d.category}</td>
                      <td className="font-medium text-[var(--color-text)]">{d.title}</td>
                      <td>{d.branch?.code ?? <span className="text-[var(--color-text-muted)]">GLOBAL</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ AUDIT TAB ═══ */}
      {tab === "audit" && (
        <div className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden shadow-sm">
          <div className="hm-card-header-teal px-5 py-3 flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            <h2 className="font-semibold">Registro de Auditoría</h2>
          </div>
          {data.auditLogs.length === 0 ? (
            <div className="p-8 text-center">
              <ClipboardList className="h-10 w-10 mx-auto mb-3 text-[var(--color-text-muted)]" />
              <p className="text-sm font-medium text-[var(--color-text-secondary)]">Sin registros de auditoría</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="hm-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Módulo</th>
                    <th>Acción</th>
                    <th>Sucursal</th>
                    <th>Usuario</th>
                  </tr>
                </thead>
                <tbody>
                  {data.auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="whitespace-nowrap">{fmtDateTime(log.occurredAt)}</td>
                      <td><Badge variant="info">{log.module}</Badge></td>
                      <td className="font-medium text-[var(--color-text)]">{log.action}</td>
                      <td>{log.branch?.code ?? <span className="text-[var(--color-text-muted)]">GLOBAL</span>}</td>
                      <td className="text-[var(--color-text-secondary)]">
                        {log.actor ? `${log.actor.fullName || log.actor.username}` : <span className="text-[var(--color-text-muted)]">Sistema</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ── KPI Mini Card ── */
/* ═══════════════════════════════════════════════════════════════════════════ */
function KpiMini({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  accent: "emerald" | "blue" | "indigo" | "amber";
}) {
  const accentMap = {
    emerald: { bg: "bg-emerald-50", text: "text-emerald-600", bar: "from-emerald-400 to-emerald-600" },
    blue: { bg: "bg-blue-50", text: "text-blue-600", bar: "from-blue-400 to-blue-600" },
    indigo: { bg: "bg-indigo-50", text: "text-indigo-600", bar: "from-indigo-400 to-indigo-600" },
    amber: { bg: "bg-amber-50", text: "text-amber-600", bar: "from-amber-400 to-amber-600" },
  };
  const a = accentMap[accent];
  return (
    <Card className="overflow-hidden">
      <div className={`h-1 bg-gradient-to-r ${a.bar}`} />
      <div className="p-4 flex items-start gap-3">
        <div className={`flex-shrink-0 rounded-xl p-2.5 ${a.bg}`}>
          <Icon className={`h-5 w-5 ${a.text}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">{label}</p>
          <p className="mt-1 text-2xl font-bold leading-none text-[var(--color-text)]">{value}</p>
        </div>
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ── Kardex Tab — full-featured movements view ── */
/* ═══════════════════════════════════════════════════════════════════════════ */
function KardexTab({
  productId,
  fallbackMovements,
}: {
  productId: string;
  fallbackMovements: ProductDetail["product"]["inventoryMovements"];
}) {
  const [movements, setMovements] = useState<KardexMovement[]>(fallbackMovements);
  const [pagination, setPagination] = useState<MovementPagination>({ page: 1, limit: 30, total: fallbackMovements.length, totalPages: 1 });
  const [filterBranch, setFilterBranch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(30);
  const [loading, setLoading] = useState(false);
  const [sortAsc, setSortAsc] = useState(false);

  const loadMovements = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (filterBranch) params.set("branchId", filterBranch);
      if (filterType) params.set("movementType", filterType);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const response = await fetch(`/api/master/catalog-inventory/products/${productId}/movements?${params}`, { cache: "no-store" });
      const raw = await response.json();
      if (!response.ok) throw new Error(raw?.error?.message ?? raw?.message ?? "No se pudo cargar Kardex.");
      const payload = raw.data as { rows: KardexMovement[]; pagination: MovementPagination };
      setMovements(payload.rows);
      setPagination(payload.pagination);
    } catch {
      setMovements(fallbackMovements);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, fallbackMovements, filterBranch, filterType, limit, page, productId]);

  useEffect(() => {
    void loadMovements();
  }, [loadMovements]);

  const branches = [...new Map([...fallbackMovements, ...movements].map((m) => [m.branch.id, m.branch])).values()].sort((a, b) => a.code.localeCompare(b.code));
  const types = [...new Set([...fallbackMovements, ...movements].map((m) => m.movementType))].sort();

  const sorted = [...movements].sort((a, b) => {
    const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return sortAsc ? diff : -diff;
  });

  // Totals
  const totalEntries = sorted.filter((m) => isInboundMovement(m.movementType)).length;
  const totalExits = sorted.filter((m) => isOutboundMovement(m.movementType)).length;

  return (
    <div className="space-y-4">
      {/* ── Filters + Summary ── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Branch filter */}
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-[var(--color-text-muted)]" />
          <select
            value={filterBranch}
            onChange={(e) => { setFilterBranch(e.target.value); setPage(1); }}
            className="hm-input !w-auto !py-1.5 !px-3 !text-sm"
          >
            <option value="">Todas las sucursales</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.code}</option>
            ))}
          </select>
        </div>
        {/* Type filter */}
        <select
          value={filterType}
          onChange={(e) => { setFilterType(e.target.value); setPage(1); }}
          className="hm-input !w-auto !py-1.5 !px-3 !text-sm"
        >
          <option value="">Todos los tipos</option>
          {types.map((t) => {
            const lbl = movementLabel(t);
            return <option key={t} value={t}>{lbl.label}</option>;
          })}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="hm-input !w-auto !py-1.5 !px-3 !text-sm" />
        <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="hm-input !w-auto !py-1.5 !px-3 !text-sm" />
        <select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }} className="hm-input !w-auto !py-1.5 !px-3 !text-sm">
          <option value="30">30</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </select>

        {/* Sort toggle */}
        <button
          onClick={() => setSortAsc(!sortAsc)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-[var(--color-text-secondary)] bg-[var(--color-surface-alt)] hover:bg-[var(--color-surface-muted)] transition-colors border border-[var(--color-border)]"
        >
          <Calendar className="h-3.5 w-3.5" />
          {sortAsc ? "Antiguos primero" : "Recientes primero"}
          {sortAsc ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {/* Summary pills */}
        <div className="ml-auto flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-bold text-emerald-700">
            <TrendingUp className="h-3 w-3" /> {totalEntries} entradas
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-3 py-1 text-xs font-bold text-red-700">
            <TrendingDown className="h-3 w-3" /> {totalExits} salidas
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-300 px-3 py-1 text-xs font-bold text-slate-700">
            {pagination.total} total
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
        <span>Pagina {pagination.page} de {pagination.totalPages}{loading ? " · cargando..." : ""}</span>
        <div className="flex items-center gap-2">
          <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-md border border-[var(--color-border)] px-2 py-1 disabled:opacity-40">Anterior</button>
          <button type="button" disabled={page >= pagination.totalPages || loading} onClick={() => setPage((p) => p + 1)} className="rounded-md border border-[var(--color-border)] px-2 py-1 disabled:opacity-40">Siguiente</button>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden shadow-sm">
        <div className="hm-card-header-green px-5 py-3 flex items-center gap-2">
          <ArrowLeftRight className="h-5 w-5" />
          <h2 className="font-semibold">Kardex de Movimientos</h2>
          <span className="ml-auto text-xs opacity-80">{pagination.total} registros</span>
        </div>

        {sorted.length === 0 ? (
          <div className="p-8 text-center">
            <ArrowLeftRight className="h-10 w-10 mx-auto mb-3 text-[var(--color-text-muted)]" />
            <p className="text-sm font-medium text-[var(--color-text-secondary)]">
              No hay movimientos {filterBranch || filterType ? "con los filtros seleccionados" : "registrados"}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="hm-table">
              <thead>
                <tr>
                  <th className="w-8"></th>
                  <th>Fecha</th>
                  <th>Sucursal</th>
                  <th>Tipo</th>
                  <th className="text-right">Cantidad</th>
                  <th className="text-right">Costo unit.</th>
                  <th className="text-right">Valor total</th>
                  <th>Referencia</th>
                  <th>Nota</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => {
                  const ml = movementLabel(m.movementType);
                  const isNegative = isOutboundMovement(m.movementType);
                  const qtyVal = Number(m.quantity);
                  const costVal = Number(m.unitCost);
                  const totalVal = qtyVal * costVal;
                  const refLabel = {
                    OPENING_BALANCE: "Carga inicial",
                    OPENING_BALANCE_BULK: "Carga masiva",
                    MANUAL_ADJUSTMENT: "Ajuste manual",
                    SALE: "Venta",
                    SALE_RETURN: "Devolución",
                    PURCHASE: "Compra",
                    TRANSFER: "Traslado",
                    MANUAL: "Manual",
                  }[m.referenceType] ?? m.referenceType;
                  const refShort = m.referenceId.startsWith("OPENING-BULK-")
                    ? `Lote·${m.referenceId.split("-").pop()}`
                    : m.referenceId.length > 18 ? `${m.referenceId.slice(0, 16)}…` : m.referenceId;
                  const nota = m.notes?.trim() || null;
                  return (
                    <tr key={m.id} className="group hover:bg-[var(--color-surface-alt)]">
                      <td><MovementIcon type={m.movementType} /></td>
                      <td className="whitespace-nowrap text-[var(--color-text-secondary)] text-xs">{fmtDateTime(m.createdAt)}</td>
                      <td>
                        <span className="flex items-center justify-center w-6 h-6 rounded bg-[var(--color-master-50)] text-[var(--color-master-700)] text-[10px] font-bold">
                          {m.branch.code}
                        </span>
                      </td>
                      <td><Badge variant={ml.color}>{ml.label}</Badge></td>
                      <td className={`text-right font-mono font-semibold text-sm ${isNegative ? "text-red-600" : "text-emerald-600"}`}>
                        {isNegative ? "−" : "+"}{qty(qtyVal)}
                      </td>
                      <td className="text-right font-mono text-xs text-[var(--color-text-secondary)]">{money(costVal)}</td>
                      <td className="text-right font-mono text-xs font-semibold text-[var(--color-text)]">{money(totalVal)}</td>
                      <td>
                        <div className="text-[11px] font-medium text-[var(--color-text-secondary)]">{refLabel}</div>
                        <div className="font-mono text-[10px] text-[var(--color-text-muted)]">{refShort}</div>
                      </td>
                      <td className="max-w-[160px]">
                        {nota ? (
                          <span className="text-xs text-[var(--color-text-secondary)] line-clamp-2" title={nota}>{nota}</span>
                        ) : (
                          <span className="text-[10px] text-[var(--color-text-muted)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
