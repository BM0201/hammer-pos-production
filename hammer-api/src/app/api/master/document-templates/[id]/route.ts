/**
 * GET/PATCH/DELETE /api/master/document-templates/[id]
 * CRUD individual para plantillas de documentos.
 */
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, notFound, validationFail, noContent } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { id } = await params;
    const template = await prisma.documentTemplate.findUnique({
      where: { id },
      include: { createdBy: { select: { id: true, fullName: true, username: true } } },
    });

    if (!template) return notFound("Plantilla no encontrada");
    return ok(template);
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  templateContent: z.record(z.unknown()).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    await requireCsrf(request, session);

    const { id } = await params;
    const body = await request.json();
    const parsed = updateTemplateSchema.safeParse(body);
    if (!parsed.success) return validationFail(parsed.error);

    const existing = await prisma.documentTemplate.findUnique({ where: { id } });
    if (!existing) return notFound("Plantilla no encontrada");

    // Si se marca como default, quitar default de otras del mismo tipo
    if (parsed.data.isDefault) {
      await prisma.documentTemplate.updateMany({
        where: { documentType: existing.documentType, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = { ...parsed.data };
    if (parsed.data.templateContent) {
      updateData.templateContent = parsed.data.templateContent;
    }

    const updated = await prisma.documentTemplate.update({
      where: { id },
      data: updateData,
      include: { createdBy: { select: { id: true, fullName: true, username: true } } },
    });

    return ok(updated);
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    await requireCsrf(request, session);

    const { id } = await params;
    const existing = await prisma.documentTemplate.findUnique({ where: { id } });
    if (!existing) return notFound("Plantilla no encontrada");

    await prisma.documentTemplate.delete({ where: { id } });
    return noContent();
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}
