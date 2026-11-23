import { PaymentMethod, Prisma } from "@prisma/client";

type UsdTenderLike = {
  method: PaymentMethod;
  amount: number;
  receivedAmount?: number | null;
  changeAmount?: number | null;
  receivedUsdAmount?: number | null;
};

/**
 * Cobro en dólares: el cliente entrega US$ y el vuelto sale en C$. El servidor
 * recalcula lo recibido en C$ (US$ × tasa vigente, a 2 decimales) en vez de
 * confiar en el cliente; si la pantalla calculó con otra tasa (Master la cambió
 * mientras se cobraba) el vuelto que vio el cajero ya no es el correcto, así que
 * se rechaza. Pura: la tasa se pasa desde afuera.
 */
export function resolveUsdTenders<T extends UsdTenderLike>(
  tenders: readonly T[],
  rate: number | null,
): Array<T & { receivedAmount?: number | null; changeAmount?: number | null; usdRate?: number | null }> {
  return tenders.map((tender) => {
    if (tender.receivedUsdAmount == null) return { ...tender, receivedUsdAmount: null };
    if (tender.method !== PaymentMethod.CASH) throw new Error("USD_TENDER_MUST_BE_CASH");
    if (!rate || rate <= 0) throw new Error("USD_RATE_MISSING");
    const usd = new Prisma.Decimal(tender.receivedUsdAmount);
    if (usd.lte(0)) throw new Error("INVALID_TENDER_AMOUNT");
    const received = usd.mul(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (tender.receivedAmount != null && received.sub(tender.receivedAmount).abs().gt(0.01)) {
      throw new Error("USD_RATE_CHANGED");
    }
    const change = received.sub(tender.amount);
    if (change.lt(0)) throw new Error("INVALID_CASH_RECEIVED_AMOUNT");
    return { ...tender, receivedAmount: received.toNumber(), changeAmount: change.toNumber(), usdRate: rate };
  });
}

/** Cobros en dólares de un período: cuántos, US$ recibidos y C$ que cubrieron. Ya están dentro de "Efectivo". */
export type UsdSales = { count: number; usd: number; nio: number };

type Decimalish = { toString(): string } | number | string;

export function summarizeUsdTenders(tenders: ReadonlyArray<{ amount: Decimalish; receivedUsdAmount?: Decimalish | null }>): UsdSales | null {
  const usdTenders = tenders.filter((t) => t.receivedUsdAmount != null);
  if (usdTenders.length === 0) return null;
  const sum = (f: (t: (typeof usdTenders)[number]) => Decimalish) =>
    usdTenders.reduce((acc, t) => acc.add(new Prisma.Decimal(f(t).toString())), new Prisma.Decimal(0)).toDecimalPlaces(2).toNumber();
  return { count: usdTenders.length, usd: sum((t) => t.receivedUsdAmount!), nio: sum((t) => t.amount) };
}
