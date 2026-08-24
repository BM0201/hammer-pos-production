import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";

const preferencesSchema = z.object({
  themePreference: z.enum(["light", "dark"]).nullable(),
});

/**
 * Preferencias cosméticas del propio usuario — sin assertMaster, cualquiera
 * puede cambiar SU PROPIO tema. Persiste lo que hoy solo vivía en
 * localStorage, para que un dispositivo nuevo o una caché limpiada arranquen
 * con la preferencia elegida en vez de la del sistema operativo (FIX 5,
 * prompt-destello-modo-claro.md).
 */
export async function PATCH(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsed = preferencesSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());

    await prisma.user.update({
      where: { id: session.userId },
      data: { themePreference: parsed.data.themePreference },
    });

    return ok({ themePreference: parsed.data.themePreference });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
