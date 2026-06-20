export type DemandPoint = {
  date: Date;
  quantity: number;
};

export type DemandForecast = {
  dailyDemandAvg: number;
  trend: "UP" | "DOWN" | "STABLE" | "UNKNOWN";
  coverageDays: number | null;
  stockoutDate: Date | null;
  confidence: number;
};

function sum(points: DemandPoint[]) {
  return points.reduce((total, point) => total + Math.max(0, point.quantity), 0);
}

export function forecastDemand(input: {
  history: DemandPoint[];
  quantityAvailable: number;
  now?: Date;
  windowDays?: number;
}): DemandForecast {
  const now = input.now ?? new Date();
  const windowDays = Math.max(1, input.windowDays ?? 30);
  const history = input.history.filter((point) => point.date <= now);
  if (history.length === 0) {
    return {
      dailyDemandAvg: 0,
      trend: "UNKNOWN",
      coverageDays: null,
      stockoutDate: null,
      confidence: 35,
    };
  }

  const midpoint = new Date(now.getTime() - (windowDays / 2) * 24 * 60 * 60 * 1000);
  const recent = history.filter((point) => point.date >= midpoint);
  const previous = history.filter((point) => point.date < midpoint);
  const recentAvg = sum(recent) / Math.max(1, windowDays / 2);
  const previousAvg = sum(previous) / Math.max(1, windowDays / 2);
  const dailyDemandAvg = sum(history) / windowDays;
  const trendDelta = recentAvg - previousAvg;
  const trend = Math.abs(trendDelta) < Math.max(0.5, dailyDemandAvg * 0.12)
    ? "STABLE"
    : trendDelta > 0
      ? "UP"
      : "DOWN";

  const coverageDays = dailyDemandAvg > 0 ? input.quantityAvailable / dailyDemandAvg : null;
  const stockoutDate = coverageDays !== null
    ? new Date(now.getTime() + Math.max(0, coverageDays) * 24 * 60 * 60 * 1000)
    : null;
  const confidence = Math.min(92, 45 + Math.min(history.length, 30) * 1.4 + (dailyDemandAvg > 0 ? 12 : 0));

  return {
    dailyDemandAvg: Number(dailyDemandAvg.toFixed(2)),
    trend,
    coverageDays: coverageDays === null ? null : Number(coverageDays.toFixed(1)),
    stockoutDate,
    confidence: Number(confidence.toFixed(0)),
  };
}
