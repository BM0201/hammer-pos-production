"use client";

import { useEffect, useState } from "react";
import { Battery, BatteryCharging, BatteryLow, BatteryWarning } from "lucide-react";
import { batteryLabel, type BatteryReading } from "@/lib/battery";

type BatteryManagerLike = EventTarget & BatteryReading;

const EVENTS = ["levelchange", "chargingchange", "chargingtimechange", "dischargingtimechange"];

/**
 * Batería del equipo en la barra de la caja. La app instalada corre a pantalla
 * completa y Android no muestra su barra de estado, así que en la tablet no se
 * veía la carga. Usa la Battery Status API de Chrome; en navegadores sin ella
 * (Safari, Firefox) o en PC (puntero fino) no se muestra nada.
 */
export function DeviceBattery() {
  const [reading, setReading] = useState<BatteryReading | null>(null);

  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> };
    if (!nav.getBattery || !window.matchMedia("(pointer: coarse)").matches) return;

    let battery: BatteryManagerLike | null = null;
    let cancelled = false;
    const read = () => {
      if (!battery) return;
      setReading({
        level: battery.level,
        charging: battery.charging,
        chargingTime: battery.chargingTime,
        dischargingTime: battery.dischargingTime,
      });
    };

    nav.getBattery()
      .then((b) => {
        if (cancelled) return;
        battery = b;
        read();
        EVENTS.forEach((e) => b.addEventListener(e, read));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (battery) EVENTS.forEach((e) => battery!.removeEventListener(e, read));
    };
  }, []);

  if (!reading) return null;

  const { percent, low, detail } = batteryLabel(reading);
  const Icon = reading.charging ? BatteryCharging : low ? BatteryWarning : percent < 50 ? BatteryLow : Battery;
  const color = low
    ? "text-[var(--color-danger-400)]"
    : reading.charging
      ? "text-[var(--color-pay-on-dark)]"
      : "text-[var(--color-sidebar-text-active)]";

  return (
    <div
      className={`flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--color-sidebar-hover)] px-3 py-1 ${color}`}
      role="status"
      aria-label={`Batería ${percent}%${detail ? `, ${detail}` : ""}`}
      data-testid="pos-device-battery"
    >
      <Icon className="h-4 w-4" aria-hidden />
      <span className="text-[13px] font-semibold tabular-nums">{percent}%</span>
      {detail ? <span className="text-[11px] text-[var(--color-sidebar-section)]">{detail}</span> : null}
    </div>
  );
}
