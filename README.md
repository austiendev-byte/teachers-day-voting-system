# Teachers' Day Voting System

BiPSU Teachers' Day election app: React + Vite frontend, Supabase backend.

## Development

```sh
npm install
npm run dev
```

`npm run dev` reads `.env.local` (the **load-test** Supabase project).
`npm run build` reads `.env.production.local` (the **production** project) when it exists.
Both files are gitignored; see `.env.example` for the variables.

## Deploying to Vercel

`vercel.json` configures the build, the single-page-app rewrite (so `/student`,
`/reset-password` and other routes load on refresh or from email links) and
long-lived caching for hashed assets.

1. Push this repository to GitHub, then **Add New → Project** in Vercel and import it.
   Vercel detects Vite; keep the defaults.
2. In **Settings → Environment Variables**, add for **Production**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`

   Use the values from `.env.production.local`. Optionally add the load-test
   values for **Preview**, so preview deployments never touch production data.
3. Deploy. Then in the production Supabase project, open
   **Authentication → URL Configuration** and set:
   - **Site URL**: `https://<your-project>.vercel.app`
   - **Redirect URLs**: `https://<your-project>.vercel.app/reset-password`

   Without this, password-reset emails link to the wrong address.

## Stability / authentication fixes

Before using the updated build, run:

`supabase/2026-09-19-fix-auth-election-users.sql`

in the Supabase SQL Editor as a project owner. This migration adds student approval status, student-facing election/schedule read policies, corrected vote lookup, and admin student-management RPCs.

The app also uses an isolated Supabase client during registration so a new registration cannot replace an administrator's active browser session.
