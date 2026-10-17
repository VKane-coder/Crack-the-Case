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
| `npm run db:test` | Apply migrations + seed to a throwaway Postgres and run the RLS/integrity tests (`tests/db`) |

## Database

Schema lives in `supabase/migrations` (Postgres + RLS). Apply it with the Supabase CLI:

```bash
npx supabase link --project-ref <ref>
npx supabase db push            # migrations
npx supabase db reset --linked  # migrations + seed (DESTRUCTIVE, dev projects only)
```

Security model: students only **read** their own rows; every write except their own profile and onboarding fields goes through server code using the service role. Case bodies (which contain the diagnosis) and rubrics are never readable by students. The catalog is exposed through the `v_case_catalog` view.

## Case content

Cases are authored as JSON in `content/cases/` and extend a rubric template in `content/rubrics/`. `npm run seed:build` validates each file (Zod), merges the rubric, checks the patient's view of the case for diagnosis leaks, and emits versioned, idempotent SQL. Editing a case creates a new immutable version, so past assessments keep pointing to the version they were scored against.

> ⚠️ The three launch cases are marked `pending_clinician_review`. An Australian clinician must review them before real students use them.

## Status

- [x] **M0 Foundations**: scaffold, design tokens, UI primitives, env validation, Supabase clients, XP/level rules + tests, CI, landing and hub design preview
- [x] M1a Data: migrations, RLS, seed data (3 cases), case library pipeline, DB tests
- [ ] M1b Auth: Supabase Auth, session proxy, onboarding flow
- [ ] M2 Text-mode station + Patient Agent
- [ ] M3 Voice (Deepgram + ElevenLabs)
- [ ] M4 Examiner & Assessment
- [ ] M5 Gamification · M6 Hub & Analytics · M7 Admin & Content · M8 Hardening & Beta
