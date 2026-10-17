# Crack the Case

AI-powered OSCE practice for Australian medical students. Students take a voice history from an AI patient, present to an AI examiner, get rubric-based feedback, and earn XP, streaks and badges.

The full technical blueprint (architecture, schema, agents, voice pipeline, milestones) is in [`docs/architecture.md`](docs/architecture.md).

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · shadcn/ui (Radix) · Supabase (Postgres, Auth, Storage) · Anthropic Claude · Deepgram · ElevenLabs

## Getting started

```bash
cp .env.example .env.local   # fill in keys (not needed for the M0 preview pages)
npm install
npm run dev                  # http://localhost:3000, design preview at /hub
```

| Script | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint, including the patient/examiner agent isolation rule |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests |
| `npm run seed:build` | Regenerate `supabase/seed/05_levels.sql` and `10_cases.sql` from `content/` and the level maths |
| `npm run test:e2e` | Playwright end-to-end tests against a real Supabase project (needs the env below) |
| `npm run supabase:admin -- <status\|migrate\|seed\|auth-config> [--dry-run]` | Apply migrations, seed and auth settings to the hosted project via the Management API |
| `npm run db:test` | Apply migrations + seed to a throwaway Postgres and run the RLS/integrity tests (`tests/db`) |
| `npm run voices:list` | List the ElevenLabs voices on your account (Australian accents first) to fill in `ELEVENLABS_VOICE_MAP` |
| `npm run eval:patient` | Adversarial leak eval against the real patient agent (needs `ANTHROPIC_API_KEY`, costs a few cents) |

## Database

Schema lives in `supabase/migrations` (Postgres + RLS). Apply it with the Supabase CLI:

```bash
npx supabase link --project-ref <ref>
npx supabase db push            # migrations
npx supabase db reset --linked  # migrations + seed (DESTRUCTIVE, dev projects only)
```

Security model: students only **read** their own rows; every write except their own profile and onboarding fields goes through server code using the service role. Case bodies (which contain the diagnosis) and rubrics are never readable by students. The catalog is exposed through the `v_case_catalog` view.

## Auth

Students sign in with a single email that carries a **magic link and a 6-digit code** (the code helps when the link opens in a different browser), or with **Google**.

- `src/proxy.ts` refreshes the Supabase session on every request and sends signed-out visitors to `/login?next=…`. Every `next` is passed through `safeNext()` to block open redirects.
- `/auth/confirm` verifies email links via `token_hash` (works across browsers). `/auth/callback` handles Google. `/auth/signout` is POST-only.
- The `(app)` layout sends students who haven't onboarded to `/onboarding`: avatar → goals → exam → specialties. Onboarding writes go through the student's own RLS-limited session. The +50 welcome XP goes through the service-role `grant_xp` RPC, which is idempotent.

**Setting up a Supabase project**

1. Fill in `.env.local` from `.env.example` (URL, anon key, service role key, `SUPABASE_ACCESS_TOKEN`).
2. Run `npm run supabase:admin -- migrate`, then `seed`, then `auth-config`. Each command supports `--dry-run`. `auth-config` sets the site URL, redirect allow-list, 6-digit OTP and the branded magic-link email (`supabase/templates/magic-link.html`).
3. Google: create an OAuth client in Google Cloud, enable the Google provider in the Supabase dashboard, then set `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED=true`.
4. Before real students use it: configure custom SMTP (e.g. Resend). Supabase's built-in mailer only reaches project team members and is rate-limited.

## Stations

A station runs reading time (60 s with the candidate brief), then a timed history with the AI patient, then the presentation and examiner phases (M4). Students talk to the patient (push-to-talk) or type.

- **Server-owned state.** `src/server/station/orchestrator.ts` moves a consultation through the state machine with the guarded `transition_consultation()` RPC and writes with the service role. The server deadline (plus 5 s grace) is the real limit; the browser clock only displays it. Starting a new case abandons any station in progress.
- **Patient agent** (`src/server/agents/patient`). Sees only `case_versions.patient_view`, never the diagnosis or rubric; a lint rule blocks examiner and rubric imports. The system prompt is three cached layers (role contract, persona, patient script); the station clock and the facts revealed so far go in a per-turn system message after the cache breakpoint. Replies stream sentence by sentence with a leading `[emotion:x]` tag (stripped, drives the face) and a `mark_disclosed` tool call that records which script facts the student elicited.
- **Models.** `claude-sonnet-5-5` at low effort with server-side refusal fallback; on an error or a slow first token the turn moves to `claude-haiku-5-5`. Every call is logged to `ai_calls` with tokens, cache reads and cost.
- **Guardrail** (`src/server/agents/guardrails/patient.ts`). Every sentence is checked for the diagnosis and its synonyms, coaching and stepping out of role before the student sees it. A trip withdraws the reply, regenerates once with a correction, and otherwise falls back to a neutral in-role line.
- **API.** `POST /api/consultations` · `/[id]/start-history` · `/[id]/patient-turn` (NDJSON stream; idempotent per `clientSeq`, so a resend replays the stored reply) · `/[id]/end-history`.
- **Config.** Set `ANTHROPIC_API_KEY` (locally and in Vercel) for the real patient. Without it the hub shows "Patients unavailable". `PATIENT_LLM=fake` swaps in a scripted patient for e2e runs and local UI work; it is ignored on Vercel production.

## Voice

Student speaks → Deepgram → transcript → Claude → guardrail → ElevenLabs → patient speaks.

- **Speech in** (`src/features/station/use-speech-input.ts`). Push-to-talk: hold the button or the space bar. The browser opens one Deepgram WebSocket for the history phase with a 30-second token from `POST /api/voice/deepgram-token` (only issued for the student's own station while its history is running), keeps it alive between presses, and streams raw 16-bit PCM from an AudioWorklet only while the button is held. Releasing sends `Finalize` and submits the transcript to the same patient-turn endpoint as typing. Audio never touches our servers, and Deepgram's model-improvement programme is opted out (`mip_opt_out`). Defaults: `nova-3-medical`, `en`, plus generic medical keyterms (`src/server/voice/deepgram.ts`); case-specific terms are deliberately not sent to the browser.
- **Speech out** (`src/server/voice`). Each sentence that passes the guardrail is synthesised with ElevenLabs Flash v2.5 as soon as it's released, in parallel with the next one, and streamed back in order as `audio` events (MP3, base64). The patient's emotion tag sets stability and speed. A guardrail retry withdraws queued audio too. The browser plays sentences through one `<audio>` element (works on iOS).
- **Barge-in and fallbacks.** Pressing talk silences the patient. Typing always works. A blocked microphone, missing keys, or a vendor error fall back to text and never stop the station. Students can turn the patient's voice off.
- **Voices.** Each case names a `voice_profile` (e.g. `au-female-60s-soft`). Without configuration the server picks the best match on your ElevenLabs account once per instance (Australian accent, then gender, then age) and logs its choice. To choose yourself, set `ELEVENLABS_VOICE_MAP` (profile → voice id; `npm run voices:list` helps) or `ELEVENLABS_DEFAULT_VOICE_ID`.
- **Cost logging.** `voice_usage` records ElevenLabs characters and Deepgram seconds per turn; set `ELEVENLABS_USD_PER_1K_CHARS` and `DEEPGRAM_USD_PER_MINUTE` to your plan's rates.
- **Config.** `DEEPGRAM_API_KEY` (Member role, needed to mint tokens) and `ELEVENLABS_API_KEY`. `VOICE_PROVIDERS=fake` swaps in a scripted recogniser and silent audio for e2e runs; ignored on Vercel production.

## Case content

Cases are authored as JSON in `content/cases/` and extend a rubric template in `content/rubrics/`. `npm run seed:build` validates each file (Zod), merges the rubric, checks the patient's view of the case for diagnosis leaks, and emits versioned, idempotent SQL. Editing a case creates a new immutable version, so past assessments keep pointing to the version they were scored against.

> ⚠️ The three launch cases are marked `pending_clinician_review`. An Australian clinician must review them before real students use them.

## Status

- [x] **M0 Foundations**: scaffold, design tokens, UI primitives, env validation, Supabase clients, XP/level rules + tests, CI, landing and hub design preview
- [x] M1a Data: migrations, RLS, seed data (3 cases), case library pipeline, DB tests
- [x] M1b Auth: email link + code and Google sign-in, session proxy, 4-step onboarding, real-data hub
- [x] M2 Text-mode station + Patient Agent: reading time, timed history with a streaming patient, personas, disclosure tracking, guardrail, model fallback, cost logging, leak eval
- [x] M3 Voice: push-to-talk Deepgram streaming from the browser, sentence-streamed ElevenLabs voices with emotion, barge-in, text fallbacks, voice cost logging
- [ ] M4 Examiner & Assessment
- [ ] M5 Gamification · M6 Hub & Analytics · M7 Admin & Content · M8 Hardening & Beta
