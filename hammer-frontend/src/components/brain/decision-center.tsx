"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  Brain,
  CheckCircle2,
  ChevronDown,
  Loader2,
  RadioTower,
  ScanLine,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money as formatMoney } from "@/lib/format";
import { BrainFilters, type BrainFilterState } from "@/components/brain/brain-filters";
import { DecisionCard, type BrainDecision } from "@/components/brain/decision-card";
import { BrainSummary, type BrainKpis } from "@/components/brain/brain-summary";
import type { BrainDecisionAction } from "@/components/brain/decision-action-buttons";
import { showToast } from "@/components/ui/toast";

type BranchOption = {
  id: string;
  code: string;
  name: string;
};

type BrainResponse = {
  decisions: BrainDecision[];
  kpis: BrainKpis;
  nextCursor?: string | null;
  executiveSummary?: string[];
  priorityMessage?: string;
  totalDecisions?: number;
  criticalCount?: number;
  highRiskCount?: number;
  estimatedImpactAmount?: number;
  categoriesBreakdown?: {
    pricing: number;
    inventory: number;
    purchasing: number;
    transfers: number;
    cash: number;
    config: number;
  };
};

type BrainScanMode = "QUICK_SCAN" | "OPERATIONAL_DAY_SCAN" | "ENTITY_SCAN" | "DEEP_SCAN" | "REPAIR_SCAN";

type NoteModal = {
  action: BrainDecisionAction;
  decisionId: string;
  prompt: string;
};

const initialFilters: BrainFilterState = {
  branchId: "",
  category: "",
  severity: "",
  status: "",
  search: "",
  productId: "",
  targetUserId: "",
  actionType: "",
  days: "30",
  sort: "priority",
  onlyCritical: "",
  onlyActionable: "",
  onlyWithImpact: "",
  onlyPendingApproval: "",
  onlyPricing: "",
  onlyInventory: "",
  onlyCash: "",
  onlyPurchasing: "",
  onlyTransfers: "",
  onlyConfiguration: "",
  onlyPricingMisconfiguration: "",
};

const STATUS_TABS = [
  { value: "", label: "Todas" },
  { value: "OPEN", label: "Abiertas" },
  { value: "APPROVED", label: "Aprobadas" },
  { value: "MANUAL_REVIEW", label: "Revisión" },
  { value: "EXECUTING", label: "Ejecutando" },
  { value: "EXECUTED", label: "Ejecutadas" },
  { value: "DISMISSED", label: "Descartadas" },
];

const SEV_CHIP: Record<string, string> = {
  CRITICAL: "bg-[var(--color-danger-50)] text-[var(--color-danger-700)]",
  HIGH:     "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
  MEDIUM:   "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
  LOW:      "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]",
  INFO:     "bg-[var(--color-info-50)] text-[var(--color-info-700)]",
};

const FILTER_STORAGE_KEY = "hammer.brain.filters.v2";

function formatDate(value?: string | null) {
  if (!value) return "Sin escaneo reciente";
  return new Date(value).toLocaleString("es-NI", { dateStyle: "medium", timeStyle: "short" });
}

function decisionTime(decision: BrainDecision) {
  return decision.lastDetectedAt ?? decision.firstDetectedAt ?? decision.createdAt;
}

function severityRank(severity: string) {
  return { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 }[severity] ?? 0;
}

function asNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function scrollToPriorities() {
  document.getElementById("brain-priorities")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function DecisionCenter() {
  const [filters, setFilters] = useState(initialFilters);
  const [scanMode, setScanMode] = useState<BrainScanMode>("QUICK_SCAN");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [businessDate, setBusinessDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [operationalDayId, setOperationalDayId] = useState("");
  const [cashSessionId, setCashSessionId] = useState("");
  const [saleOrderId, setSaleOrderId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [data, setData] = useState<BrainResponse | null>(null);
  const [extraDecisions, setExtraDecisions] = useState<BrainDecision[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [noteModal, setNoteModal] = useState<NoteModal | null>(null);
  const [noteText, setNoteText] = useState("");
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return params.toString();
  }, [filters]);

  useEffect(() => {
    const stored = window.localStorage.getItem(FILTER_STORAGE_KEY);
    if (!stored) return;
    try {
      setFilters({ ...initialFilters, ...JSON.parse(stored) });
    } catch {
      window.localStorage.removeItem(FILTER_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
  }, [filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setExtraDecisions([]);
    setNextCursor(null);
    try {
      const response = await apiFetch(`/api/master/brain/decisions?${query}`);
      const raw = await response.json();
      if (!response.ok) throw new Error(raw?.error?.message ?? "No se pudo cargar el Brain.");
      const result = unwrapApiData(raw) as BrainResponse;
      setData(result);
      setNextCursor(result.nextCursor ?? null);
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "No se pudo cargar el Brain.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams(query);
      params.set("cursor", nextCursor);
      const response = await apiFetch(`/api/master/brain/decisions?${params.toString()}`);
      const raw = await response.json();
      if (!response.ok) throw new Error(raw?.error?.message ?? "No se pudo cargar más decisiones.");
      const result = unwrapApiData(raw) as BrainResponse;
      setExtraDecisions((current) => [...current, ...result.decisions]);
      setNextCursor(result.nextCursor ?? null);
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Error cargando más decisiones.");
    } finally {
      setLoadingMore(false);
    }
  }, [query, nextCursor, loadingMore]);

  useEffect(() => {
    apiFetch("/api/branches")
      .then((response) => response.json())
      .then((raw) => {
        const list = unwrapApiData(raw);
        setBranches(Array.isArray(list) ? list as BranchOption[] : []);
      })
      .catch(() => setBranches([]));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (noteModal) {
      setTimeout(() => noteTextareaRef.current?.focus(), 50);
    }
  }, [noteModal]);

  async function scan(dryRun = false) {
    setBusyAction(dryRun ? "dry-run" : "scan");
    setScanMessage(null);
    try {
      const entityScope = scanMode === "ENTITY_SCAN"
        ? {
            operationalDayId: operationalDayId || undefined,
            cashSessionId: cashSessionId || undefined,
            saleOrderId: saleOrderId || undefined,
            productId: filters.productId || undefined,
          }
        : {};
      const response = await apiFetch("/api/master/brain/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: scanMode,
          branchId: filters.branchId || undefined,
          businessDate: scanMode === "QUICK_SCAN" || scanMode === "OPERATIONAL_DAY_SCAN" ? businessDate || undefined : undefined,
          operationalDayId: scanMode === "OPERATIONAL_DAY_SCAN" ? operationalDayId || undefined : undefined,
          ...entityScope,
          category: filters.category || undefined,
          severity: filters.severity || undefined,
          dateFrom: scanMode === "DEEP_SCAN" && dateFrom ? new Date(`${dateFrom}T00:00:00.000Z`).toISOString() : undefined,
          dateTo: scanMode === "DEEP_SCAN" && dateTo ? new Date(`${dateTo}T23:59:59.999Z`).toISOString() : undefined,
          maxIssues: scanMode === "QUICK_SCAN" ? 50 : 150,
          maxEntities: scanMode === "QUICK_SCAN" ? 250 : 1000,
          days: Number(filters.days || 30),
          dryRun,
        }),
      });
      const raw = await response.json();
      if (!response.ok) throw new Error(raw?.error?.message ?? "No se pudo ejecutar el análisis.");
      const result = unwrapApiData(raw) as { created: number; updated: number; reopened: number; expired: number; skipped: number; errors?: unknown[]; total?: number; scannedCategories?: string[] };
      setScanMessage(`${dryRun ? "Dry run" : scanMode} completado: ${result.created} nuevas, ${result.updated} actualizadas, ${result.reopened} reabiertas, ${result.expired} expiradas, ${result.skipped} omitidas, ${result.total ?? 0} hallazgos${result.errors?.length ? `, ${result.errors.length} avisos` : ""}.`);
      if (!dryRun) await load();
    } catch (error) {
      setScanMessage(error instanceof Error ? error.message : "Error ejecutando análisis.");
    } finally {
      setBusyAction(null);
    }
  }

  async function doAct(decisionId: string, action: BrainDecisionAction, note?: string) {
    setBusyAction(`${decisionId}:${action}`);
    try {
      if (action === "approve-and-execute") {
        const approveResp = await apiFetch(`/api/master/brain/decisions/${decisionId}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const approveRaw = await approveResp.json();
        if (!approveResp.ok) throw new Error(approveRaw?.error?.message ?? "No se pudo aprobar la decisión.");

        const executeResp = await apiFetch(`/api/master/brain/decisions/${decisionId}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const executeRaw = await executeResp.json();
        if (!executeResp.ok) throw new Error(executeRaw?.error?.message ?? "Decisión aprobada pero no se pudo ejecutar.");
        const executeResult = unwrapApiData(executeRaw) as { status?: string } | null;
        if (executeResult?.status === "MANUAL_REVIEW") {
          showToast("warning", "Decisión aprobada. Requiere revisión manual — no se ejecutó automáticamente.");
        } else {
          showToast("success", "Decisión aprobada y ejecutada correctamente.");
        }
      } else {
        const body = action === "snooze"
          ? { days: 7, note: "Pospuesto desde Centro de Decisiones" }
          : { note };

        const response = await apiFetch(`/api/master/brain/decisions/${decisionId}/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const raw = await response.json();
        if (!response.ok) throw new Error(raw?.error?.message ?? "No se pudo aplicar la acción.");

        const actionLabels: Record<string, string> = {
          approve: "Decisión aprobada.",
          execute: "Decisión ejecutada.",
          dismiss: "Decisión descartada.",
          snooze: "Decisión pospuesta 7 días.",
          "manual-review": "Marcada para revisión manual.",
          reopen: "Decisión reabierta.",
        };
        showToast("success", actionLabels[action] ?? "Acción aplicada.");
      }
      await load();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Error aplicando acción.");
    } finally {
      setBusyAction(null);
    }
  }

  function act(decisionId: string, action: BrainDecisionAction) {
    if (action === "dismiss" || action === "manual-review") {
      setNoteModal({
        action,
        decisionId,
        prompt: action === "dismiss"
          ? "¿Por qué se descarta esta decisión?"
          : "Nota para la revisión manual (opcional):",
      });
      setNoteText("");
      return;
    }
    void doAct(decisionId, action);
  }

  function submitNote() {
    if (!noteModal) return;
    const { action, decisionId } = noteModal;
    setNoteModal(null);
    void doAct(decisionId, action, noteText || undefined);
  }

  const kpis = data?.kpis ?? { openCritical: 0, highRisk: 0, estimatedImpact: 0, reorderSuggested: 0, cashRisks: 0, lowMarginPrices: 0, lateDispatches: 0, manualReview: 0 };
  const decisions = [...(data?.decisions ?? []), ...extraDecisions];
  const latestScan = decisions.map(decisionTime).sort().at(-1);
  const systemState = busyAction === "scan" || busyAction === "dry-run"
    ? { label: "Escaneando",        tone: "border-[var(--color-info-200)] bg-[var(--color-info-50)] text-[var(--color-info-700)]",       icon: Loader2 }
    : kpis.openCritical > 0 || (kpis.manualReview ?? 0) > 0
      ? { label: "Revisión requerida", tone: "border-[var(--color-warning-200)] bg-[var(--color-warning-50)] text-[var(--color-warning-700)]", icon: AlertTriangle }
      : { label: "Listo",             tone: "border-[var(--color-success-200)] bg-[var(--color-success-50)] text-[var(--color-success-700)]", icon: CheckCircle2 };
  const StateIcon = systemState.icon;
  const priorities = decisions
    .filter((decision) => ["OPEN", "MANUAL_REVIEW", "APPROVED"].includes(decision.status))
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || asNumber(b.priorityScore) - asNumber(a.priorityScore))
    .slice(0, 6);
  const quickChips = [
    { id: "critical",   label: "Críticas",       count: kpis.openCritical,                                                                                                     patch: { severity: "CRITICAL", onlyCritical: "" } },
    { id: "pricing",    label: "Pricing",         count: kpis.lowMarginPrices,                                                                                                  patch: { category: "PRICING", onlyPricing: "" } },
    { id: "inventory",  label: "Inventario",      count: decisions.filter((d) => d.category === "INVENTORY").length,                                                             patch: { category: "INVENTORY", onlyInventory: "" } },
    { id: "reorder",    label: "Reposición",      count: kpis.reorderSuggested,                                                                                                  patch: { category: "REORDER" } },
    { id: "low-margin", label: "Margen bajo",     count: kpis.lowMarginPrices,                                                                                                  patch: { category: "PRICING", search: "margen" } },
    { id: "below-cost", label: "Bajo costo",      count: decisions.filter((d) => `${d.title} ${d.description} ${d.proposedActionType ?? ""}`.toLowerCase().includes("costo")).length, patch: { category: "PRICING", search: "costo" } },
    { id: "cz-stock",   label: "CZ con stock",    count: decisions.filter((d) => `${d.title} ${d.description}`.toLowerCase().includes("cz")).length,                             patch: { search: "CZ" } },
    { id: "transfers",  label: "Traslados",       count: decisions.filter((d) => `${d.title} ${d.description} ${d.recommendation}`.toLowerCase().includes("traslado")).length,   patch: { search: "traslado" } },
    { id: "cash",       label: "Caja",            count: kpis.cashRisks,                                                                                                          patch: { category: "CASH", onlyCash: "" } },
    { id: "manual",     label: "Revisión manual", count: kpis.manualReview ?? 0,                                                                                                  patch: { status: "MANUAL_REVIEW" } },
    { id: "approved",   label: "Aprobadas",       count: decisions.filter((d) => d.status === "APPROVED").length,                                                                 patch: { status: "APPROVED" } },
    { id: "today",      label: "Nuevas hoy",      count: decisions.filter((d) => new Date(d.createdAt).toDateString() === new Date().toDateString()).length,                      patch: { days: "7", sort: "newest" } },
  ];

  function resetFilters() {
    setFilters(initialFilters);
    window.localStorage.removeItem(FILTER_STORAGE_KEY);
  }

  function toggleQuickChip(chip: { id: string; patch: Partial<BrainFilterState> }) {
    const active = Object.entries(chip.patch).every(([key, value]) => filters[key as keyof BrainFilterState] === value);
    setFilters((current) => active
      ? { ...current, ...Object.fromEntries(Object.keys(chip.patch).map((key) => [key, initialFilters[key as keyof BrainFilterState]])) }
      : { ...current, ...chip.patch });
  }

  const inputCls = "hm-input text-sm disabled:cursor-not-allowed";

  return (
    <main className="space-y-5">
      {/* Note modal */}
      {noteModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={() => setNoteModal(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-modal)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-extrabold text-[var(--color-text)]">
                {noteModal.action === "dismiss" ? "Descartar decisión" : "Revisión manual"}
              </h3>
              <button
                type="button"
                onClick={() => setNoteModal(null)}
                className="rounded-lg p-1 text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="block text-sm text-[var(--color-text-secondary)]">{noteModal.prompt}</label>
            <textarea
              ref={noteTextareaRef}
              className="hm-input mt-2 text-sm"
              rows={3}
              placeholder="Nota (opcional)…"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submitNote(); }}
            />
            <p className="mt-1 text-xs text-[var(--color-text-soft)]">Ctrl+Enter para confirmar</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="hm-btn hm-btn-secondary hm-btn-sm"
                onClick={() => setNoteModal(null)}
              >
                Cancelar
              </button>
              <button type="button" className="hm-btn hm-btn-master hm-btn-sm" onClick={submitNote}>
                Confirmar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Page header */}
      <header className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-card)] lg:p-7">
        <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex min-w-0 gap-4">
            <div className="hidden h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-[var(--color-master-600)] text-white shadow-[var(--shadow-colored-blue)] sm:flex">
              <Brain className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-[var(--color-master-200)] bg-[var(--color-master-50)] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[var(--color-master-700)]">
                  Master
                </span>
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${systemState.tone}`}>
                  <StateIcon className={`h-3.5 w-3.5 ${busyAction === "scan" || busyAction === "dry-run" ? "animate-spin" : ""}`} />
                  {systemState.label}
                </span>
              </div>
              <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-[var(--color-text)] lg:text-3xl">
                H.A.M.M.E.R. Brain
              </h1>
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[var(--color-text-muted)]">
                Centro de decisiones, riesgos y acciones operativas.
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-1 text-[var(--color-text-muted)]">
                  <RadioTower className="h-3.5 w-3.5 text-[var(--color-master-600)]" />
                  Último escaneo: {formatDate(latestScan)}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-1 text-[var(--color-text-muted)]">
                  <ShieldCheck className="h-3.5 w-3.5 text-[var(--color-success-600)]" />
                  Acciones con trazabilidad
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 lg:justify-end">
            <button
              type="button"
              disabled={Boolean(busyAction)}
              className="hm-btn hm-btn-master hm-btn-sm"
              onClick={() => void scan(false)}
            >
              {busyAction === "scan" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
              {busyAction === "scan" ? "Escaneando..." : scanMode === "QUICK_SCAN" ? "Escaneo rápido" : "Escanear scope"}
            </button>
            <button type="button" className="hm-btn hm-btn-secondary hm-btn-sm" onClick={scrollToPriorities}>
              <ArrowDown className="h-4 w-4" />
              Ver prioridades
            </button>
          </div>
        </div>
      </header>

      <BrainSummary kpis={kpis} />

      {/* Scanner panel — collapsible */}
      <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            className="flex flex-1 items-center gap-2.5 text-left"
            onClick={() => setScannerOpen((v) => !v)}
          >
            <ChevronDown
              className={`h-4 w-4 flex-shrink-0 text-[var(--color-text-muted)] transition-transform duration-200 ${scannerOpen ? "rotate-180" : ""}`}
            />
            <span className="text-sm font-semibold text-[var(--color-text-muted)]">Opciones de escaneo</span>
            <span className="rounded-md border border-[var(--color-master-200)] bg-[var(--color-master-50)] px-2 py-0.5 text-xs font-bold text-[var(--color-master-700)]">
              {scanMode.replace(/_/g, " ")}
            </span>
          </button>
          <button
            type="button"
            disabled={Boolean(busyAction)}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-master-600)] px-4 py-2 text-sm font-bold text-white transition hover:bg-[var(--color-master-500)] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void scan(false)}
          >
            {busyAction === "scan" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
            {busyAction === "scan" ? "Escaneando..." : "Ejecutar"}
          </button>
        </div>

        {scannerOpen ? (
          <div className="animate-fade-in border-t border-[var(--color-border)] p-4">
            <div className="grid gap-3 lg:grid-cols-12">
              <label className="space-y-1 text-xs font-bold text-[var(--color-text-muted)] lg:col-span-3">
                Tipo de escaneo
                <select
                  className={inputCls}
                  value={scanMode}
                  onChange={(event) => setScanMode(event.target.value as BrainScanMode)}
                >
                  <option value="QUICK_SCAN">Escaneo rápido</option>
                  <option value="OPERATIONAL_DAY_SCAN">Día operativo</option>
                  <option value="ENTITY_SCAN">Entidad</option>
                  <option value="DEEP_SCAN">Profundo</option>
                  <option value="REPAIR_SCAN">Revalidar abiertos</option>
                </select>
              </label>
              <label className="space-y-1 text-xs font-bold text-[var(--color-text-muted)] lg:col-span-2">
                Fecha operativa
                <input className={inputCls} type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} />
              </label>
              <label className="space-y-1 text-xs font-bold text-[var(--color-text-muted)] lg:col-span-3">
                Día operativo ID
                <input className={inputCls} value={operationalDayId} onChange={(event) => setOperationalDayId(event.target.value)} placeholder="OperationalDay" />
              </label>
              <label className="space-y-1 text-xs font-bold text-[var(--color-text-muted)] lg:col-span-2">
                Desde
                <input className={inputCls} type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} disabled={scanMode !== "DEEP_SCAN"} />
              </label>
              <label className="space-y-1 text-xs font-bold text-[var(--color-text-muted)] lg:col-span-2">
                Hasta
                <input className={inputCls} type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} disabled={scanMode !== "DEEP_SCAN"} />
              </label>
              <label className="space-y-1 text-xs font-bold text-[var(--color-text-muted)] lg:col-span-3">
                Orden ID
                <input className={inputCls} value={saleOrderId} onChange={(event) => setSaleOrderId(event.target.value)} disabled={scanMode !== "ENTITY_SCAN"} placeholder="SaleOrder" />
              </label>
              <label className="space-y-1 text-xs font-bold text-[var(--color-text-muted)] lg:col-span-3">
                Caja ID
                <input className={inputCls} value={cashSessionId} onChange={(event) => setCashSessionId(event.target.value)} disabled={scanMode !== "ENTITY_SCAN"} placeholder="CashSession" />
              </label>
            </div>
            {process.env.NODE_ENV !== "production" ? (
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  disabled={Boolean(busyAction)}
                  className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-4 py-2 text-sm font-bold text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => void scan(true)}
                >
                  <Sparkles className="h-4 w-4" />
                  {busyAction === "dry-run" ? "Simulando..." : "Dry-run"}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* Executive summary */}
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
        <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[var(--color-master-600)]" />
              <h2 className="text-lg font-extrabold text-[var(--color-text)]">Resumen ejecutivo</h2>
            </div>
            <p className="mt-1 text-sm font-semibold text-[var(--color-master-700)]">
              {data?.priorityMessage ?? "El Brain está listo para priorizar decisiones operativas."}
            </p>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--color-text-secondary)]">
              {(data?.executiveSummary?.length ? data.executiveSummary : ["Sin resumen ejecutivo disponible para los filtros actuales."]).map((line) => (
                <li key={line} className="flex gap-2">
                  <CheckCircle2 className="mt-1 h-4 w-4 flex-shrink-0 text-[var(--color-success-600)]" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <SummaryPill label="Total"       value={data?.totalDecisions ?? decisions.length} />
            <SummaryPill label="Críticas"    value={data?.criticalCount ?? kpis.openCritical} />
            <SummaryPill label="Alto riesgo" value={data?.highRiskCount ?? kpis.highRisk ?? 0} />
            <SummaryPill label="Impacto"     value={formatMoney(data?.estimatedImpactAmount ?? kpis.estimatedImpact)} />
            <SummaryPill label="Pricing"     value={data?.categoriesBreakdown?.pricing ?? 0} />
            <SummaryPill label="Inventario"  value={data?.categoriesBreakdown?.inventory ?? 0} />
          </div>
        </div>
      </section>

      {/* Priorities */}
      <section id="brain-priorities" className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold text-[var(--color-text)]">Prioridades de hoy</h2>
            <p className="text-sm text-[var(--color-text-muted)]">Las decisiones abiertas más importantes según severidad y prioridad.</p>
          </div>
          <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-1 text-xs font-bold text-[var(--color-text-muted)]">
            {priorities.length} visibles
          </span>
        </div>
        {loading ? (
          <LoadingPanel label="Escaneando riesgos operativos..." />
        ) : priorities.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {priorities.map((decision) => (
              <PriorityItem
                key={decision.id}
                decision={decision}
                onOpen={() => setFilters((current) => ({ ...current, search: decision.title, status: "" }))}
              />
            ))}
          </div>
        ) : (
          <EmptyPanel label="No hay prioridades críticas abiertas." />
        )}
      </section>

      <BrainFilters filters={filters} branches={branches} onChange={setFilters} onReset={resetFilters} />

      {/* Quick chips */}
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-card)]">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Chips rápidos</p>
          <button
            type="button"
            className="text-xs font-bold text-[var(--color-master-700)] hover:text-[var(--color-master-600)]"
            onClick={resetFilters}
          >
            Limpiar filtros
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {quickChips.map((chip) => {
            const active = Object.entries(chip.patch).every(([key, value]) => filters[key as keyof BrainFilterState] === value);
            return (
              <button
                key={chip.id}
                type="button"
                className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                  active
                    ? "border-[var(--color-master-300,#93c5fd)] bg-[var(--color-master-600)] text-white shadow-sm"
                    : "border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface)]"
                }`}
                onClick={() => toggleQuickChip(chip)}
              >
                {chip.label}
                <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-extrabold ${active ? "bg-white/20 text-white" : "bg-[var(--color-surface)] text-[var(--color-text-muted)]"}`}>
                  {chip.count}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {scanMessage ? (
        <div className={`rounded-xl border px-4 py-3 text-sm ${scanMessage.includes("Error") || scanMessage.includes("No se pudo") ? "border-[var(--color-danger-200)] bg-[var(--color-danger-50)] text-[var(--color-danger-700)]" : "border-[var(--color-master-200)] bg-[var(--color-master-50)] text-[var(--color-master-700)]"}`}>
          {scanMessage}
        </div>
      ) : null}

      {/* Decisions list */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold text-[var(--color-text)]">Decisiones operativas</h2>
            <p className="text-sm text-[var(--color-text-muted)]">Riesgos, recomendaciones y acciones pendientes.</p>
          </div>
          <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-xs font-bold text-[var(--color-text-muted)]">
            {decisions.length} resultados
          </span>
        </div>

        {/* Status tabs */}
        <div className="flex flex-wrap gap-1.5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-1.5">
          {STATUS_TABS.map((tab) => {
            const active = filters.status === tab.value;
            const count = tab.value === "" ? decisions.length : decisions.filter((d) => d.status === tab.value).length;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setFilters((f) => ({ ...f, status: tab.value }))}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                  active
                    ? "bg-[var(--color-surface)] text-[var(--color-master-700)] shadow-[var(--shadow-xs)] ring-1 ring-[var(--color-master-200)]"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text-secondary)]"
                }`}
              >
                {tab.value === "OPEN" ? <Zap className="h-3 w-3" /> : null}
                {tab.label}
                {count > 0 ? (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-extrabold ${active ? "bg-[var(--color-master-100)] text-[var(--color-master-700)]" : "bg-[var(--color-border)] text-[var(--color-text-muted)]"}`}>
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {loading ? (
          <LoadingPanel label="Escaneando riesgos operativos..." />
        ) : decisions.length ? (
          <>
            {decisions.map((decision) => (
              <DecisionCard key={decision.id} decision={decision} busy={Boolean(busyAction)} onAction={act} />
            ))}
            {nextCursor ? (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  disabled={loadingMore}
                  className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-2.5 text-sm font-bold text-[var(--color-text-secondary)] shadow-[var(--shadow-xs)] transition hover:bg-[var(--color-surface-alt)] disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => void loadMore()}
                >
                  {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {loadingMore ? "Cargando..." : "Cargar más decisiones"}
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <EmptyPanel label="No hay decisiones para los filtros actuales." />
        )}
      </section>
    </main>
  );
}

function PriorityItem({ decision, onOpen }: { decision: BrainDecision; onOpen: () => void }) {
  const sevCls = SEV_CHIP[decision.severity] ?? "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]";
  return (
    <button
      type="button"
      className="group rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left shadow-[var(--shadow-card)] transition hover:border-[var(--color-master-200)] hover:shadow-[var(--shadow-card-hover)]"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2 text-[11px] font-bold uppercase">
            <span className={`rounded-full px-2 py-1 ${sevCls}`}>{decision.severity}</span>
            <span className="rounded-full bg-[var(--color-surface-alt)] px-2 py-1 text-[var(--color-text-muted)]">{decision.category}</span>
          </div>
          <h3 className="mt-3 line-clamp-2 text-sm font-extrabold text-[var(--color-text)]">{decision.title}</h3>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--color-text-secondary)]">{decision.recommendation || decision.description}</p>
        </div>
        <AlertTriangle className="h-5 w-5 flex-shrink-0 text-[var(--color-warning-600)] transition group-hover:scale-110" />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--color-text-soft)]">
        {decision.branch ? <span>{decision.branch.code}</span> : null}
        {decision.product ? <span>{decision.product.sku}</span> : null}
        {decision.proposedActionType ? <span>{decision.proposedActionType}</span> : null}
      </div>
    </button>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-[var(--color-master-100)] bg-[var(--color-master-50)] px-5 py-8 text-center text-sm font-semibold text-[var(--color-master-700)]">
      <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin" />
      {label}
    </div>
  );
}

function EmptyPanel({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-alt)] px-5 py-8 text-center text-sm text-[var(--color-text-muted)]">
      <CheckCircle2 className="mx-auto mb-3 h-6 w-6 text-[var(--color-success-600)]" />
      {label}
    </div>
  );
}

function SummaryPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</div>
      <div className="mt-1 font-extrabold text-[var(--color-text)]">{value}</div>
    </div>
  );
}
