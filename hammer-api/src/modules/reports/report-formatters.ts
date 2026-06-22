const NIO = new Intl.NumberFormat("es-NI", {
  style: "currency",
  currency: "NIO",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const NUMBER = new Intl.NumberFormat("es-NI", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Activo",
  APPROVED: "Aprobado",
  CANCELLED: "Cancelado",
  COMPLETED: "Completado",
  DISPATCH_PENDING: "Pendiente despacho",
  DISPATCHED: "Despachado",
  DRAFT: "Borrador",
  IN_PROGRESS: "En proceso",
  IN_TRANSIT: "En transito",
  OPEN: "Abierto",
  PAID: "Pagado",
  PARTIALLY_RECEIVED: "Parcial recibido",
  PENDING: "Pendiente",
  PENDING_PAYMENT: "Pendiente pago",
  POSTED: "Cobrado",
  RECONCILED: "Reconciliado",
  RECONCILING: "Reconciliando",
  RECEIVED: "Recibido",
  REFUNDED: "Reembolsado",
  REJECTED: "Rechazado",
  REQUESTED: "Solicitado",
  RETURN_APPROVED: "Devolucion aprobada",
  RETURN_REJECTED: "Devolucion rechazada",
  RETURN_REQUESTED: "Devolucion solicitada",
  RETURNED: "Devuelto",
  VOIDED: "Anulado",
};

export function formatCurrency(value: unknown): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? NIO.format(amount).replace("NIO", "C$") : "C$ 0.00";
}

export function formatNumber(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) ? NUMBER.format(number) : "0";
}

export function formatPercent(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) ? `${NUMBER.format(number)}%` : "0%";
}

export function formatDateLocal(value: unknown): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return safeText(value);

  const parts = new Intl.DateTimeFormat("es-NI", {
    timeZone: "America/Managua",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const day = byType.get("day") ?? "";
  const month = byType.get("month") ?? "";
  const year = byType.get("year") ?? "";
  const hour = byType.get("hour") ?? "";
  const minute = byType.get("minute") ?? "";
  const dayPeriod = (byType.get("dayPeriod") ?? "").toLowerCase();
  return `${day}/${month}/${year} ${hour}:${minute} ${dayPeriod}`.trim();
}

export function formatStatus(value: unknown): string {
  const key = safeText(value).trim();
  return STATUS_LABELS[key] ?? key.replaceAll("_", " ").toLowerCase().replace(/^\w/, (char) => char.toUpperCase());
}

export function safeText(value: unknown, fallback = "N/D"): string {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value).replace(/\s+/g, " ").trim();
}

export function truncateMiddle(value: unknown, max = 24): string {
  const text = safeText(value, "");
  if (text.length <= max) return text;
  if (max <= 6) return text.slice(0, max);
  const side = Math.floor((max - 3) / 2);
  return `${text.slice(0, side)}...${text.slice(text.length - side)}`;
}

export function getNestedValue(row: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, row);
}

export function toNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
