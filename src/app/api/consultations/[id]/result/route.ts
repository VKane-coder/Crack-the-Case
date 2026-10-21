import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/server/auth/session";
import { errorBody, stationErrorResponse } from "@/server/station/http";
import { loadOwned } from "@/server/station/orchestrator";
import { createAdminClient } from "@/lib/supabase/admin";

// GET → { status } for polling while the examiner marks. The report itself renders on /results/[id].
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json(errorBody("unauthenticated", "Please sign in again."), { status: 401 });
  try {
    const station = await loadOwned(createAdminClient(), user.id, (await params).id);
    return NextResponse.json({ data: { status: station.status } }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return stationErrorResponse(err);
  }
}
