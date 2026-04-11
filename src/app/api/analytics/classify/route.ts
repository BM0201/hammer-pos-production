import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import {
  calculateABCClassification,
  calculateXYZClassification,
  calculateRotationIndices,
  updateDaysInStock,
  updateSuggestedMargins,
  generateProductAnalytics,
} from "@/modules/analytics/abc-classifier";

/** POST /api/analytics/classify — run full ABC-XYZ classification */
export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session!);

    const body = await req.json();
    const { month } = body;

    if (!month) {
      return NextResponse.json({ error: "Campo requerido: month (YYYY-MM)" }, { status: 400 });
    }

    const [yearStr, monthStr] = month.split("-");
    const year = parseInt(yearStr);
    const mon = parseInt(monthStr);

    if (isNaN(year) || isNaN(mon) || mon < 1 || mon > 12) {
      return NextResponse.json({ error: "Formato de mes inv\u00e1lido. Use YYYY-MM" }, { status: 400 });
    }

    // Execute all classification steps
    const abcResult = await calculateABCClassification(year, mon);
    const xyzResult = await calculateXYZClassification(year, mon);
    const rotationCount = await calculateRotationIndices(year, mon);
    const daysUpdated = await updateDaysInStock();
    const marginsUpdated = await updateSuggestedMargins();
    const analyticsCreated = await generateProductAnalytics(year, mon);

    return NextResponse.json({
      data: {
        month,
        abc: abcResult,
        xyz: xyzResult,
        rotationIndicesUpdated: rotationCount,
        daysInStockUpdated: daysUpdated,
        suggestedMarginsUpdated: marginsUpdated,
        analyticsRecordsCreated: analyticsCreated,
      },
    });
  } catch (err: any) {
    return toHttpErrorResponse(err);
  }
}
