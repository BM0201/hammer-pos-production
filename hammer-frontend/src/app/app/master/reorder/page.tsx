"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  PackageSearch,
  Loader2,
  AlertTriangle,
  RefreshCw,
  ShoppingCart,
  ArrowLeftRight,
  XCircle,
  Layers,
  ClipboardList,
  Save,
  Plus,
  Building2,
} from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import toast from "react-hot-toast";

/* ════════════════════════════════════════════════════════════════
 *  Types
 * ════════════════════════════════════════════════════════════════ */

type Branch = { id: string; code: string; name: string };
type Product = { id: string; sku: string; name: string; unit: string };

type ReorderAlert = {
  id: string;
  branchId: string;
  productId: string;
  currentQuantity: string;
  reorderPoint: string;
  targetQuantity: string;
  suggestedQuantity: string;
  alertType: "PURCHASE" | "TRANSFER" | "BOTH";
  status: "OPEN" | "DISMISSED" | "CONVERTED_TO_PURCHASE_ORDER" | "CONVERTED_TO_TRANSFER";
  nearestSourceBranchId: string | null;
  nearestSourceStock: string | null;
  preferredSupplier: string | null;
  reason: string;
  createdAt: string;
  product: { id: string; sku: string; name: string; unit: string };
  branch: { id: string; code: string; name: string };
  sourceBranch: { id: string; code: string; name: string } | null;
};

type ReorderBatch = {
  id: string;
  branchId: string;
  sourceBranchId: string | null;
  supplier: string | null;
  suggestionType: "PURCHASE" | "TRANSFER";
  status: "DRAFT" | "REVIEWED" | "CONVERTED" | "DISCARDED";
  totalEstimatedCost: string;
  createdAt: string;
  branch: { id: string; code: string; name: string };
  sourceBranch: { id: string; code: string; name: string } | null;
  lines: {
    id: string;
    productId: string;
    currentQuantity: string;
    suggestedQuantity: string;
    unitCostSnapshot: string | null;
    product: { id: string; sku: string; name: string; unit: string };
  }[];
};

type ReorderPolicy = {
  id: string;
  branchId: string;
  productId: string;
  minQuantity: string;
  reorderPoint: string;
  targetQuantity: string;
  safetyStock: string;
  preferredSupplier: string | null;
  leadTimeDays: number;
  isActive: boolean;
  product: { id: string; sku: string; name: string; unit: string };
  branch: { id: string; code: string; name: string };
};

type Tab = "alerts" | "batches" | "policies";
type ReorderPolicyPayload = {
  branchId: string;
  productId: string;
  reorderPoint: number;
  targetQuantity: number;
  minQuantity: number;
  safetyStock: number;
  preferredSupplier: string | null;
  leadTimeDays: number;
  isActive: boolean;
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/* ════════════════════════════════════════════════════════════════
 *  Inline status badges
 * ════════════════════════════════════════════════════════════════ */

function AlertStatusBadge({ status }: { status: ReorderAlert["status"] }) {
  const cfg: Record<string, { bg: string; text: string; label: string }> = {
    OPEN: { bg: "bg-[var(--color-warning-100)]", text: "text-[var(--color-warning-700)]", label: "Abierta" },
    DISMISSED: { bg: "bg-[var(--color-surface-alt)]", text: "text-[var(--color-text)]", label: "Descartada" },
    CONVERTED_TO_PURCHASE_ORDER: { bg: "bg-[var(--color-info-50)]", text: "text-[var(--color-info-700)]", label: "Convertida a PO" },
    CONVERTED_TO_TRANSFER: { bg: "bg-[var(--color-success-50)]", text: "text-[var(--color-success-700)]", label: "Convertida a Transfer" },
  };
  const c = cfg[status] || { bg: "bg-[var(--color-surface-alt)]", text: "text-[var(--color-text)]", label: status };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

function AlertTypeBadge({ alertType }: { alertType: ReorderAlert["alertType"] }) {
  const cfg: Record<string, { bg: string; text: string; label: string }> = {
    PURCHASE: { bg: "bg-[var(--color-info-50)]", text: "text-purple-800", label: "Compra" },
    TRANSFER: { bg: "bg-cyan-100", text: "text-cyan-800", label: "Transferencia" },
    BOTH: { bg: "bg-[var(--color-warning-100)]", text: "text-[var(--color-warning-700)]", label: "Compra + Transfer" },
  };
  const c = cfg[alertType] || { bg: "bg-[var(--color-surface-alt)]", text: "text-[var(--color-text)]", label: alertType };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

function BatchStatusBadge({ status }: { status: ReorderBatch["status"] }) {
  const cfg: Record<string, { bg: string; text: string; label: string }> = {
    DRAFT: { bg: "bg-[var(--color-warning-100)]", text: "text-[var(--color-warning-700)]", label: "Borrador" },
    REVIEWED: { bg: "bg-[var(--color-info-50)]", text: "text-[var(--color-info-700)]", label: "Revisado" },
    CONVERTED: { bg: "bg-[var(--color-success-50)]", text: "text-[var(--color-success-700)]", label: "Convertido" },
    DISCARDED: { bg: "bg-[var(--color-surface-alt)]", text: "text-[var(--color-text)]", label: "Descartado" },
  };
  const c = cfg[status] || { bg: "bg-[var(--color-surface-alt)]", text: "text-[var(--color-text)]", label: status };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

/* ════════════════════════════════════════════════════════════════
 *  Main Page
 * ════════════════════════════════════════════════════════════════ */

export default function ReorderPage() {
  const [activeTab, setActiveTab] = useState<Tab>("alerts");
  

  /* Shared state */
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  /* Alerts state */
  const [alerts, setAlerts] = useState<ReorderAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertStatusFilter, setAlertStatusFilter] = useState<string>("OPEN");
  const [alertBranchFilter, setAlertBranchFilter] = useState<string>("");
  const [evaluating, setEvaluating] = useState(false);
  const [alertActionLoading, setAlertActionLoading] = useState<string | null>(null);

  /* Batches state */
  const [batches, setBatches] = useState<ReorderBatch[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [batchStatusFilter, setBatchStatusFilter] = useState<string>("DRAFT");
  const [batchActionLoading, setBatchActionLoading] = useState<string | null>(null);

  /* Policies state */
  const [policies, setPolicies] = useState<ReorderPolicy[]>([]);
  const [policiesLoading, setPoliciesLoading] = useState(false);
  const [policyBranchFilter, setPolicyBranchFilter] = useState<string>("");
  const [policyEdits, setPolicyEdits] = useState<Record<string, Partial<ReorderPolicy>>>({});
  const [policySaving, setPolicySaving] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);

  /* New policy form */
  const [newPolicyBranch, setNewPolicyBranch] = useState("");
  const [newPolicyProduct, setNewPolicyProduct] = useState("");
  const [newPolicyReorderPoint, setNewPolicyReorderPoint] = useState("");
  const [newPolicyTarget, setNewPolicyTarget] = useState("");
  const [newPolicySafety, setNewPolicySafety] = useState("0");
  const [newPolicySupplier, setNewPolicySupplier] = useState("");
  const [newPolicyLeadTime, setNewPolicyLeadTime] = useState("0");

  /* ── Fetchers ── */

  const fetchMeta = useCallback(async () => {
    try {
      const [bRes, pRes] = await Promise.all([
        fetch("/api/master/users"),
        fetch("/api/catalog/products"),
      ]);
      const bJson = unwrapApiData(await bRes.json());
      const pJson = unwrapApiData(await pRes.json());
      if (bJson?.branches) setBranches(bJson.branches);
      setProducts(Array.isArray(pJson) ? pJson : []);
    } catch { /* non-critical */ }
  }, []);

  const fetchAlerts = useCallback(async () => {
    try {
      setAlertsLoading(true);
      const params = new URLSearchParams();
      if (alertStatusFilter) params.set("status", alertStatusFilter);
      if (alertBranchFilter) params.set("branchId", alertBranchFilter);
      const res = await fetch(`/api/master/reorder/alerts?${params.toString()}`);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al cargar alertas");
      const alertsData = unwrapApiData(raw);
      setAlerts(Array.isArray(alertsData) ? alertsData : []);
    } catch (error) {
      toast.error(getErrorMessage(error, "Error al cargar alertas"));
    } finally {
      setAlertsLoading(false);
    }
  }, [alertStatusFilter, alertBranchFilter]);

  const fetchBatches = useCallback(async () => {
    try {
      setBatchesLoading(true);
      const params = new URLSearchParams();
      if (batchStatusFilter) params.set("status", batchStatusFilter);
      const res = await fetch(`/api/master/reorder/batches?${params.toString()}`);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al cargar lotes");
      const batchesData = unwrapApiData(raw);
      setBatches(Array.isArray(batchesData) ? batchesData : []);
    } catch (error) {
      toast.error(getErrorMessage(error, "Error al cargar lotes"));
    } finally {
      setBatchesLoading(false);
    }
  }, [batchStatusFilter]);

  const fetchPolicies = useCallback(async () => {
    try {
      setPoliciesLoading(true);
      const params = new URLSearchParams();
      if (policyBranchFilter) params.set("branchId", policyBranchFilter);
      const res = await fetch(`/api/master/reorder/policies?${params.toString()}`);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al cargar políticas");
      const policiesData = unwrapApiData(raw);
      setPolicies(Array.isArray(policiesData) ? policiesData : []);
      setPolicyEdits({});
    } catch (error) {
      toast.error(getErrorMessage(error, "Error al cargar políticas"));
    } finally {
      setPoliciesLoading(false);
    }
  }, [policyBranchFilter]);

  /* ── Initial / Tab-specific loads ── */

  useEffect(() => { fetchMeta(); }, [fetchMeta]);

  useEffect(() => {
    if (activeTab === "alerts") fetchAlerts();
  }, [activeTab, fetchAlerts]);

  useEffect(() => {
    if (activeTab === "batches") fetchBatches();
  }, [activeTab, fetchBatches]);

  useEffect(() => {
    if (activeTab === "policies") fetchPolicies();
  }, [activeTab, fetchPolicies]);

  /* ── Feedback via react-hot-toast ── */

  /* ── Alert actions ── */

  const handleEvaluate = async () => {
    if (!confirm("¿Ejecutar evaluación de reposición ahora? Se analizarán todas las políticas activas y se generarán alertas/lotes nuevos.")) return;
    try {
      setEvaluating(true);
      
      const res = await apiFetch("/api/master/reorder/evaluate", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al evaluar");
      const json = unwrapApiData(raw);
      const { alertsCreated, batchesCreated, skippedDuplicates } = json;
      toast.success(
        `Evaluación completada: ${alertsCreated} alertas creadas, ${batchesCreated} lotes generados, ${skippedDuplicates} omitidos (duplicados).`,
      );
      fetchAlerts();
      fetchBatches();
    } catch (error) {
      toast.error(getErrorMessage(error, "Error al evaluar"));
    } finally {
      setEvaluating(false);
    }
  };

  const handleConvertAlertToPO = async (alertId: string) => {
    if (!confirm("¿Convertir esta alerta en un Pedido de Compra (PO) en estado borrador?")) return;
    try {
      setAlertActionLoading(alertId);
      
      const res = await apiFetch(`/api/master/reorder/alerts/${alertId}/convert-purchase-order`, {
        method: "POST",
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al convertir alerta");
      const json = unwrapApiData(raw);
      toast.success(`Alerta convertida a PO ${json?.purchaseOrder?.orderNumber ?? ""}`);
      fetchAlerts();
    } catch (error) {
      toast.error(getErrorMessage(error, "Error al convertir alerta"));
    } finally {
      setAlertActionLoading(null);
    }
  };

  const handleConvertAlertToTransfer = async (alertId: string) => {
    if (!confirm("¿Convertir esta alerta en una Transferencia interna entre sucursales?")) return;
    try {
      setAlertActionLoading(alertId);
      
      const res = await apiFetch(`/api/master/reorder/alerts/${alertId}/convert-transfer`, {
        method: "POST",
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al convertir alerta");
      const json = unwrapApiData(raw);
      toast.success(`Alerta convertida a Transferencia ${json?.transfer?.transferNumber ?? ""}`);
      fetchAlerts();
    } catch (error) {
      toast.error(getErrorMessage(error, "Error al convertir alerta"));
    } finally {
      setAlertActionLoading(null);
    }
  };

  const handleDismissAlert = async (alertId: string) => {
    if (!confirm("¿Descartar esta alerta? No se generará pedido ni transferencia.")) return;
    try {
      setAlertActionLoading(alertId);
      
      const res = await apiFetch(`/api/master/reorder/alerts/${alertId}/dismiss`, {
        method: "POST",
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message ?? e.message ?? "Error al descartar alerta"); }
      toast.success("Alerta descartada");
      fetchAlerts();
    } catch (error) {
      toast.error(getErrorMessage(error, "Error al descartar alerta"));
    } finally {
      setAlertActionLoading(null);
    }
  };

  /* ── Batch actions ── */

  const handleConvertBatch = async (batch: ReorderBatch) => {
    const tipo = batch.suggestionType === "PURCHASE" ? "Pedido de Compra" : "Transferencia";
    if (!confirm(`¿Convertir todo el lote (${batch.lines.length} líneas) en un ${tipo}? Las alertas vinculadas se marcarán como resueltas.`)) return;
    try {
      setBatchActionLoading(batch.id);
      
      const res = await apiFetch(`/api/master/reorder/batches/${batch.id}/convert`, {
        method: "POST",
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al convertir lote");
      const json = unwrapApiData(raw);
      const ref = batch.suggestionType === "PURCHASE"
        ? json?.purchaseOrder?.orderNumber
        : json?.transfer?.transferNumber;
      toast.success(`Lote convertido a ${tipo} ${ref ?? ""}`);
      fetchBatches();
    } catch (error) {
      toast.error(getErrorMessage(error, "Error al convertir lote"));
    } finally {
      setBatchActionLoading(null);
    }
  };

  /* ── Policy actions ── */

  const updatePolicyEdit = (id: string, field: keyof ReorderPolicy, value: ReorderPolicy[keyof ReorderPolicy]) => {
    setPolicyEdits((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  };

  const handleSavePolicy = async (policy: ReorderPolicy) => {
    const edit = policyEdits[policy.id];
    if (!edit) return;

    const merged = {
      branchId: policy.branchId,
      productId: policy.productId,
      reorderPoint: Number(edit.reorderPoint ?? policy.reorderPoint),
      targetQuantity: Number(edit.targetQuantity ?? policy.targetQuantity),
      minQuantity: Number(edit.minQuantity ?? policy.minQuantity ?? 0),
      safetyStock: Number(edit.safetyStock ?? policy.safetyStock ?? 0),
      preferredSupplier:
        edit.preferredSupplier !== undefined ? edit.preferredSupplier : policy.preferredSupplier,
      leadTimeDays: Number(edit.leadTimeDays ?? policy.leadTimeDays ?? 0),
      isActive: edit.isActive ?? policy.isActive,
    };

    if (merged.targetQuantity <= merged.reorderPoint) {
      toast.error("La cantidad objetivo debe ser mayor que el punto de reorden");
      return;
    }

    try {
      setPolicySaving(policy.id);
      
      const res = await apiFetch("/api/master/reorder/policies", {
        method: "POST",
        body: JSON.stringify(merged),
      });
      const rawPol = await res.json();
      if (!res.ok) throw new Error(rawPol.error?.message ?? rawPol.message ?? "Error al guardar política");
      toast.success(`Política actualizada — ${policy.product.name}`);
      // Clear edit for this row
      setPolicyEdits((prev) => {
        const next = { ...prev };
        delete next[policy.id];
        return next;
      });
      fetchPolicies();
    } catch (error) {
      toast.error(getErrorMessage(error, "Error al guardar política"));
    } finally {
      setPolicySaving(null);
    }
  };

  const handleBulkSavePolicies = async () => {
    const editedIds = Object.keys(policyEdits);
    if (editedIds.length === 0) {
      toast.error("No hay cambios pendientes para guardar");
      return;
    }
    if (!confirm(`¿Guardar ${editedIds.length} política(s) modificada(s) en bloque?`)) return;

    const payload: ReorderPolicyPayload[] = [];
    for (const id of editedIds) {
      const policy = policies.find((p) => p.id === id);
      if (!policy) continue;
      const edit = policyEdits[id];
      const merged = {
        branchId: policy.branchId,
        productId: policy.productId,
        reorderPoint: Number(edit.reorderPoint ?? policy.reorderPoint),
        targetQuantity: Number(edit.targetQuantity ?? policy.targetQuantity),
        minQuantity: Number(edit.minQuantity ?? policy.minQuantity ?? 0),
        safetyStock: Number(edit.safetyStock ?? policy.safetyStock ?? 0),
        preferredSupplier:
          edit.preferredSupplier !== undefined ? edit.preferredSupplier : policy.preferredSupplier,
        leadTimeDays: Number(edit.leadTimeDays ?? policy.leadTimeDays ?? 0),
        isActive: edit.isActive ?? policy.isActive,
      };
      if (merged.targetQuantity <= merged.reorderPoint) {
        toast.error(`Política inválida (${policy.product.name}): cantidad objetivo debe ser > punto de reorden`);
        return;
      }
      payload.push(merged);
    }

    try {
      setBulkSaving(true);
      
      const res = await apiFetch("/api/master/reorder/policies", {
        method: "PATCH",
        body: JSON.stringify({ policies: payload }),
      });
      const rawBulk = await res.json();
      if (!res.ok) throw new Error(rawBulk.error?.message ?? rawBulk.message ?? "Error al guardar políticas");
      const bulkResult = unwrapApiData(rawBulk);
      toast.success(`${bulkResult?.count ?? payload.length} política(s) guardada(s) en bloque`);
      fetchPolicies();
    } catch (error) {
      toast.error(getErrorMessage(error, "Error al guardar políticas"));
    } finally {
      setBulkSaving(false);
    }
  };

  const handleCreatePolicy = async () => {
    if (!newPolicyBranch || !newPolicyProduct) {
      toast.error("Selecciona sucursal y producto");
      return;
    }
    const rp = Number(newPolicyReorderPoint);
    const tq = Number(newPolicyTarget);
    if (!(tq > rp)) {
      toast.error("La cantidad objetivo debe ser mayor que el punto de reorden");
      return;
    }
    try {
      setPolicySaving("__new__");
      
      const res = await apiFetch("/api/master/reorder/policies", {
        method: "POST",
        body: JSON.stringify({
          branchId: newPolicyBranch,
          productId: newPolicyProduct,
          reorderPoint: rp,
          targetQuantity: tq,
          safetyStock: Number(newPolicySafety) || 0,
          preferredSupplier: newPolicySupplier || null,
          leadTimeDays: Number(newPolicyLeadTime) || 0,
          isActive: true,
        }),
      });
      const rawCreate = await res.json();
      if (!res.ok) throw new Error(rawCreate.error?.message ?? rawCreate.message ?? "Error al crear política");
      toast.success("Política creada");
      setNewPolicyBranch("");
      setNewPolicyProduct("");
      setNewPolicyReorderPoint("");
      setNewPolicyTarget("");
      setNewPolicySafety("0");
      setNewPolicySupplier("");
      setNewPolicyLeadTime("0");
      fetchPolicies();
    } catch (error) {
      toast.error(getErrorMessage(error, "Error al crear política"));
    } finally {
      setPolicySaving(null);
    }
  };

  /* ── Derived: alerts grouped by branch ── */

  const alertsByBranch = useMemo(() => {
    const map = new Map<string, { branch: ReorderAlert["branch"]; items: ReorderAlert[] }>();
    for (const a of alerts) {
      if (!map.has(a.branchId)) {
        map.set(a.branchId, { branch: a.branch, items: [] });
      }
      map.get(a.branchId)!.items.push(a);
    }
    return Array.from(map.values()).sort((a, b) => a.branch.code.localeCompare(b.branch.code));
  }, [alerts]);

  /* ── Counts for tabs ── */
  const openAlertCount = useMemo(() => alerts.filter((a) => a.status === "OPEN").length, [alerts]);

  /* ════════════════════════════════════════════════════════════
   *  RENDER
   * ════════════════════════════════════════════════════════════ */

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="h-8 w-1 rounded-full"
            style={{
              background: "linear-gradient(to bottom, var(--color-master-400), var(--color-master-600))",
            }}
          />
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-[var(--color-text)]">
              <PackageSearch className="h-5 w-5 text-[var(--color-master-600)]" />
              Motor de Reposición
            </h1>
            <p className="text-sm text-[var(--color-text-muted)]">
              Alertas inteligentes de reabastecimiento, lotes de sugerencias y políticas por sucursal/producto.
            </p>
          </div>
        </div>
        <button
          onClick={handleEvaluate}
          disabled={evaluating}
          className="flex items-center gap-2 rounded-lg bg-[var(--color-master-600)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-master-700)] disabled:opacity-50 transition-colors"
        >
          {evaluating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {evaluating ? "Evaluando…" : "Evaluar Ahora"}
        </button>
      </div>

      {/* Feedback via react-hot-toast */}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-[var(--color-border)]">
        <button
          onClick={() => setActiveTab("alerts")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === "alerts"
              ? "border-[var(--color-master-600)] text-[var(--color-master-700)]"
              : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          }`}
        >
          <AlertTriangle className="h-4 w-4" />
          Alertas
          {activeTab === "alerts" && openAlertCount > 0 && (
            <span className="ml-1 rounded-full bg-[var(--color-danger-50)] text-[var(--color-danger-700)] px-2 py-0.5 text-[0.6875rem] font-bold">
              {openAlertCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("batches")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === "batches"
              ? "border-[var(--color-master-600)] text-[var(--color-master-700)]"
              : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          }`}
        >
          <Layers className="h-4 w-4" />
          Lotes
        </button>
        <button
          onClick={() => setActiveTab("policies")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === "policies"
              ? "border-[var(--color-master-600)] text-[var(--color-master-700)]"
              : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          }`}
        >
          <ClipboardList className="h-4 w-4" />
          Políticas
        </button>
      </div>

      {/* ═══════════════════ TAB: ALERTAS ═══════════════════ */}
      {activeTab === "alerts" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-2 text-sm">
              {[
                { v: "OPEN", l: "Abiertas" },
                { v: "DISMISSED", l: "Descartadas" },
                { v: "CONVERTED_TO_PURCHASE_ORDER", l: "Conv. PO" },
                { v: "CONVERTED_TO_TRANSFER", l: "Conv. Transfer" },
                { v: "", l: "Todas" },
              ].map((s) => (
                <button
                  key={s.v}
                  onClick={() => setAlertStatusFilter(s.v)}
                  className={`rounded-lg border px-3 py-1.5 font-medium transition-colors ${
                    alertStatusFilter === s.v
                      ? "bg-[var(--color-master-600)] text-white border-[var(--color-master-600)]"
                      : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]"
                  }`}
                >
                  {s.l}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <label className="text-xs text-[var(--color-text-muted)] font-medium">Sucursal:</label>
              <select
                value={alertBranchFilter}
                onChange={(e) => setAlertBranchFilter(e.target.value)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)]"
              >
                <option value="">Todas</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.code} — {b.name}</option>
                ))}
              </select>
            </div>
          </div>

          {alertsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--color-master-500)]" />
              <span className="ml-2 text-sm text-[var(--color-text-muted)]">Cargando alertas...</span>
            </div>
          ) : alertsByBranch.length === 0 ? (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
              <PackageSearch className="h-12 w-12 mx-auto text-[var(--color-text-muted)] mb-3" />
              <p className="text-[var(--color-text-muted)]">No hay alertas con los filtros actuales.</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                Ejecuta &quot;Evaluar Ahora&quot; para detectar productos que requieren reposición.
              </p>
            </div>
          ) : (
            alertsByBranch.map((group) => (
              <div
                key={group.branch.id}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden"
              >
                <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface-alt)] px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <Building2 className="h-4 w-4 text-[var(--color-master-600)]" />
                    <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--color-master-50)] text-[var(--color-master-700)] text-xs font-bold">
                      {group.branch.code}
                    </span>
                    <span className="text-sm font-semibold text-[var(--color-text)]">{group.branch.name}</span>
                  </div>
                  <span className="text-xs font-medium text-[var(--color-text-muted)]">
                    {group.items.length} alerta{group.items.length === 1 ? "" : "s"}
                  </span>
                </div>
                <table className="hm-table w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]/40">
                      <th className="px-4 py-2 text-left font-semibold text-[var(--color-text-secondary)]">Producto</th>
                      <th className="px-4 py-2 text-left font-semibold text-[var(--color-text-secondary)]">Tipo</th>
                      <th className="px-4 py-2 text-right font-semibold text-[var(--color-text-secondary)]">Stock</th>
                      <th className="px-4 py-2 text-right font-semibold text-[var(--color-text-secondary)]">Punto Reorden</th>
                      <th className="px-4 py-2 text-right font-semibold text-[var(--color-text-secondary)]">Sugerido</th>
                      <th className="px-4 py-2 text-left font-semibold text-[var(--color-text-secondary)]">Origen / Proveedor</th>
                      <th className="px-4 py-2 text-left font-semibold text-[var(--color-text-secondary)]">Estado</th>
                      <th className="px-4 py-2 text-center font-semibold text-[var(--color-text-secondary)]">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((a) => (
                      <tr key={a.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]/30">
                        <td className="px-4 py-2.5">
                          <div className="flex flex-col">
                            <span className="font-medium text-[var(--color-text)]">{a.product.name}</span>
                            <span className="font-mono text-[0.6875rem] text-[var(--color-text-muted)]">{a.product.sku}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5"><AlertTypeBadge alertType={a.alertType} /></td>
                        <td className="px-4 py-2.5 text-right font-mono text-[var(--color-text)]">
                          {Number(a.currentQuantity).toFixed(0)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-[var(--color-text-secondary)]">
                          {Number(a.reorderPoint).toFixed(0)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-[var(--color-master-700)]">
                          {Number(a.suggestedQuantity).toFixed(0)} {a.product.unit}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-[var(--color-text-secondary)]">
                          {a.alertType === "TRANSFER" || a.alertType === "BOTH" ? (
                            a.sourceBranch ? (
                              <span className="inline-flex items-center gap-1">
                                <ArrowLeftRight className="h-3 w-3" />
                                <span className="font-medium">{a.sourceBranch.code}</span>
                                <span className="text-[var(--color-text-muted)]">({Number(a.nearestSourceStock ?? 0).toFixed(0)} uds.)</span>
                              </span>
                            ) : "—"
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <ShoppingCart className="h-3 w-3" />
                              {a.preferredSupplier ?? <span className="italic text-[var(--color-text-muted)]">Sin proveedor</span>}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5"><AlertStatusBadge status={a.status} /></td>
                        <td className="px-4 py-2.5">
                          {a.status === "OPEN" ? (
                            <div className="flex flex-wrap items-center justify-center gap-1.5">
                              {(a.alertType === "PURCHASE" || a.alertType === "BOTH") && (
                                <button
                                  onClick={() => handleConvertAlertToPO(a.id)}
                                  disabled={alertActionLoading === a.id}
                                  className="flex items-center gap-1 rounded bg-[var(--color-master-600)] px-2 py-1 text-[0.6875rem] font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
                                  title="Convertir a Pedido de Compra"
                                >
                                  <ShoppingCart className="h-3 w-3" /> PO
                                </button>
                              )}
                              {(a.alertType === "TRANSFER" || a.alertType === "BOTH") && a.sourceBranch && (
                                <button
                                  onClick={() => handleConvertAlertToTransfer(a.id)}
                                  disabled={alertActionLoading === a.id}
                                  className="flex items-center gap-1 rounded bg-cyan-600 px-2 py-1 text-[0.6875rem] font-semibold text-white hover:bg-cyan-700 disabled:opacity-50"
                                  title="Convertir a Transferencia"
                                >
                                  <ArrowLeftRight className="h-3 w-3" /> Transfer
                                </button>
                              )}
                              <button
                                onClick={() => handleDismissAlert(a.id)}
                                disabled={alertActionLoading === a.id}
                                className="flex items-center gap-1 rounded bg-gray-500 px-2 py-1 text-[0.6875rem] font-semibold text-white hover:bg-gray-600 disabled:opacity-50"
                                title="Descartar alerta"
                              >
                                <XCircle className="h-3 w-3" /> Descartar
                              </button>
                            </div>
                          ) : (
                            <span className="text-[0.6875rem] text-[var(--color-text-muted)] italic">Resuelta</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>
      )}

      {/* ═══════════════════ TAB: LOTES ═══════════════════ */}
      {activeTab === "batches" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-2 text-sm">
            {[
              { v: "DRAFT", l: "Borradores" },
              { v: "CONVERTED", l: "Convertidos" },
              { v: "DISCARDED", l: "Descartados" },
              { v: "", l: "Todos" },
            ].map((s) => (
              <button
                key={s.v}
                onClick={() => setBatchStatusFilter(s.v)}
                className={`rounded-lg border px-3 py-1.5 font-medium transition-colors ${
                  batchStatusFilter === s.v
                    ? "bg-[var(--color-master-600)] text-white border-[var(--color-master-600)]"
                    : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]"
                }`}
              >
                {s.l}
              </button>
            ))}
          </div>

          {batchesLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--color-master-500)]" />
              <span className="ml-2 text-sm text-[var(--color-text-muted)]">Cargando lotes...</span>
            </div>
          ) : batches.length === 0 ? (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
              <Layers className="h-12 w-12 mx-auto text-[var(--color-text-muted)] mb-3" />
              <p className="text-[var(--color-text-muted)]">No hay lotes de sugerencias con los filtros actuales.</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {batches.map((batch) => (
                <div
                  key={batch.id}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden"
                >
                  <div className="flex items-start justify-between border-b border-[var(--color-border)] bg-[var(--color-surface-alt)] px-4 py-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {batch.suggestionType === "PURCHASE" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-info-50)] text-purple-800 px-2 py-0.5 text-[0.6875rem] font-bold">
                            <ShoppingCart className="h-3 w-3" />
                            COMPRA
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-cyan-100 text-cyan-800 px-2 py-0.5 text-[0.6875rem] font-bold">
                            <ArrowLeftRight className="h-3 w-3" />
                            TRANSFERENCIA
                          </span>
                        )}
                        <BatchStatusBadge status={batch.status} />
                      </div>
                      <div className="text-sm font-semibold text-[var(--color-text)]">
                        Destino: {batch.branch.code} — {batch.branch.name}
                      </div>
                      {batch.suggestionType === "PURCHASE" ? (
                        <div className="text-xs text-[var(--color-text-muted)]">
                          Proveedor: <span className="font-medium text-[var(--color-text-secondary)]">
                            {batch.supplier ?? "Sin proveedor preferido"}
                          </span>
                        </div>
                      ) : (
                        <div className="text-xs text-[var(--color-text-muted)]">
                          Origen: <span className="font-medium text-[var(--color-text-secondary)]">
                            {batch.sourceBranch ? `${batch.sourceBranch.code} — ${batch.sourceBranch.name}` : "—"}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-[0.6875rem] text-[var(--color-text-muted)]">Costo estimado</div>
                      <div className="text-sm font-bold text-[var(--color-text)]">
                        C${Number(batch.totalEstimatedCost).toFixed(2)}
                      </div>
                      <div className="text-[0.6875rem] text-[var(--color-text-muted)] mt-0.5">
                        {batch.lines.length} línea{batch.lines.length === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>

                  <div className="px-4 py-3 max-h-64 overflow-y-auto">
                    <table className="hm-table w-full text-xs">
                      <thead>
                        <tr className="border-b border-[var(--color-border)]">
                          <th className="py-1.5 text-left font-semibold text-[var(--color-text-muted)]">Producto</th>
                          <th className="py-1.5 text-right font-semibold text-[var(--color-text-muted)]">Stock</th>
                          <th className="py-1.5 text-right font-semibold text-[var(--color-text-muted)]">Sugerido</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batch.lines.map((l) => (
                          <tr key={l.id} className="border-b border-[var(--color-border)]/50">
                            <td className="py-1.5">
                              <div className="text-[var(--color-text)]">{l.product.name}</div>
                              <div className="font-mono text-[0.625rem] text-[var(--color-text-muted)]">{l.product.sku}</div>
                            </td>
                            <td className="py-1.5 text-right font-mono text-[var(--color-text-secondary)]">
                              {Number(l.currentQuantity).toFixed(0)}
                            </td>
                            <td className="py-1.5 text-right font-mono font-semibold text-[var(--color-master-700)]">
                              {Number(l.suggestedQuantity).toFixed(0)} {l.product.unit}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {batch.status === "DRAFT" && (
                    <div className="border-t border-[var(--color-border)] px-4 py-3 flex justify-end">
                      <button
                        onClick={() => handleConvertBatch(batch)}
                        disabled={batchActionLoading === batch.id}
                        className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50 transition-colors ${
                          batch.suggestionType === "PURCHASE"
                            ? "bg-[var(--color-master-600)] hover:bg-purple-700"
                            : "bg-cyan-600 hover:bg-cyan-700"
                        }`}
                      >
                        {batchActionLoading === batch.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : batch.suggestionType === "PURCHASE" ? (
                          <ShoppingCart className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowLeftRight className="h-3.5 w-3.5" />
                        )}
                        Convertir lote completo a {batch.suggestionType === "PURCHASE" ? "PO" : "Transferencia"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════ TAB: POLÍTICAS ═══════════════════ */}
      {activeTab === "policies" && (
        <div className="space-y-4">
          {/* Filter + Bulk save */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--color-text-muted)] font-medium">Sucursal:</label>
              <select
                value={policyBranchFilter}
                onChange={(e) => setPolicyBranchFilter(e.target.value)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)]"
              >
                <option value="">Todas</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.code} — {b.name}</option>
                ))}
              </select>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {Object.keys(policyEdits).length > 0 && (
                <span className="text-xs text-[var(--color-warning-700)] font-medium">
                  {Object.keys(policyEdits).length} cambio(s) pendiente(s)
                </span>
              )}
              <button
                onClick={handleBulkSavePolicies}
                disabled={bulkSaving || Object.keys(policyEdits).length === 0}
                className="flex items-center gap-2 rounded-lg bg-[var(--color-master-600)] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[var(--color-master-700)] disabled:opacity-50 transition-colors"
              >
                {bulkSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Guardar todo
              </button>
            </div>
          </div>

          {/* New policy form */}
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)]/40 p-4 space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
              <Plus className="h-4 w-4 text-[var(--color-master-600)]" />
              Nueva política
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-7 gap-2">
              <select
                value={newPolicyBranch}
                onChange={(e) => setNewPolicyBranch(e.target.value)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text)] md:col-span-1 lg:col-span-2"
              >
                <option value="">Sucursal...</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.code} — {b.name}</option>
                ))}
              </select>
              <select
                value={newPolicyProduct}
                onChange={(e) => setNewPolicyProduct(e.target.value)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text)] md:col-span-1 lg:col-span-2"
              >
                <option value="">Producto...</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>
                ))}
              </select>
              <input
                type="number"
                placeholder="Punto reorden"
                value={newPolicyReorderPoint}
                onChange={(e) => setNewPolicyReorderPoint(e.target.value)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text)]"
                min="0"
              />
              <input
                type="number"
                placeholder="Objetivo"
                value={newPolicyTarget}
                onChange={(e) => setNewPolicyTarget(e.target.value)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text)]"
                min="1"
              />
              <input
                type="number"
                placeholder="Seg."
                value={newPolicySafety}
                onChange={(e) => setNewPolicySafety(e.target.value)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text)]"
                min="0"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input
                type="text"
                placeholder="Proveedor preferido (opcional)"
                value={newPolicySupplier}
                onChange={(e) => setNewPolicySupplier(e.target.value)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text)]"
              />
              <input
                type="number"
                placeholder="Lead time (días)"
                value={newPolicyLeadTime}
                onChange={(e) => setNewPolicyLeadTime(e.target.value)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text)]"
                min="0"
              />
              <button
                onClick={handleCreatePolicy}
                disabled={policySaving === "__new__"}
                className="flex items-center justify-center gap-2 rounded-lg bg-[var(--color-master-600)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--color-master-700)] disabled:opacity-50"
              >
                {policySaving === "__new__" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Crear política
              </button>
            </div>
          </div>

          {policiesLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--color-master-500)]" />
              <span className="ml-2 text-sm text-[var(--color-text-muted)]">Cargando políticas...</span>
            </div>
          ) : policies.length === 0 ? (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
              <ClipboardList className="h-12 w-12 mx-auto text-[var(--color-text-muted)] mb-3" />
              <p className="text-[var(--color-text-muted)]">No hay políticas configuradas.</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                Crea una política usando el formulario superior para que el motor de reposición empiece a generar alertas.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
              <table className="hm-table w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
                    <th className="px-3 py-2 text-left font-semibold text-[var(--color-text-secondary)]">Sucursal</th>
                    <th className="px-3 py-2 text-left font-semibold text-[var(--color-text-secondary)]">Producto</th>
                    <th className="px-3 py-2 text-right font-semibold text-[var(--color-text-secondary)]">Punto Reorden</th>
                    <th className="px-3 py-2 text-right font-semibold text-[var(--color-text-secondary)]">Objetivo</th>
                    <th className="px-3 py-2 text-right font-semibold text-[var(--color-text-secondary)]">Stock Seguridad</th>
                    <th className="px-3 py-2 text-left font-semibold text-[var(--color-text-secondary)]">Proveedor</th>
                    <th className="px-3 py-2 text-right font-semibold text-[var(--color-text-secondary)]">Lead time</th>
                    <th className="px-3 py-2 text-center font-semibold text-[var(--color-text-secondary)]">Activa</th>
                    <th className="px-3 py-2 text-center font-semibold text-[var(--color-text-secondary)]">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {policies.map((p) => {
                    const edit = policyEdits[p.id] ?? {};
                    const hasChanges = Object.keys(edit).length > 0;
                    return (
                      <tr
                        key={p.id}
                        className={`border-b border-[var(--color-border)] ${hasChanges ? "bg-[var(--color-warning-50)]/50" : "hover:bg-[var(--color-surface-alt)]/30"}`}
                      >
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-[var(--color-master-50)] text-[var(--color-master-700)] text-[0.6875rem] font-bold">
                            {p.branch.code}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-[var(--color-text)]">{p.product.name}</div>
                          <div className="font-mono text-[0.6875rem] text-[var(--color-text-muted)]">{p.product.sku}</div>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0"
                            value={edit.reorderPoint !== undefined ? String(edit.reorderPoint) : Number(p.reorderPoint).toString()}
                            onChange={(e) => updatePolicyEdit(p.id, "reorderPoint", e.target.value)}
                            className="w-20 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-right text-[var(--color-text)]"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="1"
                            value={edit.targetQuantity !== undefined ? String(edit.targetQuantity) : Number(p.targetQuantity).toString()}
                            onChange={(e) => updatePolicyEdit(p.id, "targetQuantity", e.target.value)}
                            className="w-20 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-right text-[var(--color-text)]"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0"
                            value={edit.safetyStock !== undefined ? String(edit.safetyStock) : Number(p.safetyStock).toString()}
                            onChange={(e) => updatePolicyEdit(p.id, "safetyStock", e.target.value)}
                            className="w-20 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-right text-[var(--color-text)]"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={edit.preferredSupplier !== undefined ? (edit.preferredSupplier ?? "") : (p.preferredSupplier ?? "")}
                            onChange={(e) => updatePolicyEdit(p.id, "preferredSupplier", e.target.value || null)}
                            placeholder="—"
                            className="w-32 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)]"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0"
                            value={edit.leadTimeDays !== undefined ? String(edit.leadTimeDays) : String(p.leadTimeDays)}
                            onChange={(e) => updatePolicyEdit(p.id, "leadTimeDays", e.target.value)}
                            className="w-16 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-right text-[var(--color-text)]"
                          />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={edit.isActive !== undefined ? !!edit.isActive : p.isActive}
                            onChange={(e) => updatePolicyEdit(p.id, "isActive", e.target.checked)}
                            className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-master-600)]"
                          />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => handleSavePolicy(p)}
                            disabled={!hasChanges || policySaving === p.id}
                            className="inline-flex items-center gap-1 rounded bg-[var(--color-master-600)] px-2 py-1 text-[0.6875rem] font-semibold text-white hover:bg-[var(--color-master-700)] disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {policySaving === p.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Save className="h-3 w-3" />
                            )}
                            Guardar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
