import type {
  BrainDecisionCategory,
  BrainDecisionSeverity,
  BrainDecisionStatus,
  Prisma,
} from "@prisma/client";

export type BrainScanMode = "SCHEDULED_SCAN" | "QUICK_SCAN" | "OPERATIONAL_DAY_SCAN" | "ENTITY_SCAN" | "DEEP_SCAN" | "REPAIR_SCAN";

export type BrainScanTrigger = "SCHEDULED" | "MANUAL" | "PRICING_REFRESH";

export type BrainScanScope = {
  branchId?: string;
  businessDate?: string;
  operationalDayId?: string;
  cashSessionId?: string;
  saleOrderId?: string;
  productId?: string;
  category?: BrainDecisionCategory;
  module?: string;
  severity?: BrainDecisionSeverity;
  detector?: string;
  dateFrom?: Date;
  dateTo?: Date;
  mode: BrainScanMode;
};

export type BrainDetectorLimits = {
  maxIssues: number;
  maxEntities: number;
  timeoutMs: number;
};

export type BrainDetectorContext = {
  branchId?: string;
  businessDate?: string;
  operationalDayId?: string;
  cashSessionId?: string;
  saleOrderId?: string;
  productId?: string;
  detector?: string;
  mode: BrainScanMode;
  days: number;
  since: Date;
  now: Date;
  dateFrom: Date;
  dateTo: Date;
  scope: BrainScanScope;
  limits: BrainDetectorLimits;
  dryRun?: boolean;
  /**
   * Parte A 1.2 — un detector llama esto cuando una consulta paginada
   * (`paginateAll`) se quedó sin tiempo antes de agotar las filas reales:
   * "pricing:branchProductSetting", "inventory:product"... El engine junta
   * estas marcas en el resumen del detector (`truncated: string[]`) y
   * `shouldAutoCloseAfterScan` ya no cierra nada si hay alguna — cerrar
   * sobre una MUESTRA (no sobre el dominio completo) es lo que generaba el
   * ciclo "se cierra sola → vuelve a aparecer" cada hora.
   */
  markTruncated: (source: string) => void;
};

export type BrainDecisionDraft = {
  category: BrainDecisionCategory;
  severity: BrainDecisionSeverity;
  title: string;
  description: string;
  recommendation: string;
  branchId?: string | null;
  productId?: string | null;
  userId?: string | null;
  targetUserId?: string | null;
  confidenceScore?: number | null;
  impactAmount?: number | null;
  riskScore?: number | null;
  priorityScore?: number | null;
  proposedActionType?: string | null;
  proposedActionJson?: Prisma.InputJsonValue | null;
  evidenceJson?: Prisma.InputJsonValue | null;
  sourceJson?: Prisma.InputJsonValue | null;
  fingerprintParts: Array<string | number | boolean | null | undefined>;
  expiresAt?: Date | null;
  /** Estampado por engine.ts antes de persistir — la `key` del detector que la emitió. Habilita el cierre automático. */
  detectorKey?: string;
};

export type BrainScanDetectorSummary = {
  key: string;
  category: BrainDecisionCategory;
  ok: boolean;
  count: number;
  capped: boolean;
  /** Parte A 1.2 — consultas paginadas que se quedaron sin tiempo antes de leer todo el dominio. */
  truncated: string[];
  ms: number | null;
  error?: string;
};

export type BrainScanResult = {
  total: number;
  created: number;
  updated: number;
  reopened: number;
  expired: number;
  skipped: number;
  errors: Array<{ detector?: string; message: string }>;
  scannedCategories: BrainDecisionCategory[];
  byCategory: Partial<Record<BrainDecisionCategory, number>>;
  scope?: BrainScanScope;
  limits?: BrainDetectorLimits;
};

export type BrainDecisionFilters = {
  branchId?: string;
  productId?: string;
  category?: BrainDecisionCategory;
  severity?: BrainDecisionSeverity;
  status?: BrainDecisionStatus;
  days?: number;
  targetUserId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
  onlyCritical?: boolean;
  onlyActionable?: boolean;
  onlyWithImpact?: boolean;
  onlyPendingApproval?: boolean;
  onlyPricing?: boolean;
  onlyInventory?: boolean;
  onlyCash?: boolean;
  onlyPurchasing?: boolean;
  onlyTransfers?: boolean;
  onlyConfiguration?: boolean;
  onlyPricingMisconfiguration?: boolean;
  actionType?: string;
  cursor?: string;
  limit?: number;
  sort?: "priority" | "severity" | "impact" | "newest" | "oldest" | "branch" | "category" | "date";
};
