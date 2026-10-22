import { EXPENSE_CATEGORIES } from "@/modules/pricing/validators";

/**
 * prompt-caja-gastos-pos-cobro.md Commit 1 — "etiquetas en español en un
 * solo lugar... Prohibido mostrar el código (OTHER, UTILITIES) en
 * cualquier pantalla." Antes había al menos 4 copias sueltas de este mismo
 * mapa en el frontend (cash-movements-panel, retained-cash-expense-sheet,
 * retained-cash-expense-list, expense-manager.types); esta es la fuente
 * canónica del lado API (mensajes de validación, auditoría). El frontend
 * tiene su propia copia en expense-manager.types.ts (CATEGORY_LABELS) —
 * dos apps separadas, sin paquete compartido — pero AMBAS pasan por el
 * mismo test de exhaustividad contra EXPENSE_CATEGORIES.
 */
export const EXPENSE_CATEGORY_LABELS: Record<(typeof EXPENSE_CATEGORIES)[number], string> = {
  PAYROLL: "Personal / Nómina",
  UTILITIES: "Servicios (agua, luz, internet)",
  RENT: "Renta / Alquiler",
  FOOD: "Alimentación",
  MAINTENANCE: "Mantenimiento",
  TRANSPORT: "Transporte",
  MARKETING: "Publicidad / Marketing",
  TAXES: "Impuestos y tasas",
  SUPPLIES: "Suministros",
  CASUAL_LABOR: "Carga y descarga",
  BANK_FEES: "Comisiones bancarias",
  OTHER: "Otro",
};

export function expenseCategoryLabel(category: string): string {
  return EXPENSE_CATEGORY_LABELS[category as (typeof EXPENSE_CATEGORIES)[number]] ?? category;
}
