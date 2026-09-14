# Wiki Race

Self-hosted Wikipedia race for playing with friends: host a room, share the
5-character code, race from a random start page to a random target page by
clicking through real Wikipedia links.

## Setup

1. Create a Supabase project.
2. Run every file in `supabase/migrations/` against it, in order (SQL editor or `supabase db push`).
3. Copy `.env.local.example` to `.env.local` and fill in the project URL, anon key, and service-role key from Supabase's API settings.
4. `npm install`
5. `npm run dev`

## Scripts

- `npm run dev` — local dev server
- `npm run test` — unit tests (vitest)
- `npm run lint` — eslint
- `npm run build` — production build
