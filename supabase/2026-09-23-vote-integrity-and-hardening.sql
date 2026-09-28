-- Teachers' Day Voting System - VOTE INTEGRITY AND HARDENING MIGRATION
-- Applied directly to the connected Supabase project on 2026-09-23.
-- This file documents that change for source control; it is safe to
-- rerun (every statement is idempotent / CREATE OR REPLACE / IF NOT EXISTS).
--
-- IMPORTANT CONTEXT: submit_vote(), is_admin(), close_election(),
-- open_election(), get_election_results(), save_election_school_schedule(),
-- and several other RPCs referenced below were NOT present anywhere in this
-- repository before this migration -- they existed only live in Supabase.
-- That is a real gap: keep this file (and future ones) in source control
-- going forward so the schema stops drifting from what's checked in.

begin;

-- ================================================================
-- 1. VOTE INTEGRITY FIX
-- submit_vote() previously checked only that the election ROW EXISTED,
-- never that elections.status = 'open'. That means close_election()
-- (the admin's emergency stop) had no effect on a student whose school
-- schedule window was still open -- they could keep voting after the
-- admin explicitly closed the election. Fixed by checking status.
--
-- Also wraps the insert in an exception handler so a genuine race (two
-- concurrent submits passing the pre-check at the same instant) raises
-- the same friendly "already voted" message instead of a raw Postgres
-- unique_violation. The UNIQUE (election_id, student_id) constraint on
-- votes is what actually guarantees only one succeeds -- this only
-- improves the error message on the losing request.
-- ================================================================
create or replace function public.submit_vote(p_election_id bigint, p_faculty_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_student_id bigint;
    v_student_school_id bigint;
    v_faculty_school_id bigint;
    v_election_status text;
    v_schedule_start timestamptz;
    v_schedule_end timestamptz;
begin
    if auth.uid() is null then
        raise exception 'You must be logged in to vote.';
    end if;

    select st.id, p.school_id
    into v_student_id, v_student_school_id
    from public.students st
    join public.programs p on st.program_id = p.id
    where st.auth_user_id = auth.uid();

    if v_student_id is null then
        raise exception 'Student profile not found.';
    end if;

    select status into v_election_status
    from public.elections
    where id = p_election_id;

    if v_election_status is null then
        raise exception 'Election not found.';
    end if;

    if v_election_status <> 'open' then
        raise exception 'This election is not currently open for voting.';
    end if;

    select start_date, end_date
    into v_schedule_start, v_schedule_end
    from public.election_school_schedules
    where election_id = p_election_id
      and school_id = v_student_school_id;

    if v_schedule_start is null then
        raise exception 'No voting schedule has been assigned to your school.';
    end if;

    if now() < v_schedule_start then
        raise exception 'Voting for your school has not started yet.';
    end if;

    if now() > v_schedule_end then
        raise exception 'Voting for your school has already ended.';
    end if;

    select school_id
    into v_faculty_school_id
    from public.faculty
    where id = p_faculty_id;

    if v_faculty_school_id is null then
        raise exception 'Faculty member not found.';
    end if;

    if v_faculty_school_id <> v_student_school_id then
        raise exception 'You can only vote for faculty from your school.';
    end if;

    if exists (
        select 1 from public.votes
        where election_id = p_election_id and student_id = v_student_id
    ) then
        raise exception 'You have already voted in this election.';
    end if;

    begin
        insert into public.votes (election_id, student_id, faculty_id)
        values (p_election_id, v_student_id, p_faculty_id);
    exception when unique_violation then
        raise exception 'You have already voted in this election.';
    end;
end;
$function$;

-- ================================================================
-- 2. Pin search_path on trigger functions (Supabase advisor WARN:
-- function_search_path_mutable). Behavior is unchanged, only hardened.
-- ================================================================
create or replace function public.set_system_settings_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$function$;

create or replace function public.set_report_reference_number()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.reference_number is null then
    new.reference_number := 'RPT-' || lpad(nextval('public.report_reference_seq')::text, 6, '0');
  end if;
  return new;
end;
$function$;

create or replace function public.set_reports_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

create or replace function public.set_support_report_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

-- ================================================================
-- 3. Reduce attack surface: revoke EXECUTE on every application RPC
-- from `anon` (unauthenticated) and bare `public`; grant to
-- `authenticated` only. Every one of these already enforces its own
-- auth.uid()/is_admin() check internally, so legitimate behavior for
-- students and admins is unchanged. This only removes the ability for
-- an unauthenticated request to reach these endpoints at all
-- (Supabase advisor WARN: anon_security_definer_function_executable).
-- ================================================================
do $$
declare
  fn record;
begin
  for fn in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef = true
  loop
    execute format('revoke all on function public.%I(%s) from public;', fn.proname, fn.args);
    execute format('revoke all on function public.%I(%s) from anon;', fn.proname, fn.args);
    execute format('grant execute on function public.%I(%s) to authenticated;', fn.proname, fn.args);
  end loop;
end $$;

-- ================================================================
-- 4. RLS performance: wrap auth.uid() in (select auth.uid()) so
-- Postgres evaluates it once per query instead of once per row
-- (Supabase advisor WARN: auth_rls_initplan -- matters at 13k-student
-- scale). Also drops duplicate policies left over from the two
-- migrations that were applied on top of each other (advisor WARN:
-- multiple_permissive_policies).
-- ================================================================
drop policy if exists "students can read own profile" on public.students;
drop policy if exists "Students can view their own profile" on public.students;
create policy "students can read own profile"
on public.students for select to authenticated
using (auth_user_id = (select auth.uid()));

drop policy if exists "students can insert own profile" on public.students;
drop policy if exists "Students can create their own profile" on public.students;
create policy "students can insert own profile"
on public.students for insert to authenticated
with check (auth_user_id = (select auth.uid()));

drop policy if exists "students can read own reports" on public.reports;
drop policy if exists "student_view_own_reports" on public.reports;
drop policy if exists "reports_student_select_own" on public.reports;
create policy "students can read own reports"
on public.reports for select to authenticated
using (
  exists (
    select 1 from public.students st
    where st.id = reports.student_id
      and st.auth_user_id = (select auth.uid())
  )
);

drop policy if exists "admins can read reports" on public.reports;
drop policy if exists "admin_view_all_reports" on public.reports;
drop policy if exists "reports_admin_select_all" on public.reports;
create policy "admins can read reports"
on public.reports for select to authenticated
using (public.is_admin());

drop policy if exists "authenticated users can read elections" on public.elections;
-- "Authenticated users can view elections" is kept as the single SELECT policy.

-- ================================================================
-- 5. Missing FK-covering indexes (advisor INFO: unindexed_foreign_keys).
-- Matters for admin_delete_student's cascading deletes and for joins
-- at 13k-student / ~900-faculty scale.
-- ================================================================
create index if not exists idx_election_school_schedules_school_id
  on public.election_school_schedules (school_id);
create index if not exists idx_faculty_program_id
  on public.faculty (program_id);
create index if not exists idx_programs_school_id
  on public.programs (school_id);
create index if not exists idx_students_program_id
  on public.students (program_id);
create index if not exists idx_votes_faculty_id
  on public.votes (faculty_id);
create index if not exists idx_votes_student_id
  on public.votes (student_id);

commit;

-- NOT covered by this migration, and still open:
--   - Auth > Policies > "Leaked password protection" is disabled. This is
--     a dashboard/Auth-config toggle, not SQL -- enable it before the
--     election (https://supabase.com/docs/guides/auth/password-security).
--   - `votes` and `user_roles` show as "RLS enabled, no policy" in the
--     advisor. This is intentional: both tables are meant to be
--     unreachable directly and are only ever read/written through
--     SECURITY DEFINER RPCs. Left as-is on purpose.
