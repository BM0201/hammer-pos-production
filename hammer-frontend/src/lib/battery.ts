export type BatteryReading = {
  level: number; // 0–1
  charging: boolean;
  chargingTime: number; // segundos hasta llena; Infinity si no se sabe
  dischargingTime: number; // segundos hasta vacía; Infinity si carga o no se sabe
};

/** Texto para el indicador de batería de la tablet (la PWA fullscreen oculta la barra de Android). */
export function batteryLabel(b: BatteryReading): { percent: number; low: boolean; detail: string } {
  const percent = Math.round(b.level * 100);
  const low = !b.charging && percent <= 20;
  const seconds = b.charging ? b.chargingTime : b.dischargingTime;
  let detail = b.charging ? (percent >= 100 ? "Cargada" : "Cargando") : "";
  if (Number.isFinite(seconds) && seconds > 0) {
    detail = `${b.charging ? "llena en" : "quedan"} ${formatDuration(seconds)}`;
  }
  return { percent, low, detail };
}

function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
