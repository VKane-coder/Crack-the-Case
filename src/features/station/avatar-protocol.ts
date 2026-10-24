// Shared by the server (which starts LemonSlice sessions) and the browser (which watches them).

/** The LiveKit identity LemonSlice publishes the patient's face under. */
export const AVATAR_IDENTITY = "lemonslice-avatar";
/** LemonSlice renders at 16 kHz; the patient's speech is sent at that rate to avoid resampling. */
export const AVATAR_SAMPLE_RATE = 16000;

/** What the browser gets for its station's avatar: a watch-only room pass and where to send the speech. */
export type AvatarAccess = {
  livekitUrl: string;
  token: string;
  websocketAddress: string;
};
