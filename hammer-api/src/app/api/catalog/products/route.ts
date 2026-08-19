import type { SessionPayload } from "@/types/auth";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { hasBranchAccess } from "@/modules/rbac/guards";
import { canInBranch, canInAnyAssignedBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { createProduct, listProducts, getTopSellingProducts, checkSkuAvailable, previewAutoSku } from "@/modules/catalog/service";
import { createProductSchema } from "@/modules/catalog/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, okCached, created, fail } from "@/lib/api/response";

// Auditoría 2026-08-03: globalCost/averageCost/lastPurchaseCost/branchCost/
// weightedAverageCost/effectiveCost/costSource viajaban siempre en la
// respuesta de este endpoint — cualquier CASHIER/SALES autenticado podía
// volcar el costo y margen real de todo el catálogo (el "costo del
// navegador" que el resto del sistema evita deliberadamente). Se ocultan
// salvo que el usuario tenga capacidad de ver precios/costos internos.
const COST_FIELDS = [
  "globalCost", "averageCost", "lastPurchaseCost",
  "branchCost", "weightedAverageCost", "effectiveCost", "costSource",
] as const;

function canViewProductCosts(session: SessionPayload, branchId?: string): boolean {
  const capabilities = [CAPABILITIES.FINANCE_VIEW_PRICING, CAPABILITIES.INVENTORY_VIEW, CAPABILITIES.BRANCH_INVENTORY_VIEW];
  return branchId
    ? capabilities.some((cap) => canInBranch(session, branchId, cap))
    : capabilities.some((cap) => canInAnyAssignedBranch(session, cap));
}

function redactCostFields(rows: unknown[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const clone = { ...(row as Record<string, unknown>) };
    for (const field of COST_FIELDS) delete clone[field];
    return clone;
  });
}

function isFamilyGroupShape(rows: unknown[]): rows is Array<{ family: string; categoryName: string | null; items: unknown[] }> {
  const first = rows[0];
  return rows.length > 0 && typeof first === "object" && first !== null && "items" in first && "family" in first;
}

// group=true hace que listProducts() devuelva FamilyGroup[] en vez de la
// lista plana — la redacción de costos tiene que bajar un nivel a `items`.
function redactCostFieldsDeep(rows: unknown[]): unknown[] {
  if (isFamilyGroupShape(rows)) {
    return rows.map((group) => ({ ...group, items: redactCostFields(group.items) }));
  }
  return redactCostFields(rows);
}

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { searchParams } = new URL(request.url);

    // SKU availability check: GET /api/catalog/products?checkSku=ABC-123
    const checkSku = searchParams.get("checkSku");
    if (checkSku) {
      const excludeId = searchParams.get("excludeProductId") ?? undefined;
      return ok(await checkSkuAvailable(checkSku, excludeId));
    }

    // SKU preview: GET /api/catalog/products?previewSku=true&productName=...&categoryId=...
    if (searchParams.get("previewSku") === "true") {
      const productName = searchParams.get("productName") ?? "";
      const categoryId = searchParams.get("categoryId") ?? "";
      if (!productName || !categoryId) return fail("VALIDATION_ERROR", "productName y categoryId son obligatorios.", 400);
      return ok(await previewAutoSku({ productName, categoryId }));
    }

    const q = searchParams.get("q") ?? undefined;
    const isActiveParam = searchParams.get("isActive");
    const isActive = isActiveParam === null ? undefined : isActiveParam === "true";
    const topSelling = searchParams.get("topSelling") === "true";
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;
    const branchId = searchParams.get("branchId") ?? undefined;
    // Opt-in: solo el POS lo activa. El resto de las pantallas (catálogo,
    // reposición, órdenes de compra, recetas, etc.) siguen viendo todo,
    // incluidos los productos sin stock — los necesitan para gestionarlos.
    const inStockOnly = searchParams.get("inStockOnly") === "true";
    // Agrupación por familia (ej. "Lija · 3 productos") — la pide el POS
    // para mostrar los resultados de búsqueda agrupados en vez de una lista plana.
    const group = searchParams.get("group") === "true";

    // Auditoría 2026-08-03: no se verificaba pertenencia a la sucursal
    // pedida — cualquier usuario autenticado podía consultar el catálogo
    // de una sucursal ajena con solo cambiar branchId.
    if (branchId && !hasBranchAccess(session, branchId)) {
      return fail("FORBIDDEN", "No tienes acceso a esta sucursal.", 403);
    }
    const canSeeCosts = canViewProductCosts(session, branchId);

    if (topSelling) {
      const products = await getTopSellingProducts({ limit: limit ?? 5, isActive, branchId, inStockOnly });
      return okCached(canSeeCosts ? products : redactCostFields(products), 30);
    }

    const products = await listProducts({ q, isActive, branchId, limit, inStockOnly, group });
    // Search results: short TTL so new products appear within 30s
    return okCached(canSeeCosts ? products : redactCostFieldsDeep(products as unknown[]), 30);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const parsed = createProductSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Invalid payload", 400);
    }

    const product = await createProduct({ ...parsed.data, actorUserId: session.userId });
    return created(product);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
