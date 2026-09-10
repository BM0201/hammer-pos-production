/**
 * ════════════════════════════════════════════════════════════════
 * FRONTERA DE SALIDA — redondeo de Prisma.Decimal antes de JSON
 * ════════════════════════════════════════════════════════════════
 *
 * Prisma.Decimal tiene su propio toJSON() (decimal.js): cuando NextResponse.json()
 * lo serializa, escribe el string de precisión COMPLETA que trae de la base de
 * datos o de un cálculo intermedio (ej. "100.000000000000000000", o un residuo
 * de una división no exacta). Eso nunca debería llegar tal cual a un cliente:
 * ni el POS ni ningún reporte necesitan más que 2 decimales para dinero o 4
 * para cantidades/factores de conversión.
 *
 * Este módulo NO toca cómo se calcula o almacena nada — camina el árbol de la
 * respuesta ya construida (después de todo el negocio, justo antes de
 * NextResponse.json) y sustituye cada Prisma.Decimal por una copia nueva
 * (.toDecimalPlaces no muta) redondeada a 2 o 4 decimales según el NOMBRE del
 * campo que lo contiene. Ver ok() en response.ts — es el único punto de
 * inyección; okCached/created lo heredan porque delegan en ok().
 *
 * Clasificación dinero (2dp) vs cantidad/factor/porcentaje (4dp):
 * un Decimal suelto no dice qué es — se infiere del nombre de su campo. Se
 * revisó campo por campo contra el vocabulario completo de schema.prisma
 * (~220 nombres Decimal) más las claves en español que usan algunos DTOs de
 * reportes (kpi-summary, etc.).
 */
import { Prisma } from "@prisma/client";

/** Casos puntuales: demasiado cortos/genéricos para un substring seguro, o
 * genuinamente polimórficos (mismo campo, significado distinto según otro
 * campo del mismo registro). Se resuelven por IGUALDAD exacta de la clave,
 * antes de tocar los patrones de substring de abajo. */
const EXACT_MONEY_KEYS = new Set(["ir"]); // Impuesto sobre la Renta — monto en C$, "ir" a secas no es seguro como substring (matchea "director", "circuito", etc.)
const EXACT_NON_MONEY_KEYS = new Set([
  "value", // Discount.value: "Percentage (e.g., 10 = 10%) or fixed amount in C$" según el propio comment de schema.prisma — polimórfico. Redondear de más (4dp) nunca pierde el 2dp de un monto real; redondear de menos (2dp) SÍ podría truncar un porcentaje con más precisión. Más seguro por defecto.
  "rate", // ídem "taxRate"/"returnRate": ya cubierto por el patrón EXCLUDE de abajo, listado aquí también por claridad cuando aparece solo.
]);

/** Substrings que indican cantidad/factor/porcentaje/score — se revisan ANTES
 * que los de dinero porque nombres como "maxDiscountPercent" o
 * "calculatedCostFeet" contienen una palabra de dinero (discount/cost) pero
 * son claramente NO monetarios (un porcentaje, una medida en pies).
 * "(?<!pro)rate" evita el falso positivo de "proratedSalary" — "prorated"
 * contiene "rate" como substring accidental (p-r-o-RATE-d), pero es un
 * salario (dinero), no una tasa/porcentaje. */
const NON_MONEY_PATTERN = /percent|pct|factor|(?<!pro)rate|score|index|days|feet|length|width|thickness/i;

/** Substrings de dinero — raíces de campos Prisma en inglés + claves en
 * español que usan algunos DTOs de reportes (kpi-summary, etc. construyen su
 * respuesta con claves como "ventas30dias"/"pagosHoy", no con los nombres
 * crudos de Prisma). */
const MONEY_PATTERN =
  /amount|cost|price|precio|costo|balance|saldo|salary|salario|sueldo|pay|payroll|nomina|deduction|discount|descuento|tax|impuesto|subtotal|total|venta|cobro|pago|refund|devolucion|deposit|freight|flete|installment|principal|charge|fee|expense|gasto|credit|debit|provision|inatec|inss|aguinaldo|indemnizacion|vacacion|retain|fund|fondo|value|profit|margin/i;

/**
 * true = campo monetario (redondear a 2 decimales), false = cantidad, factor
 * de conversión, porcentaje u otro Decimal no monetario (redondear a 4).
 * Por defecto, cuando nada matchea, se clasifica NO-dinero (4dp): sobre-redondear
 * un monto real a 4dp es inofensivo (money() en el frontend igual lo muestra a
 * 2dp), pero sub-redondear una cantidad/factor real a 2dp sí puede perder
 * precisión que hace falta.
 */
export function isMoneyField(key: string): boolean {
  const k = key.toLowerCase();
  if (EXACT_MONEY_KEYS.has(k)) return true;
  if (EXACT_NON_MONEY_KEYS.has(k)) return false;
  if (NON_MONEY_PATTERN.test(k)) return false;
  return MONEY_PATTERN.test(k);
}

const MONEY_DP = 2;
const QTY_DP = 4;

function roundDecimal(value: Prisma.Decimal, key: string): Prisma.Decimal {
  return value.toDecimalPlaces(isMoneyField(key) ? MONEY_DP : QTY_DP);
}

/**
 * Camina data recursivamente y devuelve una copia con todo Prisma.Decimal
 * redondeado (2dp dinero / 4dp cantidad-factor) según el nombre de su campo
 * contenedor. No muta el valor recibido; no toca Date, null, string, number,
 * boolean ni instancias de clases que no sean objeto plano/array/Decimal
 * (se dejan tal cual — más seguro que asumir cómo recorrerlas).
 *
 * `key` es el nombre del campo que CONTIENE a `value` (para clasificar un
 * Decimal encontrado directamente); al recorrer un array se conserva la key
 * del array (ej. amounts: [Decimal, Decimal] clasifica por "amounts").
 */
export function roundDecimalsForResponse<T>(data: T, key = ""): T {
  if (data instanceof Prisma.Decimal) {
    return roundDecimal(data, key) as unknown as T;
  }
  if (Array.isArray(data)) {
    return data.map((item) => roundDecimalsForResponse(item, key)) as unknown as T;
  }
  if (data !== null && typeof data === "object") {
    // Fechas y cualquier otra instancia de clase que no sea un objeto plano
    // (Buffer, Map, etc.) se dejan intactas — no sabemos cómo recorrerlas de
    // forma segura y no contienen Decimal en este codebase.
    const proto = Object.getPrototypeOf(data);
    if (proto !== Object.prototype && proto !== null) {
      return data;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      out[k] = roundDecimalsForResponse(v, k);
    }
    return out as T;
  }
  return data;
}
