import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { toApiErrorResponse } from "@/lib/api/errors";
import { ok, created } from "@/lib/api/response";
import { listReorderPolicies, upsertReorderPolicy, bulkUpsertReorderPolicies } from "@/modules/reorder/service";
import { upsertPolicySchema, bulkPolicySchema } from "@/modules/reorder/validators";

/** GET /api/master/reorder/policies — list reorder policies */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session!);

    const url = new URL(req.url);
    const policies = await listReorderPolicies({
      branchId: url.searchParams.get("branchId") ?? undefined,
      productId: url.searchParams.get("productId") ?? undefined,
      isActive: url.searchParams.get("isActive") !== null
        ? url.searchParams.get("isActive") === "true"
        : undefined,
    });

    return ok(policies);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

/** POST /api/master/reorder/policies — upsert a single policy */
export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session!);

    const body = await req.json();
    const input = upsertPolicySchema.parse(body);
    const policy = await upsertReorderPolicy(input, session!.userId);

    return created(policy);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

/** PATCH /api/master/reorder/policies — bulk upsert policies */
export async function PATCH(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session!);

    const body = await req.json();
    const { policies } = bulkPolicySchema.parse(body);
    const count = await bulkUpsertReorderPolicies(policies, session!.userId);

    return ok({ count });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}