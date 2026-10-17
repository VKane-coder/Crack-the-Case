"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DeepgramClient } from "@deepgram/sdk";
import { floatTo16BitPcm, TranscriptAssembler, type SttResult } from "./transcript";

// Push-to-talk speech input (docs/architecture.md §8.1). One Deepgram socket stays open for the
// history phase (kept alive between presses); microphone audio is tapped as raw PCM and only sent
// while the student holds the talk button. Audio goes browser → Deepgram, never via our servers.

export type SpeechState = "idle" | "connecting" | "listening" | "finalizing" | "error";
export type SpeechError = "mic_denied" | "unavailable" | "connection";

type TokenResponse = {
  provider: "deepgram" | "fake";
  accessToken: string;
  settings: { model: string; language: string; keyterms: string[] };
};

type Socket = Awaited<ReturnType<DeepgramClient["listen"]["v1"]["connect"]>>;

const KEEPALIVE_MS = 4_000;
const FINALIZE_TIMEOUT_MS = 2_500;
const SEND_EVERY_SAMPLES_MS = 100;

// Runs on the audio thread: forwards each 128-sample block of the first channel.
const WORKLET = `class PcmTap extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor("pcm-tap", PcmTap);`;

export function useSpeechInput(consultationId: string, enabled: boolean) {
  const [state, setState] = useState<SpeechState>("idle");
  const [error, setError] = useState<SpeechError | null>(null);
  const [caption, setCaption] = useState("");

  const socket = useRef<Socket | null>(null);
  const fake = useRef(false);
  const keepalive = useRef<ReturnType<typeof setInterval> | null>(null);
  const mic = useRef<{ stream: MediaStream; ctx: AudioContext } | null>(null);
  const listening = useRef(false);
  const pending = useRef<Float32Array[]>([]);
  const pendingSamples = useRef(0);
  const assembler = useRef(new TranscriptAssembler());
  const finalized = useRef<(() => void) | null>(null);
  const starting = useRef<Promise<boolean> | null>(null);
  const pressedAt = useRef(0);

  const flush = useCallback(() => {
    if (!pendingSamples.current || !socket.current) return;
    const merged = new Float32Array(pendingSamples.current);
    let o = 0;
    for (const chunk of pending.current) {
      merged.set(chunk, o);
      o += chunk.length;
    }
    pending.current = [];
    pendingSamples.current = 0;
    socket.current.sendMedia(floatTo16BitPcm(merged));
  }, []);

  const ensureMic = useCallback(async () => {
    if (mic.current) return mic.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const ctx = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const tap = new AudioWorkletNode(ctx, "pcm-tap");
    const mute = ctx.createGain();
    mute.gain.value = 0;
    ctx.createMediaStreamSource(stream).connect(tap).connect(mute).connect(ctx.destination);
    const batch = Math.round((ctx.sampleRate * SEND_EVERY_SAMPLES_MS) / 1000);
    tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (!listening.current) return;
      pending.current.push(e.data);
      pendingSamples.current += e.data.length;
      if (pendingSamples.current >= batch) flush();
    };
    mic.current = { stream, ctx };
    return mic.current;
  }, [flush]);

  const fetchToken = useCallback(async (): Promise<TokenResponse> => {
    const res = await fetch("/api/voice/deepgram-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ consultationId }),
    });
    const body = (await res.json().catch(() => null)) as { data?: TokenResponse } | null;
    if (!body?.data) throw Object.assign(new Error("token"), { kind: res.status === 503 ? "unavailable" : "connection" });
    return body.data;
  }, [consultationId]);

  const openSocket = useCallback(async ({ accessToken, settings }: TokenResponse, sampleRate: number) => {
    const s = await new DeepgramClient({ accessToken }).listen.v1.connect({
      model: settings.model,
      language: settings.language,
      keyterm: settings.keyterms,
      encoding: "linear16",
      sample_rate: String(sampleRate),
      channels: "1",
      interim_results: "true",
      smart_format: "true",
      punctuate: "true",
      // Opt out of Deepgram's model improvement programme: student voices are personal data.
      mip_opt_out: "true",
    });
    s.on("message", (msg) => {
      if ((msg as { type?: string }).type !== "Results") return;
      const done = assembler.current.add(msg as unknown as SttResult);
      setCaption(assembler.current.live);
      if (done) finalized.current?.();
    });
    s.on("close", () => {
      if (keepalive.current) clearInterval(keepalive.current);
      socket.current = null;
    });
    s.connect();
    await s.waitForOpen();
    socket.current = s;
    keepalive.current = setInterval(() => socket.current?.sendKeepAlive({ type: "KeepAlive" }), KEEPALIVE_MS);
  }, []);

  /** Press: open the mic (first time asks permission) and start streaming. */
  const start = useCallback(() => {
    if (!enabled || starting.current) return;
    setError(null);
    assembler.current.reset();
    setCaption("");
    pressedAt.current = Date.now();
    setState("connecting");
    starting.current = (async () => {
      try {
        // The token says which provider is live; the scripted one (e2e) needs no microphone.
        const token = socket.current || fake.current ? null : await fetchToken();
        if (token?.provider === "fake") fake.current = true;
        if (!fake.current) {
          const { ctx } = await ensureMic();
          if (ctx.state === "suspended") await ctx.resume();
          if (token && !socket.current) await openSocket(token, ctx.sampleRate);
          else if (!socket.current) await openSocket(await fetchToken(), ctx.sampleRate);
        }
        listening.current = true;
        setState("listening");
        return true;
      } catch (err) {
        const kind = (err as { kind?: SpeechError; name?: string }).kind;
        const denied = (err as { name?: string }).name === "NotAllowedError";
        setError(denied ? "mic_denied" : (kind ?? "connection"));
        setState("error");
        return false;
      }
    })();
  }, [enabled, ensureMic, fetchToken, openSocket]);

  /** Release: finalise and return what was said, with how long the student held the button. */
  const stop = useCallback(async (): Promise<{ text: string; seconds: number } | null> => {
    const ok = await starting.current;
    starting.current = null;
    if (!ok) return null;
    listening.current = false;
    const seconds = (Date.now() - pressedAt.current) / 1000;
    if (fake.current) {
      setState("idle");
      const text = (window as unknown as { __fakeSttTranscript?: string }).__fakeSttTranscript ?? "";
      return { text, seconds };
    }
    setState("finalizing");
    flush();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, FINALIZE_TIMEOUT_MS);
      finalized.current = () => {
        clearTimeout(timer);
        resolve();
      };
      socket.current?.sendFinalize({ type: "Finalize" });
    });
    finalized.current = null;
    setState("idle");
    return { text: assembler.current.final, seconds };
  }, [flush]);

  useEffect(
    () => () => {
      if (keepalive.current) clearInterval(keepalive.current);
      socket.current?.close();
      mic.current?.stream.getTracks().forEach((t) => t.stop());
      void mic.current?.ctx.close();
    },
    [],
  );

  return { state, error, caption, start, stop };
}
