import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseFilters } from "@/features/case-library/filters";
import { getUser } from "@/server/auth/session";
import { listCases } from "@/server/cases/catalog";
import { errorBody, stationErrorResponse } from "@/server/station/http";

// GET /api/cases?q=&specialty=&difficulty=&length=&page= → { data: CatalogPage }
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json(errorBody("unauthenticated", "Please sign in again."), { status: 401 });
  try {
    const data = await listCases(await createClient(), user.id, parseFilters(request.nextUrl.searchParams));
    return NextResponse.json({ data });
  } catch (err) {
    return stationErrorResponse(err);
  }
}
