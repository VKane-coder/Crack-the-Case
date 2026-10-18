// Reads a newline-delimited JSON response body, calling onEvent for each complete line as it arrives.
export async function readNdjson<T>(body: ReadableStream<Uint8Array>, onEvent: (event: T) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as T);
    }
    if (done) break;
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as T);
}

export type PatientStreamEvent =
  | { type: "emotion"; emotion: string }
  | { type: "text"; text: string }
  | { type: "reset" }
  | { type: "audio"; index: number; mime: string; data: string }
  | { type: "voice_error"; code: string }
  | { type: "done" }
  | { type: "error"; code: string; message: string };
