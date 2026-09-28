# Final setup

1. Extract the project.
2. Run `npm install`.
3. In Supabase SQL Editor, run (in order, both are safe to rerun):
   - `supabase/2026-09-20-final-stability-migration.sql`
   - `supabase/2026-09-23-vote-integrity-and-hardening.sql`
4. Run `npm run dev`.

The migrations are designed to be rerunnable and do not open or close elections.
The app uses per-tab session storage so admin and student sessions cannot replace each other in the same browser.

## Realtime (updated 2026-09-23)

Students no longer depend on Supabase Realtime for anything. The student
dashboard, the shared header/footer branding, and the student's own report
list each load once and refresh only when the tab regains focus (and, for
the dashboard, when the browser regains network connectivity, and right
before a vote is submitted). No continuous subscription, no per-second
polling. `submit_vote()` independently re-validates election status,
school schedule, and duplicate-vote status against the database on every
call, so a stale browser tab can never produce an accepted vote outside
the actual rules -- it can only be told "no" a little later than a live
connection would have told it.

Realtime is still used, intentionally, for the **admin** dashboard only
(vote/election/schedule/report sync while an admin is working), which is
low-connection-count and not required for students to vote.
