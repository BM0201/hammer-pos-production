import type { OperationalDayStatus } from "@prisma/client";

export type ChecklistItem = {
  key: string;
  label: string;
  status: "OK" | "WARNING" | "BLOCKING";
  count?: number;
  message?: string;
};

export type OperationalDayClosePreview = {
  canClose: boolean;
  blockers: ChecklistItem[];
  warnings: ChecklistItem[];
  ok: ChecklistItem[];
  summary: Record<string, unknown>;
  status: OperationalDayStatus;
};
