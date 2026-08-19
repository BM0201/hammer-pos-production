export type ChecklistItem = {
  key: string;
  label: string;
  status: "OK" | "ATTENTION";
  count?: number;
  message?: string;
};

/** Checklist informativo — Día Operativo 360. Ningún ítem bloquea; `attention`
 * solo exige nota al confirmar (ver confirmOperationalDay en day-lifecycle.ts). */
export type OperationalDayChecklist = {
  items: ChecklistItem[];
  attention: ChecklistItem[];
  ok: ChecklistItem[];
  summary: Record<string, unknown>;
};
