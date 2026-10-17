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

## Status

- [x] **M0 Foundations**: scaffold, design tokens, UI primitives, env validation, Supabase clients, XP/level rules + tests, CI, landing and hub design preview
- [ ] M1 Data & Auth: Supabase migrations, RLS, seed data, auth, onboarding
- [ ] M2 Text-mode station + Patient Agent
- [ ] M3 Voice (Deepgram + ElevenLabs)
- [ ] M4 Examiner & Assessment
- [ ] M5 Gamification · M6 Hub & Analytics · M7 Admin & Content · M8 Hardening & Beta
