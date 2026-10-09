import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * prompt-gastos-semana-quincena.md Fase 3 — administración de ExpenseConcept
 * (el desglose dentro de cada categoría: "Agua", "Internet", "Combustible
 * flota propia"...). El modelo y los 11 conceptos semilla ya existen desde
 * la Fase 1 (migración); esto es el CRUD que faltaba para administrarlos
 * desde la pantalla de Gastos por período y para el selector de Fase 4.
 */
export type ExpenseConceptRow = {
  id: string;
  category: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
};

export async function listExpenseConcepts(
  input: { category?: string; includeInactive?: boolean } = {},
  db: DbClient = prisma,
): Promise<ExpenseConceptRow[]> {
  const rows = await db.expenseConcept.findMany({
    where: {
      ...(input.category ? { category: input.category as any } : {}),
      ...(input.includeInactive ? {} : { isActive: true }),
    },
    select: { id: true, category: true, name: true, isActive: true, sortOrder: true },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
  return rows;
}

export async function createExpenseConcept(
  input: { category: string; name: string; sortOrder?: number },
  db: DbClient = prisma,
): Promise<ExpenseConceptRow> {
  const name = input.name.trim();
  if (!name) throw new Error("VALIDATION_ERROR: el nombre del concepto es obligatorio.");

  const maxSortOrder = input.sortOrder ?? (await db.expenseConcept.aggregate({
    where: { category: input.category as any },
    _max: { sortOrder: true },
  }))._max.sortOrder ?? -1;

  return db.expenseConcept.create({
    data: {
      category: input.category as any,
      name,
      sortOrder: input.sortOrder ?? maxSortOrder + 1,
    },
    select: { id: true, category: true, name: true, isActive: true, sortOrder: true },
  });
}

export async function updateExpenseConcept(
  id: string,
  input: { name?: string; isActive?: boolean; sortOrder?: number },
  db: DbClient = prisma,
): Promise<ExpenseConceptRow> {
  const existing = await db.expenseConcept.findUnique({ where: { id } });
  if (!existing) throw new Error("NOT_FOUND: concepto no encontrado.");

  const name = input.name !== undefined ? input.name.trim() : undefined;
  if (name !== undefined && !name) throw new Error("VALIDATION_ERROR: el nombre del concepto es obligatorio.");

  return db.expenseConcept.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    },
    select: { id: true, category: true, name: true, isActive: true, sortOrder: true },
  });
}
