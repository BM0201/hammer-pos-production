/**
 * correccion-destino-y-pantalla-cobro.md §1.1 — el usuario declara un solo
 * número de "Retener"; el sistema lo descompone contra el fondo de caja
 * configurado por sucursal. Sin esto, el contador de días marca riesgo
 * sobre plata que nunca iba a depositarse, y el monto "acumulado en
 * sucursal" queda inflado por el fondo de forma permanente.
 *
 *   Retener   C$ 215,000
 *             ├─ Fondo de caja        C$  15,000   (configurado)
 *             └─ Esperando depósito   C$ 200,000   ← esto cuenta el contador
 */

export type RetainedDecomposition = {
  cashFundPortion: number;
  awaitingDepositPortion: number;
};

/**
 * Si el fondo configurado no está cargado (`cashFundAmount` null/undefined),
 * TODO lo retenido cuenta como esperando depósito — conservador y correcto
 * (doc §1.1, última línea). El fondo nunca "come" más de lo retenido: si
 * declaran menos que el fondo configurado, el fondo se ajusta hacia abajo,
 * no genera un esperando-depósito negativo.
 */
export function decomposeRetainedAmount(retainAmount: number, cashFundAmount: number | null | undefined): RetainedDecomposition {
  if (retainAmount < 0) throw new Error("INVALID_RETAIN_AMOUNT: no puede ser negativo");
  const fund = cashFundAmount ?? 0;
  const cashFundPortion = Math.min(retainAmount, Math.max(0, fund));
  const awaitingDepositPortion = round2(retainAmount - cashFundPortion);
  return { cashFundPortion: round2(cashFundPortion), awaitingDepositPortion };
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * Alerta de exposición acumulada (§1.3) — nunca bloquea, solo informa. El
 * doc da ejemplos ("C$50,000 dos días es normal, C$400,000 seis días es
 * otra cosa") pero NO fija un número — así que el umbral es un parámetro
 * explícito del caller, nunca un valor adivinado acá. Sin umbral
 * configurado, no hay alerta (informativo únicamente, nunca bloqueante,
 * y sin umbral no hay con qué comparar).
 */
export type ExposureAlertThreshold = { maxAmount: number; maxBusinessDays: number };

export type ExposureAlertResult = {
  awaitingDepositAmount: number;
  businessDaysWithoutDeposit: number;
  exceeds: boolean;
};

export function computeExposureAlert(
  awaitingDepositAmount: number,
  businessDaysWithoutDeposit: number,
  threshold: ExposureAlertThreshold | null,
): ExposureAlertResult {
  const exceeds = threshold !== null
    && awaitingDepositAmount > threshold.maxAmount
    && businessDaysWithoutDeposit > threshold.maxBusinessDays;
  return { awaitingDepositAmount, businessDaysWithoutDeposit, exceeds };
}
