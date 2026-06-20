"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ShoppingCart, Truck, Package, Users, BarChart3, Tag, Wallet,
  ClipboardCheck, BookOpen, TrendingUp, TrendingDown, AlertTriangle, Banknote,
  ChevronRight, Download, Eye, X, Layers,
} from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { showToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { LoadingState, KpiSkeleton } from "@/components/ui/loading-state";
import { type ColumnDef, ReportPreviewTable } from "@/components/reports/report-preview-table";
import { SalesDashboard } from "@/components/reports/sales-dashboard";

// ─── Types ───────────────────────────────────────────────────────────────────

type Branch = { id: string; code: string; name: string };

type KpiData = {
  ventas30dias: number;        ventas30diasCount: number;
  pagosHoy: number;            pagosHoyCount: number;
  pendientePago: number;       pendientePagoCount: number;
  descuentos30dias: number;    descuentos30diasCount: number;
  inventarioCritico: number;   prestamosActivos: number;
};

type FilterState = {
  dateFrom: string;
  dateTo: string;
  branchId: string;
  status: string;
  actorUsername: string;
};

type PreviewData = { rows: Record<string, unknown>[]; count: number; generatedAt: string };

type FilterConfig = {
  dateRange: boolean;
  status: boolean;
  statusLabel?: string;
  statusOptions?: { value: string; label: string }[];
  actor: boolean;
  actorLabel?: string;
};

type ReportDef = {
  key: string;
  label: string;
  description: string;
  category: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  endpoint: string;
  csvFilename: string;
  maxRows: number;
  columns: ColumnDef[];
  filters: FilterConfig;
};

// ─── Catalog ─────────────────────────────────────────────────────────────────

const C: Record<string, ColumnDef> = {
  fecha:          { key: "fecha",          label: "Fecha",            type: "datetime" },
  fecha_pago:     { key: "fecha_pago",     label: "Fecha pago",       type: "datetime" },
  fecha_solicitud:{ key: "fecha_solicitud",label: "Fecha solicitud",  type: "datetime" },
  fecha_despacho: { key: "fecha_despacho", label: "F. Despacho",      type: "datetime" },
  suc:            { key: "sucursal_codigo",label: "Suc.",             type: "text"     },
  suc_nombre:     { key: "sucursal_nombre",label: "Sucursal",         type: "text"     },
  orden:          { key: "orden",          label: "# Orden",          type: "text"     },
  estado:         { key: "estado",         label: "Estado",           type: "status"   },
  estado_run:     { key: "estado_run",     label: "Estado",           type: "status"   },
  vendedor:       { key: "vendedor",       label: "Vendedor",         type: "text"     },
  cajero:         { key: "cajero",         label: "Cajero",           type: "text"     },
  total:          { key: "total",          label: "Total",            type: "currency", align: "right" },
  sku:            { key: "producto_sku",   label: "SKU",              type: "text"     },
  producto:       { key: "producto_nombre",label: "Producto",         type: "text"     },
  cantidad:       { key: "cantidad",       label: "Cant.",            type: "number",  align: "right" },
  precio_unit:    { key: "precio_unitario",label: "P. Unitario",      type: "currency",align: "right" },
  desc_monto:     { key: "descuento_monto",label: "Desc.",            type: "currency",align: "right" },
  desc_pct:       { key: "descuento_porcentaje_efectivo", label: "% Desc.", type: "percent", align: "right" },
  subtotal_final: { key: "subtotal_final", label: "Neto",             type: "currency",align: "right" },
  metodo:         { key: "metodo",         label: "Método",           type: "text"     },
  monto:          { key: "monto",          label: "Monto",            type: "currency",align: "right" },
  efectivo:       { key: "efectivo",       label: "Efectivo",         type: "currency",align: "right" },
  cambio:         { key: "cambio",         label: "Cambio",           type: "currency",align: "right" },
  referencia:     { key: "referencia",     label: "Referencia",       type: "text"     },
  despachador:    { key: "despachado_por", label: "Despachador",      type: "text"     },
  notas:          { key: "notas",          label: "Notas",            type: "text"     },
  tipo:           { key: "tipo",           label: "Tipo",             type: "text"     },
  solicitado_por: { key: "solicitado_por", label: "Solicitado por",   type: "text"     },
  resuelto_por:   { key: "resuelto_por",   label: "Resuelto por",     type: "text"     },
  motivo:         { key: "motivo",         label: "Motivo",           type: "text"     },
  modulo:         { key: "modulo",         label: "Módulo",           type: "text"     },
  accion:         { key: "accion",         label: "Acción",           type: "text"     },
  usuario:        { key: "usuario",        label: "Usuario",          type: "text"     },
  entidad:        { key: "entidad",        label: "Entidad",          type: "text"     },
  entidad_id:     { key: "entidad_id",     label: "ID",               type: "text"     },
  existencia:     { key: "existencia",     label: "Existencia",       type: "number",  align: "right" },
  costo_prom:     { key: "costo_promedio", label: "Costo Prom.",      type: "currency",align: "right" },
  valor_inv:      { key: "valor_inventario",label: "Valor Inv.",      type: "currency",align: "right" },
  ano:            { key: "ano",            label: "Año",              type: "number"   },
  mes:            { key: "mes",            label: "Mes",              type: "number"   },
  sucursal_txt:   { key: "sucursal",       label: "Sucursal",         type: "text"     },
  empleado:       { key: "empleado",       label: "Empleado",         type: "text"     },
  puesto:         { key: "puesto",         label: "Puesto",           type: "text"     },
  salario_bruto:  { key: "salario_bruto",  label: "Bruto",            type: "currency",align: "right" },
  desc_prestamos: { key: "deducciones_prestamos", label: "Desc. Préstamos", type: "currency", align: "right" },
  otras_desc:     { key: "otras_deducciones", label: "Otras Desc.",   type: "currency",align: "right" },
  neto:           { key: "neto_a_pagar",   label: "Neto a pagar",     type: "currency",align: "right" },
  costo_empresa:  { key: "costo_empresa",  label: "Costo empresa",    type: "currency",align: "right" },
  monto_original: { key: "monto_original", label: "Monto original",   type: "currency",align: "right" },
  saldo_pendiente:{ key: "saldo_pendiente",label: "Saldo pendiente",  type: "currency",align: "right" },
  cuota:          { key: "cuota",          label: "Cuota",            type: "currency",align: "right" },
};

const SALE_STATUS_OPTIONS = [
  { value: "PENDING_PAYMENT", label: "Pend. pago" },
  { value: "PAID",            label: "Pagada" },
  { value: "DISPATCH_PENDING",label: "Pend. despacho" },
  { value: "DISPATCHED",      label: "Despachada" },
  { value: "CANCELLED",       label: "Cancelada" },
  { value: "RETURNED",        label: "Devuelta" },
];

const PAYMENT_STATUS_OPTIONS = [
  { value: "POSTED", label: "Cobrado" },
  { value: "VOIDED", label: "Anulado" },
];

const DISPATCH_STATUS_OPTIONS = [
  { value: "PENDING",    label: "Pendiente" },
  { value: "IN_TRANSIT", label: "En tránsito" },
  { value: "DISPATCHED", label: "Despachado" },
  { value: "CANCELLED",  label: "Cancelado" },
];

const APPROVAL_STATUS_OPTIONS = [
  { value: "PENDING",  label: "Pendiente" },
  { value: "APPROVED", label: "Aprobado" },
  { value: "REJECTED", label: "Rechazado" },
];

const LOAN_STATUS_OPTIONS = [
  { value: "ACTIVE",    label: "Activo" },
  { value: "PAID",      label: "Pagado" },
  { value: "CANCELLED", label: "Cancelado" },
];

const REPORTS: ReportDef[] = [
  {
    key: "sales", label: "Ventas", category: "ventas",
    description: "Órdenes con cobros registrados: estado, vendedor y monto. Base para comisiones y cierre comercial.",
    icon: ShoppingCart, iconColor: "text-[var(--color-warning-600)]", iconBg: "bg-[var(--color-warning-50)] border-[var(--color-warning-100)]",
    endpoint: "/api/reports/sales", csvFilename: "reporte-ventas.csv", maxRows: 2000,
    columns: [C.fecha, C.suc, C.suc_nombre, C.orden, C.estado, C.vendedor, C.total],
    filters: { dateRange: true, status: true, statusLabel: "Estado de orden", statusOptions: SALE_STATUS_OPTIONS, actor: false },
  },
  {
    key: "discounts", label: "Descuentos", category: "ventas",
    description: "Líneas con descuento aplicado: monto, porcentaje efectivo y vendedor. Auditoría de política comercial.",
    icon: Tag, iconColor: "text-[var(--color-danger-600)]", iconBg: "bg-[var(--color-danger-50)] border-[var(--color-danger-100)]",
    endpoint: "/api/reports/discounts", csvFilename: "reporte-descuentos.csv", maxRows: 2000,
    columns: [C.fecha, C.suc, C.orden, C.sku, C.producto, C.cantidad, C.precio_unit, C.desc_monto, C.desc_pct, C.subtotal_final, C.vendedor],
    filters: { dateRange: true, status: false, actor: true, actorLabel: "Vendedor (usuario)" },
  },
  {
    key: "payments", label: "Cobros", category: "ventas",
    description: "Pagos registrados con método, cajero y desglose de efectivo. Conciliación de caja y trazabilidad.",
    icon: Wallet, iconColor: "text-[var(--color-success-700)]", iconBg: "bg-[var(--color-success-50)] border-[var(--color-success-100)]",
    endpoint: "/api/reports/payments", csvFilename: "reporte-cobros.csv", maxRows: 2000,
    columns: [C.fecha_pago, C.suc, C.orden, C.metodo, C.estado, C.cajero, C.monto, C.efectivo, C.cambio, C.referencia],
    filters: { dateRange: true, status: true, statusLabel: "Estado de pago", statusOptions: PAYMENT_STATUS_OPTIONS, actor: true, actorLabel: "Cajero (usuario)" },
  },
  {
    key: "dispatch", label: "Despachos", category: "logistica",
    description: "Tickets de despacho con estado, despachador y fecha. Seguimiento de cumplimiento de entregas.",
    icon: Truck, iconColor: "text-[var(--color-info-600)]", iconBg: "bg-[var(--color-info-50)] border-[var(--color-info-100)]",
    endpoint: "/api/reports/dispatch", csvFilename: "reporte-despachos.csv", maxRows: 2000,
    columns: [C.fecha, C.suc, C.suc_nombre, C.orden, C.estado, C.despachador, C.fecha_despacho, C.notas],
    filters: { dateRange: true, status: true, statusLabel: "Estado de despacho", statusOptions: DISPATCH_STATUS_OPTIONS, actor: false },
  },
  {
    key: "approvals", label: "Aprobaciones", category: "auditoria",
    description: "Solicitudes de aprobación por tipo, estado y resolución. Control de excepciones y decisiones gerenciales.",
    icon: ClipboardCheck, iconColor: "text-[var(--color-info-700)]", iconBg: "bg-[var(--color-info-50)] border-[var(--color-info-100)]",
    endpoint: "/api/reports/approvals", csvFilename: "reporte-aprobaciones.csv", maxRows: 2000,
    columns: [C.fecha_solicitud, C.suc, C.tipo, C.estado, C.solicitado_por, C.resuelto_por, C.motivo],
    filters: { dateRange: true, status: true, statusLabel: "Estado de solicitud", statusOptions: APPROVAL_STATUS_OPTIONS, actor: true, actorLabel: "Solicitado por (usuario)" },
  },
  {
    key: "audit", label: "Bitácora", category: "auditoria",
    description: "Registro de todas las acciones del sistema: módulo, acción, usuario y entidad. Trazabilidad completa.",
    icon: BookOpen, iconColor: "text-[var(--color-text-secondary)]", iconBg: "bg-[var(--color-surface-alt)] border-[var(--color-border)]",
    endpoint: "/api/reports/audit", csvFilename: "reporte-bitacora.csv", maxRows: 3000,
    columns: [C.fecha, C.suc, C.modulo, C.accion, C.usuario, C.entidad, C.entidad_id],
    filters: { dateRange: true, status: true, statusLabel: "Buscar acción (texto)", actor: true, actorLabel: "Usuario (nombre de usuario)" },
  },
  {
    key: "inventory-critical", label: "Inventario crítico", category: "inventario",
    description: "Productos con existencia ≤ 5 unidades por sucursal. Identifica necesidades de reorden urgente.",
    icon: Package, iconColor: "text-[var(--color-danger-600)]", iconBg: "bg-[var(--color-danger-50)] border-[var(--color-danger-100)]",
    endpoint: "/api/reports/inventory-critical", csvFilename: "reporte-inventario-critico.csv", maxRows: 2000,
    columns: [C.suc, C.suc_nombre, C.sku, C.producto, C.existencia, C.costo_prom, C.valor_inv],
    filters: { dateRange: false, status: false, actor: false },
  },
  {
    key: "payroll", label: "Nómina", category: "rrhh",
    description: "Líneas de nómina por empleado y período: bruto, deducciones, neto y costo empresa.",
    icon: Users, iconColor: "text-[var(--color-master-600)]", iconBg: "bg-[var(--color-master-50)] border-[var(--color-master-100)]",
    endpoint: "/api/reports/payroll", csvFilename: "reporte-nomina.csv", maxRows: 2000,
    columns: [C.ano, C.mes, C.sucursal_txt, C.empleado, C.puesto, C.salario_bruto, C.desc_prestamos, C.otras_desc, C.neto, C.costo_empresa, C.estado_run],
    filters: { dateRange: true, status: false, actor: false },
  },
  {
    key: "employee-loans", label: "Préstamos empleados", category: "rrhh",
    description: "Estado de préstamos por empleado: monto original, saldo pendiente, cuota mensual y estado actual.",
    icon: Banknote, iconColor: "text-[var(--color-branch-admin-600)]", iconBg: "bg-[var(--color-branch-admin-50)] border-[var(--color-branch-admin-100)]",
    endpoint: "/api/reports/employee-loans", csvFilename: "reporte-prestamos.csv", maxRows: 2000,
    columns: [C.fecha, C.sucursal_txt, C.empleado, C.monto_original, C.saldo_pendiente, C.cuota, C.estado, C.notas],
    filters: { dateRange: true, status: true, statusLabel: "Estado del préstamo", statusOptions: LOAN_STATUS_OPTIONS, actor: false },
  },
];

const CATEGORIES = [
  { key: "dashboard",  label: "Dashboard",   icon: BarChart3,      featured: true  },
  { key: "todos",      label: "Todos",        icon: Layers,         featured: false },
  { key: "ventas",     label: "Ventas",       icon: ShoppingCart,   featured: false },
  { key: "logistica",  label: "Logística",    icon: Truck,          featured: false },
  { key: "inventario", label: "Inventario",   icon: Package,        featured: false },
  { key: "rrhh",       label: "RR.HH.",       icon: Users,          featured: false },
  { key: "auditoria",  label: "Auditoría",    icon: BookOpen,       featured: false },
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDefaultDates() {
  const today = new Date();
  const dateTo = today.toISOString().split("T")[0];
  const from   = new Date(today);
  from.setDate(from.getDate() - 30);
  return { dateFrom: from.toISOString().split("T")[0], dateTo };
}

const NIO = new Intl.NumberFormat("es-NI", { style: "currency", currency: "NIO", maximumFractionDigits: 0 });

function buildQuery(filters: FilterState, format: "json" | "csv" | "pdf") {
  const p = new URLSearchParams();
  if (filters.dateFrom)      p.set("dateFrom",      filters.dateFrom);
  if (filters.dateTo)        p.set("dateTo",        filters.dateTo);
  if (filters.branchId)      p.set("branchId",      filters.branchId);
  if (filters.status)        p.set("status",        filters.status);
  if (filters.actorUsername) p.set("actorUsername", filters.actorUsername);
  p.set("format", format);
  return p.toString() ? `?${p.toString()}` : "";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiTile({ label, value, sub, icon: Icon, tone }: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; tone: "ok" | "warn" | "alert" | "default";
}) {
  const s = {
    ok:      { tile: "border-[var(--color-success-100)] bg-[color-mix(in_srgb,var(--color-success-50)_25%,white)]", bar: "from-[var(--color-success-400)] to-[var(--color-success-600)]", ring: "bg-[var(--color-success-50)] border-[var(--color-success-100)]", icon: "text-[var(--color-success-600)]" },
    warn:    { tile: "border-[var(--color-warning-200)] bg-[color-mix(in_srgb,var(--color-warning-50)_25%,white)]", bar: "from-[var(--color-warning-400)] to-[var(--color-warning-600)]", ring: "bg-[var(--color-warning-50)] border-[var(--color-warning-100)]", icon: "text-[var(--color-warning-700)]" },
    alert:   { tile: "border-[var(--color-danger-200)] bg-[color-mix(in_srgb,var(--color-danger-50)_30%,white)]",   bar: "from-[var(--color-danger-400)] to-[var(--color-danger-600)]",   ring: "bg-[var(--color-danger-50)] border-[var(--color-danger-100)]",   icon: "text-[var(--color-danger-600)]" },
    default: { tile: "", bar: "from-[var(--color-info-400)] to-[var(--color-info-600)]", ring: "bg-[var(--color-surface-alt)] border-[var(--color-border)]", icon: "text-[var(--color-text-muted)]" },
  }[tone];
  return (
    <div className={`hm-kpi-tile hm-shine group ${s.tile}`}>
      <div className={`absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r ${s.bar}`} />
      <div className="flex items-start justify-between gap-2 mt-0.5">
        <div className="min-w-0">
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.1em] text-[var(--color-text-muted)] mb-1.5">{label}</p>
          <p className="hm-num-lg">{value}</p>
          {sub && <p className="mt-1 text-[0.625rem] text-[var(--color-text-soft)] truncate">{sub}</p>}
        </div>
        <div className={`hm-icon-wrap hm-icon-wrap-md border flex-shrink-0 mt-0.5 ${s.ring}`}>
          <Icon className={s.icon} style={{ width: "1rem", height: "1rem" }} />
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type ReportsHubProps = { masterMode?: boolean; defaultBranchId?: string };

export function ReportsHub({ masterMode = false, defaultBranchId = "" }: ReportsHubProps) {
  const { dateFrom: defFrom, dateTo: defTo } = getDefaultDates();

  const [kpi, setKpi]                 = useState<KpiData | null>(null);
  const [kpiLoading, setKpiLoading]   = useState(true);
  const [branches, setBranches]       = useState<Branch[]>([]);
  const [category, setCategory]       = useState("dashboard");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [filters, setFilters]         = useState<FilterState>({
    dateFrom: defFrom, dateTo: defTo,
    branchId: defaultBranchId, status: "", actorUsername: "",
  });
  const [preview, setPreview]         = useState<PreviewData | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const selectedReport = REPORTS.find((r) => r.key === selectedKey) ?? null;
  const visibleReports = category === "todos" ? REPORTS : REPORTS.filter((r) => r.category === category);

  const loadKpi = useCallback(async () => {
    setKpiLoading(true);
    try {
      const params = defaultBranchId ? `?branchId=${defaultBranchId}` : "";
      const res = await apiFetch(`/api/reports/kpi-summary${params}`);
      const raw = await res.json();
      if (res.ok) setKpi(unwrapApiData(raw) as KpiData);
    } catch { /* best-effort */ }
    finally { setKpiLoading(false); }
  }, [defaultBranchId]);

  useEffect(() => { void loadKpi(); }, [loadKpi]);

  useEffect(() => {
    if (!masterMode) return;
    apiFetch("/api/branches")
      .then((r) => r.json())
      .then((raw) => setBranches(unwrapApiData(raw) as Branch[]))
      .catch(() => showToast("error", "No se pudieron cargar las sucursales."));
  }, [masterMode]);

  function selectReport(key: string) {
    setSelectedKey((prev) => {
      if (prev === key) return null;
      return key;
    });
    setPreview(null);
    setTimeout(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }

  async function loadPreview() {
    if (!selectedReport) return;
    setLoadingPreview(true);
    setPreview(null);
    try {
      const url = `${selectedReport.endpoint}${buildQuery(filters, "json")}`;
      const res = await apiFetch(url);
      const raw = await res.json();
      if (!res.ok) {
        showToast("error", raw?.error?.message ?? raw?.message ?? "No se pudo generar la vista previa.");
        return;
      }
      setPreview(raw as PreviewData);
    } catch {
      showToast("error", "Error de red al cargar la vista previa.");
    } finally {
      setLoadingPreview(false);
    }
  }

  function setFilter(key: keyof FilterState, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPreview(null);
  }

  return (
    <div className="space-y-5">

      {/* ── KPI Strip — pulso en tiempo real ── */}
      <section>
        <p className="mb-2 text-[0.625rem] font-bold uppercase tracking-[0.14em] text-[var(--color-text-muted)] flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-success-500)] animate-pulse" />
          Indicadores clave — últimos 30 días
        </p>
        {kpiLoading ? <KpiSkeleton count={4} /> : !kpi ? null : (
          <div className="hm-kpi-grid">
            <KpiTile label="Ventas cobradas (30 d)" value={NIO.format(kpi.ventas30dias)} sub={`${kpi.ventas30diasCount.toLocaleString("es-NI")} cobros`} icon={TrendingUp} tone="ok" />
            <KpiTile label="Cobrado hoy" value={NIO.format(kpi.pagosHoy)} sub={`${kpi.pagosHoyCount} pago${kpi.pagosHoyCount !== 1 ? "s" : ""} procesados`} icon={Wallet} tone={kpi.pagosHoy > 0 ? "ok" : "default"} />
            <KpiTile label="Pendiente de cobro" value={NIO.format(kpi.pendientePago)} sub={`${kpi.pendientePagoCount} orden${kpi.pendientePagoCount !== 1 ? "es" : ""} sin pagar`} icon={TrendingDown} tone={kpi.pendientePago > 0 ? "warn" : "ok"} />
            <KpiTile label="Inventario crítico" value={String(kpi.inventarioCritico)} sub={kpi.inventarioCritico > 0 ? "Productos ≤ 5 unidades" : "Sin alertas de stock"} icon={AlertTriangle} tone={kpi.inventarioCritico > 0 ? "alert" : "ok"} />
          </div>
        )}
      </section>

      {/* ── Category tabs ── */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Dashboard: botón destacado */}
        <button
          type="button"
          onClick={() => setCategory("dashboard")}
          className={[
            "inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-[0.8125rem] font-semibold border transition-all duration-150",
            category === "dashboard"
              ? "bg-[var(--color-info-600)] text-white border-[var(--color-info-600)] shadow-sm"
              : "bg-[var(--color-surface)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:text-[var(--color-info-600)] hover:border-[var(--color-info-300)]",
          ].join(" ")}
        >
          <BarChart3 style={{ width: "0.8125rem", height: "0.8125rem" }} />
          Dashboard
        </button>

        <span className="h-4 w-px bg-[var(--color-border)] flex-shrink-0" />

        {/* Reportes: pill container */}
        <div className="erp-tabs-pill flex-wrap">
          {CATEGORIES.filter((c) => !c.featured).map((cat) => {
            const Icon = cat.icon;
            return (
              <button
                key={cat.key}
                type="button"
                className={[
                  "inline-flex items-center gap-1.5",
                  category === cat.key ? "active" : "",
                ].join(" ")}
                onClick={() => setCategory(cat.key)}
              >
                <Icon style={{ width: "0.6875rem", height: "0.6875rem" }} className="flex-shrink-0 opacity-70" />
                {cat.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Sales Dashboard ── */}
      {category === "dashboard" && (
        <SalesDashboard
          masterMode={masterMode}
          defaultBranchId={defaultBranchId}
          branches={branches}
        />
      )}

      {/* ── Report grid ── */}
      {category !== "dashboard" && (
      <div className="space-y-3">
        <p className="text-[0.625rem] font-bold uppercase tracking-[0.12em] text-[var(--color-text-muted)] flex items-center gap-1.5">
          <span className="h-px flex-1 bg-[var(--color-border)]" />
          {visibleReports.length} reporte{visibleReports.length !== 1 ? "s" : ""} disponibles
          <span className="h-px flex-1 bg-[var(--color-border)]" />
        </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visibleReports.map((report) => {
          const Icon = report.icon;
          const isSelected = selectedKey === report.key;
          return (
            <div
              key={report.key}
              className={`hm-module-card cursor-pointer transition-all duration-150 hover:shadow-md ${isSelected ? "ring-2 ring-[var(--color-info-400)] ring-offset-1" : "hover:border-[var(--color-info-200)]"}`}
            >
              <div className="p-4">
                <div className="flex items-start gap-3 mb-2.5">
                  <div className={`hm-icon-wrap hm-icon-wrap-md border flex-shrink-0 ${report.iconBg}`}>
                    <Icon className={report.iconColor} style={{ width: "1rem", height: "1rem" }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-[0.875rem] text-[var(--color-text)] leading-tight">{report.label}</h3>
                    <span className="hm-chip text-[0.5625rem] mt-0.5 inline-block">{report.category}</span>
                  </div>
                  {isSelected && (
                    <div className="h-2 w-2 rounded-full bg-[var(--color-info-500)] flex-shrink-0 mt-1.5" />
                  )}
                </div>
                <p className="text-xs text-[var(--color-text-muted)] leading-relaxed mb-3">{report.description}</p>
                <div className="flex gap-1.5">
                  <Button
                    type="button"
                    variant={isSelected ? "primary" : "secondary"}
                    size="sm"
                    className="flex-1 justify-center"
                    icon={<Eye className="h-3 w-3" />}
                    onClick={() => selectReport(report.key)}
                  >
                    {isSelected ? "Activo" : "Seleccionar"}
                  </Button>
                  <button
                    type="button"
                    title="Exportar CSV (últimos 30 días)"
                    className="hm-icon-btn"
                    onClick={() => { window.location.href = `${report.endpoint}${buildQuery(filters, "csv")}`; }}
                  >
                    <Download style={{ width: "0.875rem", height: "0.875rem" }} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      </div>
      )}

      {/* ── Active report panel ── */}
      {category !== "dashboard" && selectedReport && (
        <div ref={panelRef} className="space-y-4 scroll-mt-20">

          {/* Report header */}
          <div className="hm-module-card">
            <div className="hm-module-card-header">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`hm-icon-wrap hm-icon-wrap-md border flex-shrink-0 ${selectedReport.iconBg}`}>
                  <selectedReport.icon className={selectedReport.iconColor} style={{ width: "1rem", height: "1rem" }} />
                </div>
                <div className="min-w-0">
                  <h2 className="font-bold text-[var(--color-text)]">{selectedReport.label}</h2>
                  <p className="text-xs text-[var(--color-text-muted)] truncate">{selectedReport.description}</p>
                </div>
              </div>
              <button type="button" className="hm-icon-btn flex-shrink-0" onClick={() => { setSelectedKey(null); setPreview(null); }}>
                <X style={{ width: "0.875rem", height: "0.875rem" }} />
              </button>
            </div>

            {/* Filter panel */}
            <div className="p-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">

                {/* Date range */}
                {selectedReport.filters.dateRange && (
                  <>
                    <label className="grid gap-1">
                      <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Desde</span>
                      <input className="hm-input rounded-lg text-sm" type="date" value={filters.dateFrom} onChange={(e) => setFilter("dateFrom", e.target.value)} />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Hasta</span>
                      <input className="hm-input rounded-lg text-sm" type="date" value={filters.dateTo} onChange={(e) => setFilter("dateTo", e.target.value)} />
                    </label>
                  </>
                )}

                {/* Branch (master only) */}
                {masterMode && (
                  <label className="grid gap-1">
                    <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Sucursal</span>
                    <select className="hm-input rounded-lg text-sm" value={filters.branchId} onChange={(e) => setFilter("branchId", e.target.value)}>
                      <option value="">Todas</option>
                      {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
                    </select>
                  </label>
                )}

                {/* Status */}
                {selectedReport.filters.status && (
                  <label className="grid gap-1">
                    <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                      {selectedReport.filters.statusLabel ?? "Estado"}
                    </span>
                    {selectedReport.filters.statusOptions ? (
                      <select className="hm-input rounded-lg text-sm" value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
                        <option value="">Todos</option>
                        {selectedReport.filters.statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <input className="hm-input rounded-lg text-sm" placeholder="Buscar..." value={filters.status} onChange={(e) => setFilter("status", e.target.value)} />
                    )}
                  </label>
                )}

                {/* Actor */}
                {selectedReport.filters.actor && (
                  <label className="grid gap-1">
                    <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                      {selectedReport.filters.actorLabel ?? "Usuario actor"}
                    </span>
                    <input className="hm-input rounded-lg text-sm" placeholder="nombre de usuario..." value={filters.actorUsername} onChange={(e) => setFilter("actorUsername", e.target.value)} />
                  </label>
                )}
              </div>

              {/* Action bar */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-[var(--color-text-muted)]">
                  Máx. {selectedReport.maxRows.toLocaleString("es-NI")} filas · CSV / PDF disponibles después de previsualizar
                </p>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" loading={loadingPreview} icon={<Eye className="h-3.5 w-3.5" />} onClick={loadPreview}>
                    Previsualizar
                  </Button>
                  <Button variant="ghost" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => { window.location.href = `${selectedReport.endpoint}${buildQuery(filters, "csv")}`; }}>
                    CSV
                  </Button>
                  <Button size="sm" icon={<ChevronRight className="h-3.5 w-3.5" />} onClick={() => { window.open(`${selectedReport.endpoint}${buildQuery(filters, "pdf")}`, "_blank"); }}>
                    PDF
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Preview table */}
          {loadingPreview && <LoadingState message="Generando vista previa..." />}
          {!loadingPreview && preview && (
            <ReportPreviewTable
              rows={preview.rows}
              count={preview.count}
              maxRows={selectedReport.maxRows}
              columns={selectedReport.columns}
              generatedAt={preview.generatedAt}
              exportCsvUrl={`${selectedReport.endpoint}${buildQuery(filters, "csv")}`}
              exportPdfUrl={`${selectedReport.endpoint}${buildQuery(filters, "pdf")}`}
              reportLabel={selectedReport.label}
            />
          )}
        </div>
      )}
    </div>
  );
}
