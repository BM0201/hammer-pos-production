import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { listDocumentTemplates, createDocumentTemplate } from "@/modules/print/service";
import { createDocumentTemplateSchema } from "@/modules/print/validation";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, validationFail } from "@/lib/api/response";
import type { DocumentType } from "@prisma/client";

/**
 * GET /api/master/document-templates
 * Lista plantillas de documentos.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const url = new URL(request.url);
    const documentType = url.searchParams.get("documentType") as DocumentType | null;
    const isActive = url.searchParams.get("isActive");

    const templates = await listDocumentTemplates({
      documentType: documentType ?? undefined,
      isActive: isActive === null ? undefined : isActive === "true",
    });
    return ok(templates);
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}

/**
 * POST /api/master/document-templates
 * Crear nueva plantilla de documento.
 */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    await requireCsrf(request, session);

    const body = await request.json();
    const parsed = createDocumentTemplateSchema.safeParse(body);
    if (!parsed.success) return validationFail(parsed.error);

    const template = await createDocumentTemplate({
      ...parsed.data,
      createdByUserId: session.userId,
    });
    return created(template);
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}
