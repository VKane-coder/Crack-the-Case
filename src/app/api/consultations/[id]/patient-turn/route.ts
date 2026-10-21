import { stationRoute } from "@/server/station/http";
import { patientAvailable } from "@/server/station/llm";
import { patientTurn, StationError } from "@/server/station/orchestrator";

export const maxDuration = 60;

// POST { utterance, clientSeq, voice?, sttSeconds? } → NDJSON stream, one event per line:
//   {"type":"emotion","emotion":"anxious"}  {"type":"text","text":"…"}  {"type":"reset"}
//   {"type":"audio","index":0,"mime":"audio/mpeg","data":"<base64>"}  (voice: true, one per sentence, in order)
//   {"type":"done"} once the turn is saved (audio may still follow), or {"type":"error","code":"…","message":"…"}
// Text arrives sentence by sentence; "reset" withdraws everything shown so far for this turn.
export const POST = stationRoute<{ id: string }>(async ({ user, params, body }) => {
  if (!patientAvailable()) throw new StationError("unavailable", "The patient isn't available right now.");
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // The student may disconnect mid-turn; the turn still completes and is stored, so a resend replays it.
      let open = true;
      const send = (obj: object) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          open = false;
        }
      };
      try {
        await patientTurn(
          user.id,
          params.id,
          {
            utterance: String(body.utterance ?? ""),
            clientSeq: Number(body.clientSeq),
            voice: body.voice === true,
            sttSeconds: Number(body.sttSeconds) || 0,
          },
          (e) => send(e.type === "sentence" ? { type: "text", text: e.text } : e),
          // Not request.signal: a dropped connection shouldn't cut the reply short, since a resend replays it.
          AbortSignal.timeout(55_000),
        );
      } catch (err) {
        if (err instanceof StationError) send({ type: "error", code: err.code, message: err.message });
        else {
          console.error("patient turn failed", err);
          send({ type: "error", code: "server_error", message: "The patient didn't catch that. Please try again." });
        }
      } finally {
        if (open) controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
});
