/**
 * Reparto quincenal del neto — módulo PURO (sin DB), fuente única de la regla.
 *
 * El INSS (y el IR y los préstamos mensuales) se cobran UNA vez al mes, no por
 * quincena. Repartir el neto 50/50 escondía media deducción en cada quincena
 * (a 6,000 de media quincena se le restaban 228.19 "invisibles" en vez de los
 * 456.37 completos una sola vez). Regla correcta:
 *
 *   1ª quincena (día 15)      = MEDIO SALARIO completo, sin deducciones.
 *   2ª quincena (fin de mes)  = neto restante = medio salario − TODAS las
 *                               deducciones mensuales (INSS + IR + préstamos).
 *
 * Si las deducciones superan medio salario, la 1ª se recorta para que la suma
 * sea EXACTAMENTE el neto del mes (la 2ª nunca es negativa).
 */

const round2 = (v: number) => Math.round(v * 100) / 100;

export function splitNetPayBiweekly(grossSalary: number, netPay: number): { firstHalf: number; secondHalf: number } {
  const net = Math.max(0, netPay);
  const firstHalf = round2(Math.min(round2(Math.max(0, grossSalary) / 2), net));
  const secondHalf = round2(net - firstHalf);
  return { firstHalf, secondHalf };
}
