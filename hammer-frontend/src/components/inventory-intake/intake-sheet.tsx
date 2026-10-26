"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  Camera, Check, ChevronDown, Loader2, RotateCcw,
  Save, Search, Trash2, Upload, X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money, qty } from "@/lib/format";
import { useSession } from "@/lib/client/session";
import { useSubmitting } from "@/lib/client/use-submitting";
import { useCameraAvailable } from "@/lib/client/use-camera-available";
import { CameraScanner } from "@/components/scanner/camera-scanner";
import { findExactProductMatch, looksLikeScannedCode } from "@/lib/pos-enter-resolution";
import { parseMatrixTsvPaste, type TsvPasteProduct } from "@/lib/multi-branch-matrix";
import {
  addOrFocusScannedProduct,
  applyBranchCellInput,
  applySalePriceCellInput,
  buildCreateIntakeRequest,
  buildIntakePayloadLines,
  buildPreviewRequestLines,
  canConfirmIntake,
  clearIntakeDraft,
  computeBarCounts,
  computeMarginPercent,
  countMissingPriceByBranch,
  draftAgeLabel,
  enforceBranchSelectionForKind,
  firstErrorProductId,
  loadIntakeDraft,
  priceForMarginPercent,
  productIdsWithPackageCostWarning,
  quantityForIntakeBranch,
  readPossibleDuplicate,
  reasonChipsForKind,
  rowStateLabel,
  salePriceForIntakeBranch,
  saveIntakeDraft,
  shortTextForErrorCode,
  switchingKindNeedsConfirmation,
  toggleBranchSelection,
  worstRowStatus,
  type IntakeKind,
  type IntakeLine,
  type IntakeLineStatus,
  type PossibleDuplicateIntake,
  type ScannedProductRef,
} from "@/lib/inventory-intake-logic";
import type { Branch, ProductRow, CenterData } from "@/components/catalog-inventory/catalog-inventory-admin";

/**
 * Fase 2 (prompt-entrada-inventario.md) — reemplaza OpeningBalanceModal.
 * "Sumar mercadería" / "Conteo físico" / "Carga inicial" como tres tarjetas
 * (no un selector), sucursales en chips (no pestañas Una/Varias), estado
 * por fila (✓/⚠/✕) con el `status`/`messages` de intake-preview-service.ts
 * (debounce 400 ms), borrador en localStorage y progreso por tandas
 * reanudables (createMultiBranchIntake / continueMultiBranchIntake).
 */

type MessageKind = "DATA" | "BLOCKED" | "RULE";
type PreviewMessage = { code: string; kind: MessageKind; text: string; poId?: string };
type PreviewCell = {
  productId: string;
  branchId: string;
  currentQty: number;
  finalQty: number;
  delta: number;
  currentWac: number | null;
  newWac: number | null;
  lastPurchaseCost: number | null;
  lastPurchaseDate: string | null;
  /** Commit 3 (prompt-entrada-reintento-precio.md) — precio de venta vigente en ESTA sucursal (<=0 = sin precio configurado). */
  currentSalePrice: number | null;
  /** Costo efectivo vigente (distinto de currentWac: es el de la cadena completa, el mismo que usa la validación). */
  currentEffectiveCost: number | null;
  /** Mínimo de margen de la política de categoría — null = sin política configurada. */
  minMarginPercent: number | null;
  status: IntakeLineStatus;
  messages: PreviewMessage[];
};
type PreviewTotals = { units: number; value: number | null; wacChanges: number };
/** prompt-entrada-multisucursal-fix.md — un mensaje por código con sus sucursales, nunca un mensaje por celda con el id interno. */
type PreviewLineMessage = { code: string; kind: MessageKind; text: string; branchCodes: string[]; poId?: string };
type PreviewResponse = { cells: PreviewCell[]; totals: Record<string, PreviewTotals>; lineMessages: Record<string, PreviewLineMessage[]> };

type IntakeBranchResult = { branchId: string; status: "PENDING" | "IN_PROGRESS" | "DONE" | "FAILED"; error: string | null; processedLines: number; totalLines: number };
type CreateIntakeResult = { intake: { id: string; code: string }; overallStatus: "DONE" | "IN_PROGRESS"; branches: IntakeBranchResult[] };

/**
 * prompt-entrada-reintento-precio.md Commit 2 §2 — "abre la MISMA hoja de
 * Entrada en modo 'Editar IM-000008 · RIV'": sucursal/tipo/motivo fijos,
 * precargada con las líneas PENDIENTES de esa sucursal (las ya aplicadas
 * se muestran bloqueadas aparte, vía `appliedLines`), misma vista previa,
 * pero el botón final hace PUT .../lines + POST .../retry en vez de crear
 * una entrada nueva.
 */
export type IntakeEditModeInput = {
  intakeId: string;
  intakeCode: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  kind: IntakeKind;
  reason: string;
  notes: string;
  expectedRevision: number;
  appliedLines: Array<{ productId: string; sku: string; name: string; quantity: number; unit?: string; unitCost?: number }>;
  pendingLines: IntakeLine[];
};

const KIND_META: Record<IntakeKind, { label: string; description: string; example: string }> = {
  ADD_STOCK: {
    label: "Sumar mercadería",
    description: "Llegó producto: la cantidad se suma a lo que ya hay. El costo de esta entrada se promedia con el actual.",
    example: "hay 40, llegan 12 → quedan 52",
  },
  PHYSICAL_COUNT: {
    label: "Conteo físico",
    description: "Lo que escribís reemplaza lo que dice el sistema. Se registra la diferencia.",
    example: "sistema 40, contaste 37 → −3",
  },
  OPENING_BALANCE: {
    label: "Carga inicial",
    description: "Producto que nunca tuvo existencias en esa sucursal. Necesita costo.",
    example: "",
  },
};
const KIND_ORDER: IntakeKind[] = ["ADD_STOCK", "PHYSICAL_COUNT", "OPENING_BALANCE"];

function cellKey(productId: string, branchId: string): string {
  return `${productId}:${branchId}`;
}

function productToScannedRef(product: ProductRow): ScannedProductRef {
  const saleUnit = product.stockConversion?.saleUnit ?? product.unit ?? "UN";
  const baseUnit = product.stockConversion?.baseUnit ?? product.unit ?? "UN";
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    saleUnit,
    baseUnit,
    hasConversion: !!product.stockConversion,
    conversionFactor: Number(product.stockConversion?.conversionFactor ?? 1) || 1,
  };
}

function blankLineFromRef(ref: ScannedProductRef): IntakeLine {
  return {
    productId: ref.id, sku: ref.sku, name: ref.name, saleUnit: ref.saleUnit, baseUnit: ref.baseUnit,
    hasConversion: ref.hasConversion, conversionFactor: ref.conversionFactor, unit: ref.saleUnit,
    quantity: null, overrides: {}, unitCost: null, salePrice: null, salePriceOverrides: {},
  };
}

export function IntakeSheet({
  branches,
  fallbackProducts,
  activeBranchId,
  onSelectBranch,
  onClose,
  onDone,
  onViewKardex,
  editMode,
}: {
  branches: Branch[];
  fallbackProducts: ProductRow[];
  activeBranchId: string;
  onSelectBranch: (branchId: string) => void;
  onClose: () => void;
  onDone: () => Promise<void>;
  onViewKardex: (intakeId: string) => void;
  editMode?: IntakeEditModeInput;
}) {
  const sessionState = useSession();
  const userId = sessionState.status === "authenticated" ? sessionState.session.userId : null;
  const cameraAvailable = useCameraAvailable();

  const [kind, setKind] = useState<IntakeKind>(editMode?.kind ?? "ADD_STOCK");
  const [branchIds, setBranchIds] = useState<string[]>(editMode ? [editMode.branchId] : (activeBranchId ? [activeBranchId] : []));
  const [reason, setReason] = useState(editMode?.reason ?? "");
  const [notes, setNotes] = useState(editMode?.notes ?? "");
  const [notesOpen, setNotesOpen] = useState(false);
  const [lines, setLines] = useState<IntakeLine[]>(editMode?.pendingLines ?? []);

  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<ProductRow[]>(fallbackProducts.slice(0, 12));
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasting, setPasting] = useState(false);
  // Commit 3 (prompt-entrada-reintento-precio.md) — ya no abre el editor
  // único de "⋯ → Cambiar precio de venta" (reemplazado por la columna);
  // ahora es el toggle "por sucursal ▾" cuando hay más de 3 sucursales.
  const [priceEditorFor, setPriceEditorFor] = useState<string | null>(null);
  const [primaryBranch, setPrimaryBranch] = useState<{ id: string; code: string } | null>(null);

  const [previewCells, setPreviewCells] = useState<Map<string, PreviewCell>>(new Map());
  const [previewTotals, setPreviewTotals] = useState<Record<string, PreviewTotals>>({});
  const [previewLineMessages, setPreviewLineMessages] = useState<Record<string, PreviewLineMessage[]>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [statusFilter, setStatusFilter] = useState<IntakeLineStatus | null>(null);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());

  const [showConfirm, setShowConfirm] = useState(false);
  const [reviewedWarnings, setReviewedWarnings] = useState(false);
  const [submitting, runSubmit] = useSubmitting();
  const [result, setResult] = useState<CreateIntakeResult | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const [duplicateWarning, setDuplicateWarning] = useState<PossibleDuplicateIntake | null>(null);
  const [draftBanner, setDraftBanner] = useState<{ savedAt: string } | null>(null);
  const draftCheckedKinds = useRef(new Set<IntakeKind>());
  const quantityRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // ── Borrador: avisar si hay uno guardado para el kind actual ────────────
  // En modo edición no hay borrador — las líneas ya vienen precargadas de la entrada que falló.
  useEffect(() => {
    if (!userId || editMode) return;
    if (draftCheckedKinds.current.has(kind)) return;
    draftCheckedKinds.current.add(kind);
    if (lines.length > 0) return;
    const draft = loadIntakeDraft(window.localStorage, userId, kind);
    if (draft && draft.lines.length > 0) setDraftBanner({ savedAt: draft.savedAt });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, userId]);

  // Commit 3 — "igual que MGA": la sucursal principal de Inventario
  // (prompt-inventario-unificado.md Commit 1 §3), nunca una sucursal fija
  // a mano. Si no está entre las elegidas, el atajo simplemente no aparece.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/master/inventory/config/primary-branch", { cache: "no-store" });
        const raw = await response.json().catch(() => null);
        if (!response.ok || cancelled) return;
        const data = unwrapApiData(raw) as { branchId: string | null };
        if (!data.branchId) return;
        const branch = branches.find((b) => b.id === data.branchId);
        if (branch) setPrimaryBranch({ id: branch.id, code: branch.code });
      } catch {
        /* sin sucursal principal configurada o sin red -- el atajo "igual que" no aparece */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function restoreDraft() {
    if (!userId) return;
    const draft = loadIntakeDraft(window.localStorage, userId, kind);
    if (!draft) return;
    setBranchIds(draft.branchIds);
    setReason(draft.reason);
    setNotes(draft.notes);
    setLines(draft.lines);
    setDraftBanner(null);
    toast.success("Borrador restaurado.");
  }
  function discardDraft() {
    if (userId) clearIntakeDraft(window.localStorage, userId, kind);
    setDraftBanner(null);
  }
  function saveDraftNow() {
    if (!userId) { toast.error("Esperá a que cargue la sesión."); return; }
    if (lines.length === 0) { toast.error("No hay nada que guardar todavía."); return; }
    saveIntakeDraft(window.localStorage, userId, { kind, branchIds, reason, notes, lines });
    toast.success("Borrador guardado.");
  }

  // ── Cambiar de tarjeta ───────────────────────────────────────────────────
  function selectKind(next: IntakeKind) {
    if (next === kind) return;
    if (switchingKindNeedsConfirmation(lines)) {
      const ok = window.confirm(`Los productos ya cargados se vuelven a validar con las reglas de "${KIND_META[next].label}". ¿Continuar?`);
      if (!ok) return;
    }
    setKind(next);
    setBranchIds((prev) => enforceBranchSelectionForKind(next, prev));
    setReason("");
    setStatusFilter(null);
    setResult(null);
  }

  function toggleBranch(id: string) {
    setBranchIds((prev) => toggleBranchSelection(kind, prev, id));
  }

  // ── Productos ────────────────────────────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const term = search.trim();
      const params = new URLSearchParams({ page: "1", limit: "20" });
      if (term) params.set("q", term);
      if (branchIds[0]) params.set("branchId", branchIds[0]);
      setSearchLoading(true);
      try {
        const response = await fetch(`/api/master/catalog-inventory?${params}`, { cache: "no-store", signal: controller.signal });
        const raw = await response.json().catch(() => null);
        if (!response.ok) throw new Error(raw?.error?.message ?? "No se pudo buscar productos.");
        const payload = unwrapApiData(raw) as CenterData;
        setSearchResults(payload.products ?? []);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setSearchResults(fallbackProducts.slice(0, 12));
      } finally {
        setSearchLoading(false);
      }
    }, 280);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [search, branchIds, fallbackProducts]);

  function focusQuantity(productId: string) {
    requestAnimationFrame(() => quantityRefs.current[productId]?.focus());
  }

  function addProduct(product: ProductRow) {
    const { lines: next, focusProductId } = addOrFocusScannedProduct(lines, productToScannedRef(product), kind);
    setLines(next);
    focusQuantity(focusProductId);
  }

  async function resolveAndAddCode(code: string) {
    const exact = findExactProductMatch(code, searchResults);
    if (exact) { addProduct(exact); setSearch(""); return; }
    try {
      const params = new URLSearchParams({ q: code, page: "1", limit: "5" });
      if (branchIds[0]) params.set("branchId", branchIds[0]);
      const response = await fetch(`/api/master/catalog-inventory?${params}`, { cache: "no-store" });
      const raw = await response.json().catch(() => null);
      const payload = unwrapApiData(raw) as CenterData;
      const found = findExactProductMatch(code, payload.products ?? []);
      if (found) { addProduct(found); setSearch(""); return; }
      toast.error(`No se encontró ningún producto con el código "${code}".`);
    } catch {
      toast.error("Error al buscar el código.");
    }
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const text = search.trim();
    if (!text) return;
    e.preventDefault();
    if (looksLikeScannedCode(text) || searchResults.length === 1) void resolveAndAddCode(text);
  }

  async function applyPaste() {
    const text = pasteText.trim();
    if (!text) return;
    setPasting(true);
    try {
      const codes = [...new Set(text.split(/\r?\n/).map((row) => row.split("\t")[0]?.trim()).filter((c): c is string => !!c))];
      const pool: TsvPasteProduct[] = [];
      const byId = new Map<string, ProductRow>();
      for (const code of codes) {
        const params = new URLSearchParams({ q: code, page: "1", limit: "5" });
        const response = await fetch(`/api/master/catalog-inventory?${params}`, { cache: "no-store" });
        const raw = await response.json().catch(() => null);
        const payload = unwrapApiData(raw) as CenterData;
        for (const p of payload.products ?? []) { byId.set(p.id, p); pool.push({ id: p.id, sku: p.sku, name: p.name, barcode: p.barcode, barcodes: p.barcodes }); }
      }
      const branchIdByCode: Record<string, string> = {};
      for (const b of branches) branchIdByCode[b.code.toUpperCase()] = b.id;
      const { matched, unmatchedCodes } = parseMatrixTsvPaste(text, pool, branchIdByCode);

      let next = lines;
      for (const row of matched) {
        const idx = next.findIndex((l) => l.productId === row.product.id);
        if (idx === -1) {
          const full = byId.get(row.product.id);
          const ref = full ? productToScannedRef(full) : { id: row.product.id, sku: row.product.sku, name: row.product.name, saleUnit: "UN", baseUnit: "UN", hasConversion: false, conversionFactor: 1 };
          next = [...next, { ...blankLineFromRef(ref), quantity: row.forAll, overrides: row.overrides }];
        } else {
          next = next.map((l, i) => (i === idx ? { ...l, quantity: row.forAll, overrides: { ...l.overrides, ...row.overrides } } : l));
        }
      }
      setLines(next);
      if (unmatchedCodes.length > 0) toast.error(`${unmatchedCodes.length} código(s) no encontrado(s): ${unmatchedCodes.join(", ")}`);
      else toast.success(`${matched.length} producto(s) cargado(s) desde el pegado.`);
      setPasteText("");
      setPasteOpen(false);
    } finally {
      setPasting(false);
    }
  }

  function updateLine(productId: string, patch: Partial<IntakeLine>) {
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
  }
  function removeLine(productId: string) {
    setLines((prev) => prev.filter((l) => l.productId !== productId));
  }
  // prompt-entrada-multisucursal-fix.md — vacío QUITA el override (vuelve
  // a "para todas"); 0 lo fija en "no lleva". Antes, vaciar el campo dejaba
  // el override en null, que la validación leía como "falta la cantidad"
  // en vez de volver a "para todas" (causa 3 del bug reportado).
  function setBranchCell(productId: string, branchId: string, rawValue: string) {
    setLines((prev) => prev.map((l) => (l.productId === productId ? applyBranchCellInput(l, branchId, rawValue) : l)));
  }
  function resetOverride(productId: string, branchId: string) {
    setBranchCell(productId, branchId, "");
  }
  // Commit 3 — "Precio de venta {sucursal}", mismo criterio que setBranchCell/resetOverride para cantidad.
  function setSalePriceCell(productId: string, branchId: string, rawValue: string) {
    setLines((prev) => prev.map((l) => (l.productId === productId ? applySalePriceCellInput(l, branchId, rawValue) : l)));
  }
  function resetSalePriceOverride(productId: string, branchId: string) {
    setSalePriceCell(productId, branchId, "");
  }

  // ── Vista previa real (debounce 400 ms) ─────────────────────────────────
  // prompt-entrada-multisucursal-fix.md Commit 2 #4 — si falla, las filas
  // quedan "Sin verificar" (previewFailed), nunca se muestran como si
  // tuvieran un error real; un banner arriba ofrece reintentar.
  useEffect(() => {
    if (branchIds.length === 0 || lines.length === 0) {
      setPreviewCells(new Map());
      setPreviewTotals({});
      setPreviewLineMessages({});
      setPreviewFailed(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const body = { kind, branchIds, lines: buildPreviewRequestLines(lines) };
        const response = await apiFetch("/api/inventory/intake/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
        const raw = await response.json().catch(() => null);
        if (!response.ok) throw new Error(raw?.error?.message ?? "No se pudo calcular la vista previa.");
        const data = unwrapApiData(raw) as PreviewResponse;
        const map = new Map<string, PreviewCell>();
        for (const cell of data.cells) map.set(cellKey(cell.productId, cell.branchId), cell);
        setPreviewCells(map);
        setPreviewTotals(data.totals);
        setPreviewLineMessages(data.lineMessages ?? {});
        setPreviewFailed(false);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setPreviewFailed(true);
        }
      } finally {
        setPreviewLoading(false);
      }
    }, 400);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [kind, branchIds, lines]);

  function retryPreview() {
    // Fuerza al efecto de arriba a volver a correr aunque `lines` no haya cambiado.
    setPreviewFailed(false);
    setLines((prev) => [...prev]);
  }

  const rowStatuses = useMemo(() => lines.map((line) => {
    const statuses = branchIds.map((id) => previewCells.get(cellKey(line.productId, id))?.status).filter((s): s is IntakeLineStatus => !!s);
    const hasFullCoverage = branchIds.length > 0 && statuses.length === branchIds.length;
    return { productId: line.productId, status: worstRowStatus(statuses), loading: previewLoading || !hasFullCoverage };
  }), [lines, branchIds, previewCells, previewLoading]);

  const barCounts = useMemo(() => computeBarCounts(rowStatuses.map((r) => ({ productId: r.productId, status: r.status }))), [rowStatuses]);
  const anyRowLoading = rowStatuses.some((r) => r.loading);
  const canConfirm = canConfirmIntake(barCounts, lines.length, previewFailed) && !anyRowLoading;
  const hasReviewWarnings = barCounts.review > 0;
  const firstErrorId = useMemo(() => firstErrorProductId(rowStatuses), [rowStatuses]);

  const visibleLines = useMemo(
    () => (statusFilter ? lines.filter((l) => rowStatuses.find((r) => r.productId === l.productId)?.status === statusFilter) : lines),
    [lines, rowStatuses, statusFilter],
  );

  const pendingPoWarnings = useMemo(() => {
    const seen = new Map<string, PreviewMessage>();
    for (const cell of previewCells.values()) {
      for (const m of cell.messages) {
        if (m.code === "PENDING_PURCHASE_ORDER" && m.poId && !seen.has(m.poId)) seen.set(m.poId, m);
      }
    }
    return [...seen.values()];
  }, [previewCells]);

  // Commit 3 — "visible siempre en Sumar y en Carga inicial. En Conteo se
  // oculta". Una sucursal: una columna. Hasta 3: una por sucursal. Más de
  // 3: un solo campo con "por sucursal ▾" (reusa priceEditorFor/onTogglePriceEditor).
  const showSalePrice = kind !== "PHYSICAL_COUNT";
  const priceColumnBranchIds = showSalePrice && branchIds.length <= 3 ? branchIds : [];
  const showPriceExpandToggle = showSalePrice && branchIds.length > 3;
  const missingPriceByBranch = useMemo(() => countMissingPriceByBranch([...previewCells.values()]), [previewCells]);

  /** Presupuesto de tiempo agotado antes de terminar (IN_PROGRESS) → /continue hasta asentarse, igual para crear que para editar+reintentar. */
  async function settleUntilDone(initial: CreateIntakeResult): Promise<CreateIntakeResult> {
    let data = initial;
    let guard = 0;
    while (data.overallStatus === "IN_PROGRESS" && guard < 20) {
      guard += 1;
      const response = await apiFetch(`/api/inventory/multi-branch-intake/${data.intake.id}/continue`, { method: "POST" });
      const raw = await response.json().catch(() => null);
      if (!response.ok) throw new Error(raw?.error?.message ?? "No se pudo continuar la entrada.");
      data = unwrapApiData(raw) as CreateIntakeResult;
    }
    return data;
  }

  // ── Confirmar y guardar (o, en modo edición, corregir + reintentar) ─────
  async function confirmAndSubmit(confirmDuplicate = false) {
    // Solo se llega acá con "Revisé los avisos" marcado si hubo avisos (canConfirm/ConfirmSummaryModal):
    // las filas con "¿costo del paquete?" van confirmadas como costo por unidad.
    const confirmHighCostProductIds = productIdsWithPackageCostWarning(previewLineMessages);
    await runSubmit(async () => {
      try {
        let data: CreateIntakeResult;
        if (editMode) {
          const putResponse = await apiFetch(`/api/inventory/multi-branch-intake/${editMode.intakeId}/branches/${editMode.branchId}/lines`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lines: buildIntakePayloadLines(lines, branchIds, confirmHighCostProductIds), expectedRevision: editMode.expectedRevision }),
          });
          const putRaw = await putResponse.json().catch(() => null);
          if (!putResponse.ok) throw new Error(putRaw?.error?.message ?? "No se pudo guardar la corrección.");

          const retryResponse = await apiFetch(`/api/inventory/multi-branch-intake/${editMode.intakeId}/retry`, { method: "POST" });
          const retryRaw = await retryResponse.json().catch(() => null);
          if (!retryResponse.ok) throw new Error(retryRaw?.error?.message ?? "Se guardó la corrección, pero no se pudo reintentar.");
          data = await settleUntilDone(unwrapApiData(retryRaw) as CreateIntakeResult);
        } else {
          const body = buildCreateIntakeRequest({ clientRequestId, kind, reason, notes, branchIds, lines, confirmDuplicate, confirmHighCostProductIds });
          const response = await apiFetch("/api/inventory/multi-branch-intake", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          const raw = await response.json().catch(() => null);
          if (!response.ok) throw new Error(raw?.error?.message ?? "No se pudo registrar la entrada.");
          // Aviso, no error: no se creó nada todavía — el usuario decide.
          const duplicate = readPossibleDuplicate(unwrapApiData(raw));
          if (duplicate) {
            setShowConfirm(false);
            setDuplicateWarning(duplicate);
            return;
          }
          data = await settleUntilDone(unwrapApiData(raw) as CreateIntakeResult);
        }

        setResult(data);
        setShowConfirm(false);
        if (!editMode && userId) clearIntakeDraft(window.localStorage, userId, kind);
        const failedCount = data.branches.filter((b) => b.status === "FAILED").length;
        if (editMode) {
          const thisBranch = data.branches.find((b) => b.branchId === editMode.branchId);
          if (thisBranch?.status === "DONE") toast.success(`${editMode.branchCode} quedó al día.`);
          else toast.error(`${editMode.branchCode} sigue fallando — revisá el detalle y corregí de nuevo.`);
        } else if (failedCount === 0) {
          toast.success("Entrada registrada.");
        } else {
          toast.error(`${failedCount} sucursal(es) fallaron — podés reintentar.`);
        }
        await onDone();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : (editMode ? "No se pudo corregir la entrada." : "No se pudo registrar la entrada."));
      }
    });
  }

  async function retryFailed() {
    if (!result) return;
    setRetrying(true);
    try {
      const response = await apiFetch(`/api/inventory/multi-branch-intake/${result.intake.id}/retry`, { method: "POST" });
      const raw = await response.json().catch(() => null);
      if (!response.ok) throw new Error(raw?.error?.message ?? "No se pudo reintentar.");
      const data = unwrapApiData(raw) as CreateIntakeResult;
      setResult(data);
      const stillFailed = data.branches.filter((b) => b.status === "FAILED").length;
      toast[stillFailed === 0 ? "success" : "error"](stillFailed === 0 ? "Todas las sucursales quedaron al día." : `${stillFailed} sucursal(es) siguen fallando.`);
      await onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo reintentar.");
    } finally {
      setRetrying(false);
    }
  }

  function finishAndClose() {
    setResult(null);
    setLines([]);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 lg:items-center lg:p-4">
      <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--color-surface)] shadow-2xl lg:h-auto lg:max-h-[94vh] lg:max-w-6xl lg:rounded-xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold">{editMode ? `Editar ${editMode.intakeCode} · ${editMode.branchCode}` : "Entrada de inventario"}</h3>
            <p className="text-xs text-[var(--color-text-muted)]">{editMode ? `${editMode.branchName} — corrige solo lo pendiente; lo ya aplicado no se toca.` : "Sumá mercadería, hacé un conteo físico o cargá existencias iniciales — todo con vista previa real antes de guardar."}</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} icon={<X className="h-4 w-4" />}>Cerrar</Button>
        </div>

        {result ? (
          <IntakeResultView
            result={result}
            branches={branches}
            retrying={retrying}
            onRetry={retryFailed}
            onViewKardex={() => { onViewKardex(result.intake.id); finishAndClose(); }}
            onClose={finishAndClose}
          />
        ) : (
          <>
            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
              {draftBanner ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-master-200)] bg-[var(--color-master-50)] px-3 py-2 text-xs text-[var(--color-master-800)]">
                  <span>Tenés un borrador de {draftAgeLabel(draftBanner.savedAt)}: ¿continuar?</span>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="primary" onClick={restoreDraft}>Continuar</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={discardDraft}>Descartar</Button>
                  </div>
                </div>
              ) : null}

              {editMode ? (
                <div className="rounded-lg border border-[var(--color-master-200)] bg-[var(--color-master-50)] px-3 py-2 text-xs text-[var(--color-master-800)]">
                  <p>Estás corrigiendo la entrada original. Al guardar se reintenta la misma <strong>{editMode.intakeCode}</strong> en <strong>{editMode.branchCode}</strong>; no se crea otra.</p>
                  <p className="mt-1 text-[var(--color-text-secondary)]">{KIND_META[editMode.kind].label} · {editMode.branchCode} — {editMode.branchName} · {editMode.reason}</p>
                </div>
              ) : (
                <>
                  {/* Paso 1 — ¿Qué estás haciendo? */}
                  <section>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">1. ¿Qué estás haciendo?</h4>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {KIND_ORDER.map((k) => {
                        const meta = KIND_META[k];
                        const active = kind === k;
                        return (
                          <button
                            key={k}
                            type="button"
                            onClick={() => selectKind(k)}
                            className={`rounded-xl border p-3 text-left transition ${active ? "border-[var(--color-master-600)] bg-[var(--color-master-50)] ring-1 ring-[var(--color-master-600)]" : "border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]"}`}
                          >
                            <div className="text-sm font-semibold text-[var(--color-text)]">{meta.label}</div>
                            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{meta.description}</p>
                            {meta.example ? <p className="mt-1 font-mono text-[11px] text-[var(--color-text-soft)]">{meta.example}</p> : null}
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  {/* Paso 2 — ¿A qué sucursales? */}
                  <section>
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">2. ¿A qué sucursales?</h4>
                      {kind !== "PHYSICAL_COUNT" ? (
                        <button type="button" onClick={() => setBranchIds(branches.map((b) => b.id))} className="text-xs font-semibold text-[var(--color-master-600)] hover:underline">Todas</button>
                      ) : null}
                    </div>
                    {kind === "PHYSICAL_COUNT" ? <p className="mb-1.5 text-xs text-[var(--color-text-muted)]">Conteo físico admite una sola sucursal — cada estante es distinto.</p> : null}
                    <div className="flex flex-wrap gap-2">
                      {branches.map((b) => {
                        const active = branchIds.includes(b.id);
                        return (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => { toggleBranch(b.id); onSelectBranch(b.id); }}
                            className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${active ? "border-[var(--color-master-600)] bg-[var(--color-master-50)] text-[var(--color-master-700)]" : "border-[var(--color-border)] text-[var(--color-text-muted)]"}`}
                          >
                            {b.code} · {b.name}
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  {/* Paso 3 — Motivo */}
                  <section>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">3. Motivo</h4>
                    <div className="flex flex-wrap gap-2">
                      {reasonChipsForKind(kind).map((chip) => (
                        <button key={chip} type="button" onClick={() => setReason(chip)} className={`rounded-full border px-3 py-1.5 text-xs font-medium ${reason === chip ? "border-[var(--color-master-600)] bg-[var(--color-master-50)] text-[var(--color-master-700)]" : "border-[var(--color-border)] text-[var(--color-text-secondary)]"}`}>
                          {chip}
                        </button>
                      ))}
                    </div>
                    <Input className="mt-2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (podés escribir el tuyo)" />
                    <button type="button" onClick={() => setNotesOpen((v) => !v)} className="mt-2 flex items-center gap-1 text-xs font-semibold text-[var(--color-master-600)]">
                      <ChevronDown className={`h-3 w-3 transition-transform ${notesOpen ? "rotate-180" : ""}`} /> Nota opcional
                    </button>
                    {notesOpen ? <Input className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observación opcional" /> : null}
                  </section>
                </>
              )}

              {editMode && editMode.appliedLines.length > 0 ? (
                <section>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Ya aplicadas ({editMode.appliedLines.length}) — no se pueden editar</h4>
                  <div className="space-y-1">
                    {editMode.appliedLines.map((line) => (
                      <div key={line.productId} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-1.5 text-xs text-[var(--color-text-muted)]">
                        <span>{line.name} <span className="font-mono text-[10px]">{line.sku}</span></span>
                        <span>{qty(line.quantity)}{line.unit ? ` ${line.unit}` : ""}{line.unitCost !== undefined ? ` · ${money(line.unitCost)}` : ""} · ya aplicada</span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {/* Paso 4 — Productos */}
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{editMode ? `Pendientes (${lines.length})` : "4. Productos"}</h4>
                {previewFailed ? (
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-danger-300)] bg-[var(--color-danger-50)] px-3 py-2 text-xs text-[var(--color-danger-800)]">
                    <span>No se pudo calcular la vista previa — las filas quedan sin verificar.</span>
                    <button type="button" onClick={retryPreview} className="shrink-0 font-semibold hover:underline">Reintentar</button>
                  </div>
                ) : null}
                {branchIds.length > 1 ? (
                  <p className="mb-2 text-xs text-[var(--color-text-muted)]">
                    Escribí la cantidad en &quot;para todas&quot;. Cambiá solo la sucursal que lleve distinto. 0 = no lleva. Vacío = igual que &quot;para todas&quot;.
                  </p>
                ) : null}
                {pendingPoWarnings.length > 0 ? (
                  <div className="mb-2 space-y-1.5">
                    {pendingPoWarnings.map((w) => (
                      <div key={w.poId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-warning-300)] bg-[var(--color-warning-50)] px-3 py-2 text-xs text-[var(--color-warning-800)]">
                        <span>{w.text}</span>
                        <a href="/app/master/purchase-orders" className="shrink-0 font-semibold text-[var(--color-master-700)] hover:underline">Recibir OC →</a>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="relative">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
                      <Input
                        className="h-11 pl-9"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        onKeyDown={handleSearchKeyDown}
                        placeholder="Nombre, SKU o código de barras — el lector USB funciona acá"
                        onFocus={() => setShowDropdown(true)}
                        onBlur={() => setTimeout(() => setShowDropdown(false), 160)}
                        autoFocus
                      />
                      {showDropdown ? (
                        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
                          {searchLoading ? (
                            <div className="flex items-center gap-2 px-3 py-3 text-xs text-[var(--color-text-muted)]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando...</div>
                          ) : searchResults.length > 0 ? searchResults.map((product) => {
                            const alreadyAdded = lines.some((l) => l.productId === product.id);
                            return (
                              <button key={product.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => addProduct(product)} className="flex w-full items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2.5 text-left text-xs last:border-0 hover:bg-[var(--color-surface-alt)]">
                                <div className="min-w-0">
                                  <div className="truncate font-semibold text-[var(--color-text)]">{product.name}</div>
                                  <div className="text-[var(--color-text-muted)]">{product.sku}{product.barcode ? ` · ${product.barcode}` : ""}</div>
                                </div>
                                {alreadyAdded ? <Check className="h-4 w-4 shrink-0 text-[var(--color-success-600)]" /> : null}
                              </button>
                            );
                          }) : <div className="px-3 py-3 text-xs text-[var(--color-text-muted)]">Sin resultados.</div>}
                        </div>
                      ) : null}
                    </div>
                    {cameraAvailable ? (
                      <button type="button" onClick={() => setShowCamera((v) => !v)} className="hm-icon-btn h-11 w-11" title="Escanear con cámara"><Camera className="h-4 w-4" /></button>
                    ) : null}
                    <button type="button" onClick={() => setPasteOpen((v) => !v)} className="hm-icon-btn h-11 w-11" title="Pegar desde Excel"><Upload className="h-4 w-4" /></button>
                  </div>
                  {showCamera ? (
                    <div className="mt-2"><CameraScanner className="max-w-sm" onClose={() => setShowCamera(false)} onDecode={(rawText) => { void resolveAndAddCode(rawText); }} /></div>
                  ) : null}
                  {pasteOpen ? (
                    <div className="mt-2 space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
                      <p className="text-xs text-[var(--color-text-muted)]">Pegá columnas: código, cantidad para todas y, opcionalmente, una columna por sucursal con su código como encabezado.</p>
                      <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={4} placeholder={"SKU-1\t10\nSKU-2\t5"} className="hm-input w-full rounded-lg font-mono text-xs" />
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => { setPasteOpen(false); setPasteText(""); }} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)]">Cancelar</button>
                        <button type="button" onClick={() => void applyPaste()} disabled={pasting || !pasteText.trim()} className="rounded-lg bg-[var(--color-master-600)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{pasting ? "Procesando..." : "Aplicar"}</button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </section>

              {/* Tabla (≥1024) */}
              <div className="hidden overflow-x-auto rounded-xl border border-[var(--color-border-strong)] lg:block">
                <table className="hm-sheet-table min-w-full">
                  <thead className="sticky top-0 z-10 bg-[var(--color-surface)]">
                    <tr>
                      <th className="sticky top-0 z-10 bg-[var(--color-surface)]">Producto</th>
                      <th className="hm-num sticky top-0 z-10 bg-[var(--color-surface)]">Cantidad{branchIds.length > 1 ? " · todas" : ""}</th>
                      {branchIds.length > 1 ? branchIds.map((id) => <th key={id} className="hm-num sticky top-0 z-10 bg-[var(--color-surface)]">{branches.find((b) => b.id === id)?.code ?? id}</th>) : null}
                      {kind !== "PHYSICAL_COUNT" ? <th className="hm-num sticky top-0 z-10 bg-[var(--color-surface)]">Costo de esta entrada</th> : null}
                      {priceColumnBranchIds.length > 0
                        ? priceColumnBranchIds.map((id) => <th key={id} className="hm-num sticky top-0 z-10 bg-[var(--color-surface)]">Precio de venta {branches.find((b) => b.id === id)?.code ?? id}</th>)
                        : showPriceExpandToggle ? <th className="hm-num sticky top-0 z-10 bg-[var(--color-surface)]">Precio de venta</th> : null}
                      <th className="sticky top-0 z-10 bg-[var(--color-surface)]">Resultado</th>
                      <th className="sticky top-0 z-10 bg-[var(--color-surface)]">Estado</th>
                      <th className="sticky top-0 z-10 bg-[var(--color-surface)]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleLines.map((line) => (
                      <IntakeTableRow
                        key={line.productId}
                        line={line}
                        kind={kind}
                        branches={branches}
                        branchIds={branchIds}
                        cells={previewCells}
                        lineMessages={previewLineMessages[line.productId] ?? []}
                        previewFailed={previewFailed}
                        expanded={expandedMessages.has(line.productId)}
                        onToggleExpanded={() => setExpandedMessages((prev) => { const next = new Set(prev); if (next.has(line.productId)) next.delete(line.productId); else next.add(line.productId); return next; })}
                        rowLoading={rowStatuses.find((r) => r.productId === line.productId)?.loading ?? true}
                        rowStatus={rowStatuses.find((r) => r.productId === line.productId)?.status ?? "PENDING"}
                        priceEditorOpen={priceEditorFor === line.productId}
                        onTogglePriceEditor={() => setPriceEditorFor((v) => (v === line.productId ? null : line.productId))}
                        quantityRef={(el) => { quantityRefs.current[line.productId] = el; }}
                        onUpdate={(patch) => updateLine(line.productId, patch)}
                        onSetOverride={(branchId, rawValue) => setBranchCell(line.productId, branchId, rawValue)}
                        onResetOverride={(branchId) => resetOverride(line.productId, branchId)}
                        onRemove={() => removeLine(line.productId)}
                        showSalePrice={showSalePrice}
                        priceColumnBranchIds={priceColumnBranchIds}
                        showPriceExpandToggle={showPriceExpandToggle}
                        primaryBranch={primaryBranch}
                        onSetSalePrice={(branchId, rawValue) => setSalePriceCell(line.productId, branchId, rawValue)}
                        onResetSalePrice={(branchId) => resetSalePriceOverride(line.productId, branchId)}
                      />
                    ))}
                    {visibleLines.length === 0 ? (
                      <tr><td colSpan={11} className="py-8 text-center text-sm text-[var(--color-text-muted)]">{lines.length === 0 ? "Buscá un producto arriba, escaneá o pegá desde Excel." : "Ninguna fila coincide con el filtro elegido."}</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              {/* Tarjetas (<1024) */}
              <div className="space-y-3 lg:hidden">
                {visibleLines.map((line) => (
                  <IntakeCardRow
                    key={line.productId}
                    line={line}
                    kind={kind}
                    branches={branches}
                    branchIds={branchIds}
                    cells={previewCells}
                    lineMessages={previewLineMessages[line.productId] ?? []}
                    previewFailed={previewFailed}
                    expanded={expandedMessages.has(line.productId)}
                    onToggleExpanded={() => setExpandedMessages((prev) => { const next = new Set(prev); if (next.has(line.productId)) next.delete(line.productId); else next.add(line.productId); return next; })}
                    rowLoading={rowStatuses.find((r) => r.productId === line.productId)?.loading ?? true}
                    rowStatus={rowStatuses.find((r) => r.productId === line.productId)?.status ?? "PENDING"}
                    priceEditorOpen={priceEditorFor === line.productId}
                    onTogglePriceEditor={() => setPriceEditorFor((v) => (v === line.productId ? null : line.productId))}
                    onUpdate={(patch) => updateLine(line.productId, patch)}
                    onSetOverride={(branchId, rawValue) => setBranchCell(line.productId, branchId, rawValue)}
                    onResetOverride={(branchId) => resetOverride(line.productId, branchId)}
                    onRemove={() => removeLine(line.productId)}
                    showSalePrice={showSalePrice}
                    priceColumnBranchIds={priceColumnBranchIds}
                    showPriceExpandToggle={showPriceExpandToggle}
                    primaryBranch={primaryBranch}
                    onSetSalePrice={(branchId, rawValue) => setSalePriceCell(line.productId, branchId, rawValue)}
                    onResetSalePrice={(branchId) => resetSalePriceOverride(line.productId, branchId)}
                  />
                ))}
                {visibleLines.length === 0 ? (
                  <p className="rounded-lg border border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-text-muted)]">{lines.length === 0 ? "Buscá un producto arriba, escaneá o pegá desde Excel." : "Ninguna fila coincide con el filtro elegido."}</p>
                ) : null}
              </div>
            </div>

            {Object.keys(missingPriceByBranch).length > 0 ? (
              <div className="px-5 pb-2 text-xs text-[var(--color-warning-700)]">
                {Object.entries(missingPriceByBranch).map(([branchId, count]) => (
                  <span key={branchId} className="mr-3">{count} producto{count === 1 ? "" : "s"} sin precio en {branches.find((b) => b.id === branchId)?.code ?? branchId}</span>
                ))}
              </div>
            ) : null}

            {/* Barra fija abajo */}
            <div className="space-y-2 border-t border-[var(--color-border)] px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-3">
                  <StatusFilterChip label="Listos" count={barCounts.ok} variant="success" active={statusFilter === "OK"} onClick={() => setStatusFilter((f) => (f === "OK" ? null : "OK"))} />
                  <StatusFilterChip label="Para revisar" count={barCounts.review} variant="warning" active={statusFilter === "REVIEW"} onClick={() => setStatusFilter((f) => (f === "REVIEW" ? null : "REVIEW"))} />
                  <StatusFilterChip label="Con error" count={barCounts.error} variant="danger" active={statusFilter === "ERROR"} onClick={() => setStatusFilter((f) => (f === "ERROR" ? null : "ERROR"))} />
                </div>
                <div className="flex flex-wrap gap-3 font-medium text-[var(--color-text-secondary)]">
                  {branchIds.map((id) => {
                    const t = previewTotals[id];
                    if (!t) return null;
                    const branch = branches.find((b) => b.id === id);
                    return <span key={id}>{branch?.code ?? id} {t.units > 0 ? `+${qty(t.units)} u` : "0 u"}{t.value !== null ? ` · ${money(t.value)}` : ""}</span>;
                  })}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                {!editMode ? <Button type="button" variant="ghost" size="sm" onClick={saveDraftNow} icon={<Save className="h-3.5 w-3.5" />}>Guardar borrador</Button> : null}
                <Button
                  type="button"
                  variant={previewFailed ? "danger" : barCounts.error > 0 ? "secondary" : "success"}
                  size="sm"
                  disabled={lines.length === 0 || (!previewFailed && barCounts.error === 0 && !canConfirm)}
                  onClick={() => {
                    // prompt-entrada-multisucursal-fix.md Commit 2 #4/#7 — con
                    // errores, el botón LLEVA a la primera fila con error en
                    // vez de quedar muerto; si la vista previa falló, reintenta.
                    if (previewFailed) { retryPreview(); return; }
                    if (barCounts.error > 0) {
                      setStatusFilter(null);
                      if (firstErrorId) requestAnimationFrame(() => { const el = quantityRefs.current[firstErrorId]; el?.scrollIntoView({ block: "center", behavior: "smooth" }); el?.focus(); });
                      return;
                    }
                    if (canConfirm) setShowConfirm(true);
                  }}
                  icon={<Check className="h-3.5 w-3.5" />}
                >
                  {previewFailed
                    ? "No se pudo calcular la vista previa"
                    : barCounts.error > 0
                      ? `Corregí ${barCounts.error} error${barCounts.error === 1 ? "" : "es"} →`
                      : anyRowLoading
                        ? "Calculando…"
                        : editMode
                          ? `Ver vista previa y reintentar ${editMode.branchCode}`
                          : "Revisar y confirmar"}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {showConfirm && !result ? (
        <ConfirmSummaryModal
          kind={kind}
          branches={branches}
          branchIds={branchIds}
          totals={previewTotals}
          missingPriceByBranch={missingPriceByBranch}
          hasReviewWarnings={hasReviewWarnings}
          reviewedWarnings={reviewedWarnings}
          onToggleReviewed={() => setReviewedWarnings((v) => !v)}
          submitting={submitting}
          onCancel={() => setShowConfirm(false)}
          onConfirm={() => void confirmAndSubmit()}
          editBranchCode={editMode?.branchCode}
        />
      ) : null}

      {duplicateWarning && !result ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="intake-duplicate-title" className="w-full max-w-md space-y-3 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl">
            <h4 id="intake-duplicate-title" className="text-sm font-semibold">¿Es otra entrada o la misma de {duplicateWarning.code}?</h4>
            <p className="text-xs text-[var(--color-text-secondary)]">
              {duplicateWarning.code} tiene {duplicateWarning.matchPercent}% de los mismos productos y quedó <strong>fallida en {duplicateWarning.branchName}</strong> sin corregir. Todavía no se guardó nada.
            </p>
            <ul className="list-disc space-y-1 pl-4 text-xs text-[var(--color-text-secondary)]">
              <li>Si es mercadería nueva (otro envío igual al anterior), creá la entrada igual.</li>
              <li>Si es la misma que falló, cancelá y corregí {duplicateWarning.code} desde Entradas → Editar y reintentar, para no sumarla dos veces.</li>
            </ul>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setDuplicateWarning(null)} disabled={submitting}>Cancelar</Button>
              <Button type="button" variant="success" loading={submitting} onClick={() => { setDuplicateWarning(null); void confirmAndSubmit(true); }}>Crear nueva igual</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatusFilterChip({ label, count, variant, active, onClick }: { label: string; count: number; variant: "success" | "warning" | "danger"; active: boolean; onClick: () => void }) {
  const icon = variant === "success" ? "✓" : variant === "warning" ? "⚠" : "✕";
  return (
    <button type="button" onClick={onClick} className={`rounded-lg px-2 py-1 font-semibold ${active ? "bg-[var(--color-surface-alt)] ring-1 ring-[var(--color-border-strong)]" : ""}`}>
      <Badge variant={variant}>{icon} {count}</Badge> <span className="text-[var(--color-text-muted)]">{label}</span>
    </button>
  );
}

/**
 * prompt-entrada-multisucursal-fix.md Commit 2 #2 — el texto corto sigue
 * el TIPO real del primer mensaje (shortTextForErrorCode), nunca
 * "Falta dato" para todo. PENDING ("sin vista previa todavía o falló") es
 * neutro, nunca rojo — distinto de un error real.
 */
function StatusBadge({ status, loading, firstMessageCode }: { status: IntakeLineStatus; loading: boolean; firstMessageCode?: string }) {
  if (loading) return <Badge variant="neutral">… revisando</Badge>;
  if (status === "PENDING") return <Badge variant="neutral">Sin verificar</Badge>;
  if (status === "OK") return <Badge variant="success">✓ Listo</Badge>;
  if (status === "REVIEW") return <Badge variant="warning">⚠ Revisar</Badge>;
  return <Badge variant="danger">✕ {firstMessageCode ? shortTextForErrorCode(firstMessageCode) : "Falta dato"}</Badge>;
}

function ResultLine({ cell, branchCode }: { cell: PreviewCell | undefined; branchCode?: string }) {
  if (!cell) return <span className="text-[var(--color-text-soft)]">{branchCode ? `${branchCode}: —` : "—"}</span>;
  const stockUp = cell.delta > 0;
  const stockDown = cell.delta < 0;
  return (
    <div className="text-[11px] leading-tight">
      <div className={stockUp ? "text-[var(--color-success-700)]" : stockDown ? "text-[var(--color-danger-700)]" : "text-[var(--color-text-muted)]"}>
        {branchCode ? `${branchCode}: ` : ""}{qty(cell.currentQty)} → {qty(cell.finalQty)}{cell.delta !== 0 ? ` (${cell.delta > 0 ? "+" : ""}${qty(cell.delta)})` : ""}
      </div>
      {cell.newWac !== null ? (
        <div className="text-[var(--color-text-muted)]">prom. {money(cell.currentWac ?? 0)} → {money(cell.newWac)}</div>
      ) : null}
    </div>
  );
}

/**
 * prompt-entrada-multisucursal-fix.md Commit 2 #2/#3 — el primer mensaje
 * siempre visible en una línea; el resto en "y N más ▾". Usa los
 * lineMessages YA AGRUPADOS por código con su código de sucursal
 * (MSY, RIV — nunca el id interno) que manda el preview.
 */
function RowMessages({ messages, expanded, onToggleExpanded }: { messages: PreviewLineMessage[]; expanded: boolean; onToggleExpanded: () => void }) {
  if (messages.length === 0) return null;
  const [first, ...rest] = messages;
  return (
    <div className="mt-1 space-y-0.5">
      <div className="text-[10.5px] leading-tight text-[var(--color-text-muted)]">{first.text}</div>
      {rest.length > 0 ? (
        <>
          {expanded ? rest.map((m, i) => (
            <div key={`${m.code}-${i}`} className="text-[10.5px] leading-tight text-[var(--color-text-muted)]">{m.text}</div>
          )) : null}
          <button type="button" onClick={onToggleExpanded} className="text-[10.5px] font-semibold text-[var(--color-master-600)]">
            {expanded ? "ocultar ▴" : `y ${rest.length} más ▾`}
          </button>
        </>
      ) : null}
    </div>
  );
}

type RowProps = {
  line: IntakeLine;
  kind: IntakeKind;
  branches: Branch[];
  branchIds: string[];
  cells: Map<string, PreviewCell>;
  lineMessages: PreviewLineMessage[];
  previewFailed: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  rowLoading: boolean;
  rowStatus: IntakeLineStatus;
  priceEditorOpen: boolean;
  onTogglePriceEditor: () => void;
  onUpdate: (patch: Partial<IntakeLine>) => void;
  onSetOverride: (branchId: string, rawValue: string) => void;
  onResetOverride: (branchId: string) => void;
  onRemove: () => void;
  quantityRef?: (el: HTMLInputElement | null) => void;
  /** Commit 3 — false en Conteo (no cambia precios). */
  showSalePrice: boolean;
  /** Columnas de precio a mostrar (vacío = usar el campo único + priceEditorOpen "por sucursal ▾"). */
  priceColumnBranchIds: string[];
  showPriceExpandToggle: boolean;
  primaryBranch: { id: string; code: string } | null;
  onSetSalePrice: (branchId: string, rawValue: string) => void;
  onResetSalePrice: (branchId: string) => void;
};

function rowCells(line: IntakeLine, branchIds: string[], cells: Map<string, PreviewCell>): PreviewCell[] {
  return branchIds.map((id) => cells.get(cellKey(line.productId, id))).filter((c): c is PreviewCell => !!c);
}

function shouldShowCostInput(kind: IntakeKind, cells: PreviewCell[]): boolean {
  if (kind === "OPENING_BALANCE") return true;
  if (kind === "ADD_STOCK") return true;
  // PHYSICAL_COUNT: oculto salvo que ALGUNA sucursal elegida no tenga costo
  // previo (NO_COST_NO_AVERAGE es por celda — si ninguna lo necesita, no
  // tiene sentido mostrarlo; si una sola lo necesita, hay que poder llenarlo).
  return cells.length > 0 && cells.some((c) => c.currentWac === null && c.lastPurchaseCost === null);
}

/**
 * prompt-entrada-multisucursal-fix.md Commit 2 #5 — "actual C$ X" si todas
 * las sucursales elegidas tienen el mismo costo; "actual: MGA C$ X · MSY
 * C$ Y" si difieren; y "MSY sin costo" en ámbar si falta en alguna.
 */
function CostHint({ cells, branchIds, branches, productId }: { cells: Map<string, PreviewCell>; branchIds: string[]; branches: Branch[]; productId: string }) {
  const entries = branchIds.map((id) => {
    const cell = cells.get(cellKey(productId, id));
    const cost = cell?.currentWac ?? cell?.lastPurchaseCost ?? null;
    return { code: branches.find((b) => b.id === id)?.code ?? id, cost };
  });
  const withCost = entries.filter((e): e is { code: string; cost: number } => e.cost !== null);
  const withoutCost = entries.filter((e) => e.cost === null);
  if (withCost.length === 0 && withoutCost.length === 0) return null;
  const allSame = withCost.length > 0 && withCost.every((e) => e.cost === withCost[0].cost);

  return (
    <div className="mt-0.5 text-[10.5px] leading-tight">
      {withCost.length > 0 ? (
        <span className="text-[var(--color-text-muted)]">
          actual {allSame || withCost.length === 1 ? money(withCost[0].cost) : withCost.map((e) => `${e.code} ${money(e.cost)}`).join(" · ")}
        </span>
      ) : null}
      {withoutCost.length > 0 ? (
        <span className={withCost.length > 0 ? "ml-1 text-[var(--color-warning-700)]" : "text-[var(--color-warning-700)]"}>
          {withoutCost.map((e) => e.code).join(", ")} sin costo
        </span>
      ) : null}
    </div>
  );
}

/**
 * Commit 3 §3 — "si la sucursal no tiene costo: chips con 'Última compra
 * C$85' y 'MGA C$82'. Tocar un chip lo copia al campo, pero no se llena
 * solo." Solo tiene sentido ofrecerlos cuando el campo está vacío — una
 * vez que el dueño escribió algo, los chips no sirven (ya hay un valor).
 */
function CostChips({ cell, principalCell, principalCode, onPick }: { cell: PreviewCell | undefined; principalCell: PreviewCell | undefined; principalCode: string | undefined; onPick: (value: number) => void }) {
  const chips: Array<{ label: string; value: number }> = [];
  if (cell?.lastPurchaseCost) chips.push({ label: `Última compra ${money(cell.lastPurchaseCost)}`, value: cell.lastPurchaseCost });
  if (principalCode && principalCell?.currentEffectiveCost) chips.push({ label: `${principalCode} ${money(principalCell.currentEffectiveCost)}`, value: principalCell.currentEffectiveCost });
  if (chips.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {chips.map((c) => (
        <button key={c.label} type="button" onClick={() => onPick(c.value)} className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]">{c.label}</button>
      ))}
    </div>
  );
}

/**
 * Commit 3 — el campo "Precio de venta {sucursal}", con toda su ayuda:
 * precio/margen vigente, margen con el costo NUEVO (ámbar bajo la
 * política), atajos +5/10/15 % sobre el costo resultante e "igual que
 * {principal}", y el aviso de "sin precio" (nunca bloquea, solo avisa).
 */
function SalePriceCell({ line, branchId, branchCode, cell, resultingCost, primaryBranch, principalCell, onSet, onReset, className }: {
  line: IntakeLine;
  branchId: string;
  branchCode: string;
  cell: PreviewCell | undefined;
  resultingCost: number | null;
  primaryBranch: { id: string; code: string } | null;
  principalCell: PreviewCell | undefined;
  onSet: (branchId: string, rawValue: string) => void;
  onReset: (branchId: string) => void;
  className?: string;
}) {
  const resolvedPrice = salePriceForIntakeBranch(line, branchId);
  const overridden = branchId in line.salePriceOverrides;
  const currentPrice = cell?.currentSalePrice ?? null;
  const hasCurrentPrice = currentPrice !== null && currentPrice > 0;
  const currentMargin = hasCurrentPrice && resultingCost !== null ? computeMarginPercent(currentPrice, resultingCost) : null;
  const resultingPrice = resolvedPrice ?? (hasCurrentPrice ? currentPrice : null);
  const newMargin = resultingPrice !== null && resultingCost !== null ? computeMarginPercent(resultingPrice, resultingCost) : null;
  const belowPolicy = newMargin !== null && cell?.minMarginPercent != null && newMargin < cell.minMarginPercent;
  const noPrice = !hasCurrentPrice && resolvedPrice === null;
  const priceBelowCost = resultingPrice !== null && resultingCost !== null && resultingCost > 0 && resultingPrice < resultingCost;
  const principalPrice = primaryBranch && primaryBranch.id !== branchId ? principalCell?.currentSalePrice ?? null : null;

  return (
    <div className={className}>
      <div className="flex items-center gap-1">
        <Input
          type="number" min="0" step="0.01"
          className={`w-24 text-right ${priceBelowCost ? "border-[var(--color-danger-400)]" : belowPolicy ? "border-[var(--color-warning-400)]" : ""}`}
          value={resolvedPrice ?? ""}
          onChange={(e) => onSet(branchId, e.target.value)}
          placeholder="sin cambio"
        />
        {overridden ? <button type="button" onClick={() => onReset(branchId)} className="hm-icon-btn h-6 w-6" title="Igualar a 'para todas'"><RotateCcw className="h-3 w-3" /></button> : null}
      </div>
      <div className="mt-0.5 space-y-0.5 text-[10.5px] leading-tight">
        {hasCurrentPrice ? (
          <div className="text-[var(--color-text-muted)]">actual {money(currentPrice)}{currentMargin !== null ? ` · margen ${currentMargin.toFixed(1)}%` : ""}</div>
        ) : null}
        {noPrice ? (
          <div className="text-[var(--color-warning-700)]">{branchCode} no tiene precio de venta</div>
        ) : newMargin !== null && resultingPrice !== currentPrice ? (
          <div className={belowPolicy ? "text-[var(--color-warning-700)]" : "text-[var(--color-text-muted)]"}>margen {belowPolicy ? "baja a" : "queda en"} {newMargin.toFixed(1)}% con el costo nuevo</div>
        ) : null}
        {resultingCost !== null && resultingCost > 0 ? (
          <div className="flex flex-wrap gap-1">
            {[5, 10, 15].map((m) => {
              const shortcutPrice = priceForMarginPercent(resultingCost, m);
              if (shortcutPrice === null) return null;
              return <button key={m} type="button" onClick={() => onSet(branchId, String(Math.round(shortcutPrice * 100) / 100))} className="rounded-full border border-[var(--color-border)] px-1.5 py-0.5 font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]">+{m}%</button>;
            })}
            {principalPrice !== null ? (
              <button type="button" onClick={() => onSet(branchId, String(principalPrice))} className="rounded-full border border-[var(--color-border)] px-1.5 py-0.5 font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]">igual que {primaryBranch!.code}</button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const QUANTITY_ERROR_CODES = new Set(["MISSING_QUANTITY", "ALL_BRANCHES_SKIPPED"]);
const COST_ERROR_CODES = new Set(["NO_COST_NO_AVERAGE", "OPENING_BALANCE_NO_COST", "PRICE_BELOW_COST"]);

/** prompt-entrada-multisucursal-fix.md Commit 2 #2 — "el input con el problema queda con borde rojo": cantidad, costo o la celda de la sucursal. */
function hasLineError(lineMessages: PreviewLineMessage[], codes: Set<string>): boolean {
  return lineMessages.some((m) => codes.has(m.code));
}

function IntakeTableRow({ line, kind, branches, branchIds, cells, lineMessages, previewFailed, expanded, onToggleExpanded, rowLoading, rowStatus, priceEditorOpen, onTogglePriceEditor, onUpdate, onSetOverride, onResetOverride, onRemove, quantityRef, showSalePrice, priceColumnBranchIds, showPriceExpandToggle, primaryBranch, onSetSalePrice, onResetSalePrice }: RowProps) {
  const lineCells = rowCells(line, branchIds, cells);
  const showCost = shouldShowCostInput(kind, lineCells);
  const singleBranchId = branchIds.length === 1 ? branchIds[0] : null;
  const quantityHasError = !previewFailed && hasLineError(lineMessages, QUANTITY_ERROR_CODES);
  const costHasError = !previewFailed && hasLineError(lineMessages, COST_ERROR_CODES);
  const principalCell = primaryBranch ? cells.get(cellKey(line.productId, primaryBranch.id)) : undefined;
  // "Las otras sucursales quedan sin cantidad. ¿Usar X para todas?" (Commit 2 #1) — solo tiene sentido con "para todas" vacío y AL MENOS una, pero no todas, las sucursales con un valor propio.
  const overrideCount = Object.keys(line.overrides).length;
  const showUseForAllHint = branchIds.length > 1 && line.quantity === null && overrideCount > 0 && overrideCount < branchIds.length;
  const firstOverrideValue = showUseForAllHint ? Object.values(line.overrides).find((v) => v !== null && v !== undefined) ?? null : null;

  return (
    <>
      <tr className={!previewFailed && rowStatus === "ERROR" && !rowLoading ? "bg-[var(--color-danger-50)]" : !previewFailed && rowStatus === "REVIEW" && !rowLoading ? "bg-[var(--color-warning-50)]" : undefined}>
        <td>
          <div className="font-medium text-[var(--color-text)]">{line.name}</div>
          <div className="font-mono text-[11px] text-[var(--color-text-muted)]">{line.sku}</div>
        </td>
        <td className="hm-num">
          <Input ref={quantityRef} type="number" min="0" step="0.0001" className={`w-24 text-right ${quantityHasError ? "border-[var(--color-danger-400)]" : ""}`} value={line.quantity ?? ""} onChange={(e) => onUpdate({ quantity: e.target.value === "" ? null : Number(e.target.value) })} placeholder="—" />
          {line.hasConversion ? (
            <select className="hm-input mt-1 w-24 text-xs" value={line.unit} onChange={(e) => onUpdate({ unit: e.target.value })}>
              <option value={line.saleUnit}>{line.saleUnit}</option>
              <option value={line.baseUnit}>{line.baseUnit}</option>
            </select>
          ) : null}
          {showUseForAllHint && firstOverrideValue !== null ? (
            <div className="mt-1 text-[10.5px] leading-tight text-[var(--color-text-muted)]">
              Las otras sucursales quedan sin cantidad.{" "}
              <button type="button" onClick={() => onUpdate({ quantity: firstOverrideValue })} className="font-semibold text-[var(--color-master-600)] hover:underline">
                ¿Usar {qty(firstOverrideValue)} para todas?
              </button>
            </div>
          ) : null}
        </td>
        {branchIds.length > 1 ? branchIds.map((id) => {
          const value = quantityForIntakeBranch(line, id);
          const overridden = id in line.overrides;
          const cell = cells.get(cellKey(line.productId, id));
          const skipped = cell?.status === "SKIPPED";
          const cellHasError = !previewFailed && cell?.status === "ERROR";
          const hasStockOnOpening = kind === "OPENING_BALANCE" && cell?.messages.some((m) => m.code === "OPENING_BALANCE_HAS_STOCK");
          return (
            <td key={id} className="hm-num">
              <div className="flex items-center justify-end gap-1">
                <Input
                  type="number" min="0" step="0.0001"
                  className={`w-20 text-right ${cellHasError ? "border-[var(--color-danger-400)]" : overridden ? "border-[var(--color-warning-400)] bg-[var(--color-warning-50)]" : ""} ${skipped ? "text-[var(--color-text-soft)] line-through" : ""}`}
                  value={value ?? ""}
                  onChange={(e) => onSetOverride(id, e.target.value)}
                  placeholder={skipped ? "no lleva" : "—"}
                />
                {overridden ? <button type="button" onClick={() => onResetOverride(id)} className="hm-icon-btn h-6 w-6" title="Igualar a 'para todas'"><RotateCcw className="h-3 w-3" /></button> : null}
              </div>
              {hasStockOnOpening ? (
                <button type="button" onClick={() => onSetOverride(id, "0")} className="mt-0.5 block w-full text-right text-[10.5px] font-semibold text-[var(--color-danger-600)] hover:underline">
                  Quitar esta sucursal
                </button>
              ) : null}
            </td>
          );
        }) : null}
        {kind !== "PHYSICAL_COUNT" ? (
          <td className="hm-num">
            {showCost ? (
              <>
                <Input type="number" min="0" step="0.01" className={`w-24 text-right ${costHasError ? "border-[var(--color-danger-400)]" : ""}`} value={line.unitCost || ""} onChange={(e) => onUpdate({ unitCost: e.target.value === "" ? null : Number(e.target.value) })} placeholder={kind === "OPENING_BALANCE" ? "obligatorio" : "sin cambio"} />
                {!line.unitCost ? <CostHint cells={cells} branchIds={branchIds} branches={branches} productId={line.productId} /> : null}
                {!line.unitCost ? <CostChips cell={singleBranchId ? cells.get(cellKey(line.productId, singleBranchId)) : lineCells[0]} principalCell={principalCell} principalCode={primaryBranch?.code} onPick={(value) => onUpdate({ unitCost: value })} /> : null}
              </>
            ) : <span className="text-[var(--color-text-soft)]">—</span>}
          </td>
        ) : null}
        {showSalePrice ? (
          priceColumnBranchIds.length > 0
            ? priceColumnBranchIds.map((id) => {
                const resultingCost = line.unitCost ?? cells.get(cellKey(line.productId, id))?.currentEffectiveCost ?? null;
                return <td key={id} className="hm-num"><SalePriceCell line={line} branchId={id} branchCode={branches.find((b) => b.id === id)?.code ?? id} cell={cells.get(cellKey(line.productId, id))} resultingCost={resultingCost} primaryBranch={primaryBranch} principalCell={principalCell} onSet={onSetSalePrice} onReset={onResetSalePrice} /></td>;
              })
            : showPriceExpandToggle ? (
                <td className="hm-num">
                  <button type="button" onClick={onTogglePriceEditor} className="text-xs font-semibold text-[var(--color-master-600)]">
                    Precio de venta · {branchIds.length} suc. {priceEditorOpen ? "▴" : "▾"}
                  </button>
                </td>
              ) : null
        ) : null}
        <td className="min-w-[140px]">
          {branchIds.length > 1
            ? branchIds.map((id) => <ResultLine key={id} cell={cells.get(cellKey(line.productId, id))} branchCode={branches.find((b) => b.id === id)?.code} />)
            : <ResultLine cell={singleBranchId ? cells.get(cellKey(line.productId, singleBranchId)) : undefined} />}
          {previewFailed ? null : <RowMessages messages={lineMessages} expanded={expanded} onToggleExpanded={onToggleExpanded} />}
        </td>
        <td>
          <StatusBadge status={previewFailed ? "PENDING" : rowStatus} loading={rowLoading && !previewFailed} firstMessageCode={lineMessages[0]?.code} />
          {!rowLoading && !previewFailed ? <div className="mt-0.5 text-[10.5px] text-[var(--color-text-muted)]">{rowStateLabel(rowStatus, lineMessages.map((m) => m.code))}</div> : null}
        </td>
        <td>
          <button type="button" onClick={onRemove} className="hm-icon-btn hm-icon-btn-danger h-7 w-7"><Trash2 className="h-3.5 w-3.5" /></button>
        </td>
      </tr>
      {showPriceExpandToggle && priceEditorOpen ? (
        <tr>
          <td colSpan={11} className="bg-[var(--color-surface-alt)] px-3 py-2">
            <div className="flex flex-wrap gap-3">
              {branchIds.map((id) => {
                const resultingCost = line.unitCost ?? cells.get(cellKey(line.productId, id))?.currentEffectiveCost ?? null;
                return (
                  <div key={id}>
                    <div className="mb-1 text-[10.5px] font-semibold text-[var(--color-text-muted)]">{branches.find((b) => b.id === id)?.code ?? id}</div>
                    <SalePriceCell line={line} branchId={id} branchCode={branches.find((b) => b.id === id)?.code ?? id} cell={cells.get(cellKey(line.productId, id))} resultingCost={resultingCost} primaryBranch={primaryBranch} principalCell={principalCell} onSet={onSetSalePrice} onReset={onResetSalePrice} />
                  </div>
                );
              })}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function IntakeCardRow({ line, kind, branches, branchIds, cells, lineMessages, previewFailed, expanded, onToggleExpanded, rowLoading, rowStatus, onUpdate, onSetOverride, onResetOverride, onRemove, showSalePrice, primaryBranch, onSetSalePrice, onResetSalePrice }: RowProps) {
  const lineCells = rowCells(line, branchIds, cells);
  const showCost = shouldShowCostInput(kind, lineCells);
  const singleBranchId = branchIds.length === 1 ? branchIds[0] : null;
  const quantityHasError = !previewFailed && hasLineError(lineMessages, QUANTITY_ERROR_CODES);
  const costHasError = !previewFailed && hasLineError(lineMessages, COST_ERROR_CODES);
  const principalCell = primaryBranch ? cells.get(cellKey(line.productId, primaryBranch.id)) : undefined;
  const overrideCount = Object.keys(line.overrides).length;
  const showUseForAllHint = branchIds.length > 1 && line.quantity === null && overrideCount > 0 && overrideCount < branchIds.length;
  const firstOverrideValue = showUseForAllHint ? Object.values(line.overrides).find((v) => v !== null && v !== undefined) ?? null : null;

  return (
    <div className={`rounded-xl border p-3 ${!previewFailed && rowStatus === "ERROR" && !rowLoading ? "border-[var(--color-danger-300)] bg-[var(--color-danger-50)]" : !previewFailed && rowStatus === "REVIEW" && !rowLoading ? "border-[var(--color-warning-300)] bg-[var(--color-warning-50)]" : "border-[var(--color-border-strong)] bg-[var(--color-surface)]"}`}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text)]">{line.name}</p>
          <p className="font-mono text-[11px] text-[var(--color-text-muted)]">{line.sku}</p>
        </div>
        <div className="flex items-center gap-1">
          <StatusBadge status={previewFailed ? "PENDING" : rowStatus} loading={rowLoading && !previewFailed} firstMessageCode={lineMessages[0]?.code} />
          <button type="button" onClick={onRemove} className="hm-icon-btn hm-icon-btn-danger min-h-[44px] min-w-[44px]"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs">
          <span className="mb-1 block text-[var(--color-text-muted)]">Cantidad</span>
          <Input type="number" min="0" step="0.0001" className={`h-11 ${quantityHasError ? "border-[var(--color-danger-400)]" : ""}`} value={line.quantity ?? ""} onChange={(e) => onUpdate({ quantity: e.target.value === "" ? null : Number(e.target.value) })} placeholder="—" />
          {showUseForAllHint && firstOverrideValue !== null ? (
            <span className="mt-1 block text-[10.5px] leading-tight text-[var(--color-text-muted)]">
              Las otras sucursales quedan sin cantidad.{" "}
              <button type="button" onClick={() => onUpdate({ quantity: firstOverrideValue })} className="font-semibold text-[var(--color-master-600)] hover:underline">
                ¿Usar {qty(firstOverrideValue)} para todas?
              </button>
            </span>
          ) : null}
        </label>
        {kind !== "PHYSICAL_COUNT" && showCost ? (
          <label className="text-xs">
            <span className="mb-1 block text-[var(--color-text-muted)]">Costo de esta entrada</span>
            <Input type="number" min="0" step="0.01" className={`h-11 ${costHasError ? "border-[var(--color-danger-400)]" : ""}`} value={line.unitCost || ""} onChange={(e) => onUpdate({ unitCost: e.target.value === "" ? null : Number(e.target.value) })} placeholder={kind === "OPENING_BALANCE" ? "obligatorio" : "sin cambio"} />
            {!line.unitCost ? <CostHint cells={cells} branchIds={branchIds} branches={branches} productId={line.productId} /> : null}
            {!line.unitCost ? <CostChips cell={singleBranchId ? cells.get(cellKey(line.productId, singleBranchId)) : lineCells[0]} principalCell={principalCell} principalCode={primaryBranch?.code} onPick={(value) => onUpdate({ unitCost: value })} /> : null}
          </label>
        ) : null}
      </div>
      <div className="mt-2">
        {branchIds.length > 1
          ? branchIds.map((id) => <ResultLine key={id} cell={cells.get(cellKey(line.productId, id))} branchCode={branches.find((b) => b.id === id)?.code} />)
          : <ResultLine cell={singleBranchId ? cells.get(cellKey(line.productId, singleBranchId)) : undefined} />}
        {previewFailed ? null : <RowMessages messages={lineMessages} expanded={expanded} onToggleExpanded={onToggleExpanded} />}
      </div>
      {branchIds.length > 1 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-semibold text-[var(--color-master-600)]">Distinto por sucursal ▾</summary>
          <div className="mt-2 space-y-2">
            {branchIds.map((id) => {
              const value = quantityForIntakeBranch(line, id);
              const overridden = id in line.overrides;
              const branch = branches.find((b) => b.id === id);
              const cell = cells.get(cellKey(line.productId, id));
              const skipped = cell?.status === "SKIPPED";
              const cellHasError = !previewFailed && cell?.status === "ERROR";
              const hasStockOnOpening = kind === "OPENING_BALANCE" && cell?.messages.some((m) => m.code === "OPENING_BALANCE_HAS_STOCK");
              return (
                <div key={id} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-[var(--color-text-secondary)]">{branch?.code ?? id}</span>
                  <div className="flex flex-col items-end gap-0.5">
                    <div className="flex items-center gap-1">
                      <Input
                        type="number" min="0" step="0.0001"
                        className={`h-11 w-20 text-right ${cellHasError ? "border-[var(--color-danger-400)]" : overridden ? "border-[var(--color-warning-400)] bg-[var(--color-warning-50)]" : ""} ${skipped ? "text-[var(--color-text-soft)] line-through" : ""}`}
                        value={value ?? ""}
                        onChange={(e) => onSetOverride(id, e.target.value)}
                        placeholder={skipped ? "no lleva" : "—"}
                      />
                      {overridden ? <button type="button" onClick={() => onResetOverride(id)} className="hm-icon-btn min-h-[44px] min-w-[44px]"><RotateCcw className="h-4 w-4" /></button> : null}
                    </div>
                    {hasStockOnOpening ? (
                      <button type="button" onClick={() => onSetOverride(id, "0")} className="text-[10.5px] font-semibold text-[var(--color-danger-600)] hover:underline">Quitar esta sucursal</button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
      {!previewFailed ? <div className="mt-1 text-[10.5px] font-medium text-[var(--color-text-muted)]">{rowStateLabel(rowStatus, lineMessages.map((m) => m.code))}</div> : null}
      {showSalePrice ? (
        <div className="mt-2 space-y-2 border-t border-[var(--color-border)] pt-2">
          {branchIds.map((id) => {
            const resultingCost = line.unitCost ?? cells.get(cellKey(line.productId, id))?.currentEffectiveCost ?? null;
            return (
              <div key={id}>
                <span className="mb-1 block text-xs text-[var(--color-text-muted)]">Precio de venta{branchIds.length > 1 ? ` ${branches.find((b) => b.id === id)?.code ?? id}` : ""}</span>
                <SalePriceCell line={line} branchId={id} branchCode={branches.find((b) => b.id === id)?.code ?? id} cell={cells.get(cellKey(line.productId, id))} resultingCost={resultingCost} primaryBranch={primaryBranch} principalCell={principalCell} onSet={onSetSalePrice} onReset={onResetSalePrice} />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ConfirmSummaryModal({ kind, branches, branchIds, totals, missingPriceByBranch, hasReviewWarnings, reviewedWarnings, onToggleReviewed, submitting, onCancel, onConfirm, editBranchCode }: {
  kind: IntakeKind;
  branches: Branch[];
  branchIds: string[];
  totals: Record<string, PreviewTotals>;
  missingPriceByBranch: Record<string, number>;
  hasReviewWarnings: boolean;
  reviewedWarnings: boolean;
  onToggleReviewed: () => void;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  editBranchCode?: string;
}) {
  const canSubmit = !hasReviewWarnings || reviewedWarnings;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">{editBranchCode ? `Reintentar ${editBranchCode}` : `Confirmar ${KIND_META[kind].label.toLowerCase()}`}</h3>
        <div className="mt-3 space-y-2 text-sm">
          {branchIds.map((id) => {
            const t = totals[id];
            const branch = branches.find((b) => b.id === id);
            return (
              <div key={id} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] px-3 py-2">
                <span className="font-medium">{branch?.code ?? id} — {branch?.name ?? ""}</span>
                <span className="text-xs text-[var(--color-text-muted)]">{t ? `${qty(t.units)} u${t.value !== null ? ` · ${money(t.value)}` : ""}${t.wacChanges > 0 ? ` · ${t.wacChanges} costo${t.wacChanges === 1 ? "" : "s"} promedio` : ""}` : "sin datos"}</span>
              </div>
            );
          })}
        </div>
        {Object.keys(missingPriceByBranch).length > 0 ? (
          <p className="mt-2 text-xs text-[var(--color-warning-700)]">
            {Object.entries(missingPriceByBranch).map(([id, count]) => `${count} producto${count === 1 ? "" : "s"} sin precio en ${branches.find((b) => b.id === id)?.code ?? id}`).join(" · ")}
          </p>
        ) : null}
        {hasReviewWarnings ? (
          <label className="mt-3 flex items-center gap-2 text-xs text-[var(--color-warning-800)]">
            <input type="checkbox" checked={reviewedWarnings} onChange={onToggleReviewed} /> Revisé los avisos marcados con ⚠
          </label>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button type="button" variant="success" loading={submitting} disabled={!canSubmit} onClick={onConfirm} icon={<Check className="h-4 w-4" />}>{editBranchCode ? `Reintentar ${editBranchCode}` : "Registrar entrada"}</Button>
        </div>
      </div>
    </div>
  );
}

function IntakeResultView({ result, branches, retrying, onRetry, onViewKardex, onClose }: {
  result: CreateIntakeResult;
  branches: Branch[];
  retrying: boolean;
  onRetry: () => void;
  onViewKardex: () => void;
  onClose: () => void;
}) {
  const anyFailed = result.branches.some((b) => b.status === "FAILED");
  return (
    <div className="flex-1 overflow-y-auto px-5 py-4">
      <p className="mb-3 text-sm font-semibold text-[var(--color-text)]">Resultado — {result.intake.code}</p>
      <div className="space-y-2">
        {result.branches.map((b) => {
          const branch = branches.find((br) => br.id === b.branchId);
          const pct = b.totalLines > 0 ? Math.round((b.processedLines / b.totalLines) * 100) : 100;
          return (
            <div key={b.branchId} className="rounded-lg border border-[var(--color-border)] p-3">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium">{branch?.code ?? b.branchId} — {branch?.name ?? ""}</span>
                {b.status === "DONE" ? <Badge variant="success">Hecho</Badge> : b.status === "FAILED" ? <Badge variant="danger">Falló</Badge> : <Badge variant="warning">En curso</Badge>}
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-alt)]">
                <div className="h-full rounded-full bg-[var(--color-master-600)]" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">{b.processedLines}/{b.totalLines} líneas</p>
              {b.status === "FAILED" && b.error ? <p className="mt-1 text-xs font-medium text-[var(--color-danger-600)]">{b.error}</p> : null}
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        {anyFailed ? <Button type="button" variant="danger" loading={retrying} onClick={onRetry}>Reintentar</Button> : null}
        <Button type="button" variant="secondary" onClick={onViewKardex}>Ver en kardex</Button>
        <Button type="button" variant="success" onClick={onClose} icon={<Check className="h-4 w-4" />}>Cerrar</Button>
      </div>
    </div>
  );
}
