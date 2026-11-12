import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { getUserId } from "@/server/auth/session";
import { StationError } from "./orchestrator";

// Shared plumbing for /api/consultations/*: auth, JSON-only bodies, and the
// { data } | { error: { code, message, retryable } } envelope (docs/architecture.md §6).

const STATUS: Record<StationError["code"], number> = {
  not_found: 404,
  wrong_phase: 409,
  phase_over: 409,
  turn_in_progress: 409,
  invalid_input: 400,
  unavailable: 503,
};

export function errorBody(code: string, message: string, retryable = false) {
  return { error: { code, message, retryable } };
}

export function stationErrorResponse(err: unknown) {
  if (err instanceof StationError)
    return NextResponse.json(errorBody(err.code, err.message, err.code === "unavailable"), { status: STATUS[err.code] });
  console.error("station request failed", err);
  return NextResponse.json(errorBody("server_error", "Something went wrong on our side. Please try again.", true), { status: 500 });
}

type Handler<P> = (ctx: { request: NextRequest; user: { id: string }; params: P; body: Record<string, unknown> }) => Promise<Response>;

export function stationRoute<P>(handler: Handler<P>) {
  return async (request: NextRequest, { params }: { params: Promise<P> }) => {
    // JSON-only: a cross-site form post can't send application/json without a CORS preflight.
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      return NextResponse.json(errorBody("invalid_input", "Expected a JSON body."), { status: 415 });
    }
    const userId = await getUserId();
    if (!userId) return NextResponse.json(errorBody("unauthenticated", "Please sign in again."), { status: 401 });
    const user = { id: userId };
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return NextResponse.json(errorBody("invalid_input", "Expected a JSON body."), { status: 400 });
    }
    try {
      return await handler({ request, user, params: await params, body });
    } catch (err) {
      return stationErrorResponse(err);
    }
  };
}
