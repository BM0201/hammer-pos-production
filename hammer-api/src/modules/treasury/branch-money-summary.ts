import { PaymentMethod } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { paymentValidAsOfPeriodEnd } from "@/modules/finance/service";
import { businessDateFromInstant, businessDateWeekRange, operationalWindow } from "@/modules/operations/business-date";
import { getBranchCashPosition, type BranchCashPosition } from "@/modules/treasury/cash-monitor";
import { getTreasuryAccountBalance } from "@/modules/treasury/service";

/**
 * prompt-modulo-dinero-semana-sucursal.md — "Dinero de la semana" (Admin de
 * Sucursal). Fuente ÚNICA con la Tesorería de Master (§4): ninguna de las
 * dos pantallas arma sus propios totales, ambas llaman a
 * getBranchMoneySummary. Reutiliza getBranchCashPosition (prompt-indicador-
 * efectivo-inteligente.md) para el bloque "tu efectivo ahora" — ese bloque
 * ya está construido y no depende de la semana (§2.2, §8 prueba 8).
 */

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export type MoneyByMethod = { cash: number; transfer: number; card: number; other: number; total: number };

export type BranchMoneySummaryDay = MoneyByMethod & { businessDate: string };

const EMPTY_METHOD_TOTALS: MoneyByMethod = { cash: 0, transfer: 0, card: 0, other: 0, total: 0 };

type TenderRow = { method: PaymentMethod; amount: number; businessDate: Date };

/**
 * Puro — agrupa tenders ya resueltos en 7 días (lunes-domingo), zero-filled
 * (§2.1: "los días sin actividad se muestran vacíos, no se omiten"), y suma
 * los totales de la semana. Separado de la consulta a DB para poder probar
 * el reparto por método y el zero-fill sin base de datos (doc §6 pruebas 1,
 * 2, 4, 5).
 */
export function buildWeeklyMoneyBreakdown(tenders: TenderRow[], weekStart: Date): { days: BranchMoneySummaryDay[]; totals: MoneyByMethod } {
  const days: BranchMoneySummaryDay[] = Array.from({ length: 7 }, (_, i) => ({
    businessDate: ymd(new Date(weekStart.getTime() + i * 24 * 60 * 60 * 1000)),
    ...EMPTY_METHOD_TOTALS,
  }));
  const dayByDate = new Map(days.map((d) => [d.businessDate, d]));

  for (const tender of tenders) {
    const day = dayByDate.get(ymd(tender.businessDate));
    if (!day) continue; // fuera de la semana pedida — no debería pasar si la consulta ya filtró por rango
    const bucket: keyof MoneyByMethod = tender.method === PaymentMethod.CASH ? "cash"
      : tender.method === PaymentMethod.TRANSFER ? "transfer"
      : tender.method === PaymentMethod.CARD ? "card"
      : "other"; // CREDIT y cualquier método futuro — nunca se descarta plata, se agrupa aparte
    day[bucket] = round2(day[bucket] + tender.amount);
    day.total = round2(day.total + tender.amount);
  }

  const totals = days.reduce<MoneyByMethod>((acc, d) => ({
    cash: round2(acc.cash + d.cash),
    transfer: round2(acc.transfer + d.transfer),
    card: round2(acc.card + d.card),
    other: round2(acc.other + d.other),
    total: round2(acc.total + d.total),
  }), { ...EMPTY_METHOD_TOTALS });

  return { days, totals };
}

/** Puro — % vs. semana anterior. null cuando la semana anterior no tuvo nada que comparar (evita división por cero / infinito engañoso). */
export function computeWeekChangePercent(currentTotal: number, previousTotal: number): number | null {
  if (previousTotal <= 0) return null;
  return Math.round(((currentTotal - previousTotal) / previousTotal) * 1000) / 10;
}

async function fetchWeekTenders(branchId: string, weekStart: Date, weekEnd: Date): Promise<TenderRow[]> {
  const periodEnd = operationalWindow(weekEnd).end; // domingo 24:00 Managua — "hasta acá cerró la semana"
  const rows = await prisma.paymentTender.findMany({
    where: {
      operationalDay: { branchId, businessDate: { gte: weekStart, lte: weekEnd } },
      payment: paymentValidAsOfPeriodEnd(periodEnd, branchId),
    },
    select: { method: true, amount: true, operationalDay: { select: { businessDate: true } } },
  });
  return rows
    .filter((r): r is typeof r & { operationalDay: { businessDate: Date } } => r.operationalDay !== null)
    .map((r) => ({ method: r.method, amount: Number(r.amount), businessDate: r.operationalDay.businessDate }));
}

export type InTransitEntry = {
  custodyAccountId: string;
  holderUserId: string | null;
  holderName: string;
  amount: number;
  sinceDate: string | null;
};

/**
 * Desde cuándo hay plata sentada en esta cuenta de custodia sin cortar: la
 * IN más vieja desde el último OUT (o desde siempre, si nunca hubo un OUT) —
 * mismo principio que daysSinceOldestRetained en cash-monitor.ts, aplicado
 * al libro mayor en vez de a las declaraciones.
 */
async function getCustodySinceDate(accountId: string): Promise<Date | null> {
  const lastOut = await prisma.treasuryEntry.findFirst({
    where: { accountId, direction: "OUT" },
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true },
  });
  const earliestInSinceReset = await prisma.treasuryEntry.findFirst({
    where: { accountId, direction: "IN", ...(lastOut ? { occurredAt: { gt: lastOut.occurredAt } } : {}) },
    orderBy: { occurredAt: "asc" },
    select: { occurredAt: true },
  });
  return earliestInSinceReset?.occurredAt ?? null;
}

async function getBranchInTransit(branchId: string): Promise<InTransitEntry[]> {
  const accounts = await prisma.treasuryAccount.findMany({
    where: { type: "CUSTODY", isActive: true, branchId },
    include: { holderUser: { select: { id: true, fullName: true } } },
  });
  if (accounts.length === 0) return [];

  const rows = await Promise.all(accounts.map(async (account) => {
    const balance = await getTreasuryAccountBalance(account.id);
    if (balance.balance <= 0.01) return null;
    const sinceDate = await getCustodySinceDate(account.id);
    return {
      custodyAccountId: account.id,
      holderUserId: account.holderUser?.id ?? null,
      holderName: account.holderUser?.fullName ?? account.accountAlias,
      amount: round2(balance.balance),
      sinceDate: sinceDate ? ymd(sinceDate) : null,
    };
  }));
  return rows.filter((r): r is InTransitEntry => r !== null);
}

export type BranchMoneySummary = {
  branchId: string;
  weekStart: string;
  weekEnd: string;
  days: BranchMoneySummaryDay[];
  totals: MoneyByMethod;
  previousWeekTotal: number;
  totalChangePercent: number | null;
  /**
   * "Tu efectivo ahora" — NO acotado a la semana pedida (§2.2, doc prueba 8):
   * viene de getBranchCashPosition tal cual, sin volver a calcularlo.
   */
  cashNow: BranchCashPosition;
  inTransit: InTransitEntry[];
};

export async function getBranchMoneySummary(input: { branchId: string; weekStart: Date; weekEnd?: Date; now?: Date }): Promise<BranchMoneySummary> {
  const { weekStart, weekEnd } = input.weekEnd
    ? { weekStart: input.weekStart, weekEnd: input.weekEnd }
    : businessDateWeekRange(input.weekStart);
  const previousWeekStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const previousWeekEnd = new Date(weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [thisWeekTenders, previousWeekTenders, cashNow, inTransit] = await Promise.all([
    fetchWeekTenders(input.branchId, weekStart, weekEnd),
    fetchWeekTenders(input.branchId, previousWeekStart, previousWeekEnd),
    getBranchCashPosition(input.branchId, input.now),
    getBranchInTransit(input.branchId),
  ]);

  const { days, totals } = buildWeeklyMoneyBreakdown(thisWeekTenders, weekStart);
  const { totals: previousTotals } = buildWeeklyMoneyBreakdown(previousWeekTenders, previousWeekStart);

  return {
    branchId: input.branchId,
    weekStart: ymd(weekStart),
    weekEnd: ymd(weekEnd),
    days,
    totals,
    previousWeekTotal: previousTotals.total,
    totalChangePercent: computeWeekChangePercent(totals.total, previousTotals.total),
    cashNow,
    inTransit,
  };
}

/** Azúcar para el caso de uso más común: la semana que contiene `now` (o una fecha cualquiera). */
export function weekStartFromInstant(instant: Date = new Date()): Date {
  return businessDateWeekRange(businessDateFromInstant(instant)).weekStart;
}
