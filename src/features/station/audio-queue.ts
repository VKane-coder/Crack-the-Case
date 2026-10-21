// Plays the patient's sentences one after another through a single <audio> element (works on iOS
// Safari, unlike MediaSource). stop() is barge-in: it silences the patient immediately.

/** A zero-length WAV: playing it inside a user gesture unlocks the element for later playback. */
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

export class AudioQueue {
  private el: HTMLAudioElement | null = null;
  private unlocked = false;
  private queue: string[] = [];
  private current: string | null = null;

  constructor(private readonly onPlayingChange: (playing: boolean) => void) {}

  private audio() {
    if (!this.el) {
      this.el = new Audio();
      this.el.addEventListener("ended", () => this.next());
      this.el.addEventListener("error", () => this.next());
    }
    return this.el;
  }

  /** Call from a user gesture (a click or key press) so later playback isn't blocked by autoplay rules. */
  unlock() {
    if (this.unlocked || this.current) return;
    this.unlocked = true;
    const el = this.audio();
    el.src = SILENCE;
    el.play().catch(() => {});
  }

  enqueue(base64: string, mime: string) {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    this.queue.push(URL.createObjectURL(new Blob([bytes], { type: mime })));
    if (!this.current) this.next();
  }

  stop() {
    for (const url of this.queue) URL.revokeObjectURL(url);
    this.queue = [];
    if (this.el) this.el.pause();
    this.release();
    this.onPlayingChange(false);
  }

  get playing() {
    return this.current !== null;
  }

  private release() {
    if (this.current) URL.revokeObjectURL(this.current);
    this.current = null;
  }

  private next() {
    this.release();
    const url = this.queue.shift();
    if (!url) return this.onPlayingChange(false);
    this.current = url;
    const el = this.audio();
    el.src = url;
    this.onPlayingChange(true);
    el.play().catch(() => this.next());
  }
}
