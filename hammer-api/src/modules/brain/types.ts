import type {
  BrainDecisionCategory,
  BrainDecisionSeverity,
  BrainDecisionStatus,
  Prisma,
} from "@prisma/client";

export type BrainDetectorContext = {
  branchId?: string;
  days: number;
  since: Date;
  now: Date;
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
  cursor?: string;
  limit?: number;
  sort?: "priority" | "date" | "impact";
};
