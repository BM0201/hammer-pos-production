import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { getDepositSummary } from "@/modules/treasury/cash-monitor";

/** Primer día del mes en curso, 00:00 America/Managua, en UTC. */
function firstOfMonthUtc(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Managua", year: "numeric", month: "2-digit" })
    .format(now)
    .split("-")
    .map(Number);
  const [year, month] = parts;
  return new Date(Date.UTC(year, month - 1, 1, 6, 0, 0, 0)); // Managua 00:00 → 06:00 UTC
}

/**
 * §Tesorería operativa — la barra de totales consolidados: cuánto se
 * depositó, en cuántas cuentas, en el rango. Default: mes en curso. Nunca
 * recalcula posiciones de efectivo acá — eso es cash-positions, caro por
 * sucursal; este endpoint solo agrega BankDeposit ya escrito.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const now = new Date();
    const url = new URL(request.url);
    const fromRaw = url.searchParams.get("from");
    const toRaw = url.searchParams.get("to");
    const from = fromRaw ? new Date(fromRaw) : firstOfMonthUtc(now);
    const to = toRaw ? new Date(toRaw) : now;

    return ok(await getDepositSummary({ from, to }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
