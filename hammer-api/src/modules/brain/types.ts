import type {
  BrainDecisionCategory,
  BrainDecisionSeverity,
  BrainDecisionStatus,
  Prisma,
} from "@prisma/client";

export type BrainScanMode = "QUICK_SCAN" | "OPERATIONAL_DAY_SCAN" | "ENTITY_SCAN" | "DEEP_SCAN" | "REPAIR_SCAN";

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
