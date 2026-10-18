import { EMOTIONS, type Emotion } from "./prompts/role-contract";

// Turns the model's raw text stream into what the student hears: strips the leading
// [emotion:x] tag and releases whole sentences, so each one can pass the guardrail (and, from M3,
// go to text-to-speech) before the student sees it.

export type SpeechEvent = { type: "emotion"; emotion: Emotion } | { type: "sentence"; text: string };

const TAG = /^\s*\[emotion:\s*([a-z_]+)\s*\]\s*/i;
// A sentence ends at . ! ? or … (optionally followed by closing quotes/brackets) and then whitespace.
const BOUNDARY = /[.!?…]+["'”’)]*\s+/g;
// The first piece of a reply may end at a clause instead, so the patient starts speaking sooner.
const CLAUSE = /[,;:—–]\s+/g;
const MIN_FIRST_CLAUSE = 24;

export function parseEmotion(raw: string): Emotion {
  const e = raw.toLowerCase() as Emotion;
  return EMOTIONS.includes(e) ? e : "neutral";
}

/** Removes things that can't be spoken: *actions*, (stage directions), markdown bullets and headings. */
export function cleanSpoken(text: string): string {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*[^*\n]{1,80}\*/g, " ")
    .replace(/^\s*[-#>]+\s*/gm, "")
    .replace(/\((?:pauses|sighs|laughs|looks|shifts|hesitates|nods|shrugs|frowns|smiles)[^()]{0,60}\)/gi, " ")
    .replace(/[*_`]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export class SpeechBuffer {
  private buf = "";
  private tagResolved = false;
  private released = false;
  emotion: Emotion = "neutral";

  push(delta: string): SpeechEvent[] {
    this.buf += delta;
    const out: SpeechEvent[] = [];
    if (!this.tagResolved) {
      const emotion = this.resolveTag(false);
      if (!emotion) return out;
      out.push({ type: "emotion", emotion });
    }
    let cut = 0;
    for (const m of this.buf.matchAll(BOUNDARY)) cut = m.index + m[0].length;
    if (cut === 0 && !this.released) {
      for (const m of this.buf.matchAll(CLAUSE)) {
        if (m.index >= MIN_FIRST_CLAUSE) {
          cut = m.index + m[0].length;
          break;
        }
      }
    }
    if (cut > 0) {
      this.released = true;
      const ready = cleanSpoken(this.buf.slice(0, cut));
      this.buf = this.buf.slice(cut);
      if (ready) out.push({ type: "sentence", text: ready });
    }
    return out;
  }

  /** Releases whatever is left once the model has finished. */
  flush(): SpeechEvent[] {
    const out: SpeechEvent[] = [];
    if (!this.tagResolved) {
      const emotion = this.resolveTag(true);
      if (emotion) out.push({ type: "emotion", emotion });
    }
    const rest = cleanSpoken(this.buf);
    this.buf = "";
    if (rest) out.push({ type: "sentence", text: rest });
    return out;
  }

  /** Strips the leading tag once it can be decided. Returns undefined while still waiting for more text. */
  private resolveTag(final: boolean): Emotion | undefined {
    const m = TAG.exec(this.buf);
    if (m) {
      this.emotion = parseEmotion(m[1]);
      this.buf = this.buf.slice(m[0].length);
    } else {
      const trimmed = this.buf.trimStart();
      const mightBeTag = trimmed.startsWith("[") && !trimmed.includes("]") && trimmed.length <= 32;
      if (!final && (trimmed.length === 0 || mightBeTag)) return undefined;
      // No tag, or a malformed one: drop a leading [...] if present and use a neutral face.
      this.buf = trimmed.startsWith("[") && trimmed.includes("]") ? trimmed.slice(trimmed.indexOf("]") + 1) : trimmed;
      this.emotion = "neutral";
    }
    this.tagResolved = true;
    return this.emotion;
  }
}
