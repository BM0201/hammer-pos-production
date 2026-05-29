import type { NextRequest } from "next/server";
import { toApiErrorResponse } from "@/lib/api/errors";

export type ApiRouteContext<TParams = unknown> = {
  params?: TParams;
};

export type ApiRouteHandler<TContext = ApiRouteContext> = (
  request: NextRequest,
  context: TContext,
) => Response | Promise<Response>;

export function withApiErrors<TContext = ApiRouteContext>(
  handler: ApiRouteHandler<TContext>,
): ApiRouteHandler<TContext> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      return toApiErrorResponse(error);
    }
  };
}
