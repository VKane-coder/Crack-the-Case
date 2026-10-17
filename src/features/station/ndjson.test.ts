import { describe, expect, it } from "vitest";
import { readNdjson } from "./ndjson";

function streamOf(chunks: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      chunks.forEach((s) => c.enqueue(enc.encode(s)));
      c.close();
    },
  });
}

describe("readNdjson", () => {
  it("reassembles events split across chunks, including a final line without a newline", async () => {
    const events: unknown[] = [];
    await readNdjson(streamOf(['{"type":"emo', 'tion","emotion":"sad"}\n{"type":"te', 'xt","text":"Hi."}\n', '{"type":"done"}']), (e) =>
      events.push(e),
    );
    expect(events).toEqual([{ type: "emotion", emotion: "sad" }, { type: "text", text: "Hi." }, { type: "done" }]);
  });
});
