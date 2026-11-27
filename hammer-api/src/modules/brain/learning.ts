import type { BrainDecisionSeverity, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Lo que Brain aprende de vos, sin IA externa: por cada tipo de sugerencia
 * (y por sucursal cuando hay suficientes datos) cuenta, en los últimos 3
 * meses, cuántas veces actuaste ("Ya lo resolví", aplicar precio, ejecutar)
 * y cuántas dijiste "No aplica" o "Mantener precio". Si además Brain midió el
 * resultado a los 7 días (outcomes.ts) y salió mal, cuenta como "no sirvió".
 * Y lo que nadie toca: una sugerencia que lleva más de 30 días abierta (Brain
 * la sigue viendo y nadie hizo nada) cuenta como "no te sirvió", así Brain
 * aprende aunque nadie conteste.
 *
 * Con eso solo REORDENA: lo que casi nunca te sirve baja, lo que casi
 * siempre te sirve sube. Nunca esconde nada ni cambia la gravedad, y una
 * CRÍTICA nunca baja.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/** tray-service.ts escribe la nota con este inicio al "Mantener precio": es un "no aplica" con otro nombre. */
export const KEPT_PRICE_NOTE_PREFIX = "Precio mantenido:";

export const LEARNING_WINDOW_DAYS = 90;
/** Menos respuestas que esto y Brain no se anima a sacar conclusiones. */
export const MIN_ANSWERS = 5;
/** Abierta más de esto sin que nadie la toque = ignorada. */
export const IGNORED_AFTER_DAYS = 30;

export type TrackRecord = { acted: number; notApplicable: number; measuredGood: number; measuredBad: number; ignored: number };

export type LearningLevel = "LEARNING" | "USEFUL" | "NORMAL" | "NOT_USEFUL" | "IGNORED";

export type LearningVerdict = TrackRecord & {
  level: LearningLevel;
  /** Multiplica la prioridad de las sugerencias nuevas de este tipo. */
  priorityFactor: number;
  /** En palabras simples, para la Bandeja. */
  text: string;
};

export type LearningBook = { byType: Map<string, TrackRecord>; byTypeBranch: Map<string, TrackRecord> };

export const EMPTY_LEARNING: LearningBook = { byType: new Map(), byTypeBranch: new Map() };

export function learningKey(proposedActionType: string | null, category: string): string {
  return proposedActionType ?? `CAT:${category}`;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function verdictFor(record: TrackRecord): LearningVerdict {
  const answers = record.acted + record.notApplicable;
  const measured = record.measuredGood + record.measuredBad;
  const measuredText = measured > 0
    ? ` Brain revisó ${plural(measured, "resultado", "resultados")} a los 7 días: ${plural(record.measuredGood, "salió bien", "salieron bien")}${record.measuredBad > 0 ? ` y ${record.measuredBad} no` : ""}.`
    : "";

  const signals = answers + record.ignored;
  const ignoredText = record.ignored > 0
    ? ` ${plural(record.ignored, "lleva", "llevan")} más de ${IGNORED_AFTER_DAYS} días abierta${record.ignored === 1 ? "" : "s"} sin que nadie la${record.ignored === 1 ? "" : "s"} toque.`
    : "";

  if (signals < MIN_ANSWERS) {
    return { ...record, level: "LEARNING", priorityFactor: 1, text: `Brain todavía está aprendiendo de este tipo: lleva ${answers} de ${MIN_ANSWERS} respuestas tuyas.${measuredText}` };
  }

  // Lo que hiciste pero salió mal (medido) no cuenta como "te sirvió".
  const useful = Math.max(0, record.acted - record.measuredBad);
  const rate = useful / signals;
  const base = (answers > 0
    ? `En los últimos 3 meses, de ${answers} actuaste en ${record.acted} y marcaste ${record.notApplicable} como "No aplica".`
    : "En los últimos 3 meses no la respondiste ninguna vez.") + ignoredText;

  if (rate >= 0.7) {
    return { ...record, level: "USEFUL", priorityFactor: 1.15, text: `Te sirve casi siempre. ${base} Brain la pone más arriba.${measuredText}` };
  }
  if (rate <= 0.3 && answers === 0) {
    // Nunca la contestaste: no es que no sirva, es que nadie la atiende.
    return { ...record, level: "IGNORED", priorityFactor: 0.7, text: `Nadie la atiende. ${base} Brain la pone más abajo, pero no la esconde.${measuredText}` };
  }
  if (rate <= 0.3) {
    return { ...record, level: "NOT_USEFUL", priorityFactor: 0.7, text: `Casi nunca te sirve. ${base} Brain la pone más abajo, pero no la esconde.${measuredText}` };
  }
  return { ...record, level: "NORMAL", priorityFactor: 1, text: `${base}${measuredText}` };
}

/** La sucursal manda si ya tiene suficientes respuestas propias; si no, lo de todas las sucursales. */
export function verdictForScope(book: LearningBook, key: string, branchId?: string | null): LearningVerdict {
  const empty: TrackRecord = { acted: 0, notApplicable: 0, measuredGood: 0, measuredBad: 0, ignored: 0 };
  if (branchId) {
    const own = book.byTypeBranch.get(`${key}|${branchId}`);
    if (own && own.acted + own.notApplicable + own.ignored >= MIN_ANSWERS) return verdictFor(own);
  }
  return verdictFor(book.byType.get(key) ?? empty);
}

/** Prioridad ajustada por lo aprendido. Una CRÍTICA nunca baja. */
export function adjustPriority(priorityScore: number, severity: BrainDecisionSeverity, factor: number): number {
  const effective = severity === "CRITICAL" ? Math.max(1, factor) : factor;
  return Math.max(0, Math.min(100, Math.round(priorityScore * effective)));
}

type Row = { proposedActionType: string | null; category: string; branchId: string | null };

function bump(book: LearningBook, row: Row, field: keyof TrackRecord, by: number) {
  const key = learningKey(row.proposedActionType, row.category);
  const targets: Array<[Map<string, TrackRecord>, string]> = [[book.byType, key]];
  if (row.branchId) targets.push([book.byTypeBranch, `${key}|${row.branchId}`]);
  for (const [map, k] of targets) {
    const rec = map.get(k) ?? { acted: 0, notApplicable: 0, measuredGood: 0, measuredBad: 0, ignored: 0 };
    rec[field] += by;
    map.set(k, rec);
  }
}

export async function loadLearning(db: Db = prisma, now = new Date()): Promise<LearningBook> {
  const since = new Date(now.getTime() - LEARNING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const ignoredBefore = new Date(now.getTime() - IGNORED_AFTER_DAYS * 24 * 60 * 60 * 1000);
  const [closed, kept, outcomes, ignored] = await Promise.all([
    db.brainDecision.groupBy({
      by: ["proposedActionType", "category", "branchId", "status", "resolutionSource"],
      where: { status: { in: ["EXECUTED", "RESOLVED", "DISMISSED"] }, resolvedAt: { gte: since } },
      _count: { _all: true },
    }),
    db.brainDecision.groupBy({
      by: ["proposedActionType", "category", "branchId"],
      where: { status: "RESOLVED", resolutionNote: { startsWith: KEPT_PRICE_NOTE_PREFIX }, resolvedAt: { gte: since } },
      _count: { _all: true },
    }),
    db.brainDecisionOutcome.findMany({
      where: { successScore: { not: null }, decision: { resolvedAt: { gte: since } } },
      select: { successScore: true, decision: { select: { proposedActionType: true, category: true, branchId: true } } },
    }),
    db.brainDecision.groupBy({
      by: ["proposedActionType", "category", "branchId"],
      where: { status: "OPEN", firstDetectedAt: { lte: ignoredBefore } },
      _count: { _all: true },
    }),
  ]);

  const book: LearningBook = { byType: new Map(), byTypeBranch: new Map() };
  for (const row of closed) {
    const count = row._count._all;
    if (row.status === "DISMISSED") bump(book, row, "notApplicable", count);
    // RESOLVED por AUTO = se arregló solo / ya no se detecta: no dice nada de vos.
    else if (row.status === "EXECUTED" || row.resolutionSource === "USER" || row.resolutionSource === "EXECUTION") bump(book, row, "acted", count);
  }
  for (const row of kept) {
    bump(book, row, "acted", -row._count._all);
    bump(book, row, "notApplicable", row._count._all);
  }
  for (const row of ignored) bump(book, row, "ignored", row._count._all);
  for (const outcome of outcomes) {
    bump(book, outcome.decision, Number(outcome.successScore) >= 50 ? "measuredGood" : "measuredBad", 1);
  }
  return book;
}

/** Brain nunca deja de escanear o de mostrar la Bandeja porque falló el aprendizaje: sin datos, todo queda igual que antes. */
export async function loadLearningSafe(db: Db = prisma): Promise<LearningBook> {
  try {
    return await loadLearning(db);
  } catch (error) {
    console.warn("[brain-learning] no se pudo cargar lo aprendido:", error instanceof Error ? error.message : error);
    return EMPTY_LEARNING;
  }
}
