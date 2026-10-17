import "server-only";
import { z } from "zod";

// Only the service role key is needed everywhere; feature keys are checked where they're used.
const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  DEEPGRAM_API_KEY: z.string().min(1).optional(),
  ELEVENLABS_API_KEY: z.string().min(1).optional(),
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
});

type ServerEnv = z.infer<typeof serverSchema>;
let cached: ServerEnv | undefined;

// Parsed lazily so builds and pages that don't need secrets work without them.
export function serverEnv() {
  cached ??= serverSchema.parse(process.env);
  return cached;
}

export function requireServerEnv<K extends keyof ServerEnv>(key: K): NonNullable<ServerEnv[K]> {
  const value = serverEnv()[key];
  if (value === undefined || value === "") throw new Error(`Missing required environment variable ${key}`);
  return value as NonNullable<ServerEnv[K]>;
}
