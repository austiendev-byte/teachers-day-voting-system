# Teacher’s Day Award Categories

This version adds 9 award categories to every election FOR EACH SCHOOL:

1. Funniest Teacher
2. Most Inspiring Teacher
3. Best Dressed Teacher
4. Most Approachable Teacher Award
5. Most Energetic Teacher Award
6. Most Punctual Teacher Award
7. Human Google Award
8. Most Updated Teacher Award
9. Teacher of the Year

## What changed

- Students vote separately once in each award category.
- Each school has its own copy of all 9 award categories. Students only see the 9 categories for their own school.
- The database validates authentication, election window, school schedule, student school, category school ownership, faculty school, and one-vote-per-category.
- New category votes are stored in `category_votes`; the existing `votes` table is preserved.
- Existing legacy `votes` are copied to the student's school-specific `Teacher of the Year` category for compatibility; the original rows are not modified or deleted.
- Admin Results uses School → Award Category selectors so every category/result is explicitly school-specific.

## Supabase migration

Run this file in Supabase SQL Editor before using the new student voting UI:

`supabase/2026-09-26-award-categories.sql` only. It is self-contained and upgrades the earlier election-wide category structure when necessary.

Run the whole file once. It is designed to be re-runnable for the seeded categories and trigger.

## Verification

1. Open an election in the admin panel.
2. Open a student account whose school has an active schedule.
3. Confirm all 9 categories appear.
4. Submit one vote in a category.
5. Confirm only the 9 categories for that student's school are shown.
6. Confirm that category is marked `✓ Voted`.
7. Select another category and confirm a separate vote can be submitted.
8. Confirm the database prevents a second vote in the same category.
9. Open Admin → Results, choose Election → School → Award Category, and verify results.

## Important

Do not remove the database RPC validation or RLS protections. The frontend is not the final security boundary.


## School-specific category structure

For every election, the database creates **9 categories × every school**. A student from one school receives only that school's 9 categories. The same award name can therefore exist separately for STCS, SNHS, SAS, STHM, SOE, SBM, STED, SCJE, and any other school present in the `schools` table.
