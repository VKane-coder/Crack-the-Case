import { Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack } from "livekit-client";
import { waitForAvatarReady } from "@lemonsliceai/avatar";
import { AVATAR_IDENTITY, AVATAR_SAMPLE_RATE, type AvatarAccess } from "./avatar-protocol";
import { chunkPcm } from "./pcm";

// The patient's animated face in the browser (LemonSlice over LiveKit). The browser watches the
// station's LiveKit room, where LemonSlice publishes the face with the patient's voice in sync, and
// feeds LemonSlice the patient's speech over its session WebSocket (https://lemonslice.com/docs/websocket).
// The room pass is watch-only and the socket only drives this station's avatar; no API keys are here.

export type AvatarState = "connecting" | "ready" | "lost";

export class AvatarLink {
  /** Mounted by the page wherever the face should appear. */
  readonly video: HTMLVideoElement;
  private readonly audio: HTMLAudioElement;
  private readonly room = new Room({ adaptiveStream: true });
  private ws: WebSocket | null = null;
  private stopWatching: (() => void) | null = null;
  private frameShown = false;
  private socketOpen = false;
  private closed = false;
  private responseOpen = false;
  /** Replies sent whose playback LemonSlice hasn't reported finished. */
  private playing = 0;
  state: AvatarState = "connecting";

  constructor(
    private readonly access: AvatarAccess,
    private readonly on: {
      state: (s: AvatarState) => void;
      speaking: (speaking: boolean) => void;
    },
  ) {
    this.video = document.createElement("video");
    this.video.playsInline = true;
    this.video.muted = true; // the voice plays through the audio element, in sync with the video
    this.video.autoplay = true;
    this.video.className = "size-full object-cover";
    this.audio = new Audio();
    this.audio.autoplay = true;
  }

  async connect() {
    this.room
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) => {
        if (participant.identity !== AVATAR_IDENTITY) return;
        if (track.kind === Track.Kind.Video) {
          track.attach(this.video);
          this.stopWatching?.();
          this.stopWatching = waitForAvatarReady(track.mediaStreamTrack, {
            onReady: () => {
              this.frameShown = true;
              this.update();
            },
          });
        } else if (track.kind === Track.Kind.Audio) track.attach(this.audio);
      })
      .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
        if (p.identity === AVATAR_IDENTITY) this.lose();
      })
      .on(RoomEvent.Disconnected, () => this.lose());

    const ws = new WebSocket(this.access.websocketAddress);
    this.ws = ws;
    ws.onopen = () => {
      this.socketOpen = true;
      this.update();
    };
    ws.onmessage = (ev) => {
      let msg: { command?: string } | null = null;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg?.command === "playback_finished") {
        this.playing = Math.max(0, this.playing - 1);
        if (this.playing === 0) this.on.speaking(false);
      }
    };
    ws.onclose = () => this.lose();
    await this.room.connect(this.access.livekitUrl, this.access.token);
  }

  /** Call from a click or key press: browsers only let audio start after the user has interacted. */
  startAudio() {
    void this.room.startAudio().catch(() => {});
    void this.audio.play().catch(() => {});
  }

  /** Sends one sentence of the patient's speech (base64 16 kHz PCM). */
  speak(base64Pcm: string) {
    if (this.state !== "ready") return false;
    if (!this.responseOpen) {
      this.responseOpen = true;
      this.playing++;
      this.on.speaking(true);
    }
    for (const audio of chunkPcm(base64Pcm))
      this.send({
        command: "audio",
        audio,
        sampleRate: AVATAR_SAMPLE_RATE,
        encoding: "PCM16",
      });
    return true;
  }

  /** Commits the reply so LemonSlice renders its last words (without it the face can freeze). */
  endReply() {
    if (!this.responseOpen) return;
    this.responseOpen = false;
    this.send({ command: "audio_end" });
  }

  /** Barge-in: the patient stops talking at once. */
  interrupt() {
    if (!this.responseOpen && this.playing === 0) return;
    this.responseOpen = false;
    this.playing = 0;
    this.send({ command: "interrupt" });
    this.on.speaking(false);
  }

  /** Ends the face for this station. The server also ends the session when the patient stage ends. */
  close() {
    if (this.closed) return;
    this.closed = true;
    this.send({ command: "terminate" });
    this.ws?.close();
    this.stopWatching?.();
    void this.room.disconnect();
    this.video.srcObject = null;
    this.audio.srcObject = null;
  }

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private update() {
    if (this.closed || this.state === "lost") return;
    const next: AvatarState = this.frameShown && this.socketOpen ? "ready" : "connecting";
    if (next !== this.state) this.on.state((this.state = next));
  }

  /** The face went away (idle timeout, network, LemonSlice error): the station carries on with voice only. */
  private lose() {
    if (this.closed || this.state === "lost") return;
    this.playing = 0;
    this.responseOpen = false;
    this.on.speaking(false);
    this.on.state((this.state = "lost"));
    this.close();
  }
}
