import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { requireBranchCapability } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { fail } from "@/lib/api/response";

/**
 * prompt-caja-gastos-pos-cobro.md Commit 2 — "📷 Sí, tomar foto" del recibo.
 * Requiere BLOB_READ_WRITE_TOKEN en el entorno (Vercel Blob) — sin eso,
 * handleUpload rechaza antes de llegar acá. El cliente sube el archivo
 * DIRECTO a Vercel Blob (no pasa por el body de esta función serverless);
 * esta ruta solo emite el token (onBeforeGenerateToken, valida sesión +
 * permiso) y confirma la subida (onUploadCompleted, best-effort — Vercel
 * reintenta si no respondemos 200, no hay nada que persistir acá: la URL
 * final la recibe el cliente directo de `upload()` y la manda ella misma
 * al crear el gasto/compra).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const session = await getCurrentSession();
        assertAuthenticated(session);
        const branchId = typeof clientPayload === "string" ? JSON.parse(clientPayload)?.branchId : undefined;
        if (!branchId) throw new Error("VALIDATION_ERROR: falta branchId.");
        requireBranchCapability(session, branchId, CAPABILITIES.CASH_MOVEMENT_CREATE);

        return {
          allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "image/heic"],
          addRandomSuffix: true,
          maximumSizeInBytes: 8 * 1024 * 1024,
          tokenPayload: JSON.stringify({ branchId }),
        };
      },
      onUploadCompleted: async () => {
        // Nada que persistir acá — ver comentario de arriba.
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return fail("VALIDATION_ERROR", error instanceof Error ? error.message : "No se pudo subir el recibo.", 400);
  }
}
