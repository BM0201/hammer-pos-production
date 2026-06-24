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
  // Bug 1: server provides per-status counts computed WITHOUT the status filter
  statusCounts?: Record<string, number>;
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
  // Bug 2: priorities come from a separate query, not derived from the status-filtered decisions array
  const [priorityDecisions, setPriorityDecisions] = useState<BrainDecision[]>([]);
  const [loadingPriorities, setLoadingPriorities] = useState(true);

  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);
  // Bug 4: hydration guard — prevents save effect from overwriting localStorage on mount
  const hydrated = useRef(false);
  // Bug 6: focus management for note modal
  const noteOpenTriggerRef = useRef<HTMLElement | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return params.toString();
  }, [filters]);

  // Bug 2: priority query excludes status filter and always fetches actionable decisions sorted by priority
  const filtersWithoutStatus = useMemo(() => {
    const { status: _s, ...rest } = filters;
    return rest;
  }, [filters]);

  const priorityQuery = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filtersWithoutStatus).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    params.set("onlyActionable", "true");
    params.set("sort", "priority");
    params.set("limit", "6");
    return params.toString();
  }, [filtersWithoutStatus]);

  // Bug 6: stable close function so Esc effect can depend on it
  const closeNoteModal = useCallback(() => {
    setNoteModal(null);
    setTimeout(() => noteOpenTriggerRef.current?.focus(), 50);
  }, []);

  // Bug 4: load saved filters on mount only, then mark hydrated
  useEffect(() => {
    const stored = window.localStorage.getItem(FILTER_STORAGE_KEY);
    if (stored) {
      try {
        setFilters({ ...initialFilters, ...JSON.parse(stored) });
      } catch {
        window.localStorage.removeItem(FILTER_STORAGE_KEY);
      }
    }
    hydrated.current = true;
  }, []);

  // Bug 4: only persist after hydration so mount doesn't overwrite stored value
  useEffect(() => {
    if (!hydrated.current) return;
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

  // Bug 2: separate loader for the priorities panel — never filtered by status
  const loadPriorities = useCallback(async () => {
    setLoadingPriorities(true);
    try {
      const response = await apiFetch(`/api/master/brain/decisions?${priorityQuery}`);
      const raw = await response.json();
      if (!response.ok) return;
      const result = unwrapApiData(raw) as BrainResponse;
      setPriorityDecisions(result.decisions);
    } catch {
      // non-critical panel, fail silently
    } finally {
      setLoadingPriorities(false);
    }
  }, [priorityQuery]);

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

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadPriorities(); }, [loadPriorities]);

  useEffect(() => {
    if (noteModal) setTimeout(() => noteTextareaRef.current?.focus(), 50);
  }, [noteModal]);

  // Bug 6: Escape key closes the note modal
  useEffect(() => {
    if (!noteModal) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeNoteModal();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [noteModal, closeNoteModal]);

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
      if (!dryRun) {
        await load();
        void loadPriorities(); // Bug 2: refresh priorities after scan
      }
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
      void loadPriorities(); // Bug 2: refresh priorities after any action
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Error aplicando acción.");
    } finally {
      setBusyAction(null);
    }
  }

  function act(decisionId: string, action: BrainDecisionAction) {
    if (action === "dismiss" || action === "manual-review") {
      noteOpenTriggerRef.current = document.activeElement as HTMLElement; // Bug 6: capture trigger for focus restore
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
    closeNoteModal(); // Bug 6: restores focus to trigger element
    void doAct(decisionId, action, noteText || undefined);
  }

  const kpis = data?.kpis ?? { openCritical: 0, highRisk: 0, estimatedImpact: 0, reorderSuggested: 0, cashRisks: 0, lowMarginPrices: 0, lateDispatches: 0, manualReview: 0 };
  const decisions = [...(data?.decisions ?? []), ...extraDecisions];

  // Bug 3: robust latestScan — filter nulls before comparing, compare as numbers not strings
  // TODO: server should return lastScanAt so this is always accurate regardless of pagination
  const latestScan = useMemo(() => {
    const timestamps = decisions
      .map(decisionTime)
      .filter(Boolean)
      .map((d) => new Date(d!).getTime())
      .filter(Number.isFinite);
    if (!timestamps.length) return null;
    return new Date(Math.max(...timestamps));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decisions]);

  const systemState = busyAction === "scan" || busyAction === "dry-run"
    ? { label: "Escaneando",          tone: "border-[var(--color-info-200)] bg-[var(--color-info-50)] text-[var(--color-info-700)]",       icon: Loader2 }
    : kpis.openCritical > 0 || (kpis.manualReview ?? 0) > 0
      ? { label: "Revisión requerida", tone: "border-[var(--color-warning-200)] bg-[var(--color-warning-50)] text-[var(--color-warning-700)]", icon: AlertTriangle }
      : { label: "Listo",              tone: "border-[var(--color-success-200)] bg-[var(--color-success-50)] text-[var(--color-success-700)]", icon: CheckCircle2 };
  const StateIcon = systemState.icon;

  // Bug 1: statusCounts from server (grouped by status WITHOUT applying the status filter)
  const statusCounts = data?.statusCounts ?? {};
  const totalCount = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  // Bug 1: chips use reliable server-side counts; text-search chips hide the badge (count: undefined)
  const quickChips: Array<{ id: string; label: string; count: number | undefined; patch: Partial<BrainFilterState> }> = [
    { id: "critical",   label: "Críticas",       count: kpis.openCritical,                                           patch: { severity: "CRITICAL", onlyCritical: "" } },
    { id: "pricing",    label: "Pricing",         count: kpis.lowMarginPrices,                                        patch: { category: "PRICING", onlyPricing: "" } },
    { id: "inventory",  label: "Inventario",      count: data?.categoriesBreakdown?.inventory ?? 0,                   patch: { category: "INVENTORY", onlyInventory: "" } },
    { id: "reorder",    label: "Reposición",      count: kpis.reorderSuggested,                                       patch: { category: "REORDER" } },
    { id: "low-margin", label: "Margen bajo",     count: kpis.lowMarginPrices,                                        patch: { category: "PRICING", search: "margen" } },
    { id: "below-cost", label: "Bajo costo",      count: undefined,                                                   patch: { category: "PRICING", search: "costo" } },
    { id: "cz-stock",   label: "CZ con stock",    count: undefined,                                                   patch: { search: "CZ" } },
    { id: "transfers",  label: "Traslados",        count: undefined,                                                   patch: { search: "traslado" } },
    { id: "cash",       label: "Caja",            count: kpis.cashRisks,                                              patch: { category: "CASH", onlyCash: "" } },
    { id: "manual",     label: "Revisión manual", count: statusCounts["MANUAL_REVIEW"] ?? (kpis.manualReview ?? 0),  patch: { status: "MANUAL_REVIEW" } },
    { id: "approved",   label: "Aprobadas",       count: statusCounts["APPROVED"],                                    patch: { status: "APPROVED" } },
    { id: "today",      label: "Nuevas hoy",      count: undefined,                                                   patch: { days: "7", sort: "newest" } },
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
      {/* Note modal — Bug 6: Esc key (via effect), focus trap, focus restore on close */}
      {noteModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={closeNoteModal}
        >
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-label={noteModal.action === "dismiss" ? "Descartar decisión" : "Revisión manual"}
            className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-modal)]"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key !== "Tab") return;
              const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
                'button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
              );
              if (!focusable?.length) return;
              const first = focusable[0];
              const last = focusable[focusable.length - 1];
              if (e.shiftKey) {
                if (document.activeElement === first) { last.focus(); e.preventDefault(); }
              } else {
                if (document.activeElement === last) { first.focus(); e.preventDefault(); }
              }
            }}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-extrabold text-[var(--color-text)]">
                {noteModal.action === "dismiss" ? "Descartar decisión" : "Revisión manual"}
              </h3>
              <button
                type="button"
                aria-label="Cerrar"
                onClick={closeNoteModal}
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
              <button type="button" className="hm-btn hm-btn-secondary hm-btn-sm" onClick={closeNoteModal}>
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
                  {/* Bug 3: compare timestamps as numbers, not lexicographic strings */}
                  Último escaneo: {latestScan ? latestScan.toLocaleString("es-NI", { dateStyle: "medium", timeStyle: "short" }) : "Sin escaneo reciente"}
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
                <select className={inputCls} value={scanMode} onChange={(event) => setScanMode(event.target.value as BrainScanMode)}>
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
            {/* Bug 5: index-based key avoids collision on duplicate text lines */}
            <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--color-text-secondary)]">
              {(data?.executiveSummary?.length ? data.executiveSummary : ["Sin resumen ejecutivo disponible para los filtros actuales."]).map((line, index) => (
                <li key={`exec-${index}`} className="flex gap-2">
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

      {/* Priorities — Bug 2: separate query, independent of filters.status */}
      <section id="brain-priorities" className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold text-[var(--color-text)]">Prioridades de hoy</h2>
            <p className="text-sm text-[var(--color-text-muted)]">Las decisiones abiertas más importantes según severidad y prioridad.</p>
          </div>
          <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-1 text-xs font-bold text-[var(--color-text-muted)]">
            {priorityDecisions.length} visibles
          </span>
        </div>
        {loadingPriorities ? (
          <LoadingPanel label="Escaneando riesgos operativos..." />
        ) : priorityDecisions.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {priorityDecisions.map((decision) => (
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
                {chip.count !== undefined && chip.count > 0 ? (
                  <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-extrabold ${active ? "bg-white/20 text-white" : "bg-[var(--color-surface)] text-[var(--color-text-muted)]"}`}>
                    {chip.count}
                  </span>
                ) : null}
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

        {/* Status tabs — Bug 1: counts from server statusCounts (no status filter), not from paginated decisions array */}
        <div className="flex flex-wrap gap-1.5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-1.5">
          {STATUS_TABS.map((tab) => {
            const active = filters.status === tab.value;
            const count = tab.value === "" ? totalCount : statusCounts[tab.value];
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
                {count !== undefined && count > 0 ? (
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
