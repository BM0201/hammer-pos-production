import type { EXPENSE_CATEGORIES } from "@/modules/pricing/validators";

/**
 * Los gastos en 4 grupos fáciles de leer (2026-11-26). La mercadería no está
 * acá a propósito: nunca es un gasto, va por "Compra de mercadería o flete"
 * (CashPurchase) y termina en el costo del producto.
 *
 *  - FIXED: lo que se paga todos los meses sí o sí.
 *  - OPERATION: lo que cuesta mover el negocio día a día.
 *  - SUPPLIES: consumibles del local (bolsas, escobas, papelería).
 *  - OUTSIDE: salió plata, pero NO es costo de operar la ferretería (equipo o
 *    mejoras = inversión; personal del dueño = retiro). No resta de la
 *    utilidad operativa ni entra al % de gasto de Precios.
 */
export type ExpenseGroup = "FIXED" | "OPERATION" | "SUPPLIES" | "OUTSIDE";

type Category = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_GROUP_BY_CATEGORY: Record<Category, ExpenseGroup> = {
  PAYROLL: "FIXED",
  RENT: "FIXED",
  UTILITIES: "FIXED",
  TAXES: "FIXED",
  TRANSPORT: "OPERATION",
  CASUAL_LABOR: "OPERATION",
  FOOD: "OPERATION",
  MAINTENANCE: "OPERATION",
  MARKETING: "OPERATION",
  BANK_FEES: "OPERATION",
  OTHER: "OPERATION",
  SUPPLIES: "SUPPLIES",
  EQUIPMENT: "OUTSIDE",
  OWNER_PERSONAL: "OUTSIDE",
};

export const EXPENSE_GROUP_LABELS: Record<ExpenseGroup, string> = {
  FIXED: "Gastos fijos",
  OPERATION: "Gastos de operación",
  SUPPLIES: "Suministros",
  OUTSIDE: "Fuera de la operación",
};

/** Categorías que NO son costo de operar (no restan de la utilidad operativa). */
export const OUTSIDE_OPERATION_CATEGORIES = (Object.keys(EXPENSE_GROUP_BY_CATEGORY) as Category[])
  .filter((c) => EXPENSE_GROUP_BY_CATEGORY[c] === "OUTSIDE");

export function expenseGroupFor(category: string): ExpenseGroup {
  return EXPENSE_GROUP_BY_CATEGORY[category as Category] ?? "OPERATION";
}

export function isOutsideOperation(category: string | null | undefined): boolean {
  return category ? expenseGroupFor(category) === "OUTSIDE" : false;
}
