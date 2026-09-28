# Performance Optimization Pass

Applied a conservative student-side optimization pass based on the uploaded performance plan.

## Applied

- Student dashboard has no Supabase Realtime subscriptions.
- School schedule uses `get_student_school_schedule(...)` first and retains the broader schedule RPC only as an error fallback.
- The one-second countdown is isolated in `src/components/StudentCountdown.jsx`; the parent dashboard only updates at known election/school boundaries or when fresh data arrives.
- Faculty grid remains memoized.
- Faculty photos use `loading="lazy"` and `decoding="async"`.
- Shared bundled branding images were resized to 192x192 maximum because the UI renders them at roughly 42–60px.
- Header/auth images use asynchronous decoding; footer emblem is lazy-loaded.
- `.env` is ignored and `.env.example` documents required public Vite variables.

## Intentionally unchanged

- `submit_vote` and vote-integrity rules.
- RLS and RPC authorization.
- Election and school schedule enforcement.
- Admin workflows.
- Visual design/layout.
- Database schema/indexes in this pass, because live indexes were not available for verification.

## Validation

Run the production build, then test the student flow manually and rerun k6 at 1, 5, and 10 VUs before increasing to 25 VUs.

## Additional optimization pass

- Layout no longer blocks route rendering while system settings load.
- Student school schedule retrieval uses one targeted RPC with no broad-schedule fallback.
- Existing voting security and database-authoritative vote validation remain unchanged.
