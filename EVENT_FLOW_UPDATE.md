# Teacher's Day Voting System — Event Flow Update

## Target event flow
- 13,000 registered students total.
- All schools open at the same time.
- Approximately 3,000 students are expected to use the system per hour.
- Each student votes in 9 school-specific award categories.
- Faculty photos are removed from the student voting experience.
- Students complete the remaining categories, review their selections, then submit one final ballot.

## Student-side changes
- Replaced category-by-category submission UI with a single formal 9-category ballot.
- Uses lightweight select controls instead of faculty photo cards.
- Uses `get_my_school_election_schedule()` so the client does not supply its own school id.
- Uses `submit_full_ballot()` for one transactional submission.
- Existing already-voted categories remain protected and are shown as completed.
- Countdown and no-Realtime student architecture are preserved.

## Database chunks to apply
1. Existing award category chunks 1–6 must be successful.
2. Run `supabase/2026-09-27-ballot-security-and-schedule-CHUNK-7.sql`.
3. Run `supabase/2026-09-27-admin-progress-category-model-CHUNK-8.sql`.

## Admin-side changes
- Main school-progress RPC now measures completed ballots and category votes.
- Admin Realtime listens to `category_votes` for the selected election.
- The existing detailed Results module remains the category-specific result source.

## Testing order
1. Apply DB chunks 7 and 8 in Supabase.
2. Verify 9 categories exist for every election/school.
3. Build in Windows PowerShell.
4. Manually complete a test ballot.
5. Verify duplicate and cross-school protections.
6. Run API k6 tests, not hundreds of Chromium browsers, for high concurrency.
