import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, created, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { createExchangeRateSchema } from "@/modules/treasury/validators";
import { createExchangeRate, listExchangeRates } from "@/modules/treasury/service";
import type { CurrencyCode } from "@prisma/client";

/** Histórico de tasas registradas, más recientes primero. */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const url = new URL(request.url);
    const fromCurrency = url.searchParams.get("fromCurrency") as CurrencyCode | null;
    const toCurrency = url.searchParams.get("toCurrency") as CurrencyCode | null;

    const rates = await listExchangeRates({ fromCurrency: fromCurrency ?? undefined, toCurrency: toCurrency ?? undefined });
    return ok(rates);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

/** Registra una tasa nueva — nunca convierte saldos, solo queda disponible para mostrarse con su fecha y fuente. */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    await requireCsrf(request, session);

    const parsed = createExchangeRateSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());

    const rate = await createExchangeRate({ ...parsed.data, createdByUserId: session.userId });
    return created(rate);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
