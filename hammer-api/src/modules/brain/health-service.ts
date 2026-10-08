import { prisma } from "@/lib/prisma";
import { nextScheduledScanAt } from "@/modules/brain/cron-schedule";

/**
 * prompt-brain-centro-decisiones.md Fase 2.3 — "último BrainScanRun y
 * estado de cada detector; próximo escaneo programado; si hay un escaneo
 * corriendo". Antes "último escaneo" se deducía de las decisiones mismas
 * (sin ningún registro real) — ahora BrainScanRun (Fase 1.1) es la fuente.
 */
export async function getBrainHealth() {
  const [lastRun, running] = await Promise.all([
    prisma.brainScanRun.findFirst({ where: { status: { not: "RUNNING" } }, orderBy: { startedAt: "desc" } }),
    prisma.brainScanRun.findUnique({ where: { runningLock: "brain" } }),
  ]);

  return {
    lastRun: lastRun
      ? {
          id: lastRun.id,
          mode: lastRun.mode,
          trigger: lastRun.trigger,
          startedAt: lastRun.startedAt,
          finishedAt: lastRun.finishedAt,
          status: lastRun.status,
          detectors: lastRun.detectorsJson as unknown[] | null,
          created: lastRun.created,
          updated: lastRun.updated,
          reopened: lastRun.reopened,
          autoResolved: lastRun.autoResolved,
          skipped: lastRun.skipped,
        }
      : null,
    isRunning: running != null,
    nextScheduledAt: nextScheduledScanAt(new Date()),
  };
}
