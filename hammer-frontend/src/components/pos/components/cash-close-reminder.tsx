"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fmtTimeShort } from "@/lib/format";

const SNOOZE_MINUTES = 5;

export type CloseReminderPhase = "none" | "soon" | "overdue";

/** "soon" desde que empieza el conteo (la API lo pone 20 min antes del cierre), "overdue" pasada la hora. */
export function closeReminderPhase(now: number, countFrom: number, closeAt: number): CloseReminderPhase {
  if (now >= closeAt) return "overdue";
  return now >= countFrom ? "soon" : "none";
}

/**
 * Aviso antes del cierre automático de la caja: primero contar la gaveta,
 * luego cerrar con lo contado y decidir el destino del dinero. Sin él, el
 * cron cerraba la caja sola y el destino del efectivo quedaba sin declarar.
 * Solo para quien opera una caja abierta; se puede posponer unos minutos.
 */
export function CashCloseReminder({ closeAt, countFrom, cashSessionId }: { closeAt: string | null; countFrom: string | null; cashSessionId: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  const snoozeKey = `hammer-close-reminder:${cashSessionId ?? ""}`;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    try { setSnoozedUntil(Number(sessionStorage.getItem(snoozeKey)) || 0); } catch { setSnoozedUntil(0); }
  }, [snoozeKey]);

  const closeAtMs = closeAt ? Date.parse(closeAt) : NaN;
  const countFromMs = countFrom ? Date.parse(countFrom) : NaN;
  const phase = Number.isFinite(closeAtMs) && Number.isFinite(countFromMs) ? closeReminderPhase(now, countFromMs, closeAtMs) : "none";
  // En la pantalla Caja el conteo ya está a la mano; allí lo avisa el propio panel.
  if (phase === "none" || !cashSessionId || now < snoozedUntil || pathname === "/app/branch/cash") return null;

  function snooze() {
    const until = Date.now() + SNOOZE_MINUTES * 60_000;
    try { sessionStorage.setItem(snoozeKey, String(until)); } catch { /* sin almacenamiento: solo esta pantalla */ }
    setSnoozedUntil(until);
  }

  const time = fmtTimeShort(closeAt!);
  const minutesLeft = Math.max(1, Math.ceil((closeAtMs - now) / 60_000));

  return (
    <Dialog
      size="sm"
      onClose={snooze}
      title={phase === "soon" ? "El día está por terminar" : "Ya es hora de cerrar la caja"}
      subtitle={phase === "soon" ? `La caja se cierra sola a las ${time} (faltan ${minutesLeft} min).` : `Pasó la hora de cierre (${time}).`}
      footer={
        <>
          <Button variant="secondary" onClick={snooze}>Recordarme en {SNOOZE_MINUTES} min</Button>
          <Button data-autofocus onClick={() => router.push("/app/branch/cash?cerrar=1")}>Contar ahora</Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-[var(--color-text-secondary)]" data-testid="cash-close-reminder">
        <p>
          Hay que decidir a dónde va el dinero de la gaveta, <strong className="text-[var(--color-text)]">pero antes hay que contar cuánto hay</strong>.
          {phase === "overdue" ? " Si no la cierras tú, el sistema la cierra solo y queda pendiente de revisión, sin destino declarado." : ""}
        </p>
        <ol className="space-y-2">
          {[
            "Cuenta la gaveta billete por billete: cuántos de C$500, de C$100…",
            "Cierra la caja con ese total. Lo que debía haber se ve después.",
            "Decide el destino: entregarlo, depositarlo o dejarlo en caja.",
          ].map((step, i) => (
            <li key={step} className="flex items-start gap-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-alt)] text-xs font-bold text-[var(--color-text)]">{i + 1}</span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </Dialog>
  );
}
